// ===== 资源包 block/item 模型读取绑定（ADR-080 PackModelAdapter）=====
// ListPackModels 枚举容器内模型 JSON 条目；ReadPackEntry 读单条目内容（base64）。
// 复用 container.Reader（ADR-068），统一支持 .zip / 目录 / .7z。

package app

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"sort"
	"strings"

	"ysm-model-manager/go/container"
)

// maxPackEntrySize 单条目读取上限（64MB）：模型 JSON 远小于此，纹理 PNG 亦足够。
const maxPackEntrySize = 64 << 20

// packModelEntryMatch 判定条目是否为 block/item 模型 JSON：
// assets/<ns>/models/{block,item}/**/*.json（含子目录，如 door/fence_gate）
func packModelEntryMatch(name string) bool {
	n := strings.ToLower(name)
	if !strings.HasPrefix(n, "assets/") || !strings.HasSuffix(n, ".json") {
		return false
	}
	idx := strings.Index(n, "/models/")
	if idx < 0 {
		return false
	}
	rest := n[idx+len("/models/"):]
	return strings.HasPrefix(rest, "block/") || strings.HasPrefix(rest, "item/")
}

// packEntrySafe 条目路径守卫：必须 assets/ 开头，禁止 .. / 反斜杠 / 绝对路径（防穿越）。
func packEntrySafe(name string) bool {
	n := strings.ToLower(name)
	if !strings.HasPrefix(n, "assets/") {
		return false
	}
	if strings.Contains(n, "..") || strings.Contains(n, "\\") || strings.HasPrefix(n, "/") {
		return false
	}
	return true
}

// ListPackModels 枚举资源包容器内的 block/item 模型 JSON 条目路径（升序）。
// 失败或无模型返回 "[]"（前端据此回退缩略图通道）。
func (a *App) ListPackModels(path string) string {
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[packs] ListPackModels 打开失败 %s: %v", path, err)
		return "[]"
	}
	defer r.Close()
	seen := map[string]bool{}
	var out []string
	for _, e := range r.Entries() {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if packModelEntryMatch(n) && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	sort.Strings(out)
	data, _ := json.Marshal(out)
	return string(data)
}

// ReadPackEntry 读取容器内条目内容（base64 字符串）。
// entry 非法/缺失/超限返回空串（前端渲染兜底跳过）。
func (a *App) ReadPackEntry(path, entry string) string {
	if !packEntrySafe(entry) {
		log.Printf("[packs] ReadPackEntry 非法条目 %q", entry)
		return ""
	}
	r, err := container.Open(path)
	if err != nil {
		log.Printf("[packs] ReadPackEntry 打开失败 %s: %v", path, err)
		return ""
	}
	defer r.Close()
	for _, e := range r.Entries() {
		if e.IsDir() || !strings.EqualFold(e.Name(), entry) {
			continue
		}
		rc, err := e.Open()
		if err != nil {
			return ""
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxPackEntrySize))
		rc.Close()
		if err != nil {
			log.Printf("[packs] ReadPackEntry 读取失败 %s/%s: %v", path, entry, err)
			return ""
		}
		return base64.StdEncoding.EncodeToString(data)
	}
	log.Printf("[packs] ReadPackEntry 条目不存在 %s/%s", path, entry)
	return ""
}
