package fsutil

import "bytes"

// UTF8BOM UTF-8 字节序标记（EF BB BF）。
// PowerShell 等工具写出的 JSON/文本常带此前缀，解析前需剥离。
// 单点导出：ysm（header.go/summary.go 共 3 处判定）、fileops、packs、internal/app
// 共 7 处手写字面量收敛于此，新增/调整 BOM 语义只改一处。
var UTF8BOM = []byte{0xEF, 0xBB, 0xBF}

// StripBOM 移除 data 前缀的 UTF-8 BOM；无 BOM 时原样返回（bytes.TrimPrefix 语义）。
func StripBOM(data []byte) []byte {
	return bytes.TrimPrefix(data, UTF8BOM)
}
