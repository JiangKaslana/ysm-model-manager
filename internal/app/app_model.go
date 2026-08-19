// ========== YSM 模型解析 ==========
// 从 app.go 拆分：模型文件分析、几何体解析（.ysm 解码统一走内嵌 WASM，
// 2026-08-08 架构决策，exe sidecar 已停发）
package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// bedrockReadMax 受限整读上限（对齐 fileops maxPreviewRead 50MB 口径，
// 防 YSMParser 被篡改输出 GB 级 JSON 撑爆内存）
const bedrockReadMax = 50 << 20

// readLimitedFileBedrock 受限整读 JSON 文件（仅用于 parseBedrockGeometry 输入）
// 返回 nil 表示读失败或超限（对齐 fileops readLimitedFile 风格）
func readLimitedFileBedrock(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	return fsutil.ReadLimitedEntry(f, bedrockReadMax)
}

func (a *App) AnalyzeYSMModel(path string) ysm.YSMModelMeta {
	return ysm.AnalyzeYSMModel(path)
}

func (a *App) ExtractYsmSummary(path string) ysm.YsmSummary {
	summary, err := ysm.ExtractYsmSummary(path)
	if err != nil {
		// 解析失败不再完全静默——记录日志便于诊断。
		// 绑定签名保持单返回值（不破坏前端契约），前端 detail.ts 有 hasRealSummary 兜底 toast
		log.Printf("[ysm] ExtractYsmSummary 解析失败 %s: %v", path, err)
		summary = ysm.YsmSummary{
			Schema: "ysm-summary/v1",
			Source: filepath.Base(path),
		}
	}
	return summary
}

func (a *App) ExtractYSMHeader(path string) ysm.YSMHeader {
	return ysm.AnalyzeYSMHeader(path)
}

func (a *App) ExtractYSMHeaderFromBase64(base64Data string) ysm.YSMHeader {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return ysm.YSMHeader{}
	}
	return ysm.AnalyzeYSMHeaderFromBytes(data)
}

func (a *App) SavePreviewTempFile(base64Data string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", err
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	os.MkdirAll(tmpDir, 0755)
	tmpFile, err := os.CreateTemp(tmpDir, "preview-*.ysm")
	if err != nil {
		return "", err
	}
	defer tmpFile.Close()
	_, err = tmpFile.Write(data)
	if err != nil {
		return "", err
	}
	return tmpFile.Name(), nil
}

func (a *App) ReadFileBytes(path string) []byte {
	// 路径守卫：限制在任一合法扫描根（FilesRoot/McRoot/VrcRoot/…）内，防止读取系统任意文件。
	// 2026-08-16 修复：原用 isPathInRoot（只认 ysm 根），导致 VRM/MMD 等兄弟类型根（VrcRoot 等）
	// 下的文件被误拒 → 前端 vrm-adapter 报「ReadFileBytes 返回空」。改用 isPathInRootOrSelf，
	// 与 ScanModelEntries 等扫描口径一致：扫描能列出的文件就能读；仍拒绝 .. 越权/根外路径。
	if !a.isPathInRootOrSelf(path) {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return data
}

// ReadFileBytesBatch 批量读取多个文件（ADR-101：MMD 纹理加载优化）。
// 一次 RPC 返回多个文件字节，减少 Go↔JS IPC 往返（原 N 次 readFileBytes → 1 次 batch）。
// 路径守卫：逐个校验 isPathInRootOrSelf，非法路径跳过（值为 nil）。
// 返回 map[路径] → base64 字节（Wails []byte 自动序列化为 base64，map 保持键序）。
//
// 并发优化：I/O 密集型任务，使用 goroutine 池并行读取。
// 当 paths 数量 <= 4 时退化为顺序读取（goroutine 开销不划算）。
func (a *App) ReadFileBytesBatch(paths []string) map[string][]byte {
	if len(paths) <= 4 {
		return a.readFileBytesBatchSequential(paths)
	}
	return a.readFileBytesBatchConcurrent(paths)
}

// readFileBytesBatchSequential 顺序读取（小规模或单文件场景）
func (a *App) readFileBytesBatchSequential(paths []string) map[string][]byte {
	result := make(map[string][]byte, len(paths))
	for _, p := range paths {
		if !a.isPathInRootOrSelf(p) {
			continue
		}
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		result[p] = data
	}
	return result
}

// readFileBytesBatchConcurrent 并发批量读取（goroutine 池 + 分片调度）
// 按 runtime.NumCPU() 数量启动 worker，每个 worker 从任务队列取 path 读取。
func (a *App) readFileBytesBatchConcurrent(paths []string) map[string][]byte {
	type readTask struct {
		index int
		path  string
	}

	// 预过滤：路径守卫前置，非法路径直接跳过
	validPaths := make([]readTask, 0, len(paths))
	for i, p := range paths {
		if a.isPathInRootOrSelf(p) {
			validPaths = append(validPaths, readTask{index: i, path: p})
		}
	}

	result := make(map[string][]byte, len(validPaths))
	if len(validPaths) == 0 {
		return result
	}

	// 启动 worker 池
	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}

	taskCh := make(chan readTask, len(validPaths))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for task := range taskCh {
				data, err := os.ReadFile(task.path)
				if err != nil {
					continue
				}
				mu.Lock()
				result[task.path] = data
				mu.Unlock()
			}
		}()
	}

	// 投递任务
	for _, task := range validPaths {
		taskCh <- task
	}
	close(taskCh)

	wg.Wait()
	return result
}

