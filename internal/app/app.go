package app

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/download"
	"ysm-model-manager/go/fileops"
	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/tags"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/updater"
	"ysm-model-manager/go/version"
	"ysm-model-manager/go/watcher"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct {
	LinkMode      string
	logger        *logs.Logger
	runtimeLogs   *logs.RuntimeBuffer
	watcher       *watcher.Watcher
	queue         *DownloadQueue
	tagsStore     *tags.Store
	tagsStoreOnce sync.Once
	configCache   types.AppConfig
	configLoaded  bool
	configMu      sync.RWMutex
	linkModeMu    sync.RWMutex
	watcherMu     sync.Mutex
	app           *application.App
	mainWindow    *application.WebviewWindow

	// Plaza browser window (ADR-050)
	plazaWin           *application.WebviewWindow
	plazaWinMu         sync.Mutex
	currentPlazaTarget string
	proxySessions      map[proxyServerKey]*proxySession
	proxyMu            sync.Mutex
	httpServers        []*http.Server
}

// repoRoot 动态返回 YSM 模型存储根目录（始终从配置推导，无需手动维护缓存）
func (a *App) ysmRoot() string { dir, _ := a.GetRepoRoot("ysm"); return dir }

func NewApp() *App {
	a := &App{
		logger:      logs.NewLogger(configDir()),
		runtimeLogs: logs.NewRuntimeBuffer(logs.DefaultRuntimeCap),
	}
	// 头像缓存收敛到平台数据根（与 logs/tags 同根，ADR-046 P2）：
	// 不再贴在 exe 旁——安卓只读 APK 路径会导致 MkdirAll/WriteFile 静默失败；
	// 平台数据根缺失时返回 ""（no-op，不降级为相对路径写 CWD）。
	avatar.CacheDir = func() string {
		dir := configDir()
		if dir == "" {
			return ""
		}
		return filepath.Join(dir, "creators_cache")
	}
	// 回调注入：打破 DownloadQueue ↔ App 循环（ADR-002 P1）
	// emitFn 闭包延迟解析 a.app（SetApp 在应用启动时注入）
	a.queue = NewDownloadQueue(
		a.downloadFileWithQueue,
		func(name string, args ...interface{}) { a.app.Event.Emit(name, args...) },
		a.AddOpLog,
	)
	return a
}

// SetApp 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框/浏览器管理器
func (a *App) SetApp(app *application.App) { a.app = app }

// SetMainWindow 注入主窗口实例，避免依赖 Window.Current()。
// 注意：ServiceStartup 在 app.Run() 早期被调用，此时窗口尚未成为 Current，
// Window.Current() 会返回 nil 导致空指针；故改用直接持有的窗口引用。
func (a *App) SetMainWindow(w *application.WebviewWindow) { a.mainWindow = w }

