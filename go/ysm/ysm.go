package ysm

import (
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml）
func IsYSMJar(jarPath string) bool {
	return IsModJar(jarPath, "yes_steve_model", "Yes Steve Model")
}

// IsModJar 内容检测单个 jar 是否是指定 mod（读取 META-INF/mods.toml / neoforge.mods.toml
// 的 [[mods]] 块，按 modId + displayName 判定，非文件名匹配）。
// ADR-095：车万女仆等模型 mod 复用此内容检测，避免 ModKeywords 手写文件名关键词。
func IsModJar(jarPath, modID, displayName string) bool {
	r, err := container.OpenZipPath(jarPath)
	if err != nil {
		return false
	}
	defer r.Close()

	for _, f := range r.Entries() {
		// 支持 mods.toml 和 neoforge.mods.toml
		name := strings.ToLower(f.Name())
		if name != "meta-inf/mods.toml" && name != "meta-inf/neoforge.mods.toml" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		// limit+1 探测截断——LimitReader 截断后 ReadAll 返回 nil 错误（ADR-033 陷阱），
		// >1MB 的 mods.toml 会以截断数据继续匹配，导致 IsYSMJar 误判 false。
		// ADR-044 策略 A：统一走 fsutil.ReadLimitedEntry（超限/错误返回 nil → 跳过）
		const maxModsToml = 1 << 20
		data := fsutil.ReadLimitedEntry(rc, int64(maxModsToml))
		if data == nil {
			continue // 读取失败或超过 1MB 上限，视为畸形文件跳过
		}

		content := string(data)
		lines := strings.Split(content, "\n")
		inModsBlock := false
		foundModID := false
		foundDisplayName := false
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed == "[[mods]]" {
				inModsBlock = true
				foundModID = false
				foundDisplayName = false
				continue
			}
			if inModsBlock {
				if strings.HasPrefix(trimmed, "[[") || strings.HasPrefix(trimmed, "[") {
					if foundModID && foundDisplayName {
						return true
					}
					inModsBlock = false
					continue
				}
				if strings.HasPrefix(trimmed, `modId="`+modID+`"`) ||
					strings.HasPrefix(trimmed, `modId = "`+modID+`"`) {
					foundModID = true
				}
				if strings.HasPrefix(trimmed, `displayName="`+displayName+`"`) ||
					strings.HasPrefix(trimmed, `displayName = "`+displayName+`"`) {
					foundDisplayName = true
				}
			}
		}
		if inModsBlock && foundModID && foundDisplayName {
			return true
		}
	}
	return false
}

// HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP）
func HasYSMMod(modsDir string) bool {
	files, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".jar") {
			continue
		}
		// 文件名快速过滤：只对名称含 yes_steve_model 或 ysm- 的 JAR 打开 ZIP
		name := strings.ToLower(f.Name())
		if !strings.Contains(name, "yes_steve_model") && !strings.Contains(name, "ysm-") {
			continue
		}
		if IsYSMJar(filepath.Join(modsDir, f.Name())) {
			return true
		}
	}
	return false
}

// 各资源类型的 mod 文件名关键词
var ModKeywords = map[string][]string{
	"ysm":           {"yes_steve_model", "ysm-"},
	"mmd-skin":      {"mmdskin", "mmd-skin"},
	"vrchat-avatar": {"vrchat"},
}

// ModMeta 内容检测型资源类型的 mod 识别信息（modId + displayName，读 mods.toml 判定）。
// ADR-095：maid-model（车万女仆）不用文件名关键词，读 jar 内 mods.toml 确认
// modId="touhou_little_maid"（TouhouLittleMaid 源码 mods.toml 核实）。
var ModMeta = map[string]struct{ ModID, DisplayName string }{
	"maid-model": {"touhou_little_maid", "Touhou Little Maid"},
}

// HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar
func HasModInDir(modsDir, rtype string) bool {
	// ADR-095：内容检测型资源（ModMeta 有 modId/displayName）优先读 mods.toml，
	// 不靠文件名关键词匹配（避免 jar 改名/翻译导致误判）
	if meta, ok := ModMeta[rtype]; ok {
		files, err := os.ReadDir(modsDir)
		if err != nil {
			return false
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(strings.ToLower(f.Name()), ".jar") {
				continue
			}
			if IsModJar(filepath.Join(modsDir, f.Name()), meta.ModID, meta.DisplayName) {
				return true
			}
		}
		return false
	}
	keywords, ok := ModKeywords[rtype]
	if !ok {
		// 非模型类（资源包/光影包/蓝图等）默认假设 mod 已安装，由调用方按需处理
		return true
	}
	files, err := os.ReadDir(modsDir)
	if err != nil {
		return false
	}
	lower := strings.ToLower
	// 循环不变量提升（审核 P3）：rtype 在遍历中不变，注册表查询（mutex + 线性扫描 +
	// 3 个切片拷贝）只执行一次，而非每个命中 jar 一次
	rt := types.RegistryType(rtype)
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(lower(f.Name()), ".jar") {
			continue
		}
		// 文件名快速过滤
		name := lower(f.Name())
		match := false
		for _, kw := range keywords {
			if strings.Contains(name, kw) {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		// 进一步检查：内容检测型资源（注册表 detector=ysm）打开 ZIP 确认 mods.toml，
		// 其余类型仅凭文件名匹配（ADR-065：rtype 分支注册表化，新增类型只需改 JSON）
		if rt != nil && rt.Detector == "ysm" {
			if IsYSMJar(filepath.Join(modsDir, f.Name())) {
				return true
			}
		} else {
			// 其他类型仅凭文件名匹配即可
			return true
		}
	}
	return false
}
