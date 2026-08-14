// ===== 创意工坊 — 下载队列 · 进度条守卫（99% 卡进度防骗状态机）=====
// 从 download-queue.ts 拆分（ADR-040 ≤400 行红线）：陷阱 #6 卡进度锁定逻辑内聚于此，
// 逻辑零改动纯搬移——回归护栏见 download-queue.test.ts「99% 锁定状态机」describe。
// 职责：进度条渲染 + 小文件 300ms 强制 100% / 大文件 2s 转菊花 / file-done 强制复位 /
// 3s completeTimer 收口互斥（与队列结束双路收口防重复）。
import { t } from "../../core/i18n/t.ts";
import { isActiveStatus, STATE, type DownloadState } from "./download-queue-store.ts";

/** 进度条元素的自定义属性（点动画） */
type PctEl = HTMLElement & {
  _dotTimer?: ReturnType<typeof setInterval> | null;
  _dots?: number;
};

/** createProgressGuard 依赖注入（controller 提供查找与收口回调） */
export interface ProgressGuardHooks {
  /** 查找进度条容器（controller 注入其作用域根） */
  qsEl: () => HTMLElement | null;
  /** completeTimer 3s 到期且守卫全部通过时收口（controller：cleanupProgressUI + onAllDone） */
  onTimedCompletion: (summary?: string) => void;
}

/** 进度条守卫控制器 */
export interface ProgressGuard {
  /** 渲染进度（含 99% 卡进度锁定状态机） */
  render(s: DownloadState): void;
  /** file-done 到达：ok 强制 100% / fail 显示 ❌，并复位锁定与定时器 */
  forceFileDone(done: { status: string; errMsg: string }): void;
  /** 清空进度并取 pct/fill 元素（ok/fail 分支共用，防重复代码红线） */
  resetProgressUI(): { pctEl: PctEl | null; fillEl: HTMLElement | null };
  /** 集中清 _stuckTimer/_dotTimer/completeTimer（destroy 与 cleanup 共用） */
  stuckGuardReset(): void;
  clearCompleteTimer(): void;
  /** 队列结束收口互斥：返回是否首次收口（false = 已收口过，调用方直接 return） */
  beginQueueEnded(): boolean;
  /** 复位收口互斥标志（新批次入队 / 状态变 downloading 时调用） */
  resetCompletionMutex(): void;
}

