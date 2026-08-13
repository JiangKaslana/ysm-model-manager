// ===== 工具栏事件绑定 =====
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { bus } from "../../bus.ts";
import { flashBtn } from "./utils.ts";
import { spinnerHTML } from "./tpl.ts";
import { selectState } from "./data.ts";
import { getExts } from "../../utils/resource/extensions.ts";
import { modalAdvFilter, type AdvFilterValue } from "../../utils/dom/dialogs/adv-filter.ts";
import { updateSelectCount } from "./events.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { setRenderMode, type RenderMode } from "./render.ts";
import { getApp } from "../../backend/app.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { importWebFiles } from "../../backend/browser-adapter.ts";
import { getAndroidBridge, isViewerMode } from "../../utils/dom/android-bridge.ts";
import { resolveAndroidRepoDir } from "../../utils/dom/directory-picker.ts";
import type { AppTree } from "./index.ts";
import type { AuthorInfo } from "./authors.ts";

type $Id = (id: string) => HTMLElement | null;

// 打开弹窗版筛选器（应用结果到 inline 面板 + 后端搜索）
async function openAdvFilterDialog($: $Id, vm: AppTree): Promise<void> {
  // ADR-049 桥接增强：网页版已实现 SearchModels（关键词）/ ListByTag（标签），
  // 早期「网页版未实现」守卫已移除。数值范围条件（骨骼/立方体/纹理）浏览器端无几何
  // 分析能力，由后端降级为仅关键词匹配（在 rv 确定后于下方提示，不阻断调用）。
  // 降级提示仅限网页版（resolveWebMode）：Android 的 isViewerMode 恒 true，但其走
  // 真实 Go 后端、SearchModels 支持数值范围，误提示会与后端行为不符。
  dbg("adv-filter", "open:start", { repoRoot: vm._repoRoot });
  // 输入框值都是字符串形态（弹窗内部转数字）；AdvFilterValue 为 number|null，
  // 此处是「当前输入框值」表示，类型上放宽转换
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
  // "清除全部"路径：result 是 { cleared: true }，无 minBones 等字段——断言为
  // AdvFilterValue 后字段为 undefined，被 setVal/isUnset/n 的 null 守卫兜底（行为保真）
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
  // 网页版数值范围条件降级提示（仅提示，不阻断：后端按关键词/标签匹配，
  // 骨骼/立方体/纹理数值条件浏览器端无几何分析能力，ADR-049 桥接增强）。
  // 门控用 resolveWebMode 而非 isViewerMode：isViewerMode 对 Android 恒 true，
  // 但 Android 走真实 Go 后端、数值范围可用，提示会误导用户
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
    const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
    if (!repoRoot) {
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
        repoRoot,
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
    } catch (e) {
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

// 填充作者下拉（hover 或 click 都触发，避免鼠标快速点击时未填充）
function fillAuthorMenu(
  menuAuthors: HTMLElement,
  vm: AppTree,
  $: $Id,
): void {
  if (menuAuthors.children.length) return; // 已填充
  const authors: Array<AuthorInfo | string> = vm._authors || [];
  if (!authors.length) {
    menuAuthors.innerHTML =
      `<div style="padding:4px 10px;font-size:10px;color:var(--muted)">${t("tree.authorsEmpty")}</div>`;
    return;
  }
  authors.forEach((a) => {
    const name = typeof a === "string" ? a : a.Name || "";
    const count = typeof a === "object" ? a.Count || 0 : 0;
    if (!name) return;
    const btn = document.createElement("button");
    btn.className = "dd-item";
    btn.dataset.author = name;
    btn.textContent = name + (count ? ` (${count})` : "");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const srch = $("srch") as HTMLInputElement | null;
      if (srch) {
        srch.value = name;
        srch.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    menuAuthors.appendChild(btn);
  });
}

// 绑定工具栏事件
export function bindToolbarEvents(root: ShadowRoot, vm: AppTree): void {
  const $: $Id = (id) => root.getElementById(id);

  // 全选 / 反选 — 基于当前过滤后可见的行
  const selAllBtn = $("sel-all");
  if (selAllBtn) {
    selAllBtn.addEventListener("click", () => {
      // 原代码 vm._root._vsRows 取的是 ShadowRoot 上从未设置的属性（_vsRows 设在 #tree 上）→ 全选恒失效
      const rows = vm._root.getElementById("tree")?._vsRows || [];
      const visible = rows.filter((r) => r.type === "file");
      const keys = visible.map((r) => r.key).filter(Boolean);
      const allSelected = keys.every((k) => selectState.keys.has(k));
      keys.forEach((k) => {
        if (allSelected) selectState.keys.delete(k);
        else selectState.keys.add(k);
      });
      // P2 修复（审核发现）：全选/反选只写 selectState 不重渲染——行高亮 .selected 由
      // renderTree 渲染期生成，状态变了 UI 不刷新（幽灵路径，陷阱 #13）；补 _renderTree
      vm._renderTree();
      // 复用 events.ts 里的实现（避免重复定义）
      updateSelectCount(root);
      flashBtn(selAllBtn);
    });
  }

  // 批量导出骨骼名
  $("repo-export")?.addEventListener("click", async () => {
    try {
      // 网页版无 Go ExportBoneStructures（fail-fast WebUnsupportedError）→ 门控提示
      if (resolveWebMode()) {
        bus.emit("toast:show", {
          msg: "网页版暂不支持批量导出骨骼名",
          duration: 3000,
          type: "warn",
        });
        return;
      }
      const { ExportBoneStructures, GetRepoRoot } =
        await getApp();
      const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
      if (!repoRoot) {
        bus.emit("toast:show", {
          msg: "请先配置存储路径",
          duration: 2000,
          type: "warn",
        });
        return;
      }
      const text = await ExportBoneStructures(repoRoot);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.download = `bone-structures-${new Date().toISOString().slice(0, 10)}.txt`;
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      bus.emit("toast:show", {
        msg: "✅ 骨骼结构已导出",
        duration: 2000,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e),
        duration: 4000,
        type: "error",
      });
    }
  });

  $("btn-repo")?.addEventListener("click", () => {
    bus.emit("nav:change", { page: "settings" });
  });

  // 搜索框实时过滤
  $("srch")?.addEventListener("input", () => {
    vm._search = ($("srch") as HTMLInputElement | null)?.value || "";
    vm._renderTree();
  });

  // 排序下拉（name/size/date，renderTree 已支持，此前缺绑定导致控件无效）
  $("sort")?.addEventListener("change", () => {
    vm._sort = ($("sort") as HTMLSelectElement | null)?.value || "name";
    vm._renderTree();
  });

  // 视图模式切换（grid ⇄ list）
  const viewModeBtn = $("btn-view-mode");
  if (viewModeBtn) {
    // 初始按钮图标：当前模式对应的「切换目标」图标
    viewModeBtn.textContent = vm._renderMode === "list" ? "▦" : "☰";
    viewModeBtn.addEventListener("click", () => {
      vm._renderMode = (vm._renderMode === "list" ? "grid" : "list") as RenderMode;
      setRenderMode(vm._renderMode);
      viewModeBtn.textContent = vm._renderMode === "list" ? "▦" : "☰";
      vm._renderTree();
      flashBtn(viewModeBtn);
    });
  }

  // 高级筛选按钮：触发弹窗版筛选器
  const advBtn = $("btn-adv-filter");
  advBtn?.addEventListener("click", () => {
    dbg("adv-filter", "btn:click");
    openAdvFilterDialog($, vm).catch((e) => {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e, "高级筛选失败"),
        duration: 4000,
        type: "error",
      });
    });
  });

  // 高级筛选：清除（inline 面板"清除"按钮 — 快速清空所有筛选）
  $("af-clear")?.addEventListener("click", () => {
    [
      "af-minBones",
      "af-maxBones",
      "af-minCubes",
      "af-maxCubes",
      "af-minTex",
      "af-maxTex",
    ].forEach((id) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.value = "";
    });
    const srchEl = $("srch") as HTMLInputElement | null;
    if (srchEl) {
      srchEl.value = "";
      vm._search = "";
    }
    vm._filterPaths = null;
    vm._renderTree();
  });

  // 作者下拉菜单 — hover 或 click 都触发填充（避免快速点击时未填充）
  const menuAuthors = $("menu-authors");
  if (menuAuthors) {
    const ddWrap = menuAuthors.closest(".dd-wrap");
    if (ddWrap) {
      ddWrap.addEventListener("pointerenter", () =>
        fillAuthorMenu(menuAuthors, vm, $),
      );
      ddWrap.addEventListener("click", () =>
        fillAuthorMenu(menuAuthors, vm, $),
      );
    }
  }

  // 批量按钮下拉菜单
  const menuBatch = $("menu-batch");
  if (menuBatch) {
    menuBatch.querySelectorAll("[data-batch]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.batch;
        if (action === "enable-all") bus.emit("batch:enable-all");
        else if (action === "disable-all") bus.emit("batch:disable-all");
      });
    });
  }

  // 「⋮ 更多」下拉菜单
  const menuMore = $("menu-more");
  if (menuMore) {
    menuMore.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const item = target ? target.closest("[data-more]") : null;
      if (!item) return;
      e.stopPropagation();
      const action = (item as HTMLElement).dataset.more;
      // 绑定层/文件选择器/加载失败统一兜底（genindex 内层 try/finally 仍负责按钮恢复）
      void (async (): Promise<void> => {
      if (action === "open-folder") {
        // 查看器模式（Android/网页版）：Go OpenFolder/SelectDirectory 不可用 →
        // 接 resolveAndroidRepoDir 定位仓库目录并提示路径（自带授权引导/虚拟根）
        if (isViewerMode()) {
          await resolveAndroidRepoDir();
          return;
        }
        if (!vm._repoRoot) return;
        const { OpenFolder } = await getApp();
        await OpenFolder(vm._repoRoot);
      } else if (action === "import-file") {
        const rtype = vm._rootAttr || "ysm";
        // 查看器模式（Android/网页版）：Wails 原生文件对话框不可用（dialogs_android.go /
        // browser adapter）→ 改走浏览器文件选择器 + importWebFiles 直写 IndexedDB
        // （与全局拖拽 import-dnd 同一入口）。P2 修复（审核发现）：此前用 resolveWebMode()
        // 只门控网页版，Android 上会继续走 SelectImportFile 对话框挂起。
        if (isViewerMode()) {
          await pickWebFilesAndImport(rtype, () => vm._load(), () => vm._renderTree());
          return;
        }
        const { SelectImportFile, ImportByType } =
          await getApp();
        // 列出所有支持的扩展名（后端 SelectImportFile 用 | 解析 "显示名|*.ext1;*.ext2"）
        const exts = getExts(rtype);
        const extFilter = exts.length
          ? exts.map((e) => "*" + e).join(";")
          : "*.*";
        const filePath = await SelectImportFile(
          rtype + " 文件|" + extFilter,
          "选择" + rtype + "文件",
        );
        if (!filePath) return;
        const errMsg = await ImportByType(rtype, filePath);
        if (errMsg) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + errMsg,
            duration: 4000,
            type: "warn",
          });
          return;
        }
        await vm._load();
        vm._renderTree();
        bus.emit("toast:show", {
          msg: "✅ 导入成功",
          duration: 2000,
          type: "success",
        });
      } else if (action === "import-dir") {
        const rtype = vm._rootAttr || "ysm";
        // 网页版（P3 修复，审核发现）：resolveAndroidRepoDir 仅定位虚拟根 /web 并刷新树，
        // 不实际导入任何文件（网页版模型库在 IndexedDB，无「放入公共目录」概念）→
        // 改走浏览器文件选择器 + importWebFiles 直写 IndexedDB，与 import-file 同语义。
        if (resolveWebMode()) {
          await pickWebFilesAndImport(rtype, () => vm._load(), () => vm._renderTree());
          return;
        }
        // 查看器模式（Android）：Wails 目录选择不可用（dialogs_android.go）→
        // 接 resolveAndroidRepoDir 定位仓库目录（toast 已提示），
        // 用户放入/拖入模型即自动导入
        if (isViewerMode()) {
          const dir = await resolveAndroidRepoDir();
          if (!dir) return; // 未授权：已引导授权页
          await vm._load();
          vm._renderTree();
          return;
        }
        const { SelectDirectory, ImportByType } =
          await getApp();
        const dirPath = await SelectDirectory();
        if (!dirPath) return;
        // 后端 ImportByType → SimpleCopyImporter / DirectoryCopyImporter 都判 info.IsDir()，目录/文件都支持
        const errMsg = await ImportByType(rtype, dirPath);
        if (errMsg) {
          bus.emit("toast:show", {
            msg: "❌ 导入失败: " + errMsg,
            duration: 4000,
            type: "warn",
          });
          return;
        }
        await vm._load();
        vm._renderTree();
        bus.emit("toast:show", {
          msg: "✅ 文件夹导入成功",
          duration: 2000,
          type: "success",
        });
      } else if (action === "refresh") {
        const tree = $("tree");
        if (tree) tree.innerHTML = spinnerHTML();
        await vm._load();
        vm._renderTree();
      } else if (action === "genindex") {
        const btn = item as HTMLButtonElement;
        // ADR-049 桥接增强 Batch 3：GenerateRepoIndex 已桥接（返回 index.json 内容字符串）。
        // 网页版无磁盘，生成后触发下载；桌面由 Go 写盘，不下载（对齐既有 ExportBoneStructures 范式）。
        btn.textContent = "⏳";
        btn.disabled = true;
        try {
          const { GenerateRepoIndex, GetRepoRoot } =
            await getApp();
          const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
          if (!repoRoot) {
            bus.emit("toast:show", {
              msg: "请先配置存储路径",
              duration: 2000,
              type: "warn",
            });
            return;
          }
          const idx = await GenerateRepoIndex(repoRoot);
          if (resolveWebMode() && typeof idx === "string") {
            const blob = new Blob([idx], { type: "application/json;charset=utf-8" });
            const a = document.createElement("a");
            a.download = "index.json";
            a.href = URL.createObjectURL(blob);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
          }
          bus.emit("toast:show", {
            msg: "✅ index.json 已生成",
            duration: 3000,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: 4000,
            type: "error",
          });
        } finally {
          btn.textContent = "📇 生成索引";
          btn.disabled = false;
        }
      }
      })().catch((err) => {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(err),
          duration: 4000,
          type: "error",
        });
      });
    });
  }
}

// 网页版「导入文件」：桌面走 SelectImportFile（Wails 原生对话框）；网页版无该 binding（fail-fast）→
// 用浏览器 <input type=file> 触发选择，importWebFiles 直写 IndexedDB，导入完成后回调 onLoaded 刷新树。
async function pickWebFilesAndImport(
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
