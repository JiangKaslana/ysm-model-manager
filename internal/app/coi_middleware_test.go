package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCoopCoepMiddlewareOff：非 mpr 构建（默认）→ 不注入 COOP/COEP（透传，零额外语义）。
func TestCoopCoepMiddlewareOff(t *testing.T) {
	if coopCoepEnabled {
		t.Skip("mpr build tag set; skipping off test")
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := CoopCoepMiddleware(next)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := rec.Header().Get("Cross-Origin-Opener-Policy"); got != "" {
		t.Errorf("off: expected no COOP header, got %q", got)
	}
	if got := rec.Header().Get("Cross-Origin-Embedder-Policy"); got != "" {
		t.Errorf("off: expected no COEP header, got %q", got)
	}
}

// TestCoopCoepMiddlewareOn：mpr 构建（-tags mpr）→ 注入 COOP/COEP 解锁 SharedArrayBuffer。
// Run with: go test -tags mpr ./internal/app/ -run TestCoopCoepMiddlewareOn
func TestCoopCoepMiddlewareOn(t *testing.T) {
	if !coopCoepEnabled {
		t.Skip("mpr build tag not set; skipping on test")
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := CoopCoepMiddleware(next)
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if got := rec.Header().Get("Cross-Origin-Opener-Policy"); got != "same-origin" {
		t.Errorf("on: expected COOP=same-origin, got %q", got)
	}
	if got := rec.Header().Get("Cross-Origin-Embedder-Policy"); got != "require-corp" {
		t.Errorf("on: expected COEP=require-corp, got %q", got)
	}
}