export function createProgressGuard(hooks: ProgressGuardHooks): ProgressGuard {
  const { qsEl, onTimedCompletion } = hooks;
  let _lastPct = -1;
  // P3 修复：99% 锁定态标志。锁定后置 true，防止下一条 progress 事件经 else 分支
  // 清掉 _stuckTimer（锁定后 _lastPct=99，守卫条件不再成立，原逻辑会立刻解除锁定）。
  let _stuckLocked = false;
  let _stuckTimer: ReturnType<typeof setTimeout> | null = null;
  let completeTimer: ReturnType<typeof setTimeout> | null = null;
  // P1 修复：completeTimer 与队列结束收口双路互斥——timer 先触发后
  // queue:status done 再到达时不得重复 onAllDone/cleanupProgressUI（防双回调/双清理）
  let _doneNotified = false;

  const clearCompleteTimer = (): void => {
    if (completeTimer) {
      clearTimeout(completeTimer);
      completeTimer = null;
    }
  };

  const stuckGuardReset = (): void => {
    _lastPct = -1;
    _stuckLocked = false;
    clearCompleteTimer();
    if (_stuckTimer) {
      clearTimeout(_stuckTimer);
      _stuckTimer = null;
    }
    const pctEl = qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
    if (pctEl?._dotTimer) {
      clearInterval(pctEl._dotTimer);
      pctEl._dotTimer = null;
    }
  };

  /** 清空进度并取 pct/fill 元素（ok/fail 分支共用，防重复代码红线） */
  const resetProgressUI = (): { pctEl: PctEl | null; fillEl: HTMLElement | null } => {
    STATE.progress = { dl: 0, total: 0 };
    const pctEl = qsEl()?.querySelector(".gh-progress-pct") as PctEl | null;
    const fillEl = qsEl()?.querySelector(".gh-progress-fill") as HTMLElement | null;
    return { pctEl, fillEl };
  };

  /** 下载进度更新 → 更新进度条和百分比（含 99% 卡进度防骗锁定） */
  function render(s: DownloadState): void {
    const qs = qsEl();
    if (!qs) return;
    const { dl, total } = s.progress;

    let pct: number;
    let label: string;
    if (!total || total <= 0) {
      const mb = (dl / 1024 / 1024).toFixed(1);
      label = mb + "MB";
      // Content-Length=-1 时不得误报 100%（陷阱 #6）：完成判定只信任 file-done / queue:status done
      pct = 0;
    } else {
      pct = Math.min(Math.round((dl / total) * 100), 100);
      label = pct + "%";
    }

    const isTiny = total > 0 && total <= 100 * 1024;

    // 小文件卡进度防骗
    if (isTiny && _lastPct < 10 && pct >= 99 && !completeTimer) {
      label = "99%";
      pct = 99;
      _stuckLocked = true;
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      _stuckTimer = setTimeout(() => {
        const pctEl2 = qs?.querySelector(".gh-progress-pct") as PctEl | null;
        const fillEl2 = qs?.querySelector(
          ".gh-progress-fill",
        ) as HTMLElement | null;
        if (pctEl2) pctEl2.textContent = "100%";
        if (fillEl2) {
          fillEl2.style.transition = "width .3s";
          fillEl2.style.width = "100%";
        }
        _stuckTimer = null;
        _stuckLocked = false;
      }, 300);
    }

    // 大文件卡进度防骗（CLIP / VAE / UNET 结尾）
    const hasCL = total > 0 && pct > 0;
    if (hasCL && !isTiny && _lastPct < 10 && pct >= 99 && total > 1024 * 1024) {
      label = "99%";
      pct = 99;
      _stuckLocked = true;
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      // P3 修复：判空再写 textContent（resume 恢复路径渲染无 pct 元素时防 TypeError）
      const lockPctEl = qs.querySelector(".gh-progress-pct") as PctEl | null;
      if (lockPctEl) lockPctEl.textContent = label;
      _stuckTimer = setTimeout(() => {
        const pctEl = qs?.querySelector(".gh-progress-pct") as PctEl | null;
        const fillEl = qs?.querySelector(
          ".gh-progress-fill",
        ) as HTMLElement | null;
        if (pctEl && pctEl.textContent !== "100%") {
          pctEl.textContent = "⏳";
          pctEl.style.fontSize = "9px";
          pctEl._dots = 0;
          pctEl._dotTimer = setInterval(() => {
            if (!pctEl || pctEl.textContent === "100%") {
              if (pctEl?._dotTimer) clearInterval(pctEl._dotTimer);
              return;
            }
            pctEl._dots = ((pctEl._dots || 0) + 1) % 4;
            pctEl.textContent = "⏳" + ".".repeat(pctEl._dots);
          }, 400);
        }
        if (fillEl) fillEl.style.width = "99%";
        // 大文件转菊花后保持锁定直到 file-done 强制 100%（handleFileDone 复位）
      }, 2000);
    } else if (!_stuckLocked) {
      // P3 修复：锁定态不清 _stuckTimer（否则 300ms/2s 补写逻辑被下一条 progress 打断）
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
    }
    _lastPct = pct;

    const pctEl = qs.querySelector(".gh-progress-pct") as PctEl | null;
    const fillEl = qs.querySelector(
      ".gh-progress-fill",
    ) as HTMLElement | null;
    if (pctEl && !_stuckLocked) pctEl.textContent = label;
    if (fillEl) {
      fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
      fillEl.style.width = pct + "%";
    }

    // P2 修复（盲区）：锁定态不得 arm completeTimer。锁定后 dl 达 total 的 progress
    // （计算 pct=100，落入此分支）若仍持锁定（file-done 未到），3s 后会在 file-done
    // 前提前收口（单文件 remaining=0 时），把 99% 卡进度锁解开。
    // 锁定态下只清不设，等 file-done（ok 强制 100% / fail 复位）再走完成清理。
    if (pct >= 100 && !_stuckLocked) {
      clearCompleteTimer();
      completeTimer = setTimeout(() => {
        if (!isActiveStatus(STATE)) return;
        // P3 修复（审核）：多文件队列中下一个 file-start 若因调度/事件乱序延迟 >3s，
        // 原逻辑会在队列仍 active 时提前收口（重渲染丢进度）。
        // remaining>0 说明还有文件排队，放弃本次清理，等下一个进度/start 事件重设 timer。
        if (STATE.remaining > 0) return;
        if (STATE._lastDoneSeq > 0 && STATE.status !== "downloading") return; // 已完成，等 status done 收口
        // P1 修复：收口互斥——若队列结束已先收口（status done 已到），
        // 本 timer 不得再触发收口
        if (_doneNotified) return;
        _doneNotified = true;
        let summary: string | undefined;
        if (STATE.errorList.length > 0) {
          summary =
            '<div class="gh-queue-error">⚠️ ' +
            t("downloadQueue.failedCount", { n: STATE.errorList.length }) +
            "</div>";
        }
        onTimedCompletion(summary);
      }, 3000);
    } else {
      clearCompleteTimer();
    }
  }

  /** 文件下载完成 → 进度条强制复位（ok 100% / fail ❌），锁定与定时器清零 */
  function forceFileDone(done: { status: string; errMsg: string }): void {
    if (done.status === "ok") {
      // P3 修复：file-done 后同一次 notify 的 progress 分支会用「旧 progress」重算，
      // 把此处写入的 100% 覆盖回 99%（Content-Length 失真场景）——清空 progress
      // 使 handleStateChange 的 progress 分支（dl>0||total>0）跳过重绘
      const { pctEl, fillEl } = resetProgressUI();
      // file-done 到达时强制覆盖卡在 99% 的进度条
      if (pctEl && (_stuckLocked || pctEl.textContent === "99%")) {
        // P3 修复（code_review）：大文件 2s 转菊花后 textContent 是 ⏳ 而非 99%，
        // 必须按 _stuckLocked 判断才能命中，否则 _stuckLocked 与 _dotTimer 永不复位
        pctEl.textContent = "100%";
        _stuckLocked = false;
        if (pctEl._dotTimer) {
          clearInterval(pctEl._dotTimer);
          pctEl._dotTimer = null;
        }
        if (fillEl) fillEl.style.width = "100%";
      }
      // P3 修复：ok 分支与 fail 分支对齐——清理 _stuckTimer，防锁定期间到达的
      // 2s 补写 timer（若尚未触发）把 100% 覆盖回 99%/⏳
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
    } else if (done.status === "fail") {
      // P2 修复：与 ok 分支一致——清空 progress 防止同一次 notify 的 progress 分支
      // 用旧进度把 ❌ 重绘回 99%/100%；并复位 99% 锁定态、清理 _stuckTimer/_dotTimer，
      // 否则锁定期间到达的 fail 会让 300ms/2s 补写 timer 把 ❌ 覆盖成 ⏳/100%。
      const { pctEl, fillEl } = resetProgressUI();
      if (pctEl) {
        pctEl.textContent = "❌";
        pctEl.classList.add("gh-progress-error");
        pctEl.title = done.errMsg || "下载失败";
      }
      _stuckLocked = false;
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      if (pctEl?._dotTimer) {
        clearInterval(pctEl._dotTimer);
        pctEl._dotTimer = null;
      }
      if (fillEl) fillEl.classList.add("gh-progress-fill-error");
    }
  }

  /** 队列结束收口互斥：首次收口返回 true 并置位；已收口过返回 false */
  function beginQueueEnded(): boolean {
    if (_doneNotified) return false;
    _doneNotified = true;
    return true;
  }

  function resetCompletionMutex(): void {
    _doneNotified = false;
  }

  return {
    render,
    forceFileDone,
    resetProgressUI,
    stuckGuardReset,
    clearCompleteTimer,
    beginQueueEnded,
    resetCompletionMutex,
  };
}