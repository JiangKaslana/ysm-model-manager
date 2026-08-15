// ========== 批量导出 + 高级搜索 + 模型扫描（薄壳，ADR-003 P2）==========
// 核心扫描/哈希/缓存/作者提取/索引生成已下沉至 go/scanner（纯 Go 可测）；
// 本文件仅保留依赖 App（AnalyzeBedrockModel / tagsStore / AddOpLog）与 GUI 的方法。
package app

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/scanner"
	ysmsync "ysm-model-manager/go/sync"
	"ysm-model-manager/go/types"
)

// ========== 批量导出骨骼结构 ==========
func (a *App) ExportBoneStructures(filesRoot string) (string, error) {
	entries := a.ScanModelEntries(filesRoot)
	if len(entries) == 0 {
		return "", fmt.Errorf("仓库中没有模型文件")
	}

	var lines []string
	lines = append(lines, "YSM Model Manager — 骨骼结构批量导出")
	lines = append(lines, fmt.Sprintf("仓库: %s", filesRoot))
	lines = append(lines, fmt.Sprintf("文件总数: %d", len(entries)))
	lines = append(lines, fmt.Sprintf("导出时间: %s", time.Now().Format("2006-01-02 15:04:05")))
	lines = append(lines, "")
	lines = append(lines, "="+strings.Repeat("=", 78))
	lines = append(lines, "")

	totalBones := 0
	totalCubes := 0
	parsedCount := 0
	failCount := 0

	for i, entry := range entries {
		model := a.AnalyzeBedrockModel(entry.Path)
		relPath := entry.Name
		lines = append(lines, fmt.Sprintf("[%d/%d] %s", i+1, len(entries), relPath))
		if model.BoneCount > 0 {
			parsedCount++
			totalBones += model.BoneCount
			totalCubes += model.CubeCount
			lines = append(lines, fmt.Sprintf("  🦴 骨骼: %d  |  📦 立方体: %d  |  📐 纹理: %dx%d",
				model.BoneCount, model.CubeCount, model.TexWidth, model.TexHeight))
			for _, b := range model.Bones {
				cs := len(b.Cubes)
				if cs > 0 {
					lines = append(lines, fmt.Sprintf("  ├─ %s (%d 方)", b.Name, cs))
				} else {
					lines = append(lines, fmt.Sprintf("  ├─ %s (结构骨骼)", b.Name))
				}
			}
		} else {
			failCount++
			lines = append(lines, "  ⚠️ 未解析到骨骼数据")
		}
		lines = append(lines, "")
	}
	lines = append(lines, "="+strings.Repeat("=", 78))
	lines = append(lines, "")
	lines = append(lines, fmt.Sprintf("✅ 成功解析: %d / %d", parsedCount, len(entries)))
	lines = append(lines, fmt.Sprintf("❌ 解析失败: %d", failCount))
	lines = append(lines, fmt.Sprintf("🦴 骨骼总数: %d", totalBones))
	lines = append(lines, fmt.Sprintf("📦 立方体总数: %d", totalCubes))
	lines = append(lines, "")
	lines = append(lines, "--- 生成完毕 ---")
	return strings.Join(lines, "\n"), nil
}

// ExportModelStructureJSON 导出单模型骨骼结构
func (a *App) ExportModelStructureJSON(modelPath string) string {
	model := a.AnalyzeBedrockModel(modelPath)
	if model.BoneCount == 0 {
		return "{}"
	}
	type boneInfo struct {
		Name   string     `json:"name"`
		Parent string     `json:"parent,omitempty"`
		Pivot  [3]float64 `json:"pivot"`
		Cubes  int        `json:"cubes"`
		TexIdx int        `json:"texIdx"`
	}
	type modelInfo struct {
		File       string     `json:"file"`
		BoneCount  int        `json:"boneCount"`
		CubeCount  int        `json:"cubeCount"`
		TexWidth   int        `json:"texWidth"`
		TexHeight  int        `json:"texHeight"`
		TextureCnt int        `json:"textureCount"`
		Bones      []boneInfo `json:"bones"`
	}
	info := modelInfo{
		File: filepath.Base(modelPath), BoneCount: model.BoneCount,
		CubeCount: model.CubeCount, TexWidth: model.TexWidth,
		TexHeight: model.TexHeight, TextureCnt: len(model.Textures),
	}
	for _, b := range model.Bones {
		info.Bones = append(info.Bones, boneInfo{
			Name: b.Name, Parent: b.Parent, Pivot: b.Pivot,
			Cubes: len(b.Cubes), TexIdx: 0,
		})
	}
	data, _ := json.MarshalIndent(info, "", "  ")
	return string(data)
}

