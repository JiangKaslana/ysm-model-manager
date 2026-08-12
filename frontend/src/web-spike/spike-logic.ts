// ===== YSM Web 解码 Spike 纯逻辑（ADR-049 Phase 0）=====
// 从 main.ts 抽出的纯函数：只依赖 YsmDecodedFile 输入与 JSON/TextDecoder
// 标准全局，不触碰 DOM / File / 模块级可变状态，可直接单测。
import type { YsmDecodedFile } from "../wasm/ysm-parser.ts";

export interface YsmSummary {
  bones: number;
  cubes: number;
  texCount: number;
}

const utf8 = new TextDecoder();

/**
 * 递归找第一个数组（骨骼列表通常嵌在 model/bones 等层级）。
 * 命中 bone 相关 key 即返回该数组长度；否则下探第一个对象元素。
 */
export function findBones(node: unknown, depth = 0): number {
  if (depth > 6 || typeof node !== "object" || node === null) return 0;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      if (/bone|bone_name|boneNames/i.test(k)) return v.length;
      if (v.length && typeof v[0] === "object") {
        const n = findBones(v[0], depth + 1);
        if (n > 0) return n;
      }
    } else if (typeof v === "object") {
      const n = findBones(v, depth + 1);
      if (n > 0) return n;
    }
  }
  return 0;
}

/** 解析 main.json 提取骨骼/几何摘要（Spike 只做统计，不渲染） */
export function summarize(files: YsmDecodedFile[]): YsmSummary {
  let bones = 0;
  let cubes = 0;
  let texCount = 0;

  for (const f of files) {
    const path = f.path.toLowerCase();
    if (path.endsWith(".json") && /main|model/.test(path)) {
      try {
        const obj = JSON.parse(utf8.decode(f.data));
        bones = findBones(obj, 0);
        const cubesArr = JSON.stringify(obj).match(/"cubes"\s*:\s*\[/g);
        cubes = cubesArr?.length ?? 0;
      } catch {
        // 非模型清单 json（animation 等），跳过
      }
    } else if (/textures?\//.test(path) || /\.png$/.test(path)) {
      texCount++;
    }
  }
  return { bones, cubes, texCount };
}
