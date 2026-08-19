// ===== 整合包资源目录查找（从 extensions.go 拆出，ADR-040）=====
package types

import (
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// dirContainsExt 判断目录树内是否存在扩展名命中 extSet 的文件（找到即停，避免全树扫）
func dirContainsExt(root string, extSet map[string]bool) bool {
	found := false
	if werr := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || found {
			return err
		}
		if !d.IsDir() && extSet[strings.ToLower(filepath.Ext(p))] {
			found = true
			return filepath.SkipAll
		}
		return nil
	}); werr != nil && !errors.Is(werr, filepath.SkipAll) {
		log.Printf("[types] FindInstDir 扫描失败 %s: %v", root, werr)
	}
	return found
}

// dirContainsFlag 判断目录树内是否存在指定文件名（大小写不敏感，找到即停）。
// ADR-095：ysm 解压型模型目录无 .ysm 主文件，以 ysm.json 标志文件识别——
// 仅按扩展名判定时 config 树下任意 .json 配置文件都会误命中。
func dirContainsFlag(root, flag string) bool {
	found := false
	if werr := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || found {
			return err
		}
		if !d.IsDir() && strings.EqualFold(d.Name(), flag) {
			found = true
			return filepath.SkipAll
		}
		return nil
	}); werr != nil && !errors.Is(werr, filepath.SkipAll) {
		log.Printf("[types] dirContainsFlag 扫描失败 %s: %v", root, werr)
	}
	return found
}

// FindInstDir 查找整合包中指定资源类型的子目录：
//  1. 优先使用标准子目录名（如 schematics）——但仅当其中确实包含该类型文件
//  2. 标准目录不存在 / 存在但无该类型文件 → 扫描整合包版本目录下所有子目录，
//     找包含该类型文件的目录（P5 修复：Sable Schematics 等模组把蓝图放在
//     Sable-Schematics/ 等非标准目录，标准 schematics 目录存在但为空时原实现
//     直接返回空目录 → 蓝图识别不到；现改为无文件时继续兜底）
//
// ADR-095 收紧：.json 不再作为独立的「含该类型文件」证据（config 目录下模组
// 配置文件泛滥，ysm 的扩展名含 .json 时 config 树会被误判为模型目录）；ysm 的
// json 证据以 ysm.json 标志文件替代（解压型模型目录无 .ysm 主文件）。
//
// ADR-104 续收紧：容器扩展名（.zip/.7z）同样不作为独立命中证据——整合包根下
// 散落的 .zip（模组安装包/资源包 zip）会被兜底扫描误判为蓝图/投影目录。仅当该
// 类型扩展集还存在非容器主证据（如 .nbt/.schematic/.litematic/.ysm/.pmx）时
// 剔除；纯容器类型（resourcepack/shaderpack 扩展集仅 .zip/.7z）保留，否则其
// 兜底扫描完全失效（回归守卫 TestFindInstDir_ResourcepackZipKept）。
func FindInstDir(versionDir, subDir, rtype string) string {
	standard := filepath.Join(versionDir, subDir)
	exts := SupportedExtsForType(rtype)
	extSet := make(map[string]bool)
	// 容器扩展名（zip/7z 可包裹任意资源，属弱证据）
	containerExts := map[string]bool{".zip": true, ".7z": true}
	hasNonContainer := false
	for _, e := range exts {
		low := strings.ToLower(e)
		if low == ".json" {
			continue // ADR-095：.json 弱证据，仅以 ysm.json 标志文件识别
		}
		extSet[low] = true
		if !containerExts[low] {
			hasNonContainer = true
		}
	}
	// ADR-104 续：有非容器主证据时剔除容器弱证据；纯容器类型保留
	if hasNonContainer {
		for c := range containerExts {
			delete(extSet, c)
		}
	}
	// hit 判定：扩展名命中（剔除 .json/.zip/.7z 弱证据）或 ysm 标志文件命中
	// 消费注册表 detector 字段（ADR-065 合规），不硬编码 rtype。
	rt := RegistryType(rtype)
	isYsm := rt != nil && rt.Detector == "ysm"
	hit := func(root string) bool {
		if dirContainsExt(root, extSet) {
			return true
		}
		return isYsm && dirContainsFlag(root, "ysm.json")
	}
	// 标准目录存在且包含该类型文件 → 标准优先返回（行为不变）
	if info, err := os.Stat(standard); err == nil && info.IsDir() &&
		hit(standard) {
		return standard
	}
	if len(extSet) == 0 && !isYsm {
		return standard // 没有扩展名信息，返回标准路径（ysm 仍可经标志文件判定）
	}
	// 标准目录不存在 / 存在但无该类型文件 → 兜底扫描其他子目录
	entries, err := os.ReadDir(versionDir)
	if err != nil {
		return standard
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(versionDir, e.Name())
		// 跳过标准目录本身（已确认无该类型文件，避免重复扫描）
		if strings.EqualFold(sub, standard) {
			continue
		}
		if hit(sub) {
			return sub
		}
	}
	return standard // 没找到，返回标准路径（SyncResources 会找到空目录返回空结果）
}
