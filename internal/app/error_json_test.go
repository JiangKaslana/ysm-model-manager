// Package app - 错误 JSON 构建工具测试
package app

import (
	"encoding/json"
	"testing"
)

func TestErrorJSON_InjectsError(t *testing.T) {
	got := ErrorJSON(map[string]interface{}{"conflicts": []interface{}{}, "totalConflicts": 0}, "something went wrong")
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	if out["error"] != "something went wrong" {
		t.Errorf("期望 error='something went wrong'，实际 '%v'", out["error"])
	}
	if out["conflicts"] == nil {
		t.Error("base fields 应保留")
	}
}

func TestErrorJSON_ErrInMsgEscaped(t *testing.T) {
	got := ErrorJSON(nil, `msg with "quotes" and <html>`)
	var out map[string]string
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("非法 JSON: %v\nraw: %s", err, got)
	}
	if out["error"] != `msg with "quotes" and <html>` {
		t.Errorf("quote 未转义: %q", out["error"])
	}
}

func TestSyncErrorJSON(t *testing.T) {
	got := SyncErrorJSON("dir not found")
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	if out["error"] != "dir not found" {
		t.Errorf("期望 error='dir not found'，实际 '%v'", out["error"])
	}
	if out["conflicts"] == nil {
		t.Error("conflicts 字段应存在")
	}
}

func TestResolveErrorJSON(t *testing.T) {
	got := ResolveErrorJSON("parse failed")
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	if out["error"] != "parse failed" {
		t.Errorf("期望 error='parse failed'，实际 '%v'", out["error"])
	}
	if out["resolved"].(float64) != 0 {
		t.Error("resolved 应为 0")
	}
}

func TestDedupErrorJSON(t *testing.T) {
	got := DedupErrorJSON(`open "C:\foo": access denied`)
	var out map[string]string
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("非法 JSON: %v\nraw: %s", err, got)
	}
	if out["error"] != `open "C:\foo": access denied` {
		t.Errorf("quote 未转义: %q", out["error"])
	}
}

func TestDedupErrorJSON_EmptyMsg(t *testing.T) {
	got := DedupErrorJSON("")
	var out map[string]string
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatal(err)
	}
	if out["error"] != "" {
		t.Errorf("期望空 error，实际 %q", out["error"])
	}
}

func TestDedupErrorJSON_Multiline(t *testing.T) {
	msg := "line1\nline2"
	got := DedupErrorJSON(msg)
	var out map[string]string
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("非法 JSON: %v\nraw: %s", err, got)
	}
	if out["error"] != msg {
		t.Errorf("换行未转义: got %q want %q", out["error"], msg)
	}
}
