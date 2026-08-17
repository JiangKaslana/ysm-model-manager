// ===== 3D 全屏内「资源库 / 换角色」（step 3）=====
// 落点：⚙️ 根菜单的 📚 资源库面板。复用既有绑定（GetRepoRoot / SearchModels /
// DetectResourceType）与既有 createXxx3D 全屏入口；把「关当前 + 开目标」收敛为唯一路由
// openModel3DFullscreen，导航栏 FAB 与菜单 📚 面板共用（复用 > 重造）。
// 只在全屏遮罩内加载，不在导航/页内再造第二套文件树。

import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import type { Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import type { LibraryAsset } from "../../utils/3d/adapters/preview-menu.ts";
import { decodeYsmViaWasm } from "./wasm.ts";

export type { LibraryAsset } from "../../utils/3d/adapters/preview-menu.ts";

/** 资源库扫描的仓库类型（模型仓库 ysm；Create/Ray 等类型不在此列） */
const LIBRARY_REPO = RESOURCE_TYPES.YSM;

/** 扩展名 → 类型标签 + 图标（列表即时展示用；真正路由准确性交给路由侧 DetectResourceType） */
const EXT_TAGS: Array<{ icon: string; label: string; exts: string[] }> = [
  { icon: "🧊", label: "YSM", exts: [".ysm", ".zip", ".7z"] },
  { icon: "🥽", label: "VRM", exts: [".vrm"] },
  { icon: "🎭", label: "MMD", exts: [".pmx", ".pmd"] },
  { icon: "🧱", label: "资源包", exts: [".mcpack"] },
  { icon: "🌐", label: "蓝图", exts: [".litematic"] },
];

/** 粗判类型标签（按扩展名） */
function tagOf(path: string): { icon: string; label: string } {
  const low = path.toLowerCase();
  for (const e of EXT_TAGS) {
    if (e.exts.some((x) => low.endsWith(x))) return { icon: e.icon, label: e.label };
  }
  const ext = path.split(/[\\/.]/).pop() ?? "";
  return { icon: "📦", label: (ext || "?").toUpperCase() };
}

/** 路径 → basename（资源库名称展示） */
function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

/** 全量模型列表（桌面 Go binding / 网页 browserAdapter 兜底；空关键词返回全部）。限流防超大库拖垮菜单。 */
export async function loadAllModels(): Promise<LibraryAsset[]> {
  try {
    const { GetRepoRoot, SearchModels } = await getApp();
    const root = await GetRepoRoot(LIBRARY_REPO);
    if (!root) return [];
    const results = (await SearchModels(root, "", 0, 0, 0, 0, 0, 0)) as Array<{ name?: string; path?: string }>;
    const out: LibraryAsset[] = [];
    for (const r of results || []) {
      const p = r?.path;
      if (!p) continue;
      const { icon, label } = tagOf(p);
      out.push({ path: p, name: r.name || baseName(p), tag: label, icon });
    }
    return out.slice(0, 500);
  } catch {
    return [];
  }
}

/**
 * 通用「打开一个模型 3D」路由：探测类型 → 派发既有 createXxx3D 全屏入口
 * （各 createXxx3D → mount3D cooperate=false 会先清理旧的活跃全屏层，故无需手动预关）。
 * 无类型/探测失败回退 YSM 通路。
 */
export async function openModel3DFullscreen(path: string): Promise<void> {
  if (!path) return;
  const { DetectResourceType } = await getApp();
  let rtype = "";
  try {
    rtype = (await DetectResourceType(path)) || "";
  } catch {
    /* 类型探测失败 → 回退 YSM */
  }
  if (rtype === RESOURCE_TYPES.MMD) {
    const { createMmd3D } = await import("./mmd-3d.ts");
    await createMmd3D(path);
    return;
  }
  if (rtype === RESOURCE_TYPES.VRC) {
    const { createVrm3D } = await import("./vrm-3d.ts");
    await createVrm3D(path);
    return;
  }
  if (rtype === RESOURCE_TYPES.PACK) {
    const { createPack3D } = await import("./pack-3d.ts");
    await createPack3D(path);
    return;
  }
  const { createYsm3D } = await import("./ysm-3d.ts");
  const { loadModelData } = await import("./loader.ts");
  await createYsm3D(path, 0, {
    loader: async (p: string) =>
      (await loadModelData(p, { decodeYsmViaWasm, appendDebug: () => {} } as never)).model,
  });
}

export interface PreviewExtras extends Mount3DOptions {
  library?: () => Promise<LibraryAsset[]>;
  switchExternal?: (path: string) => Promise<void>;
}

/** 给 mount3D opts 注入「资源库默认扩展」：库加载 + 跨类型跳转。各 createXxx3D 统一经此获得 3D 内 📚 面板 */
export function withPreviewExtras<T extends Mount3DOptions>(opts: T): T & PreviewExtras {
  return Object.assign(opts as T & PreviewExtras, {
    library: loadAllModels,
    switchExternal: openModel3DFullscreen,
  });
}