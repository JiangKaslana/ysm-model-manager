// ===== 回收站管理（类型化版 — ADR-014 P3 features）=====
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { modalConfirm } from "../utils/dom/dialogs/modal.ts";
import { renderDisplayName } from "../utils/dom/display.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { loadResourceRegistry } from "../utils/resource/registry.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp } from "../backend/app.ts";
import { useCurrentResourceType } from "./repo-rtype.ts";
import { createLoadGuard } from "../utils/async/load-guard.ts";
import { stagger } from "../utils/animation/stagger.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { esc } from "../utils/dom/html.ts";
import { formatBytes } from "../utils/dom/format.ts";

// ===== 常量（魔法数值集中管理 — code_review P3）=====
/** 恢复/删除前的 leaving 滑出动画时长（ms），与 content-util.css 的 .leaving 过渡对齐 */
const LEAVE_ANIM_MS = 150;

/** 恢复/删除成功 toast 时长（ms） */
const TOAST_ACTION_OK_MS = TOAST_MS.success;
/** 恢复/删除失败 toast 时长（ms） */
const TOAST_ACTION_ERR_MS = TOAST_MS.normal;
/** 清空（批量）成功 toast 时长（ms） */
const TOAST_EMPTY_OK_MS = TOAST_MS.normal;
/** 清空（批量）失败 toast 时长（ms） */
const TOAST_EMPTY_ERR_MS = TOAST_MS.long;

/** app-content 组件实例（initRecycleBin 依赖的成员）。
 * 转义/格式化直引 utils 纯函数（esc / formatBytes，单一事实来源），
 * 不依赖宿主私有薄壳——AppContent 重构后已不持有 _esc/_fmtSize */
export interface RecycleHost {
  _root: ShadowRoot;
}

/**
 * 判断条目路径是否位于资源根目录内（带路径分隔符边界，P3 修复）。
 * - 裸 startsWith 会把 D:/games/ysm2/… 误入 D:/games/ysm 根目录 → 要求 === 或 root + "/" 前缀
 * - root 尾部可能带分隔符（specificRoot 返回用户配置原值）→ 先剥尾部分隔符
 */
export function isPathInRoot(path: string, root: string): boolean {
  // P3（审核发现）：Windows 文件系统大小写不敏感——与 Go 侧 fsutil.IsRecycleDir 的
  // EqualFold 对齐（AGENTS.md 边界对称③），避免 GetRepoRoot 与条目 Path 大小写不一致
  // 时合法条目被过滤（假阴性）
  const p = path.replace(/\\/g, "/").toLowerCase();
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return p === r || p.startsWith(r + "/");
}

