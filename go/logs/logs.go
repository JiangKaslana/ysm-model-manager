package logs

import (
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ===== 日志上限常量（P3 修复：原 500/1024 散落硬编码）=====
// maxLogEntries 日志条数上限（load 与 addOp 共用，测试同步引用）
const maxLogEntries = 500

// maxFieldLen 单字段最大长度（rune 计，防日志文件无界膨胀）
const maxFieldLen = 1024

// corruptSuffix 损坏日志备份后缀
const corruptSuffix = ".corrupt"

// corruptRetentionDays .corrupt 备份保留天数（启动 load 时清理更早的现场）
const corruptRetentionDays = 7

// logMaxEntries 日志条数上限：AppConfig.LogMaxEntries > 0 用之，否则默认 500。
// 配置源收敛到 go/config 单持有点（ADR-091 D12），字段 0 = 回退包级默认。
func logMaxEntries() int {
	if n := config.Get().LogMaxEntries; n > 0 {
		return n
	}
	return maxLogEntries
}

// logMaxFieldLen 单字段长度上限：AppConfig.LogMaxFieldLen > 0 用之，否则默认 1024
func logMaxFieldLen() int {
	if n := config.Get().LogMaxFieldLen; n > 0 {
		return n
	}
	return maxFieldLen
}

// logCorruptRetentionDays .corrupt 保留天数：AppConfig.LogCorruptRetentionDays > 0 用之，否则默认 7
func logCorruptRetentionDays() int {
	if n := config.Get().LogCorruptRetentionDays; n > 0 {
		return n
	}
	return corruptRetentionDays
}

// Logger 导入日志管理器
type Logger struct {
	mu   sync.Mutex
	logs []types.ImportLog
	path string
	// saveTimer 防抖合并写定时器（ADR-082 续）：批量高频 addOp（如 sync 逐文件安装
	// InstallModelTo）每次 save 都全量重写 JSON（O(N²) 写放大），窗口内合并为一次落盘
	saveTimer *time.Timer
}

// saveDebounce 落盘防抖窗口：窗口内多条 addOp 合并为一次 save。
// 权衡：窗口越大合并收益越高、崩溃时最后几条日志丢失窗口越长；300ms 平衡两者
// （日志是审计/诊断数据，非关键事务，且 500 条上限本就截断最旧记录）。
const saveDebounce = 300 * time.Millisecond

// NewLogger 创建日志管理器
// configDir 为应用配置根目录（含 "YSM-Model-Manager" 子目录）——
// 由调用方（internal/app）注入，与 config/tags 共用同一根目录（ADR-046 P2，
// 避免 Android 上 os.UserConfigDir() 与 PathManager 落点分叉）
func NewLogger(configDir string) *Logger {
	if configDir == "" {
		// 平台数据根缺失（Android 沙盒不可用等）：内存态 logger——
		// save no-op，绝不降级相对路径（原降级 "." 在 CWD=/ 只读时静默丢失日志）
		l := &Logger{logs: []types.ImportLog{}}
		return l
	}
	dir := configDir
	if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
		// 原 `dir = "."` 降级相对路径与上方注释「绝不降级相对路径」
		// 自相矛盾——CWD=/（Android/守护进程）时 save 落根目录失败、日志静默丢弃；
		// 与 configDir=="" 分支一致改为内存态 logger（save no-op，不降级）
		log.Printf("[logs] 创建配置目录失败: %v, 使用内存态日志（不落盘）", err)
		return &Logger{logs: []types.ImportLog{}}
	}
	path := filepath.Join(dir, "ysm-import-logs.json")
	l := &Logger{path: path}
	l.load()
	return l
}

func (l *Logger) load() {
	// 启动时清理超过保留期的 .corrupt 备份现场——原备份从不清理，
	// 损坏现场永久滞留用户目录（虽然 Rename 覆盖数量有界为 1，但长期占用磁盘）
	l.cleanupStaleCorrupt()
	data, err := os.ReadFile(l.path)
	if err != nil {
		// 陷阱 #11：错误分类用 sentinel + errors.Is，不做文本匹配——
		// os.IsNotExist 语义一致但显式 errors.Is(err, os.ErrNotExist) 更直白
		if !errors.Is(err, os.ErrNotExist) {
			// 读取失败（权限/IO）时原实现直接置空——
			// 旧日志既不备份也不保留，静默丢失；解析失败反而有 .corrupt 备份（L56-61），
			// 读取失败却无。对齐备份模式：先备份原文件再置空
			log.Printf("[logs] 读取日志文件失败: %v, 备份后创建新日志", err)
			corrupt := l.path + corruptSuffix
			if renErr := os.Rename(l.path, corrupt); renErr != nil {
				log.Printf("[logs] 备份不可读日志失败: %v", renErr)
			}
		}
		l.logs = []types.ImportLog{}
		return
	}
	if err := json.Unmarshal(data, &l.logs); err != nil {
		// 损坏 JSON 备份 .corrupt 再置空（对齐 go/tags 已修模式），
		// 防止损坏现场被下次 save 覆盖、旧数据不可溯
		log.Printf("[logs] 解析日志文件失败: %v, 备份为 .corrupt 后创建新日志", err)
		corrupt := l.path + corruptSuffix
		if renErr := os.Rename(l.path, corrupt); renErr != nil {
			log.Printf("[logs] 备份损坏日志失败: %v", renErr)
		}
		l.logs = []types.ImportLog{}
	}
	if l.logs == nil {
		l.logs = []types.ImportLog{}
	}
	// 合法但超 500 条的旧文件 load 后也裁到上限（与写入路径口径一致）
	if len(l.logs) > logMaxEntries() {
		l.logs = l.logs[len(l.logs)-logMaxEntries():]
	}
}

