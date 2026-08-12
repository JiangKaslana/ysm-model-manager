package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/executil"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

// ysmNodeDecodeTimeout 子进程解码超时上限（对齐 go/avatar decodeTimeout 模式：
// WASM 死循环/Node 卡死时防永久挂起冻结 UI 线程）。
const ysmNodeDecodeTimeout = 60 * time.Second

// ysmDecodeMaxInput 子进程解码输入 .ysm 上限（>200MB 拒绝，防超大输入拖垮子进程/内存膨胀）。
const ysmDecodeMaxInput = 200 << 20

// ysmDecodeMaxOutput 子进程解码输出（FILES_JSON 行）上限（防恶意模型输出膨胀）。
const ysmDecodeMaxOutput = 200 << 20

// nodeJSPath 查找 node.js 可执行文件
var nodeJSPath = findNodeJS()

func init() {
	avatar.SetNodeJS(nodeJSPath, getGlueCode, getWasmBinary)
}

func findNodeJS() string {
	// ADR-047 明示：Android 无 Node.js 运行时，nodeJSPath 恒为空 → runYSMNodeJSDecode
	// 返回 nil（.ysm 预览走 WASM 内嵌解码或不可用），不尝试 exec 避免静默失败
	if runtime.GOOS == "android" {
		return ""
	}
	// PATH 查找（跨平台：Linux/macOS 命中 "node"，Windows 命中 "node.exe"）
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	if p, err := exec.LookPath("node.exe"); err == nil {
		return p
	}
	return ""
}

// decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 文件
// 嵌入的 JS 胶水代码和 WASM 二进制会写到临时目录执行
type decodedYSMExtra struct {
	Path string
	Data []byte
}

