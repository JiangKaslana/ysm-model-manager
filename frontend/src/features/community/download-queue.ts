// ===== 创意工坊 — 批量下载队列 · UI 控制器（ADR-014 P3 features）=====
// 拆分说明（ADR-040 ≤400 行红线）：原 download-queue.ts 829 行拆为三文件——
// · download-queue-store.ts：模块级状态/Go 调用/4 组后端事件注册（含 ADR-039 §2.2 豁免声明）
// · download-queue-progress.ts：99% 卡进度防骗状态机（陷阱 #6 锁定/菊花/completeTimer 收口互斥）
// · 本文件：createDownloadQueue UI 控制器 + 对外 re-export（测试 / events.ts / download-tasks.ts
//   均从本文件取符号，契约零改动）
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { currentRepoType } from "../repo-rtype.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { getApp } from "../../backend/app.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import {
  STATE,
  notify,
  subscribe,
  resume,
  isActiveStatus,
  enqueueDownloads,
  cancelDownloads,
  type DownloadState,
  type DownloadTask,
  type QueueError,
} from "./download-queue-store.ts";
import { createProgressGuard, type ProgressGuard } from "./download-queue-progress.ts";

// ── 对外 re-export（保持消费者从本文件导入的既有契约）──
export {
  subscribe,
  getState,
  resume,
  enqueueDownloads,
  cancelDownloads,
} from "./download-queue-store.ts";
export type { DownloadTask, DownloadState, QueueError } from "./download-queue-store.ts";

// ============================================================
//  createDownloadQueue — UI 层（订阅 STATE → 渲染 DOM）
// ============================================================

/** createDownloadQueue 选项 */
export interface QueueControllerOptions {
  sr: HTMLElement;
  esc: (s: string) => string;
  getLocalMap: () => Map<string, string>;
  onFileSuccess?: (name: string) => void;
  onAllDone?: (result: { cancelled: boolean; errorList: QueueError[] }) => void;
}

/** 队列控制器 */
export interface QueueController {
  enqueue: (tasks: DownloadTask[]) => Promise<void>;
  cancel: () => Promise<void>;
  isDownloading: () => boolean;
  destroy: () => void;
}

/**
 * 属性选择器值转义。
 * 浏览器用标准 CSS.escape 正确处理 & < > 等字符（修复 &amp; 不还原问题，ADR-039 P3）；
 * 降级分支（CSS.escape 不可用时）做最小转义（" 与 \），覆盖非标准环境。
 */
