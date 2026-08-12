// ===== go/litematic 单测（覆盖率 0% → 补全）=====
package litematic

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

// ===== 最小 NBT 构造 helper =====

// nbtTag 构造带名称前缀的 NBT 标签（type + u16 name 长度 + name + body）。
// 统一各 nbt* helper 的「type+name 前缀」样板。
func nbtTag(tagType byte, name string, body []byte) []byte {
	b := []byte{tagType}
	b = append(b, byte(len(name)>>8), byte(len(name)))
	b = append(b, name...)
	return append(b, body...)
}

func nbtString(name, value string) []byte {
	v := []byte{byte(len(value) >> 8), byte(len(value))}
	v = append(v, value...)
	return nbtTag(0x08, name, v) // TAG_String
}

func nbtInt(name string, v int32) []byte {
	body := []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
	return nbtTag(0x03, name, body) // TAG_Int
}

func nbtCompound(name string, children ...[]byte) []byte {
	return nbtTag(0x0A, name, nbtCompoundBody(children...)) // TAG_Compound
}

// makeLitematicGz 构造最小 litematic（gzip 压缩 NBT，root 含 Metadata）
func makeLitematicGz(t *testing.T) []byte {
	t.Helper()
	metadata := nbtCompound("Metadata",
		nbtString("Name", "测试投影"),
		nbtString("Author", "作者A"),
		nbtInt("TotalBlocks", 42),
		nbtInt("TotalVolume", 100),
		nbtCompound("EnclosingSize",
			nbtInt("x", 16), nbtInt("y", 16), nbtInt("z", 16),
		),
	)
	root := nbtCompound("",
		nbtInt("Version", 5),
		metadata,
	)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// ===== 测试 =====

func TestParseMeta_Success(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.litematic")
	if err := os.WriteFile(path, makeLitematicGz(t), 0644); err != nil {
		t.Fatal(err)
	}
	meta, err := ParseMeta(path)
	if err != nil {
		t.Fatalf("ParseMeta 失败: %v", err)
	}
	if meta.Name != "测试投影" || meta.Author != "作者A" {
		t.Fatalf("元数据错误: %+v", meta)
	}
	if meta.TotalBlocks != 42 || meta.TotalVolume != 100 {
		t.Fatalf("统计错误: %+v", meta)
	}
	if meta.EnclosingSize != [3]int{16, 16, 16} {
		t.Fatalf("尺寸错误: %+v", meta.EnclosingSize)
	}
}

func TestParseMeta_Errors(t *testing.T) {
	// 文件不存在
	if _, err := ParseMeta(filepath.Join(t.TempDir(), "nope.litematic")); err == nil {
		t.Fatal("不存在文件应报错")
	}
	// 非 gzip 数据
	bad := filepath.Join(t.TempDir(), "bad.litematic")
	if err := os.WriteFile(bad, []byte("notgzip"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseMeta(bad); err == nil {
		t.Fatal("非 gzip 应报错")
	}
	// 缺 Metadata compound
	root := nbtCompound("", nbtInt("Version", 5))
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, _ = gz.Write(root)
	_ = gz.Close()
	noMeta := filepath.Join(t.TempDir(), "nometa.litematic")
	if err := os.WriteFile(noMeta, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseMeta(noMeta); err == nil {
		t.Fatal("缺 Metadata 应报错")
	}
}
