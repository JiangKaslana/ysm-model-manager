// Package avatar 创作者头像提取与缓存，不依赖 Wails runtime。
//
// 本文件（avatar_zip.go）：ZIP 内文件读取（ReadFileFromZip / ReadFileFromContainer）
// 与路径匹配（matchZipEntry/isYSMJSONPath），供提取编排复用。拆分自原 avatar.go
// （ADR-040 文件行数治理）。
package avatar

import (
	"archive/zip"
	"io"
	"log"
	"strings"

	"ysm-model-manager/go/container"
)

// ReadFileFromZip 从 ZIP 读取指定路径的文件。
func ReadFileFromZip(zr *zip.Reader, target string) []byte {
	target = strings.ReplaceAll(target, "\\", "/")
	targetLower := strings.ToLower(target)
	for _, f := range zr.File {
		p := strings.ReplaceAll(f.Name, "\\", "/")
		// 裸 HasSuffix 会让 sub/avatar/alice.png 命中 avatar/alice.png、
		// x/ysm.json 先于根 ysm.json 被取到——改为「精确路径或根下 target/ 前缀」匹配
		if !matchZipEntry(p, targetLower) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			log.Printf("[avatar] zip 条目打开失败 %s: %v", f.Name, err)
			return nil
		}
		defer rc.Close()
		// zip-bomb 防线：条目解压后大小未限制，ReadAll 全量读入可 OOM——
		// readLimitedModel 限的是压缩体积，解压比无界；对齐 readLimitedAvatar
		// 50MB 上限口径，LimitReader+1 截断探测（ADR-033，防恰 50MB 静默截断）
		const maxEntrySize = 50 << 20
		data, err := io.ReadAll(io.LimitReader(rc, maxEntrySize+1))
		if err != nil {
			log.Printf("[avatar] zip 条目读取失败 %s: %v", f.Name, err)
			return nil
		}
		if len(data) > maxEntrySize {
			log.Printf("[avatar] zip 条目超限跳过 %s（解压超 50MB）", f.Name)
			return nil
		}
		return data
	}
	return nil
}

// ReadFileFromContainer 从统一容器读取指定路径的文件（ADR-068：
// 容器打开统一走 container，替代 zip.NewReader + ReadFileFromZip 的 zip 专用路径）。
func ReadFileFromContainer(r container.Reader, target string) []byte {
	target = strings.ReplaceAll(target, "\\", "/")
	targetLower := strings.ToLower(target)
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		p := strings.ReplaceAll(e.Name(), "\\", "/")
		if !matchZipEntry(p, targetLower) {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			log.Printf("[avatar] 容器条目打开失败 %s: %v", e.Name(), err)
			return nil
		}
		data, rerr := io.ReadAll(io.LimitReader(rc, 50<<20+1))
		rc.Close()
		if rerr != nil {
			log.Printf("[avatar] 容器条目读取失败 %s: %v", e.Name(), rerr)
			return nil
		}
		if len(data) > 50<<20 {
			log.Printf("[avatar] 容器条目超限跳过 %s（解压超 50MB）", e.Name())
			return nil
		}
		return data
	}
	return nil
}

// matchZipEntry zip 条目路径匹配：
//   - 精确相等（含目标含路径如 "avatar/alice.png" 时，仅同名同路径命中，杜绝
//     sub/avatar/alice.png 误命中——P3-3 收紧点）
//   - 目标以 "/" 结尾（目录级）→ 根下该目录前缀
//   - 裸文件名（无 "/"，如 "test.png"）→ 任意目录下同名文件（既有契约：avatar/test.png
//     命中 test.png，avatarCandidates 兼容裸文件名引用）
func matchZipEntry(p, targetLower string) bool {
	low := strings.ToLower(p)
	if low == targetLower {
		return true
	}
	if strings.HasSuffix(targetLower, "/") {
		return strings.HasPrefix(low, targetLower)
	}
	if !strings.Contains(targetLower, "/") {
		return strings.HasSuffix(low, "/"+targetLower)
	}
	return false
}

// isYSMJSONPath 判断解码产物路径是否为 ysm.json 清单：精确名或任意目录下的 ysm.json。
// 原 HasSuffix(low, "ysm.json") 会把 "notysm.json"/"myysm.json" 等误判为清单——若该文件
// 先于真实 ysm.json 出现在文件列表，元数据解析会取到错误内容；zip 分支 matchZipEntry
// 裸名匹配仅认 "/ysm.json" 后缀，两分支口径不一致（本次对齐）。
func isYSMJSONPath(p string) bool {
	low := strings.ToLower(strings.ReplaceAll(p, "\\", "/"))
	return low == "ysm.json" || strings.HasSuffix(low, "/ysm.json")
}
