// ===== repoaudit 共享包测试 =====
// 覆盖：空仓库审计 / 坏模型扣分 / 去重汇总（HealthReportFor）。
// 策略：临时目录 + 零配置,不触碰真实用户配置/缓存。
package repoaudit

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAudit_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit(empty) 应成功, got %v", err)
	}
	if result.Score != 100 {
		t.Errorf("空仓库分数应为 100, got %d", result.Score)
	}
	if result.Completeness.Checked != 0 {
		t.Errorf("空仓库不应有完整性检查, got %d", result.Completeness.Checked)
	}
	if result.Resources.TotalFiles != 0 {
		t.Errorf("空仓库文件数应为 0, got %d", result.Resources.TotalFiles)
	}
}

func TestAudit_BadModelLowersScore(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "broken.ysm"), []byte("not json"))

	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if result.Completeness.Checked != 1 || result.Completeness.Invalid != 1 {
		t.Errorf("坏模型应记为 1 无效, got checked=%d invalid=%d", result.Completeness.Checked, result.Completeness.Invalid)
	}
	if result.Score > 95 {
		t.Errorf("坏模型应扣分, got score=%d", result.Score)
	}
	if len(result.Warnings) == 0 {
		t.Error("坏模型应产生完整性警告")
	}
}

func TestHealthReportFor_IncludesDedup(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "a.ysm"), []byte("same content"))
	writeFile(t, filepath.Join(dir, "b.ysm"), []byte("same content"))
	// 第三个文件相同 → 2 组多余
	writeFile(t, filepath.Join(dir, "c.ysm"), []byte("same content"))

	report, err := HealthReportFor(dir)
	if err != nil {
		t.Fatalf("HealthReportFor 应成功, got %v", err)
	}
	if report.Dedup.Groups != 1 {
		t.Errorf("应有 1 个去重组, got %d", report.Dedup.Groups)
	}
	if report.Dedup.ExtraFiles != 2 {
		t.Errorf("应有 2 个多余文件, got %d", report.Dedup.ExtraFiles)
	}
	if report.Dedup.Reclaim <= 0 {
		t.Errorf("可回收字节应 > 0, got %d", report.Dedup.Reclaim)
	}
	if report.Score <= 0 || report.Score > 100 {
		t.Errorf("分数应在 1-100, got %d", report.Score)
	}
}

func TestHealthReportFor_ErrOnMissingDir(t *testing.T) {
	_, err := HealthReportFor(filepath.Join(t.TempDir(), "nope"))
	if err == nil {
		t.Error("不存在的目录应报错")
	}
}

// writeFile 写文件（超小内容,一次写盘）
func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("写文件 %s 失败: %v", path, err)
	}
}
