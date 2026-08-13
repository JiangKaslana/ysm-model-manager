// ===== .ysm 二进制解码器注入点 =====
// 2026-08-08 架构决策（docs/architecture.md §4.1）：YSMParser 统一为内嵌 WASM，
// 取代 exe sidecar。go/ 业务层（fileops 等）不依赖具体实现，由上层
// internal/app（Node 子进程 + WASM）在 init 阶段注入；未注入时 DecodeYSM 返回 nil，
// 调用方按「解码不可用」静默降级（与 Android 无 Node 时口径一致）。
package ysm

// DecodedFile 解码 .ysm 产出的一个文件（Path 为输出目录内相对路径）
type DecodedFile struct {
	Path string
	Data []byte
}

// ysmDecoder 注入的 .ysm 解码器：输入 .ysm 字节，输出解出的全部文件
var ysmDecoder func(ysmData []byte) []DecodedFile

// SetDecoder 注入 .ysm 解码器（internal/app init 阶段调用，替换 FindCLI 模式）
func SetDecoder(fn func(ysmData []byte) []DecodedFile) {
	ysmDecoder = fn
}

// DecodeYSM 解码 .ysm 字节；解码器未注入或解码失败返回 nil
func DecodeYSM(ysmData []byte) []DecodedFile {
	if ysmDecoder == nil {
		return nil
	}
	return ysmDecoder(ysmData)
}
