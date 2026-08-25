//go:build rust_backend

package rustbridge

import (
	"encoding/json"
	"errors"
	"fmt"

	"ysm-model-manager/go/types"
)

// parseResponse 将 Rust 扫描器返回的缓冲区字节解码为 ScanResponse：
// JSON 反序列化 → 透传 Rust 侧业务错误 → 空 Entries 兜底为 []。
// Windows LazyDLL 与 android/linux/darwin CGO 静态链接的 Scan/ScanManifest
// 共用此段，避免历史遗留的多份复制漂移。
func parseResponse(data []byte, manifest bool) (ScanResponse, error) {
	label := "response"
	if manifest {
		label = "manifest response"
	}
	var response ScanResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return ScanResponse{}, fmt.Errorf("decode Rust scanner %s: %w", label, err)
	}
	if response.Error != "" {
		return ScanResponse{}, errors.New(response.Error)
	}
	if response.Entries == nil {
		response.Entries = []types.ModelEntry{}
	}
	return response, nil
}
