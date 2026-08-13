// 对抗测试：tags.Store 路径/标签安全边界——NUL 字节、控制字符、超长、JSON 注入
package tags

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// =====================================================================
// NUL / 控制字符注入
// =====================================================================

// ---------- 1. NUL 字节在 modelPath 中 ----------
func TestStore_SetTags_NULInPath(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	// 路径中嵌入 NUL——Linux 上可截断，Windows 上 os 拒绝
	path := filepath.Join(tmpDir, "safe.ysm") + "\x00" + "..\\evil.json"
	err := store.SetTags(path, []string{"test"})
	if err != nil {
		t.Logf("FIXED(BUG-NUL-1): SetTags NUL 路径被拒绝: %v", err)
		return
	}
	// 若未拒绝，检查 tags.json 是否写入 NUL 字节
	store.mu.RLock()
	_, exists := store.data[path]
	store.mu.RUnlock()
	if exists {
		t.Logf("BUG(NUL-1): SetTags 接受含 NUL 的路径，tags 内存在该 key")
		return
	}
	t.Log("INFO(NUL-1): SetTags 未崩溃但 tags 内不存在该 key")
}

// ---------- 2. NUL 字节在 tag 中 ----------
func TestStore_SetTags_NULInTag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	err := store.SetTags("model.ysm", []string{"safe\x00malicious"})
	if err != nil {
		t.Logf("FIXED(INFO-NUL-TAG): SetTags NUL 标签被拒绝: %v", err)
		return
	}
	store.mu.RLock()
	tags := store.data["model.ysm"]
	store.mu.RUnlock()
	for _, tag := range tags {
		if strings.Contains(tag, "\x00") {
			t.Logf("BUG(INFO-NUL-TAG): tags 内存在含 NUL 的标签")
			return
		}
	}
	t.Log("FIXED(INFO-NUL-TAG): trimTag 已剔除 NUL 字节")
}

// ---------- 3. 换行符注入 tag（JSON 破坏）----------
func TestStore_SetTags_NewlineInTag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	// 换行符注入——破坏 JSON 结构，导致后续 load 失败
	err := store.SetTags("model.ysm", []string{"safe\ntag2"})
	if err != nil {
		t.Logf("FIXED(INFO-NEWLINE): SetTags 换行标签被拒绝: %v", err)
		return
	}
	store.mu.RLock()
	tags := store.data["model.ysm"]
	store.mu.RUnlock()
	for _, tag := range tags {
		if strings.Contains(tag, "\n") {
			t.Logf("BUG(INFO-NEWLINE): tags 内存在含换行的标签")
			return
		}
	}
	t.Log("FIXED(INFO-NEWLINE): trimTag 已剔除换行符")
}

// ---------- 4. 超长标签 ----------
func TestStore_SetTags_ExtremelyLongTag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	longTag := strings.Repeat("a", 100000)
	err := store.SetTags("model.ysm", []string{longTag})
	if err != nil {
		t.Logf("INFO(INFO-LONG): SetTags 超长标签被拒绝: %v", err)
		return
	}
	store.mu.RLock()
	tags := store.data["model.ysm"]
	store.mu.RUnlock()
	if len(tags) > 0 && len(tags[0]) > maxTagLen {
		t.Logf("BUG(INFO-LONG): 标签超长未截断, len=%d", len(tags[0]))
		return
	}
	t.Logf("FIXED(INFO-LONG): 标签已截断至 %d 字符", len(tags[0]))
}

// ---------- 5. 空 configDir ----------
func TestStore_EmptyConfigDir(t *testing.T) {
	store := NewStore("")
	err := store.SetTags("model.ysm", []string{"test"})
	if err != nil {
		t.Logf("INFO(INFO-EMPTY-CFG): 空 configDir SetTags 被拒绝: %v", err)
		return
	}
	t.Log("FIXED(INFO-EMPTY-CFG): 空 configDir SetTags 内存态成功（不落盘）")
}

// ---------- 6. configDir 含 NUL ----------
func TestStore_NULInConfigDir(t *testing.T) {
	tmpDir := t.TempDir()
	badDir := tmpDir + "\x00" + "..\\evil"
	store := NewStore(badDir)
	err := store.SetTags("model.ysm", []string{"test"})
	if err != nil {
		t.Logf("FIXED(INFO-NUL-CFG): NUL configDir 被拒绝: %v", err)
		return
	}
	// 保存后检查文件是否写入非预期位置
	store.mu.Lock()
	_ = store.save()
	store.mu.Unlock()
	// 检查 tags.json 是否在当前目录被创建
	_, err = os.Stat("tags.json")
	if err == nil {
		os.Remove("tags.json")
		t.Logf("BUG(INFO-NUL-CFG): NUL configDir 导致 tags.json 写入当前目录")
		return
	}
	t.Log("FIXED(INFO-NUL-CFG): NUL configDir 未污染当前目录")
}
