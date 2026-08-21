// ===== FBX 同类型候选列表（ADR-112 地基拓展：P0-1 预览内切换）=====
// 委托通用底座 resolveSiblingsByType，仅过滤 .fbx（含大写），排除同目录 .vmd 等异格式。
import { resolveSiblingsByType } from "./siblings.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

/** FBX 主文件扩展名（含大写） */
const FBX_EXT_RE = /\.fbx$/i;

/** 同类型 FBX 模型候选（GetRepoRoot(fbx) → ScanModelEntries 主文件 Path 列表）；失败返回 []（下拉不渲染） */
export async function resolveFbxSiblings(): Promise<string[]> {
  return resolveSiblingsByType(RESOURCE_TYPES.FBX, FBX_EXT_RE);
}
