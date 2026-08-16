// ===== Web Worker 批量模型统计编排（SearchModels 数值条件的统计来源）=====
// 主线程只做消息编排：Worker 内独立加载 WASM + open IndexedDB（同源）逐个模型
// 解码统计，主线程零解析负载（大库后台跑不卡 UI）。
// 降级契约：Worker 不支持（new Worker 抛错）/ 启动失败 / 运行时错误 / 单批超时
// → 返回 null 并置降级标记（consumeWebSearchDegraded 消费，供 toolbar-search 提示）；
// web-fs.searchWebModels 收到 null 走「数值 0 + hasError:false」降级路径。
// 测试注入：setStatsRunnerForTest 替换 Worker 路径（browser-adapter.test.ts 用）。
import {
  STATS_BATCH_LIMIT,
  type StatsWorkerRequest,
  type StatsWorkerResponse,
  type WebModelStats,
} from "../workers/stats-protocol.ts";

// 对外类型（web-fs 复用：SearchModels 数值字段形状对齐 go types.SearchResult）
export type { WebModelStats } from "../workers/stats-protocol.ts";
export { STATS_BATCH_LIMIT } from "../workers/stats-protocol.ts";

/** 单批超时（毫秒）：WASM 解码 + 200 模型，60s 已含余量；超时终止 Worker 防僵尸 */
const STATS_CHUNK_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let requestSeq = 0;

/** 单批在途请求（批间串行，同一时刻至多一个；terminate/error/timeout 时清空） */
let pending: {
  requestId: number;
  settle: (v: WebModelStats[] | null) => void;
} | null = null;

/** 降级标记：最近一次批量统计是否降级（一次消费，toolbar-search 读取后复位） */
let degradedFlag = false;

/** 批量统计函数签名（测试注入用；返回 null = 降级） */
type StatsRunner = (paths: string[]) => Promise<WebModelStats[] | null>;

let injectedRunner: StatsRunner | null = null;

/**
 * 测试注入统计实现（替换 Worker 路径）。传 null 恢复 Worker 真实路径。
 * 返回 null 等价 Worker 不可用 → batchStatsWebModels 整体降级。
 */
export function setStatsRunnerForTest(runner: StatsRunner | null): void {
  injectedRunner = runner;
}

/** 消费「最近一次批量统计是否降级」标记（读完复位，避免跨搜索串扰） */
export function consumeWebSearchDegraded(): boolean {
  const d = degradedFlag;
  degradedFlag = false;
  return d;
}

/** 终止并回收 Worker（取消在途任务：调用方在超时/失败后使用；外部也可主动取消） */
export function terminateStatsWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (pending) {
    pending = null;
  }
}

function markDegraded(): void {
  degradedFlag = true;
}

/** 懒创建 Worker；不支持（非浏览器/被屏蔽）返回 null */
function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL("../workers/stats.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch {
    worker = null;
  }
  return worker;
}

/** 单批统计（串行调用；返回 null = 该批降级） */
function statsOneChunk(paths: string[]): Promise<WebModelStats[] | null> {
  return new Promise((resolve) => {
    const w = getWorker();
    if (!w) {
      markDegraded();
      resolve(null);
      return;
    }
    const requestId = ++requestSeq;
    const timer = setTimeout(() => {
      // 超时：杀掉 Worker 防僵尸（可能 WASM 死循环/挂起），整批降级
      terminateStatsWorker();
      markDegraded();
      resolve(null);
    }, STATS_CHUNK_TIMEOUT_MS);

    const settle = (v: WebModelStats[] | null): void => {
      clearTimeout(timer);
      if (pending?.requestId === requestId) pending = null;
      resolve(v);
    };

    pending = { requestId, settle };

    w.onmessage = (ev: MessageEvent<StatsWorkerResponse>): void => {
      const data = ev.data as StatsWorkerResponse;
      if (!data || data.requestId !== requestId) return; // 旧批/进度消息忽略
      if (data.type === "result") {
        settle(data.results as WebModelStats[]);
      } else if (data.type === "error") {
        // Worker 内 WASM 初始化失败等 → 终止并降级
        terminateStatsWorker();
        markDegraded();
        settle(null);
      }
      // progress：当前无 UI 消费，忽略
    };

    w.onerror = (): void => {
      // 运行时错误（WASM trap 逃逸等）→ 终止 + 降级，防在途请求永久挂起
      terminateStatsWorker();
      markDegraded();
      settle(null);
    };

    w.postMessage({ type: "stats", paths, requestId } satisfies StatsWorkerRequest);
  });
}

/**
 * 批量统计模型（骨骼/立方体/纹理尺寸）。返回数组与输入 paths 一一对应；
 * Worker 不可用 / 任一批失败 / 超时 → 返回 null（整体降级）。
 */
export async function batchStatsWebModels(paths: string[]): Promise<WebModelStats[] | null> {
  if (injectedRunner) {
    const res = await injectedRunner(paths);
    if (res === null) markDegraded();
    return res;
  }
  if (!paths.length) return [];
  const out: Array<WebModelStats | null> = new Array(paths.length);
  for (let offset = 0; offset < paths.length; offset += STATS_BATCH_LIMIT) {
    const chunk = paths.slice(offset, offset + STATS_BATCH_LIMIT);
    const res = await statsOneChunk(chunk);
    if (res === null) {
      markDegraded();
      return null;
    }
    // 按 path 对齐（Worker 结果带 path，防顺序漂移）
    const byPath = new Map(res.map((s) => [s.path, s]));
    for (let i = 0; i < chunk.length; i++) {
      const s = byPath.get(chunk[i]);
      out[offset + i] = s
        ? {
            boneCount: s.boneCount,
            cubeCount: s.cubeCount,
            texWidth: s.texWidth,
            texHeight: s.texHeight,
            hasError: s.hasError,
          }
        : null;
    }
  }
  if (out.some((s) => s === null)) {
    // 防御：结果对齐失败（worker 缺条目）→ 整体降级，不返回半截统计
    markDegraded();
    return null;
  }
  return out as WebModelStats[];
}