function escapeAttrValue(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * 创建一个下载队列 UI 控制器。
 * 所有 Go 事件已在 download-queue-store.ts 模块顶层注册，本函数只负责：
 *   1. 订阅 STATE 变更 → 渲染进度 DOM（进度条细节委托 progressGuard）
 *   2. 暴露 enqueue() / cancel() 供事件绑定使用
 */
export function createDownloadQueue({
  sr,
  esc,
  getLocalMap,
  onFileSuccess,
  onAllDone,
}: QueueControllerOptions): QueueController {
  let _prevStatus = "idle";
  let _prevFile = "";
  let _prevLastDoneSeq = 0;

  const qsEl = (): HTMLElement | null => sr.querySelector("#gh-queue-status");
  const dlBtn = (): HTMLButtonElement | null =>
    sr.querySelector(".gh-dl-selected");

  // ── 进度条守卫（99% 卡进度防骗 + completeTimer 收口互斥）──
  // 细节见 download-queue-progress.ts；收口回调经依赖注入回到本控制器，
  // 保证 completeTimer 3s 到期后的清理/onAllDone 与 handleQueueEnded 双路互斥语义不变。
  const progressGuard: ProgressGuard = createProgressGuard({
    qsEl,
    onTimedCompletion: (summary) => {
      cleanupProgressUI(summary);
      if (onAllDone) onAllDone({ cancelled: false, errorList: STATE.errorList });
    },
  });

  // ── 工具函数 ──

  const cleanupProgressUI = (errorSummary?: string): void => {
    progressGuard.clearCompleteTimer();
    progressGuard.stuckGuardReset();
    const qs = qsEl();
    if (qs) {
      if (errorSummary) {
        qs.innerHTML = errorSummary;
      } else {
        qs.classList.remove("show");
      }
    }
    // 统一恢复下载按钮（成功/取消/失败路径都经此清理，防按钮卡死）
    const btn = dlBtn();
    if (btn) btn.disabled = false;
    try {
      getApp()
        .then((App) => {
          if (App.ClearScanCache) App.ClearScanCache();
        })
        .catch(() => {});
    } catch (_) {
      /* 清除缓存失败不影响清理 */
    }
    bus.emit("tree:reload");
    bus.emit("stats:refresh");
  };

  // ── 事件 → UI 映射 ──

  /** 新文件开始下载 → 渲染进度行 + 取消按钮 */
  function handleFileStart(s: DownloadState): void {
    progressGuard.stuckGuardReset();
    // P2 修复（审核）：取消按钮重入守卫标志（本次文件渲染生命周期内有效）
    let cancelling = false;
    const done = s.total - s.remaining;
    const qs = qsEl();
    if (qs) {
      const remain = s.total - done;
      qs.innerHTML =
        '<div class="gh-progress-row">' +
        '<span class="gh-queue-icon">⬇️</span>' +
        '<span class="gh-progress-name">' +
        renderDisplayName(s.currentFile) +
        "</span>" +
        '<span class="gh-progress-pct">⏳</span>' +
        (remain > 1
          ? '<span class="gh-progress-remain">' +
            t("community.downloadQueue.remain", { n: remain }) +
            "</span>"
          : "") +
        '<button class="btn-base sm gh-cancel-queue" title="' + t("common.cancel") + '">✕</button>' +
        "</div>" +
        '<div class="gh-progress-bar-wrap"><div class="gh-progress-fill"></div></div>';
      qs.querySelector(".gh-cancel-queue")?.addEventListener("click", async () => {
        // P2 修复（审核）：取消按钮加本地重入守卫——快速连点会重复发 CancelQueue
        if (cancelling) return;
        cancelling = true;
        try {
          await cancelDownloads();
        } finally {
          cancelling = false;
        }
      });
    }
  }

  /** 文件下载完成 → 更新本地缓存 / 清勾选（进度复位委托 progressGuard.forceFileDone） */
  function handleFileDone(done: {
    name: string;
    status: string;
    errMsg: string;
  }): void {
    progressGuard.forceFileDone(done);
    if (done.status === "ok") {
      if (done.name) getLocalMap().set(done.name, "");
      uncheckByName(done.name);
    } else if (done.status === "fail") {
      uncheckByName(done.name);
    }
  }

  /** 清勾选并通知外部（ok/fail 分支共用；fail 也需清勾选防 selectedSet 残留） */
  function uncheckByName(name: string): void {
    // ADR-039 P3：用 CSS.escape 修复 &amp; 在属性选择器中不还原的问题
    const cb = sr.querySelector(
      '.gh-sel[data-name="' + escapeAttrValue(name) + '"]',
    );
    if (cb) (cb as HTMLInputElement).checked = false;
    if (onFileSuccess) onFileSuccess(name);
  }

  /** 队列结束 → 显示错误摘要 / 清理 UI / 通知外部 */
  function handleQueueEnded(s: DownloadState): void {
    // P1 修复：收口互斥——若 completeTimer 已先触发过 onAllDone/cleanupProgressUI，
    // status done 迟到时不得重复收口
    if (!progressGuard.beginQueueEnded()) return;
    const cancelled = s.status === "cancelled";
    let summary = "";
    if (s.errorList.length > 0) {
      summary =
        '<div class="gh-queue-error">⚠️ ' +
        t("downloadQueue.failedListTitle", { n: s.errorList.length }) +
        "</div>" +
        s.errorList
          .slice(0, 5)
          .map(
            (e) =>
              '<div class="gh-queue-err-item">❌ ' +
              renderDisplayName(e.name) +
              ": " +
              esc(e.err) +
              "</div>",
          )
          .join("") +
        (s.errorList.length > 5
          ? '<div class="gh-queue-ellipsis">' +
            t("downloadQueue.moreCount", { n: s.errorList.length - 5 }) +
            "</div>"
          : "");
    }
    if (cancelled) {
      cleanupProgressUI(summary || '<span class="gh-queue-cancel">⏹ ' + t("downloadQueue.cancelled") + "</span>");
    } else {
      cleanupProgressUI(summary || undefined);
    }
    if (onAllDone) onAllDone({ cancelled, errorList: s.errorList });
  }

  // ── 核心：订阅 STATE → 渲染 DOM ──

  function handleStateChange(s: DownloadState): void {
    // 文件完成事件（可能夹在 file-start 和 progress 之间到达）
    if (s._lastDoneSeq > _prevLastDoneSeq) {
      handleFileDone(s._lastDone!);
      _prevLastDoneSeq = s._lastDoneSeq;
    }

    // 新文件开始
    if (s.currentFile && s.currentFile !== _prevFile) {
      handleFileStart(s);
    }

    // 下载进度更新
    if (s.progress && (s.progress.dl > 0 || s.progress.total > 0)) {
      progressGuard.render(s);
    }

    // 队列状态变化
    if (s.status !== _prevStatus) {
      if (s.status === "done" || s.status === "cancelled") {
        progressGuard.clearCompleteTimer(); // 强制清掉进度条 3s timer，防止 "100% → done" 间隙
        handleQueueEnded(s);
      } else if (s.status === "downloading") {
        // 状态变 active（新批次或 resume 恢复）——复位收口互斥标志（P1 修复）
        progressGuard.resetCompletionMutex();
        // 队列启动或 resume 恢复 — 确保 UI 就绪
        const qs = qsEl();
        const btn = dlBtn();
        if (btn) btn.disabled = true;
        if (qs && !qs.classList.contains("show")) {
          // resume 路径：UI 未初始化，补上进度条
          qs.classList.add("show");
          if (s.currentFile) {
            handleFileStart(s);
          } else {
            qs.innerHTML =
              '<span class="gh-queue-icon">⬇️</span> ' +
              t("downloadQueue.downloadingRemain", { n: s.remaining || "?" });
          }
        }
      } else if (s.status === "idle" && _prevStatus === "downloading") {
        // P3 修复（审核）：网页版（resolveWebMode）直链下载完成后 store 置 idle，
        // 无后端 done 事件流——原实现按钮永久卡禁用、「准备下载」一直挂屏（陷阱 #3 变体）。
        // store 入队失败回滚也经 idle 过渡（enqueue catch 另有 cleanupProgressUI 兜底，双保险无害）。
        const btn = dlBtn();
        if (btn) btn.disabled = false;
        const qs = qsEl();
        if (qs) qs.classList.remove("show");
      }
    }

    // P3 防御修复（审核）：队列结束显式清零 _prevFile——若 Go 端事件缺失未发
    // currentFile=""（子代理 P1 场景），残留旧文件名会导致同文件名二次下载
    // 时 handleFileStart 不触发、进度条不渲染
    _prevFile = s.status === "done" || s.status === "cancelled" ? "" : s.currentFile;
    _prevStatus = s.status;
  }

  const unsub = subscribe(handleStateChange);

  // 页面进入时恢复下载状态（防止切页期间进度丢失）
  void resume();

  // ── 公开 API ──

  async function enqueue(tasks: DownloadTask[]): Promise<void> {
    if (isActiveStatus(STATE)) return;
    if (!tasks.length) return;

    try {
      // P2 修复：getApp/GetRepoRoot 移入 try 内——原实现前置 await 在 try 外，
      // 任一 reject 时按钮永久卡禁用且无 toast（陷阱 #3 变体）
      const { GetRepoRoot } = await getApp();
      // ADR-064 锚定：落库目录随当前仓库类型（原锁 RESOURCE_TYPES.YSM，
      // 未来其他类型下载会错库落盘）
      const filesRoot = await GetRepoRoot(currentRepoType());
      if (!filesRoot) {
        bus.emit("toast:show", {
          msg: t("workshop.configureRepo"),
          duration: 3000,
          type: "warn",
        });
        return;
      }
      tasks.forEach((t) => (t.saveDir = filesRoot));

      const btn = dlBtn();
      if (btn) btn.disabled = true;

      const qs = qsEl();
      if (qs) {
        qs.classList.add("show");
        qs.innerHTML =
          '<span class="gh-queue-icon">⬇️</span> ' +
          t("downloadQueue.preparingTotal", { n: tasks.length });
      }

      // P2 修复（审核）：新批次入队时同步重置控制器侧高水位——enqueueDownloads 已把
      // STATE._lastDoneSeq 归零，但本闭包的 _prevLastDoneSeq 若残留上批次的 N，
      // 新批次前 N 个 file-done 会因 seq > prev 判假被静默丢弃（勾选不复位/localMap
      // 不更新/头像不提取）。同一控制器实例内连续两批下载即触发。
      _prevLastDoneSeq = 0;
      // P1 修复：新批次入队前复位收口互斥标志，允许本批次正常触发 onAllDone
      progressGuard.resetCompletionMutex();
      await enqueueDownloads(tasks);
    } catch (e) {
      // Go 入队失败（含 getApp/GetRepoRoot reject）：恢复状态与 UI，防止按钮/进度条卡死（陷阱 #3）
      STATE.status = "idle";
      notify();
      bus.emit("toast:show", {
        msg: `❌ ${t("workshop.enqueueFailed")}: ` + (safeErrorMessage(e)),
        duration: 4000,
        type: "error",
      });
      cleanupProgressUI();
    }
  }

  async function cancel(): Promise<void> {
    await cancelDownloads();
  }

  return {
    enqueue,
    cancel,
    isDownloading: () => isActiveStatus(STATE),
    /** 组件销毁时取消订阅并清理全部定时器（P2 修复：原仅 unsub——视图销毁后
     * `_dotTimer` interval（400ms 菊花动画）无限自旋、3s `completeTimer` 在死视图上
     * 触发 cleanupProgressUI/onAllDone 副作用；stuckGuardReset 集中清 _stuckTimer/
     * _dotTimer/completeTimer） */
    destroy: () => {
      progressGuard.stuckGuardReset();
      unsub();
    },
  };
}