// ServiceStartup 对应 v2 的 startup，在 app.Run() 期间由框架调用
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// 捕获标准库 log 输出（watcher/sync 等）到运行时环形缓冲，供诊断页查看
	log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))

	// 清理上一次更新留下的 .old 备份
	updater.CleanupOldVersion()

	// 启动时自动加载配置
	a.loadAppConfig()

	// 运行阈值配置注入（ADR-062：各包 configFunc ← LoadAppConfig；字段 0=用包内默认常量）
	scanner.SetConfigFunc(a.LoadAppConfig)
	download.SetConfigFunc(a.LoadAppConfig)
	logs.SetConfigFunc(a.LoadAppConfig)
	fileops.SetConfigFunc(a.LoadAppConfig)

	// 恢复窗口位置
	pos := a.GetWindowPosition()
	if a.mainWindow != nil && pos.Width > 0 && pos.Height > 0 {
		// 双屏切换后坐标可能落到屏幕外：X/Y 过大或过负时居中
		if pos.X < -200 || pos.X > 4000 || pos.Y < -200 || pos.Y > 4000 {
			a.mainWindow.SetSize(pos.Width, pos.Height)
			a.mainWindow.Center()
		} else {
			a.mainWindow.SetSize(pos.Width, pos.Height)
			a.mainWindow.SetPosition(pos.X, pos.Y)
		}
	}

	// 确保配置文件存在（如果被删除则重建）
	cfg := a.LoadAppConfig()
	needsWrite := false
	if _, err := os.Stat(configPath()); os.IsNotExist(err) {
		// 配置文件不存在 → 创建默认文件
		needsWrite = true
	}
	if cfg.McRoot == "" {
		paths := scanMinecraftDirs()
		if len(paths) > 0 {
			cfg.McRoot = paths[0]
			needsWrite = true
		}
	}
	ysmRoot, _ := a.GetRepoRoot("ysm")
	if needsWrite {
		a.saveConfig(cfg)
		if cfg.McRoot != "" {
			println("[startup] 配置文件已创建/更新, mcRoot:", cfg.McRoot)
		}
	}

	// 创建所有存储子目录（注册表驱动，防手写漂移）
	if cfg.FilesRoot != "" {
		reg := types.LoadRegistry()
		seen := make(map[string]bool, len(reg.ResourceTypes))
		for _, rt := range reg.ResourceTypes {
			if rt.StorageSubDir != "" && !seen[rt.StorageSubDir] {
				seen[rt.StorageSubDir] = true
				// P0 修复（子代理审计）：目录权限 0644 无执行位，目录不可进入——应为 0755
				os.MkdirAll(filepath.Join(cfg.FilesRoot, rt.StorageSubDir), 0755)
			}
		}
	}

	a.app.Event.Emit("config-loaded", ysmRoot, cfg.McRoot, cfg.LinkMode)

	// 预热模型广场第二窗口（ADR-050）
	if runtime.GOOS != "android" {
		a.prewarmPlazaWindow()
	}

	// 启动文件监听器（自动同步启用/禁用状态到整合包）
	// Android 守卫：fsnotify 经 sdcardfs/FUSE 事件不完整（ADR-047 明示），
	// fw.Add 逐目录失败后 loop 空转 = running=true 静默假活 → 直接跳过，以手动刷新/重扫为准
	if runtime.GOOS != "android" && ysmRoot != "" && cfg.McRoot != "" {
		a.watcherMu.Lock()
		a.watcher = watcher.New(ysmRoot, cfg.McRoot, a.scanModelEntries, a.ClearScanCache)
		if err := a.watcher.Start(); err != nil {
			log.Printf("[startup] 文件监听器启动失败: %v", err)
		}
		a.watcherMu.Unlock()
	}
	return nil
}

// ServiceShutdown 对应 v2 的 shutdown，在应用退出前由框架调用
func (a *App) ServiceShutdown() error {
	defer func() {
		// 原 recover 静默吞 panic——记录原因便于排查
		if r := recover(); r != nil {
			println("[shutdown] 退出时异常:", fmt.Sprint(r))
		}
	}()
	a.watcherMu.Lock()
	if a.watcher != nil {
		a.watcher.Stop()
	}
	a.watcherMu.Unlock()
	// 关闭广场反向代理（ADR-050）——currentPlazaTarget 与导航/关闭并发读写，须持 plazaWinMu
	a.plazaWinMu.Lock()
	plazaTarget := a.currentPlazaTarget
	a.currentPlazaTarget = ""
	a.plazaWinMu.Unlock()
	if plazaTarget != "" {
		a.stopProxy(plazaTarget)
	}
	a.proxyMu.Lock()
	for _, srv := range a.httpServers {
		_ = srv.Close()
	}
	a.httpServers = nil
	a.proxyMu.Unlock()
	if a.mainWindow != nil {
		x, y := a.mainWindow.Position()
		w, h := a.mainWindow.Size()
		a.SaveWindowPosition(x, y, w, h)
	}
	return nil
}

// OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌）
func (a *App) OpenInBrowser(url string) {
	_ = a.app.Browser.OpenURL(url)
}

// GetAppVersion 返回当前版本号
func (a *App) GetAppVersion() string {
	return version.Version
}
