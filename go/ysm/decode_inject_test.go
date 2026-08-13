// ===== go/ysm 解码器注入点单测 =====
// SetDecoder/DecodeYSM 往返：未注入返回 nil，注入后透传结果
package ysm

import (
	"testing"
)

func TestDecodeYSM_NoDecoderInjected(t *testing.T) {
	// 测试默认未注入状态（其他测试注入后均以 t.Cleanup 恢复 nil）
	if got := DecodeYSM([]byte("YSGP\x00test")); got != nil {
		t.Fatalf("未注入解码器应返回 nil, 得到 %d 个文件", len(got))
	}
}

func TestDecodeYSM_InjectedPassthrough(t *testing.T) {
	SetDecoder(func(data []byte) []DecodedFile {
		return []DecodedFile{{Path: "output/a.json", Data: data}}
	})
	t.Cleanup(func() { SetDecoder(nil) })

	got := DecodeYSM([]byte("YSGP\x00abc"))
	if len(got) != 1 || got[0].Path != "output/a.json" || string(got[0].Data) != "YSGP\x00abc" {
		t.Fatalf("注入解码器应透传结果, 得到 %+v", got)
	}
}

func TestDecodeYSM_InjectNilResult(t *testing.T) {
	// 解码器返回 nil（无 node 等失败场景）→ DecodeYSM 返回 nil
	SetDecoder(func(data []byte) []DecodedFile { return nil })
	t.Cleanup(func() { SetDecoder(nil) })

	if got := DecodeYSM([]byte("x")); got != nil {
		t.Fatalf("解码器返回 nil 时应透传 nil, 得到 %d 个文件", len(got))
	}
}