// runYSMNodeJSDecode 用 Node.js + WASM 解码 .ysm，返回解出的全部文件（Path/Data）。
// decodeYSMViaNodeJS（合并单组件）与 decodeYSMComponentsViaNodeJS（多组件）共用此解码。
func runYSMNodeJSDecode(ysmData []byte) []decodedYSMExtra {
	if nodeJSPath == "" {
		return nil
	}
	// 输入大小护栏：超大/畸形 .ysm 直接拒绝，不进入子进程（防内存膨胀/拖垮）
	if len(ysmData) > ysmDecodeMaxInput {
		fmt.Fprintf(os.Stderr, "[ysm-node] 输入 .ysm 过大: %d bytes (上限 %d)\n", len(ysmData), ysmDecodeMaxInput)
		return nil
	}

	// 读取内嵌的胶水代码和 WASM 二进制
	glueRaw := getGlueCode()
	wasmBin := getWasmBinary()
	if len(glueRaw) == 0 || len(wasmBin) == 0 {
		return nil
	}

	// Patch 胶水代码暴露 HEAPU8
	gluePatched := strings.ReplaceAll(glueRaw,
		";updateMemoryViews()",
		`;updateMemoryViews();Module["HEAPU8"]=HEAPU8`)

	tmpDir, err := os.MkdirTemp("", "ysm-node-*")
	if err != nil {
		return nil
	}
	defer os.RemoveAll(tmpDir)

	// 写入 WASM 和胶水代码
	glueFile := filepath.Join(tmpDir, "YSMParser_patched.js")
	if err := os.WriteFile(glueFile, []byte(gluePatched), 0644); err != nil {
		return nil
	}

	// 构建解码脚本：通过 FS 写文件 + callMain（绕开 _malloc 导出问题）
	ysmB64 := base64.StdEncoding.EncodeToString(ysmData)
	wasmB64 := base64.StdEncoding.EncodeToString(wasmBin)
	script := fmt.Sprintf(`const YSMParser = require(%q);
const wb64=%q;const wb=Uint8Array.from(atob(wb64),c=>c.charCodeAt(0));
const yb64=%q;const yr=atob(yb64);const ys=new Uint8Array(yr.length);
for(let i=0;i<yr.length;i++)ys[i]=yr.charCodeAt(i);
async function main(){
  const mod=await YSMParser({wasmBinary:wb.buffer,noInitialRun:true});
  const FS=mod.FS;
  try{FS.mkdir('/input')}catch(e){}
  try{FS.mkdir('/output')}catch(e){}
  FS.writeFile('/input/model.ysm',ys);
  try{mod.callMain(['-i','/input','-o','/output'])}catch(e){
    if(!(e&&e.name==='ExitStatus'))throw e}
  function cl(dir){
    const r=[];const es=FS.readdir(dir).filter(f=>f!=='.'&&f!=='..');
    for(const e of es){const p=dir+'/'+e;
      if(FS.isDir(FS.stat(p).mode)){r.push(...cl(p))}
      else{r.push({path:p,data:Array.from(FS.readFile(p))})}}
    return r}
  console.log('FILES_JSON:'+JSON.stringify(cl('/output')));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
`, glueFile, wasmB64, ysmB64)

	scriptPath := filepath.Join(tmpDir, "decode.cjs")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return nil
	}

	// 执行（子进程加超时护栏，对齐 go/avatar decodeTimeout 模式）
	ctx, cancel := context.WithTimeout(context.Background(), ysmNodeDecodeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, nodeJSPath, scriptPath)
	executil.HideWindow(cmd)
	cmd.Dir = tmpDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fmt.Fprintf(os.Stderr, "[ysm-node] 解码超时 %v\n", ysmNodeDecodeTimeout)
			return nil
		}
		fmt.Fprintln(os.Stderr, "[ysm-node] 解码失败:", string(output))
		return nil
	}

	// 输出大小护栏：防恶意模型输出膨胀拖垮内存
	if len(output) > ysmDecodeMaxOutput {
		fmt.Fprintf(os.Stderr, "[ysm-node] 解码输出过大: %d bytes (上限 %d)\n", len(output), ysmDecodeMaxOutput)
		return nil
	}

	// 解析输出：找 FILES_JSON: 标记行
	outStr := string(output)
	idx := strings.Index(outStr, "FILES_JSON:")
	if idx < 0 {
		fmt.Fprintln(os.Stderr, "[ysm-node] 未找到输出标记")
		return nil
	}
	jsonStr := outStr[idx+len("FILES_JSON:"):]

	var rawFiles []struct {
		Path string `json:"path"`
		Data []int  `json:"data"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &rawFiles); err != nil {
		fmt.Fprintln(os.Stderr, "[ysm-node] JSON 解析失败:", err)
		return nil
	}
	files := make([]decodedYSMExtra, 0, len(rawFiles))
	for _, rf := range rawFiles {
		data := make([]byte, len(rf.Data))
		for i, v := range rf.Data {
			data[i] = byte(v)
		}
		files = append(files, decodedYSMExtra{Path: rf.Path, Data: data})
	}
	return files
}

// decodeYSMViaNodeJS 用 Node.js + WASM 解码 .ysm 并合并为单 BedrockModel（单组件模式）。
func decodeYSMViaNodeJS(ysmData []byte) *types.BedrockModel {
	files := runYSMNodeJSDecode(ysmData)
	if len(files) == 0 {
		return nil
	}

	// 找 geometry JSON 文件（合并全部组件 bones，保持历史单组件行为）
	var merged *types.BedrockModel
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || strings.HasSuffix(low, "ysm.json") {
			continue
		}
		data := f.Data
		if g := geometry.ParseBedrockGeometry(data); g != nil {
			for bi := range g.Bones {
				for ci := range g.Bones[bi].Cubes {
					g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
					g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				}
			}
			if merged == nil {
				merged = g
			} else {
				merged.Bones = append(merged.Bones, g.Bones...)
				merged.BoneCount += g.BoneCount
				merged.CubeCount += g.CubeCount
			}
		}
	}

	if merged == nil {
		return nil
	}

	// 找纹理（收集全部：Textures 数组供多纹理/3D texArr，Texture 取第一张兼容单纹理）
	var texRaws []ysmTexItem
	var ysmJSON []byte
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if strings.HasSuffix(low, "ysm.json") {
			ysmJSON = f.Data // 保留 ysm.json 用于纹理声明序对齐
			continue
		}
		if !strings.HasSuffix(low, ".png") && !strings.HasSuffix(low, ".jpg") {
			continue
		}
		if strings.HasPrefix(low, "avatar") || strings.Contains(low, "/avatar/") {
			continue
		}
		mime := "image/png"
		if strings.HasSuffix(low, ".jpg") {
			mime = "image/jpeg"
		}
		tn := path.Base(f.Path)
		lowTn := strings.ToLower(tn)
		if strings.HasSuffix(lowTn, ".png") {
			tn = tn[:len(tn)-4]
		} else if strings.HasSuffix(lowTn, ".jpg") {
			tn = tn[:len(tn)-4]
		}
		texRaws = append(texRaws, ysmTexItem{name: tn, raw: f.Data, mime: mime})
	}
	if len(texRaws) > 0 {
		// 纹理序口径统一（texture_order.go）：有 ysm.json 声明序 → 声明序 + default_texture 置首；
		// 无（加密模型等）→ 纹理尺寸降序。与前端 wasm.ts orderedTexKeys 对称。
		texNames, texData := orderTexItems(texRaws, ysmJSON)
		if len(texData) == 0 {
			return merged
		}
		merged.Textures = texData
		merged.Texture = texData[0]
		merged.TextureNames = texNames
	}

	return merged
}

// decodeYSMComponentsViaNodeJS 解码 .ysm 并收集为多组件列表（不合并 bones）。
// 每个组件 = 独立 BedrockModel；TexSlot 按全局文件序分配（main 优先，其余按路径排序），
// 供 threejs.BuildMulti 生成多组件 spec（YSMViewer 式多组件同屏，arm 等保留为独立组件）。
func decodeYSMComponentsViaNodeJS(ysmData []byte) ([]types.BedrockModel, []string) {
	files := runYSMNodeJSDecode(ysmData)
	if len(files) == 0 {
		return nil, nil
	}

	// 收集模型文件（ParseBedrockGeometry 非空的 .json；动画 JSON 解析为 nil 自动过滤）
	type mf struct {
		path string
		data []byte
	}
	var modelFiles []mf
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if !strings.HasSuffix(low, ".json") || strings.HasSuffix(low, "ysm.json") {
			continue
		}
		if g := geometry.ParseBedrockGeometry(f.Data); g != nil {
			modelFiles = append(modelFiles, mf{path: f.Path, data: f.Data})
		}
	}
	if len(modelFiles) == 0 {
		return nil, nil
	}
	// main 优先（YSMViewer 式主组件），其余按路径排序（确定性，ADR-039）
	// 注意：用 basename 判定 main（main.json / main.geo.json），与 zip 版
	// geometry.IsMainModelName 同口径——strings.Contains(..., "main.json")
	// 对 main.geo.json 不命中，会把 arm 排在 main 前（code_review P2）。
	sort.SliceStable(modelFiles, func(i, j int) bool {
		mi := geometry.IsMainModelName(modelFiles[i].path)
		mj := geometry.IsMainModelName(modelFiles[j].path)
		if mi != mj {
			return mi
		}
		return modelFiles[i].path < modelFiles[j].path
	})

	comps := make([]types.BedrockModel, 0, len(modelFiles))
	for i, mf := range modelFiles {
		g := geometry.ParseBedrockGeometry(mf.data)
		if g == nil {
			continue
		}
		// SourceName = 组件源模型文件名（去扩展名，如 main/arm/arrow），UI 组件名用
		src := mf.path
		if idx := strings.LastIndexAny(src, "/\\"); idx >= 0 {
			src = src[idx+1:]
		}
		src = strings.TrimSuffix(strings.TrimSuffix(src, ".geo.json"), ".json")
		g.SourceName = src
		// TexSlot = 全局纹理序（组件 i 的纹理起点；与 FindGeometryInExtractedYSM 的
		// 文件序 texSlot 口径一致，前端 texArr 全局数组按序索引）
		for bi := range g.Bones {
			for ci := range g.Bones[bi].Cubes {
				g.Bones[bi].Cubes[ci].CubeTexW = g.TexWidth
				g.Bones[bi].Cubes[ci].CubeTexH = g.TexHeight
				g.Bones[bi].Cubes[ci].TexSlot = i
			}
		}
		comps = append(comps, *g)
	}
	// R1 契约：WASM 路径无 ysm.json texture 声明（texArr 序由 AnalyzeBedrockModel 决定），
	// 返回 nil texNames——前端跳过契约比对（避免误报）。
	return comps, nil
}

// ysmTextureOrder 解析 ysm.json 的 files.player.texture 声明序与 properties.default_texture。
