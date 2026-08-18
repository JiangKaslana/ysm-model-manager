package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"ysm-model-manager/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// ---- CLI Mode: 独立运行，脱离 Wails GUI，用于测试或自动化 ----
	cliMode := flag.Bool("cli", false, "运行 CLI 模式 (无 GUI)")
	filesRoot := flag.String("files-root", "", "模型仓库根目录路径")
	keyword := flag.String("keyword", "", "搜索关键词")
	flag.Parse()

	if *cliMode {
		if err := runCLI(*filesRoot, *keyword); err != nil {
			fmt.Fprintf(os.Stderr, "CLI Error: %v\n", err)
			os.Exit(1)
		}
		return
	}
	// ---- End CLI Mode ----

	appStruct := app.NewApp()
	app := application.New(application.Options{
		Name: "YSM 模型管理器",
		Services: []application.Service{
			application.NewService(appStruct),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			// Wails 在 desktop 模式对 /wails/custom.js 刻意返回 404（仅 server 模式 serve）。
			// 但 runtime 的 loadOptionalScript 无条件发 HEAD 请求 → DevTools 显示红色 404。
			// 此处用 Middleware 在框架内置中间件之前拦截，返回空 JS 消除噪音。
			// ADR-079 M2：CoopCoepMiddleware 包最外层——mpr build tag 时给全部响应注入
			// COOP/COEP（桌面 WebView2 解锁 SharedArrayBuffer → pthread WASM 多线程解码）。
			Middleware: func(next http.Handler) http.Handler {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/wails/custom.js" {
						w.Header().Set("Content-Type", "application/javascript")
						w.WriteHeader(http.StatusOK)
						w.Write([]byte("// Wails custom.js — empty in desktop mode\n"))
						return
					}
					next.ServeHTTP(w, r)
				})
				return app.CoopCoepMiddleware(inner)
			},
		},
	})
	// 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框管理器
	appStruct.SetApp(app)

	wnd := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "YSM 模型管理器",
		Width:  1280,
		Height: 800,
		URL:    "/",
	})
	// 注入主窗口引用，供 ServiceStartup/ServiceShutdown 直接操作（避免 Window.Current() 在启动期返回 nil）
	appStruct.SetMainWindow(wnd)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// runCLI 执行 CLI 模式下的核心逻辑
func runCLI(filesRoot, keyword string) error {
	if filesRoot == "" {
		return fmt.Errorf("--files-root 参数不能为空")
	}

	a := app.NewApp()

	// 为 CLI 模式设置配置
	if err := a.SaveAppConfig(filesRoot, "", "", "", ""); err != nil {
		return fmt.Errorf("初始化配置失败: %w", err)
	}

	fmt.Printf("🚀 CLI Mode: 开始搜索...\n")
	fmt.Printf("   根目录: %s\n", filesRoot)
	fmt.Printf("   关键词: %s\n", keyword)

	results := a.SearchModels(filesRoot, keyword, 0, 0, 0, 0, 0, 0)
	if len(results) == 0 {
		fmt.Println("📭 未找到匹配的模型")
		return nil
	}

	// 输出 JSON 格式结果，方便脚本解析
	data, _ := json.MarshalIndent(results, "", "  ")
	fmt.Printf("✅ 找到 %d 个模型:\n", len(results))
	fmt.Println(string(data))

	return nil
}
