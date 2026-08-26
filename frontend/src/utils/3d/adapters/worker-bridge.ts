// ===== Worker 桥：resolve-mode 单 worker 同构协议 =====
// 吞掉 nextId + pending Map + setTimeout + onmessage 分发 + onerror/超时结算。
// 适用：响应自带 ok 标志、错误以响应形式回传（pmx / fbx 同构，逐字去重来源）。
//
// 基数约束：仅 1 请求 : 1 Promise。批量聚合（completed/total，如 texture-decoder）
// 不在此列——强行统一会污染 API（见 withEventTimeout 同一条裁决）。
//
// 扩展点（Step 2）：ktx2 是 reject 语义 + worker 池 round-robin + 崩溃终止整池，
// 届时在同文件加 createWorkerBridge（reject-mode + pool），与此 resolve-mode 共享
// nextId/pending/setTimeout 内核。

/** 响应必须携带 id / ok；错误以 ok:false + error 回传，不走 reject */
export interface ResolveModeResponse {
  id: number;
  ok: boolean;
  error?: string;
}

export interface ResolveModeBridge<Resp extends ResolveModeResponse> {
  /** 发请求，返回该响应的 Promise（错误以 ok:false 响应形式 resolve，不 reject） */
  request: (bytes: ArrayBuffer) => Promise<Resp>;
  /** 终止 worker，在途请求以 ok:false（"Worker 已终止"）结算 */
  dispose: () => void;
}

export function createResolveModeBridge<Resp extends ResolveModeResponse>(
  workerUrl: string,
  timeoutMs: number,
  timeoutMsg: string,
): ResolveModeBridge<Resp> {
  const worker = new Worker(new URL(workerUrl, import.meta.url), { type: "module" });
  let nextId = 0;
  const pending = new Map<number, {
    resolve: (r: Resp) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  // 单请求失败结算：超时 / dispose 复用（onerror 走下方批量快照，避免迭代中改 Map）
  function fail(id: number, errMsg: string): void {
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve({ id, ok: false, error: errMsg } as Resp);
  }

  worker.onmessage = (e: MessageEvent<Resp>) => {
    const { id } = e.data;
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(e.data);
  };

  worker.onerror = (ev: ErrorEvent) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: false, error: `Worker 错误: ${ev.message}` } as Resp);
    }
    pending.clear();
  };

  function request(bytes: ArrayBuffer): Promise<Resp> {
    return new Promise<Resp>((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => fail(id, timeoutMsg), timeoutMs);
      pending.set(id, { resolve, timer });
      worker.postMessage({ id, bytes }, [bytes]);
    });
  }

  function dispose(): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id, ok: false, error: "Worker 已终止" } as Resp);
    }
    pending.clear();
    worker.terminate();
  }

  return { request, dispose };
}