/** 初始化回收站管理，返回清理函数 */
export function initRecycleBin(app: RecycleHost): () => void {
  const root = app._root;
  const fmtSize = formatBytes;
  const onRefreshClick = (): void => {
    loadRecycleBin();
  };
  root
    .getElementById("recy-refresh")
    ?.addEventListener("click", onRefreshClick);
  // P3（审核发现）：清空按钮无 busy 守卫——restore/delete 有 btn.disabled，empty 没有。
  // modal 单例防住弹窗叠加，但确认后 EmptyRecycleBin 在途期间按钮仍可再点 → 并发清空
  let _emptyBusy = false;
  const onEmptyClick = async (): Promise<void> => {
    if (_emptyBusy) return;
    const confirmed = await modalConfirm({
      title: "清空回收站",
      icon: "♻️",
      message: "确定永久清空回收站所有文件？此操作不可恢复！",
      okText: "♻️ 清空",
      danger: true,
    });
    if (!confirmed) return;
    _emptyBusy = true;
    try {
      const { EmptyRecycleBin } = await getApp();
      const n = await EmptyRecycleBin("");
      bus.emit("toast:show", {
        msg: `♻️ ${t("recycle.cleared", { n })}`,
        duration: TOAST_EMPTY_OK_MS,
        type: "success",
      });
      loadRecycleBin();
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: TOAST_EMPTY_ERR_MS,
        type: "error",
      });
    } finally {
      _emptyBusy = false;
    }
  };
  root.getElementById("recy-empty")?.addEventListener("click", onEmptyClick);
  // 监听全局类型切换（收敛至 useCurrentResourceType，索引 4.3）：
  // currentType 初值取 localStorage（持久化权威源，由 app-nav 写入）；运行期以
  // repo:rtype-changed 事件载荷为准，二者一致时不会重复加载（事件是唯一运行期变更入口）
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => {
    loadRecycleBin();
  });
  // 加载代数守卫：rtype 快速切换时丢弃过期结果（与 oldest-models 共用 createLoadGuard）
  const guard = createLoadGuard();

  // 文件名点击 → 模型详情：事件委托只绑一次，cleanup 成对移除（避免每次渲染累积监听）
  const listEl = root.getElementById("recy-list");
  const onListClick = (e: MouseEvent): void => {
    const t = e.target as Element;
    if (t.closest(".recy-restore") || t.closest(".recy-del")) return;
    const el = t.closest("[data-path]");
    if (el) {
      const path = el.getAttribute("data-path");
      if (path) bus.emit("model:select", { path });
    }
  };
  if (listEl) listEl.addEventListener("click", onListClick);

  loadRecycleBin();

  async function loadRecycleBin(): Promise<void> {
    // generation 守卫：每次加载自增，await 后比对，旧请求结果不再覆盖新列表
    const gen = guard.next();
    const list = root.getElementById("recy-list");
    const count = root.getElementById("recy-count");
    if (!list) return;
    try {
      const {
        ListRecycleBin,
        RestoreFromRecycle,
        DeleteFromRecycle,
        GetRepoRoot,
      } = await getApp();

      // 获取当前类型的根目录（用于路径过滤）
      const currentRoot = await GetRepoRoot(getCurrentType());
      const allEntries = (await ListRecycleBin("")) || [];
      if (guard.stale(gen)) return; // 已有更新的加载，丢弃过期结果

      // 过滤：只显示路径在当前类型根目录下的条目；空 Path 一律排除（防渲染 data-path=""
      // 点击发 model:select {path:""}——原仅 currentRoot 非空时要求 Path，回退全量时漏网）
      const entries = allEntries.filter((e) => e.Path && (currentRoot ? isPathInRoot(e.Path, currentRoot) : true));

      if (!entries || !entries.length) {
        list.innerHTML = "";
        if (count) count.textContent = "空";
        return;
      }
      const reg = await loadResourceRegistry();
      if (guard.stale(gen)) return;
      const icon = (reg[getCurrentType()] && reg[getCurrentType()].icon) || "📦";
      if (count) count.textContent = icon + " " + entries.length + " 个文件";
      list.innerHTML = entries
        .map((e, i) => {
          const name = e.Name.replace(/\.(ysm|zip|7z)\.(disabled|ban)$/i, ".$1");
          const size = Number.isFinite(e.Size) ? fmtSize(e.Size as number) : "?";
          return `<div class="recy-item" data-testid="recy-item" style="animation-delay:${stagger(i, 25, 400)}ms;display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:var(--fs-sm)">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);cursor:pointer" title="${t("oldest.clickDetail", { name: esc(e.Path) })}" data-path="${esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:var(--fs-xs);color:var(--muted)">${size}</span>
<button class="recy-restore" data-testid="recy-restore" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-xs)">↩️ ${t("recycle.restore")}</button>
<button class="recy-del" data-testid="recy-del" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--paid);background:transparent;color:var(--paid);cursor:pointer;font-size:var(--fs-xs)">🗑️ ${t("recycle.delete")}</button>
</div>
<div style="font-size:var(--fs-xs);color:var(--muted);padding-left:2px;word-break:break-all">📂 ${esc(e.Path)}</div>
</div>`;
        })
        .join("");

      // 回收站列表项的「恢复 / 删除」按钮共用绑定（消除孪生 handler）：
      // 仅 binding、成功 toast key、是否先弹确认框不同。删除后联动统计与资源树刷新
      // （P2 修复：与 restore/empty 对齐）。
      const bindRecycleAction = (
        selector: string,
        opt: {
          confirm?: { title: string; icon: string; message: string; okText: string };
          binding: (path: string) => Promise<unknown>;
          toastKey: string;
        },
      ): void => {
        list.querySelectorAll(selector).forEach((btnEl) => {
          const btn = btnEl as HTMLButtonElement;
          btn.onclick = async (): Promise<void> => {
            if (btn.disabled) return;
            if (opt.confirm) {
              const confirmed = await modalConfirm({ ...opt.confirm, danger: true });
              if (!confirmed) return;
            }
            btn.disabled = true;
            const item = btn.closest(".recy-item");
            if (item) {
              item.classList.add("leaving");
              await new Promise((r) => setTimeout(r, LEAVE_ANIM_MS));
            }
            try {
              await opt.binding(btn.dataset.path || "");
              loadRecycleBin();
              bus.emit("stats:refresh");
              bus.emit("tree:reload");
              bus.emit("toast:show", {
                msg: t(opt.toastKey),
                duration: TOAST_ACTION_OK_MS,
                type: "success",
              });
            } catch (e) {
              if (item) item.classList.remove("leaving");
              btn.disabled = false;
              bus.emit("toast:show", {
                msg: `❌ ${friendlyError(e)}`,
                duration: TOAST_ACTION_ERR_MS,
                type: "error",
              });
            }
          };
        });
      };

      bindRecycleAction(".recy-restore", {
        binding: (p) => RestoreFromRecycle(p, ""),
        toastKey: "recycle.restored",
      });
      bindRecycleAction(".recy-del", {
        confirm: {
          title: "删除文件",
          icon: "🗑️",
          message: "确定永久删除此文件？",
          okText: "🗑️ 删除",
        },
        binding: (p) => DeleteFromRecycle(p),
        toastKey: "recycle.deleted",
      });

      // 文件名点击 → 模型详情：已在 init 用事件委托统一绑定（onListClick），此处无需逐元素绑定
    } catch (e) {
      if (guard.stale(gen)) return;
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:var(--paid);font-size:11px">❌ ${esc(friendlyError(e, t("recycle.loadFailed")))}</div>`;
      if (count) count.textContent = t("common.loadFailed");
    }
  }

  // 返回清理函数，供上层在组件销毁时调用
  return () => {
    // P3 修复（子代理审计）：cleanup 后使代数失效——若 loadRecycleBin 在清理后完成
    // （迟到响应）仍会写 innerHTML/绑监听；失效后任何在途请求的 gen 比对都会丢弃
    // 结果（与 oldest-models 共用 createLoadGuard 模式）
    guard.invalidate();
    cleanupRtype();
    if (listEl) listEl.removeEventListener("click", onListClick);
    root
      .getElementById("recy-refresh")
      ?.removeEventListener("click", onRefreshClick);
    root.getElementById("recy-empty")?.removeEventListener("click", onEmptyClick);
    // P3（审核发现）：条目「恢复/删除」按钮的 onclick 直接绑在元素上（bindRecycleAction），
    // cleanup 未移除时组件销毁后按钮仍可触发后端调用 + toast。清空列表即移除全部条目按钮
    // （在途异步已有 load-guard 守卫兜底，不会迟到重绘）。
    if (listEl) listEl.innerHTML = "";
  };
}
