package geometry

// ysm_parser_test.go — 共享 ysm.json 解析器（路线 B，a3030e5e）直接单测。
// 行为不变承诺的回归锁：texOrder/modelOrder 驱动 texSlot 绑定，静默偏差
// 直接错绑纹理（code review P2/P3：ToLower/TrimSuffix 顺序、三形态保序）。

import (
	"encoding/json"
	"testing"
)

func TestTexBasenameNoExt_ToLowerFirst(t *testing.T) {
	// code review P2 回归锁：顺序必须先 ToLower 再 TrimSuffix——
	// 旧内联代码（archive.go 旧 L342/791）即此序；反序时大写扩展名去不掉，
	// texOrder 去重与 texIdxMap 查找失配，texSlot 静默错绑
	cases := []struct {
		in   string
		want string
	}{
		{"textures/FOXCAR.PNG", "foxcar"},   // 大写扩展名必须剥除（修复前返回 "foxcar.png"）
		{"textures/arrow.png", "arrow"},     // 常规小写
		{"textures/skin.jpg", "skin"},       // .jpg 也要剥
		{"textures/SubDir/TEX.PNG", "tex"},  // 去目录 + 大写扩展名
		{"textures\\win\\MIX.JPG", "mix"},   // 反斜杠目录 + 大写
		{"textures/boat.PNG", "boat"},       // 项目符号纹理同路径
		{"textures/plain", "plain"},         // 无扩展名原样
	}
	for _, c := range cases {
		if got := texBasenameNoExt(c.in); got != c.want {
			t.Errorf("texBasenameNoExt(%q) = %q, want %q（ToLower 必须先于 TrimSuffix）", c.in, got, c.want)
		}
	}
}

func TestParseProjModels_FormsPreserveOrder(t *testing.T) {
	// 三形态声明序保留：list 切片序 / single 直读 / dict 用 Decoder Token 流保序
	// （map 遍历不保序——实现刻意用 Token 流，见 ysm_parser.go L151-165）
	list := `[{"model":"a","texture":"a.png"},{"model":"b","texture":"b.png"}]`
	if got := parseProjModels(json.RawMessage(list)); !projModelsEqual(got, []string{"a", "b"}) {
		t.Errorf("list 形态应保声明序 [a b]，实际 %v", projModelNames(got))
	}

	single := `{"model":"arrow","texture":"arrow.png"}`
	if got := parseProjModels(json.RawMessage(single)); !projModelsEqual(got, []string{"arrow"}) {
		t.Errorf("single 形态应只收一条 [arrow]，实际 %v", projModelNames(got))
	}

	dict := `{"minecraft:boat":{"model":"boat","texture":"boat.png"},"minecraft:minecart":{"model":"minecart","texture":"minecart.png"}}`
	if got := parseProjModels(json.RawMessage(dict)); !projModelsEqual(got, []string{"boat", "minecart"}) {
		t.Errorf("dict 形态应 Token 流保序 [boat minecart]，实际 %v", projModelNames(got))
	}

	empty := `{}`
	if got := parseProjModels(json.RawMessage(empty)); len(got) != 0 {
		t.Errorf("空对象应收零条，实际 %v", projModelNames(got))
	}
}

func projModelNames(entries []projEntry) []string {
	names := make([]string, len(entries))
	for i, e := range entries {
		names[i] = e.model
	}
	return names
}

func projModelsEqual(entries []projEntry, want []string) bool {
	got := projModelNames(entries)
	if len(got) != len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