// ========== 高级搜索 ==========
func (a *App) SearchModels(filesRoot string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult {
	entries := a.ScanModelEntries(filesRoot)
	if len(entries) == 0 {
		return nil
	}
	var results []types.SearchResult
	kw := strings.ToLower(strings.TrimSpace(keyword))
	for _, entry := range entries {
		if kw != "" {
			name := strings.ToLower(entry.Name)
			if !strings.Contains(name, kw) && !strings.Contains(strings.ToLower(entry.Path), kw) {
				continue
			}
		}
		model := a.AnalyzeBedrockModel(entry.Path)
		if model.BoneCount == 0 {
			continue
		}
		if minBones > 0 && model.BoneCount < minBones {
			continue
		}
		if maxBones > 0 && model.BoneCount > maxBones {
			continue
		}
		if minCubes > 0 && model.CubeCount < minCubes {
			continue
		}
		if maxCubes > 0 && model.CubeCount > maxCubes {
			continue
		}
		if minTex > 0 && (model.TexWidth < minTex || model.TexHeight < minTex) {
			continue
		}
		if maxTex > 0 && (model.TexWidth > maxTex || model.TexHeight > maxTex) {
			continue
		}
		results = append(results, types.SearchResult{
			Name: entry.Name, Path: entry.Path,
			BoneCount: model.BoneCount, CubeCount: model.CubeCount,
			TexWidth: model.TexWidth, TexHeight: model.TexHeight,
		})
	}
	return results
}

// ========== 模型扫描（薄壳）==========
// scanModelEntries 扫描核心（无操作日志）：watcher 自动同步等后台路径使用，
// 避免自动化触发刷屏操作日志面板。保持单返回值以兼容 watcher.ScanFunc 契约。
func (a *App) scanModelEntries(dir string) []types.ModelEntry {
	entries, _ := a.scanModelEntriesWithHit(dir)
	return entries
}

// scanModelEntriesWithHit 同 scanModelEntries，但额外返回是否命中 30s 缓存，
// 供 ScanModelEntries 决定是否记录扫描日志（命中缓存不记，避免刷屏）。
func (a *App) scanModelEntriesWithHit(dir string) ([]types.ModelEntry, bool) {
	entries, hit := scanner.ScanEntriesWithHit(strings.TrimSpace(dir))
	// 批量填充 HasTags（利用标签存储的读缓存，不重复读磁盘）
	// 统一走 getTagsStore() 入口——原裸读 a.tagsStore 与 sync.Once 内写入构成数据竞争
	if ts := a.getTagsStore(); ts != nil {
		for i := range entries {
			if tags, _ := ts.GetTags(entries[i].Path); len(tags) > 0 {
				entries[i].HasTags = true
			}
		}
	}
	return entries, hit
}

// ScanModelEntries 用户可见的扫描入口（Wails 绑定），记录操作日志。
// 仅在真正扫盘（缓存未命中）时记日志，30s 内重复访问命中缓存则跳过，避免刷屏。
func (a *App) ScanModelEntries(dir string) []types.ModelEntry {
	// 壳层套路径守卫——与 ListFileNames/ListAllFilePaths
	// 同文件已有守卫对齐；原 ScanModelEntries 未守卫，前端可传 `..`/盘符根把扫描越出
	// 仓库根遍历任意目录（ADR-044③ 路径边界对称范式）。
	// 注意：扫描是只读操作，必须放行仓库根本身（rel==.，整仓扫描是核心场景）；
	// isPathInRoot 的 rel==. 拒绝语义专为 RemoveDir/RenameDir 防整删设计，不可复用。
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	entries, hit := a.scanModelEntriesWithHit(dir)
	if !hit {
		a.AddOpLog("scan", fmt.Sprintf("扫描 %d 个文件", len(entries)), dir, "", int64(len(entries)), "success", "")
	}
	return entries
}

// ScanModelEntriesWithLabel 同 ScanModelEntries，但操作日志附带资源类型标签
// （如「资源包」「光影包」「模型」），便于在操作日志面板区分扫描的文件类型。
// 仅在缓存未命中时记日志，避免刷屏。
// 与 ScanModelEntries 共用同一路径守卫——原实现无守卫，
// 前端主扫描入口（loader.ts/app-content/community.ts 等）可传 `..`/盘符根越权遍历，
// 且与 ScanModelEntries 行为不一致（ADR-044③ 路径边界对称范式）。
func (a *App) ScanModelEntriesWithLabel(dir string, label string) []types.ModelEntry {
	if !a.isPathInRootOrSelf(dir) {
		return nil
	}
	entries, hit := a.scanModelEntriesWithHit(dir)
	if !hit {
		msg := fmt.Sprintf("扫描 %d 个文件", len(entries))
		if label != "" {
			msg += " · " + label
		}
		a.AddOpLog("scan", msg, dir, "", int64(len(entries)), "success", "")
	}
	return entries
}

// ClearScanCache 清除扫描缓存（下载/导入后调用）
func (a *App) ClearScanCache() {
	scanner.InvalidateCache()
}

// ListModelAuthors 统计 [作者] 前缀（走扫描缓存，不重复读磁盘）
func (a *App) ListModelAuthors() []types.AuthorInfo {
	if a.ysmRoot() == "" {
		return nil
	}
	entries := a.scanModelEntries(a.ysmRoot())
	return scanner.ListModelAuthors(entries)
}

// GenerateRepoIndex 生成 index.json（含 GitHub Actions workflow 模板）
func (a *App) GenerateRepoIndex(repoPath string) (string, error) {
	if !a.isPathInRootOrSelf(repoPath) {
		return "", fmt.Errorf("路径超出仓库目录")
	}
	return scanner.GenerateRepoIndex(repoPath)
}

// ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者
func (a *App) ScanLocalAuthors() []types.WorkshopCreator {
	roots := map[string]string{}
	// ADR-064 锚定：遍历注册表而非硬编码 6 类型数组（新增类型自动纳入作者扫描）
	for _, rt := range types.LoadRegistry().ResourceTypes {
		roots[rt.ID], _ = a.GetRepoRoot(rt.ID)
	}
	return scanner.ScanLocalAuthors(roots)
}

func (a *App) ListVersionInstances(mcRoot string) []types.VersionInstance {
	return ysmsync.ListVersions(strings.TrimSpace(mcRoot))
}

func (a *App) GetGlobalCustomDir(mcRoot string) string {
	// ADR-064 锚定：路径走注册表 SubDirMap（原硬编码 config/yes_steve_model/custom，
	// YSM scanDir 变更时此处失联）
	return filepath.Join(mcRoot, types.SubDirMap("ysm"))
}

func (a *App) ListFileNames(dir string) []string {
	if !a.isPathInRoot(dir) {
		return nil
	}
	files := fsutil.WalkAllFiles(dir, true)
	names := make([]string, len(files))
	for i, p := range files {
		names[i] = filepath.Base(p)
	}
	return names
}

// ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名）
func (a *App) ListAllFilePaths(dir string) []string {
	if !a.isPathInRoot(dir) {
		return nil
	}
	return fsutil.WalkAllFiles(dir, true)
}

func (a *App) CheckFileExists(path string) bool {
	if !a.isPathInRoot(path) {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

// isPathInRootOrSelf 检查路径是否位于任一合法扫描根内（或其自身）。
// 扫描入口是跨类型通用绑定（前端按 rtype 扫描 resourcepack/shaderpack 等），
// 合法根 = FilesRoot（所有类型根的公共祖先）+ McRoot（整合包实例自定义目录，
// community 诊断/GetInstanceStatus 扫描）+ 各类型专属覆写根。
// 不能像 isPathInRoot 那样以 ysmRoot 为唯一基准——resourcepack 等兄弟类型根
// 相对 ysmRoot 是 ../，会被误拒（code_review 修复）。
// 放行根本身（rel==.，整仓扫描合法）；拒绝 .. 越权、盘符根、其他卷绝对路径。
func (a *App) isPathInRootOrSelf(path string) bool {
	cfg := a.LoadAppConfig()
	roots := []string{
		cfg.FilesRoot,
		cfg.McRoot,
		cfg.ResourcepackRoot,
		cfg.ShaderpackRoot,
		cfg.SchematicRoot,
		cfg.LitematicRoot,
		cfg.MmdRoot,
		cfg.VrcRoot,
	}
	clean := filepath.Clean(path)
	for _, root := range roots {
		if root == "" {
			continue
		}
		rel, err := filepath.Rel(filepath.Clean(root), clean)
		if err != nil {
			continue // 不同卷/盘符，跳过该根
		}
		if rel == "." {
			return true
		}
		sep := string(filepath.Separator)
		if rel == ".." || strings.HasPrefix(rel, ".."+sep) {
			continue // 越权到该根外，试下一个根
		}
		return true
	}
	return false
}

// isPathInRoot 检查路径是否在 FilesRoot 内（路径守卫辅助函数）
func (a *App) isPathInRoot(path string) bool {
	root := a.ysmRoot()
	if root == "" {
		return false
	}
	clean := filepath.Clean(path)
	rel, err := filepath.Rel(root, clean)
	if err != nil {
		return false
	}
	// rel == "." 是根路径本身——RemoveDir/RenameDir 等经此守卫后
	// os.RemoveAll/os.Rename 可整删/整改名 ysm 仓库（与 DeleteModelDir 的 rel=="."
	// 拒绝模式对齐）；原 `!HasPrefix(rel, "..")` 对 "." 放行。
	// 同时修 P3：裸 HasPrefix(rel, "..") 会把根内合法目录 ..foo 误判越权——
	// 用精确段比较（对齐 go/paths 的 rel==".." || HasPrefix(rel, ".."+sep)）
	if rel == "." || rel == ".." {
		return false
	}
	sep := string(filepath.Separator)
	if strings.HasPrefix(rel, ".."+sep) {
		return false
	}
	return true
}

func (a *App) OpenFolder(dir string) error {
	// 统一路径分隔符（Windows explorer 不接受混合斜杠）
	dir = filepath.Clean(dir)
	// 目录存在性检查（v1.5.9 曾加、重构中丢失）：explorer 打开不存在的路径
	// 会静默无反应或弹不可见错误框——前置校验给前端明确错误
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return fmt.Errorf("OpenFolder: 目录不存在: %s", dir)
	}
	// ADR-047 平台守卫：Android 无 xdg-open，SAF 打开需 content:// URI 桥
	// （MikuMikuAR ADR-194 已弃用 SAF），明确返回不支持避免命令静默失败
	if runtime.GOOS == "android" {
		return fmt.Errorf("OpenFolder: Android 不支持打开文件夹，请在文件管理器中手动查找")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", dir)
		// 不设 HideWindow：explorer 是 GUI 程序（无控制台窗口），
		// CREATE_NO_WINDOW 会干扰其单实例 DDE 转发——文件夹打不开、
		// 表现为应用窗口呆住约 1 秒后无反应（P5 实测坑）
	case "darwin":
		cmd = exec.Command("open", dir)
		executil.HideWindow(cmd)
	default:
		cmd = exec.Command("xdg-open", dir)
		executil.HideWindow(cmd)
	}
	return cmd.Start()
}

// OpenInstanceFolder 按资源类型打开整合包子目录；目录不存在时回退到实例根目录
func (a *App) OpenInstanceFolder(instDir, rtype string) error {
	subDir := types.SubDirMap(rtype)
	if subDir == "" {
		return a.OpenFolder(instDir)
	}
	target := types.FindInstDir(instDir, subDir, rtype)
	// FindInstDir 在找不到时返回 standard 路径（未必存在）
	// 如果返回的目录也不存在，回退到 instDir
	if info, err := os.Stat(target); err != nil || !info.IsDir() {
		target = instDir
	}
	return a.OpenFolder(target)
}

// progressReader 包装 io.Reader，下载时通过回调推送进度（保留：下载进度计算）
type progressReader struct {
	reader     io.Reader
	total      int64
	downloaded int64
	lastPct    int
	onProgress func(downloaded, total int64)
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.downloaded += int64(n)
	if pr.total > 0 {
		pct := int(pr.downloaded * 100 / pr.total)
		if pct > pr.lastPct {
			pr.lastPct = pct
			if pr.onProgress != nil {
				pr.onProgress(pr.downloaded, pr.total)
			}
		}
	} else if n > 0 && pr.onProgress != nil {
		kb := pr.downloaded / 256 / 1024
		if kb > int64(pr.lastPct) {
			pr.lastPct = int(kb)
			pr.onProgress(pr.downloaded, pr.downloaded)
		}
	}
	return n, err
}
