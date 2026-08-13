// ===== toolbar-search.ts — 工具栏搜索/筛选/导入逻辑（从 toolbar-events.ts 拆出，ADR-040 P1）=====
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { bus } from "../../bus.ts";
import { getExts } from "../../utils/resource/extensions.ts";
import { modalAdvFilter, type AdvFilterValue } from "../../utils/dom/dialogs/adv-filter.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { importWebFiles } from "../../backend/browser-adapter.ts";
import type { AppTree } from "./index.ts";
import { getApp } from "../../backend/app.ts";

type $Id = (id: string) => HTMLElement | null;

// 打开弹窗版筛选器（应用结果到 inline 面板 + 后端搜索）
export async function openAdvFilterDialog($: $Id, vm: AppTree): Promise<void> {
  // ADR-049 桥接增强：网页版已实现 SearchModels（关键词）/ ListByTag（标签），
  // 早期「网页版未实现」守卫已移除。数值范围条件（骨骼/立方体/纹理）浏览器端无几何
  // 分析能力，由后端降级为仅关键词匹配（在 rv 确定后于下方提示，不阻断调用）。
  // 降级提示仅限网页版（resolveWebMode）：Android 的 isViewerMode 恒 true，但其走
  // 真实 Go 后端、SearchModels 支持数值范围，误提示会与后端行为不符。
  dbg("adv-filter", "open:start", { filesRoot: vm._filesRoot });
  const $v = (id: string): string => ($(id) as HTMLInputElement | null)?.value || "";
  const cur: Record<string, string> = {
    keyword: $v("srch"),
    minBones: $v("af-minBones"),
    maxBones: $v("af-maxBones"),
    minCubes: $v("af-minCubes"),
    maxCubes: $v("af-maxCubes"),
    minTex: $v("af-minTex"),
    maxTex: $v("af-maxTex"),
  };
  dbg("adv-filter", "dialog:open", { cur });
  const result = await modalAdvFilter({
    value: cur as unknown as Partial<AdvFilterValue>,
  });
  dbg("adv-filter", "dialog:return", { result });
  if (!result) {
    dbg("adv-filter", "dialog:cancelled-or-null");
    return;
  }
  const rv = result as AdvFilterValue;

  // 统一回填 inline 面板（null/undefined → ""）
  const setVal = (id: string, v: unknown): void => {
    const el = $(id) as HTMLInputElement | null;
    if (el) el.value = v == null ? "" : String(v);
  };
  setVal("af-minBones", rv.minBones);
  setVal("af-maxBones", rv.maxBones);
  setVal("af-minCubes", rv.minCubes);
  setVal("af-maxCubes", rv.maxCubes);
  setVal("af-minTex", rv.minTex);
  setVal("af-maxTex", rv.maxTex);
  const srchEl = $("srch") as HTMLInputElement | null;
  if (srchEl && rv.keyword !== undefined) {
    srchEl.value = rv.keyword;
    vm._search = rv.keyword;
  }

  const kw = srchEl?.value || "";
  const hasTag = rv.tag && !(rv.tag === "");
  const isUnset = (v: unknown): boolean => v == null || v === "";
  if (
    !kw &&
    !hasTag &&
    isUnset(rv.minBones) &&
    isUnset(rv.maxBones) &&
    isUnset(rv.minCubes) &&
    isUnset(rv.maxCubes) &&
    isUnset(rv.minTex) &&
    isUnset(rv.maxTex)
  ) {
    vm._filterPaths = null;
    vm._renderTree();
    return;
  }
  // 网页版数值范围条件降级提示（仅提示，不阻断）
  if (resolveWebMode()) {
    const hasNumRange =
      !isUnset(rv.minBones) ||
      !isUnset(rv.maxBones) ||
      !isUnset(rv.minCubes) ||
      !isUnset(rv.maxCubes) ||
      !isUnset(rv.minTex) ||
      !isUnset(rv.maxTex);
    if (hasNumRange) {
      bus.emit("toast:show", {
        msg: "网页版仅支持关键词/标签筛选，骨骼/立方体数值条件已忽略",
        duration: 3000,
        type: "warn",
      });
    }
  }
  const { SearchModels, ListByTag, GetRepoRoot } =
    await getApp();

  // 1. 按标签筛选（如果有）
  let tagPaths: Set<string> | null = null;
  if (hasTag) {
    try {
      const paths = await ListByTag(rv.tag);
      tagPaths = new Set(paths || []);
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ 标签查询失败: " + friendlyError(e),
        duration: 4000,
        type: "error",
      });
    }
  }

  // 2. 按骨骼/纹理等条件搜索（如果有关键词或范围条件）
  const hasRange =
    !isUnset(rv.minBones) ||
    !isUnset(rv.maxBones) ||
    !isUnset(rv.minCubes) ||
    !isUnset(rv.maxCubes) ||
    !isUnset(rv.minTex) ||
    !isUnset(rv.maxTex) ||
    kw;

  let modelPaths: Set<string> | null = null;
  if (hasRange) {
    const filesRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
    if (!filesRoot) {
      bus.emit("toast:show", {
        msg: "请先配置仓库目录",
        duration: 2000,
        type: "warn",
      });
      return;
    }
    const n = (v: unknown): number => (v == null ? 0 : parseInt(String(v), 10) || 0);
    try {
      const results = await SearchModels(
        filesRoot,
        kw,
        n(rv.minBones),
        n(rv.maxBones),
        n(rv.minCubes),
        n(rv.maxCubes),
        n(rv.minTex),
        n(rv.maxTex),
      );
      modelPaths = results?.length
        ? new Set(results.map((r) => r.path))
        : new Set();
    } catch (e: unknown) {
      dbg("adv-filter", "search:error", { err: String(e) });
      bus.emit("toast:show", {
        msg: "❌ 高级筛选失败: " + friendlyError(e),
        duration: 5000,
        type: "error",
      });
      vm._filterPaths = null;
      vm._renderTree();
      return;
    }
  }

  // 3. 取交集：标签 ∩ 搜索条件（如果两者都有）
  if (tagPaths && modelPaths) {
    vm._filterPaths = new Set([...tagPaths].filter((p) => modelPaths.has(p)));
  } else if (tagPaths) {
    vm._filterPaths = tagPaths;
  } else if (modelPaths) {
    vm._filterPaths = modelPaths;
  } else {
    vm._filterPaths = null;
  }

  const size = vm._filterPaths?.size ?? 0;
  if (size > 0) {
    bus.emit("toast:show", {
      msg: `🔍 找到 ${size} 个匹配`,
      duration: 1500,
      type: "success",
    });
  } else if (vm._filterPaths && size === 0) {
    bus.emit("toast:show", {
      msg: "🔍 无匹配模型（已应用筛选）",
      duration: 2000,
      type: "warn",
    });
  }
  vm._renderTree();
}

// 网页版「导入文件」：桌面走 SelectImportFile（Wails 原生对话框）；网页版无该 binding →
// 用浏览器 <input type=file> 触发选择，importWebFiles 直写 IndexedDB，导入完成后回调刷新。
export async function pickWebFilesAndImport(
  rtype: string,
  onLoaded: () => Promise<void>,
  onRendered: () => void,
): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  const exts = getExts(rtype);
  input.accept = exts.length ? exts.join(",") : "*.*";
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    void (async () => {
      try {
        const r = await importWebFiles(files, rtype);
        await onLoaded();
        onRendered();
        bus.emit("toast:show", {
          msg:
            r.failed > 0
              ? `✅ ${r.imported} 个导入成功，${r.failed} 个失败`
              : `✅ ${r.imported} 个模型已导入浏览器模型库`,
          duration: 4000,
          type: r.failed > 0 ? "warn" : "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e),
          duration: 4000,
          type: "error",
        });
      }
    })();
  });
  input.click();
}