// ReadFileMeta 是 ReadFileBytesBatchWithMeta 的单个文件元信息。
type ReadFileMeta struct {
	Data []byte `json:"data"` // 文件内容（Wails 自动 base64）
	Hash string `json:"hash"` // SHA256 十六进制
}

// readFileWithHash 读取文件并计算 SHA256，返回 data 和 hex hash。
func (a *App) readFileWithHash(path string) ([]byte, string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, ""
	}
	h := sha256.Sum256(data)
	hash := hex.EncodeToString(h[:])
	return data, hash
}

// ReadFileBytesBatchWithMeta 批量读取文件并返回内容 + SHA256 哈希。
// 一次 RPC 完成数据读取和 hash 计算，避免前端额外算 hash 或二次 RPC。
// 路径守卫和行为与 ReadFileBytesBatch 一致。
func (a *App) ReadFileBytesBatchWithMeta(paths []string) map[string]ReadFileMeta {
	if len(paths) <= 4 {
		result := make(map[string]ReadFileMeta, len(paths))
		for _, p := range paths {
			if !a.isPathInRootOrSelf(p) {
				continue
			}
			data, hash := a.readFileWithHash(p)
			if data == nil {
				continue
			}
			result[p] = ReadFileMeta{Data: data, Hash: hash}
		}
		return result
	}
	// 并发读取
	type readTask struct {
		index int
		path  string
	}
	validPaths := make([]readTask, 0, len(paths))
	for i, p := range paths {
		if a.isPathInRootOrSelf(p) {
			validPaths = append(validPaths, readTask{index: i, path: p})
		}
	}
	result := make(map[string]ReadFileMeta, len(validPaths))
	if len(validPaths) == 0 {
		return result
	}
	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}
	taskCh := make(chan readTask, len(validPaths))
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for task := range taskCh {
				data, hash := a.readFileWithHash(task.path)
				if data == nil {
					continue
				}
				mu.Lock()
				result[task.path] = ReadFileMeta{Data: data, Hash: hash}
				mu.Unlock()
			}
		}()
	}
	for _, task := range validPaths {
		taskCh <- task
	}
	close(taskCh)
	wg.Wait()
	return result
}

func (a *App) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	// 剥禁用后缀（.ban/.disabled），与 scanner 口径一致
	for _, suffix := range []string{".ban", ".disabled"} {
		if strings.HasSuffix(strings.ToLower(modelPath), suffix) {
			modelPath = modelPath[:len(modelPath)-len(suffix)]
			break
		}
	}
	ext := strings.ToLower(filepath.Ext(modelPath))
	if ext == ".ysm" {
		return a.runYSMParserOnFile(modelPath)
	}
	data, err := os.ReadFile(modelPath)
	if err != nil {
		return types.BedrockModel{}
	}
	var geoJSON *types.BedrockModel
	var texData [][]byte
	var animJSONs []string

	if ext == ".zip" {
		geoJSON, texData, animJSONs = parseBedrockFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		geoJSON, texData = parseBedrockFrom7z(data, int64(len(data)))
	} else if ext == ".json" {
		geoJSON, texData = ysm.FindGeometryInExtractedYSM(modelPath)
	}

	if geoJSON == nil && (ext == ".zip" || ext == ".7z") {
		g := a.runYSMParserOnFile(modelPath)
		geoJSON = &g
	}
	if geoJSON == nil {
		return types.BedrockModel{}
	}

	var textures []string
	for _, td := range texData {
		if len(td) > 0 {
			textures = append(textures, "data:image/png;base64,"+base64.StdEncoding.EncodeToString(td))
		}
	}
	if len(textures) > 0 {
		geoJSON.Texture = textures[0]
		geoJSON.Textures = textures
	}
	if len(animJSONs) > 0 {
		geoJSON.Animations = animJSONs
	}
	return *geoJSON
}

