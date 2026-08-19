// ========== CLI: perf-log 优化记录 ==========
// 输出优化历史日志，与 docs/knowledge/optimization_log.md 同步维护。
// 供 AI 代理和用户快速了解项目性能演进历史，无需翻阅 ADR 或知识卡。

package main

import (
	"fmt"
	"strings"

	"ysm-model-manager/internal/app"
)

func init() {
	RegisterCommand("perf-log", "输出优化记录日志（按时间倒序，含问题/做法/效果/提交）", runPerfLog)
}

func runPerfLog(a *app.App, args []string) error {
	// 优化日志数据，与 docs/knowledge/optimization_log.md 同步
	entries := []struct {
		date    string
		area    string
		problem string
		action  string
		effect  string
		commit  string
	}{
		{
			date:    "2026-08-19",
			area:    "KTX2 缓存",
			problem: "加载时间翻倍（getCachedTexture 对每个纹理读文件+算 SHA256，readFileBytesBatch 已读一次）",
			action:  "ReadFileBytesBatchWithMeta 一次 RPC 返回数据+哈希；HasCachedTextures 批量缓存检查；Promise.all 并发替换",
			effect:  "加载 1 次 RPC 替代 N+1 次；缓存检查 1 次替代 N 次；替换并行化",
			commit:  "fd068ac",
		},
		{
			date:    "2026-08-18",
			area:    "KTX2 编码",
			problem: "PNG 纹理无 KTX2 缓存，GPU 内存 1-2GB 导致移动端 OOM",
			action:  "WASM basis_encoder 后台编码（@loaders.gl/textures），加载后自动编码未缓存纹理到用户目录",
			effect:  "首次加载不阻塞，后续加载命中 KTX2 缓存，GPU 内存降到 1/4~1/8",
			commit:  "c5953531",
		},
		{
			date:    "2026-08-18",
			area:    "KTX2 替换",
			problem: "模型加载后 PNG 纹理仍占用 GPU 内存",
			action:  "KTX2Loader 在 post-load 阶段替换材质纹理，dispose 旧 PNG",
			effect:  "有 KTX2 缓存时自动替换，释放旧 PNG 纹理",
			commit:  "cfca7c08",
		},
		{
			date:    "2026-08-18",
			area:    "KTX2 缓存",
			problem: "无 KTX2 缓存基础设施",
			action:  "Go 侧 texture_cache 包（SHA256 内容哈希 key、用户目录落盘、原子写入）+ GetCachedTexture/SaveCachedTexture 绑定",
			effect:  "缓存目录可用，可手动放置 KTX2 文件验证管线",
			commit:  "31713991",
		},
		{
			date:    "2026-08-18",
			area:    "MMD dispose",
			problem: "切换模型 GPU 内存泄漏（@moeru/three-mmd 的 MMD.dispose() 仅释放物理引擎，不释放几何/材质/纹理）",
			action:  "disposeMmdMesh() 遍历 13 个纹理字段 + mat.dispose() + geometry.dispose()，输出释放统计到环形日志",
			effect:  "切换 5 个模型不再闪退，dispose 日志：tex=58 gpu≈1232.1MB",
			commit:  "80679cd7",
		},
		{
			date:    "2026-08-18",
			area:    "MMD 监控",
			problem: "单模型纹理 GPU 内存 1-2GB（4096²×24 + 8192²×2），无法量化",
			action:  "manager.onLoad 输出 GPU 内存估算到环形日志",
			effect:  "日志可见 gpu≈2053.3MB，量化优化目标",
			commit:  "80679cd7",
		},
	}

	// 紧凑输出
	fmt.Println("╔══════════════════════════════════════════════════════════════╗")
	fmt.Println("║             优化记录 perf-log（按时间倒序）                 ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	for i, e := range entries {
		fmt.Printf("─ %s ─ %s ─ %s\n", e.date, e.area, e.commit)

		// 问题（折行缩进）
		fmt.Printf("  问题: %s\n", wrap(e.problem, 72, "        "))

		// 做法
		fmt.Printf("  做法: %s\n", wrap(e.action, 72, "        "))

		// 效果
		fmt.Printf("  效果: %s\n", wrap(e.effect, 72, "        "))

		if i < len(entries)-1 {
			fmt.Println()
		}
	}

	fmt.Println()
	fmt.Println("── 当前瓶颈 ──")
	fmt.Println("  · 纹理编码：WASM basis_encoder 从 CDN 加载，首次编码慢")
	fmt.Println("  · KTX2 替换竞态：快速切换模型时 KTX2Loader 仍在加载")
	fmt.Println("  · SHA256 计算：Go 侧对每个文件做全量 SHA256，大文件有延迟")
	fmt.Println()
	fmt.Println("── 关键指标 ──")
	fmt.Println("  · 模型切换（5 次）: 闪退 → 正常")
	fmt.Println("  · 单模型 GPU 内存: 1-2GB（需 KTX2 缓存命中后降至 ~200MB）")
	fmt.Println("  · 纹理加载 RPC: N+1 次 → 1 次")
	fmt.Println("  · 缓存检查 RPC: N 次 → 1 次")

	return nil
}

// wrap 折行，每行不超过 maxLen，续行首行缩进保持对齐
func wrap(text string, maxLen int, indent string) string {
	if len(text) <= maxLen {
		return text
	}
	var b strings.Builder
	words := strings.Fields(text)
	lineLen := 0
	first := true
	for _, w := range words {
		if first {
			b.WriteString(w)
			lineLen = len(w)
			first = false
			continue
		}
		if lineLen+1+len(w) > maxLen {
			b.WriteString("\n")
			b.WriteString(indent)
			b.WriteString(w)
			lineLen = len(indent) + len(w)
		} else {
			b.WriteString(" ")
			b.WriteString(w)
			lineLen += 1 + len(w)
		}
	}
	return b.String()
}