// cleanupStaleCorrupt 清理超过保留期的 .corrupt 备份（仅存在时删除，不静默吞错）
func (l *Logger) cleanupStaleCorrupt() {
	if l.path == "" {
		return
	}
	corrupt := l.path + corruptSuffix
	fi, err := os.Stat(corrupt)
	if err != nil {
		return // 不存在（正常情况）或 Stat 失败：跳过
	}
	age := time.Since(fi.ModTime())
	if age > time.Duration(logCorruptRetentionDays())*24*time.Hour {
		if rmErr := os.Remove(corrupt); rmErr != nil {
			log.Printf("[logs] 清理过期 .corrupt 备份失败 %s: %v", corrupt, rmErr)
		}
	}
}

// save 将日志写入磁盘。
// 注意：调用方必须已持有 l.mu 锁（由 Add / Clear 保证）。
func (l *Logger) save() {
	if l.path == "" {
		return // 内存态：save no-op（平台数据根缺失）
	}
	data, err := json.MarshalIndent(l.logs, "", "  ")
	if err != nil {
		log.Printf("[logs] 序列化日志失败: %v", err)
		return
	}
	// 确保日志目录存在
	if dir := filepath.Dir(l.path); dir != "" {
		if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
			log.Printf("[logs] 创建日志目录失败: %v", err)
			return
		}
	}
	// ADR-044 策略 A：落盘统一走 fsutil.WriteFileAtomic（CreateTemp + rename 原子替换）——
	// 原固定 `l.path + ".tmp"` 路径并发写时互相覆盖，且崩溃/断电留半截 JSON
	// 下次 load 解析失败全部历史丢失；CreateTemp 唯一临时文件消除竞争（对齐 go/tags 已修模式）
	if err := fsutil.WriteFileAtomic(l.path, data); err != nil {
		log.Printf("[logs] 写入日志文件失败: %v", err)
	}
}

// Add 添加一条导入日志（兼容旧调用）
func (l *Logger) Add(modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	l.addOp("import", modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

// AddOp 添加一条指定操作类型的日志
func (l *Logger) AddOp(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	l.addOp(op, modelName, sourcePath, targetDir, fileSize, status, errMsg)
}

func (l *Logger) addOp(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	// 字段字节级截断——errMsg/modelName 无上限时 500 条 ×
	// 大字段可到数十 MB（前端 UI 截 500/200 只是展示层，Go 侧直接拼接 err.Error()）。
	// 截断到 logMaxFieldLen()（rune 计），防日志文件无界膨胀（默认见文件头）
	trunc := func(s string) string {
		r := []rune(s)
		limit := logMaxFieldLen()
		if len(r) > limit {
			return string(r[:limit])
		}
		return s
	}
	l.logs = append(l.logs, types.ImportLog{
		ModelName:  trunc(modelName),
		SourcePath: trunc(sourcePath),
		TargetDir:  trunc(targetDir),
		FileSize:   fileSize,
		Status:     status,
		ErrorMsg:   trunc(errMsg),
		Timestamp:  time.Now().UnixMilli(),
		Operation:  op,
		Level:      types.StatusToLevel(status),
	})
	if len(l.logs) > logMaxEntries() {
		l.logs = l.logs[len(l.logs)-logMaxEntries():]
		// 底层数组远大于容量时重分配，释放突发峰值占用
		if cap(l.logs) > logMaxEntries()*4 {
			nb := make([]types.ImportLog, len(l.logs))
			copy(nb, l.logs)
			l.logs = nb
		}
	}
	l.scheduleSave()
}

// scheduleSave 防抖落盘：窗口内已有定时器则合并，否则启动新定时器（ADR-082 续）。
// 调用方须持有 l.mu。内存态（path==""）不落盘，直接返回。
func (l *Logger) scheduleSave() {
	if l.path == "" {
		return
	}
	if l.saveTimer != nil {
		return // 窗口内合并：已有定时器待触发，本次写入随其落盘
	}
	l.saveTimer = time.AfterFunc(saveDebounce, func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		l.saveTimer = nil
		l.save()
	})
}

// Flush 立即落盘（取消防抖窗口）：批量写入后调用方需要立即可重启加载（测试）或
// 退出前确保审计完整时使用。内存态 no-op。
func (l *Logger) Flush() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.saveTimer != nil {
		l.saveTimer.Stop()
		l.saveTimer = nil
	}
	l.save()
}

// GetAll 获取所有日志
func (l *Logger) GetAll() []types.ImportLog {
	l.mu.Lock()
	defer l.mu.Unlock()
	cp := make([]types.ImportLog, len(l.logs))
	copy(cp, l.logs)
	return cp
}

// Clear 清空日志
func (l *Logger) Clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logs = []types.ImportLog{}
	if l.saveTimer != nil {
		l.saveTimer.Stop()
		l.saveTimer = nil
	}
	l.save()
}
