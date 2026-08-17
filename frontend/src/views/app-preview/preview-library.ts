// ===== 3D 全屏内「资源库 / 换角色」（step 3）=====
// 落点：⚙️ 根菜单的 📚 资源库面板 + 导航栏左下角 FAB。
// 复用既有绑定（GetRepoRoot / SearchModels / DetectResourceType）与既有 createXxx3D 全屏入口。
//
// 循环依赖红线（check-circular 阻断）：本模块是【叶子】——只被各 createXxx3D 静态 import
// （registerReRoute / withPreviewExtras），自身【不】反向 import 任何 createXxx3D 包装器。
// 跨类型跳转靠「注册表反向注入」：各包装器在模块加载时 registerReRoute(id, opener)，
// openModel3DFullscreen 只查表调用，从而打破「库→包装器→库」闭环。

import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import type { Mount3DOptions } from "../../utils/3d/adapters/mount-preview-core.ts";
import type { LibraryAsset } from "../../utils/3d/adapters/preview-menu.ts";

/** 资源库扫描的仓库类型（模型仓库 ysm） */
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

function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

/** 跨类型换角色注册表：各 createXxx3D 模块加载时注册，路由侧不反向 import 包装器（破循环） */
const _openers: Record<string, (path: string) => Promise<void>> = {};
/** 注册某资源类型的「打开全屏 3D」入口（由对应 createXxx3D 包装器在模块加载时调用） */
export function registerReRoute(rtype: string, opener: (path: string) => Promise<void>): void {
  _openers[rtype] = opener;
}

/** 全量模型列表（桌面 Go binding / 网页 adapter 兜底；空关键词返回全部）。限流防超大库拖垮菜单。 */
async function loadAllModels(): Promise<LibraryAsset[]> {
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
    // 加载失败时 toast 通知用户，而非静默返回空（审核 P3）
    import("../../bus.ts").then(({ bus }) => bus.emit("toast:show", { msg: "库加载失败", duration: 3000, type: "warn" }));
    return [];
  }
}

/**
 * 通用「打开一个模型 3D」路由：探测类型 → 查注册表派发 opener（跨类型换角色）。
 * 未注册类型回退 YSM opener；全无注册时 toast 提示。各 opener 内部（createXxx3D →
 * mount3D cooperate=false）会先清理旧的活跃全屏层。
 */
export async function openModel3DFullscreen(path: string): Promise<void> {
  if (!path) return;
  const { DetectResourceType } = await getApp();
  let rtype = "";
  try {
    rtype = (await DetectResourceType(path)) || "";
  } catch {
    /* 类型探测失败 */
  }
  const opener = _openers[rtype] ?? _openers[RESOURCE_TYPES.YSM];
  if (opener) {
    await opener(path);
    return;
  }
  const { bus } = await import("../../bus.ts");
  bus.emit("toast:show", { msg: "3D 预览暂不支持该类型", duration: 3000, type: "warn" });
}

interface PreviewExtras extends Mount3DOptions {
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