func (a *App) GetModel3DSpec(modelPath string) string {
	// 剥禁用后缀（.ban/.disabled），与 scanner 口径一致
	for _, suffix := range []string{".ban", ".disabled"} {
		if strings.HasSuffix(strings.ToLower(modelPath), suffix) {
			modelPath = modelPath[:len(modelPath)-len(suffix)]
			break
		}
	}
	// 多组件路径（YSMViewer 式）：.ysm（WASM 解码）/ .zip / 解压目录 ysm.json
	// 各自组件独立构建，合并 spec.models；纹理 texIdx 由解析层全局化（组件 i → i），
	// 前端 texArr 全局数组按序索引。
	ext := strings.ToLower(filepath.Ext(modelPath))
	if comps, texNames := a.collect3DComponents(modelPath, ext); len(comps) > 0 {
		spec, err := threejs.BuildMulti(comps, nil)
		if err == nil && spec != "{}" {
			// R1 契约：注入组件序纹理名（texArrOrder），前端比对 texArr 序防止贴错纹理
			if len(texNames) > 0 {
				spec = injectTexArrOrder(spec, texNames)
			}
			return spec
		}
	}
	// 单组件兜底（.7z 或多组件失败时）
	model := a.AnalyzeBedrockModel(modelPath)
	spec, err := threejs.Build(model)
	if err != nil {
		return "{}"
	}
	return spec
}

// Build3DSpecFromGeometryJSON 从 bedrock geometry JSON 构建 3D spec（纯 Go，无 Node 依赖）。
// 用途：Android 上 Go 端无 .ysm 解码通道（Node WASM 不可用，runYSMNodeJSDecode 恒 nil）时，
// 前端用 WebView 内 WASM 解码 .ysm 拿到 geometry JSON，再调本函数构建 spec——
// 复用 threejs.BuildMulti 全量顶点算法（ADR-004：Go 绑定为唯一事实来源），桌面端主路径不变。
// 返回 "{}" 表示不可用（前端据此决定是否报错/提示）。
func (a *App) Build3DSpecFromGeometryJSON(geometryJSON string) string {
	if geometryJSON == "" {
		return "{}"
	}
	model := geometry.ParseBedrockGeometry([]byte(geometryJSON))
	if model == nil || len(model.Bones) == 0 {
		return "{}"
	}
	spec, err := threejs.BuildMulti([]types.BedrockModel{*model}, nil)
	if err != nil || spec == "{}" {
		return "{}"
	}
	return spec
}

// injectTexArrOrder 在 spec JSON 中注入 texArrOrder（组件序纹理名数组，R1 契约）。
// 前端拿到后与 model.textureNames（texArr 实际序）比对，不一致即纹理错位预警。
func injectTexArrOrder(spec string, texNames []string) string {
	var m map[string]any
	if err := json.Unmarshal([]byte(spec), &m); err != nil {
		return spec
	}
	m["texArrOrder"] = texNames
	b, err := json.Marshal(m)
	if err != nil {
		return spec
	}
	return string(b)
}

// collect3DComponents 收集多组件列表（含 arm/载具等独立组件，不合并 bones）。
// 返回 (组件列表, 组件序纹理名数组)——后者仅 zip/解压目录路径有（R1 契约）；
// .ysm WASM 路径无 ysm.json texture 声明，返回 nil（前端跳过比对）。
func (a *App) collect3DComponents(modelPath, ext string) ([]types.BedrockModel, []string) {
	switch ext {
	case ".ysm":
		if data, err := os.ReadFile(modelPath); err == nil {
			return decodeYSMComponentsViaNodeJS(data)
		}
	case ".zip":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFromZip(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".7z":
		if data, err := os.ReadFile(modelPath); err == nil {
			if comps, tn, cerr := geometry.ParseComponentsFrom7z(data, int64(len(data))); cerr == nil {
				return comps, tn
			}
		}
	case ".json":
		// 解压目录的 ysm.json 路径
		if strings.HasSuffix(strings.ToLower(modelPath), "ysm.json") {
			return ysm.FindComponentsInExtractedYSM(modelPath)
		}
	}
	return nil, nil
}

// SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用）
// 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路径与路径穿越（.. 段）
func (a *App) SaveScreenshotFile(filename string, base64Data string) error {
	clean := filepath.Clean(filename)
	// 用 filepath.Base 比对：合法纯文件名 Clean 后等于自身；含目录/穿越段会被拒绝。
	// 不能用 strings.Contains(clean, "..") —— 会误杀 my..file.png 这类合法文件名
	if filepath.IsAbs(clean) || filepath.Base(clean) != clean {
		return fmt.Errorf("文件名不能包含路径")
	}
	tmpDir := filepath.Join(os.TempDir(), "ysm-preview")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return err
	}
	dest := filepath.Join(tmpDir, clean)
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0644)
}

func (a *App) runYSMParserOnFile(modelPath string) types.BedrockModel {
	// 2026-08-08 架构决策：YSMParser.exe sidecar 已停发（FindCLI 恒空已删除），
	// 统一走内嵌 WASM 解码（decodeYSMViaNodeJS：Node 子进程 + WASM，无 Node 时返回 nil）
	if data, err := os.ReadFile(modelPath); err == nil {
		if m := decodeYSMViaNodeJS(data); m != nil {
			return *m
		}
	}
	return types.BedrockModel{}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func parseBedrockFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string) {
	return geometry.ParseFromZip(data, size)
}

func parseBedrockFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte) {
	return geometry.ParseFrom7z(data, size)
}

func parseBedrockGeometry(data []byte) *types.BedrockModel {
	return geometry.ParseBedrockGeometry(data)
}
