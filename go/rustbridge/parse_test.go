//go:build rust_backend

package rustbridge

import (
	"strings"
	"testing"
)

func TestParseResponseDecodesEntries(t *testing.T) {
	data := []byte(`{"entries":[{"Name":"a","Path":"x/a.ysm","Ext":".ysm","Size":1}],"cacheable":true}`)
	resp, err := parseResponse(data, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Entries) != 1 || resp.Entries[0].Path != "x/a.ysm" {
		t.Fatalf("entries not decoded: %+v", resp.Entries)
	}
	if !resp.Cacheable {
		t.Fatal("cacheable not decoded")
	}
}

func TestParseResponseNilEntriesBecomeEmpty(t *testing.T) {
	resp, err := parseResponse([]byte(`{"entries":null}`), false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Entries == nil {
		t.Fatal("Entries must be non-nil empty slice after normalization")
	}
	if len(resp.Entries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(resp.Entries))
	}
}

func TestParseResponseSurfacesRustError(t *testing.T) {
	_, err := parseResponse([]byte(`{"error":"boom"}`), false)
	if err == nil || err.Error() != "boom" {
		t.Fatalf("expected rust business error to surface, got %v", err)
	}
}

func TestParseResponseRejectsBadJSON(t *testing.T) {
	if _, err := parseResponse([]byte(`not json`), false); err == nil {
		t.Fatal("expected decode error")
	}
}

func TestParseResponseManifestLabel(t *testing.T) {
	_, err := parseResponse([]byte(`not json`), true)
	if err == nil || !strings.Contains(err.Error(), "manifest response") {
		t.Fatalf("expected manifest-labeled decode error, got %v", err)
	}
}
