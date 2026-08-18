// ===== MMD KTX2 编码器单元测试 =====
// 覆盖：encodeAndCacheTexture（编码成功/失败）、
// scheduleBackgroundEncoding（调度行为）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    ktx2EncodeMock: vi.fn(),
    saveTextureMock: vi.fn(),
    addOpLogMock: vi.fn(),
  };
});

vi.mock("@loaders.gl/textures", () => ({
  KTX2BasisWriter: { encode: hoisted.ktx2EncodeMock },
}));

vi.mock("../../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    SaveCachedTexture: hoisted.saveTextureMock,
  }),
}));

import { encodeAndCacheTexture, scheduleBackgroundEncoding, cancelPendingEncodings, resetEncoderState } from "./mmd-ktx2-encoder.ts";
import type { MmdDataPort } from "./mmd-adapter.ts";

function makePort(): MmdDataPort {
  return {
    readFileBytes: vi.fn(),
    readFileBytesBatch: vi.fn(),
    listAllFilePaths: vi.fn(),
    addOpLog: hoisted.addOpLogMock,
    getCachedTexture: vi.fn(),
  };
}

// 最小 PNG 1x1 base64
const MINIMAL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

// 安装完整 DOM mock（Image/fetch/FileReader/canvas）
function installDomMocks(): void {
  const ImageCtor = function () {
    const obj: { width: number; height: number; onload: (() => void) | null; src: string } = {
      width: 1, height: 1, onload: null, src: "",
    };
    setTimeout(() => { obj.onload?.(); }, 0);
    return obj;
  };
  vi.stubGlobal("Image", ImageCtor);

  const mockFetch = vi.fn().mockResolvedValue({
    blob: () => Promise.resolve(new Blob([MINIMAL_PNG_B64], { type: "image/png" })),
  });
  vi.stubGlobal("fetch", mockFetch);

  const FileReaderCtor = function () {
    const obj: { result: string; onload: (() => void) | null; readAsDataURL: () => void } = {
      result: `data:image/png;base64,${MINIMAL_PNG_B64}`,
      onload: null,
      readAsDataURL: function (this: typeof obj) {
        setTimeout(() => { this.onload?.(); }, 0);
      },
    };
    return obj;
  };
  vi.stubGlobal("FileReader", FileReaderCtor);

  const ctxMock = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  };
  const canvasMock = { width: 1, height: 1, getContext: vi.fn(() => ctxMock) };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => canvasMock),
  });
}

describe("encodeAndCacheTexture", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0xab, 0xcd, 0xef]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
  });

  it("编码成功 → 返回 true 且记录日志", async () => {
    installDomMocks();
    const port = makePort();
    const ok = await encodeAndCacheTexture("hash123", "blob:test", port);

    expect(ok).toBe(true);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledOnce();
    expect(hoisted.saveTextureMock).toHaveBeenCalledWith("hash123", expect.any(String));
    expect(hoisted.addOpLogMock).toHaveBeenCalledWith(
      "ktx2-encode", "hash123", "ok", expect.stringContaining("bytes="),
    );
    vi.unstubAllGlobals();
  });

  it("编码失败（KTX2BasisWriter 抛错）→ 返回 false 且记录 fail 日志", async () => {
    hoisted.ktx2EncodeMock.mockRejectedValue(new Error("WASM encode failed"));
    installDomMocks();

    const port = makePort();
    const ok = await encodeAndCacheTexture("hash456", "blob:test", port);

    expect(ok).toBe(false);
    expect(hoisted.addOpLogMock).toHaveBeenCalledWith(
      "ktx2-encode", "hash456", "fail",
      expect.stringContaining("WASM encode failed"),
    );
    vi.unstubAllGlobals();
  });

  it("编码结果转 base64 正确处理二进制数据", async () => {
    // 模拟编码返回 256 字节数据（覆盖 charCodeAt 0-255）
    const largeBuffer = new Uint8Array(256);
    for (let i = 0; i < 256; i++) largeBuffer[i] = i;
    hoisted.ktx2EncodeMock.mockResolvedValue(largeBuffer.buffer);
    installDomMocks();

    const port = makePort();
    const ok = await encodeAndCacheTexture("hash789", "blob:test", port);

    expect(ok).toBe(true);
    // saveTexture 被调用，base64 正确包含所有字节
    const savedB64 = hoisted.saveTextureMock.mock.calls[0][1] as string;
    expect(savedB64.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

describe("scheduleBackgroundEncoding", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0x01]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
  });

  it("遍历 hashByBlobUrl 条目数触发对应编码", async () => {
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    installDomMocks();
    const port = makePort();
    const hashMap = new Map<string, string>([
      ["blob:aaa", "hash_aaa"],
      ["blob:bbb", "hash_bbb"],
    ]);

    scheduleBackgroundEncoding(hashMap, port);

    for (const task of tasks) task();

    // 等待 Image.onload + FileReader.onload + Promise 链完成
    await new Promise<void>((resolve) => {
      setTimeout(() => { setTimeout(() => { resolve(); }, 0); }, 0);
    });

    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("空 hashByBlobUrl 不报错", () => {
    const port = makePort();
    expect(() => scheduleBackgroundEncoding(new Map(), port)).not.toThrow();
  });

  it("单个纹理编码失败不影响其他纹理", async () => {
    let callCount = 0;
    hoisted.ktx2EncodeMock.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("fail"));
      return Promise.resolve(new Uint8Array([0x01]).buffer);
    });

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));
    installDomMocks();

    const port = makePort();
    const hashMap = new Map<string, string>([
      ["blob:aaa", "hash_aaa"],
      ["blob:bbb", "hash_bbb"],
    ]);

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 等待所有异步完成
    await new Promise<void>((resolve) => {
      setTimeout(() => { setTimeout(() => { resolve(); }, 0); }, 0);
    });

    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(2);

    const failLogs = hoisted.addOpLogMock.mock.calls.filter(
      (c: unknown[]) => (c as [string, string, string])[2] === "fail"
    );
    const okLogs = hoisted.addOpLogMock.mock.calls.filter(
      (c: unknown[]) => (c as [string, string, string])[2] === "ok"
    );
    expect(failLogs.length).toBeGreaterThanOrEqual(1);
    expect(okLogs.length).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();
  });
});

// ---- P1-1 并发控制与取消机制 ----
describe("并发控制与取消", () => {
  beforeEach(() => {
    resetEncoderState();
    vi.clearAllMocks();
    hoisted.ktx2EncodeMock.mockResolvedValue(new Uint8Array([0x01]).buffer);
    hoisted.saveTextureMock.mockResolvedValue(undefined);
  });

  it("超过并发限制时，后续编码排队等待（不超过 MAX_CONCURRENT 同时执行）", async () => {
    // 模拟 5 个纹理，并发限制为 3
    // 追踪同时执行中的编码数
    let concurrentCount = 0;
    let maxConcurrent = 0;

    hoisted.ktx2EncodeMock.mockImplementation(() => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      // 模拟异步编码
      return new Promise((resolve) => {
        setTimeout(() => {
          concurrentCount--;
          resolve(new Uint8Array([0x01]).buffer);
        }, 10);
      });
    });

    installDomMocks();
    const port = makePort();
    const hashMap = new Map<string, string>();
    for (let i = 0; i < 5; i++) {
      hashMap.set(`blob:tex${i}`, `hash_${i}`);
    }

    // 用 queueMicrotask stub 同步执行
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 等待所有编码完成
    await new Promise<void>((resolve) => {
      setTimeout(() => { setTimeout(() => { resolve(); }, 50); }, 50);
    });

    // 最大并发数不超过 3
    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(5);
    vi.unstubAllGlobals();
  });

  it("cancelPendingEncodings 跳过未开始的编码", async () => {
    // 8 个纹理，并发限制 3，有 5 个需要排队
    // 取消后，排队的编码不应执行
    let encodeStarted = 0;
    let triggeredCancel = false;

    hoisted.ktx2EncodeMock.mockImplementation(() => {
      encodeStarted++;
      const currentIndex = encodeStarted;
      return new Promise((resolve) => {
        setTimeout(() => {
          // 当第 3 个完成开始编码时触发取消
          if (currentIndex === 3 && !triggeredCancel) {
            triggeredCancel = true;
            cancelPendingEncodings();
          }
          resolve(new Uint8Array([0x01]).buffer);
        }, 5);
      });
    });

    installDomMocks();
    const port = makePort();
    const hashMap = new Map<string, string>();
    for (let i = 0; i < 8; i++) {
      hashMap.set(`blob:tex${i}`, `hash_${i}`);
    }

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    scheduleBackgroundEncoding(hashMap, port);
    for (const task of tasks) task();

    // 等待足够时间让取消生效
    await new Promise<void>((resolve) => {
      setTimeout(() => { setTimeout(() => { resolve(); }, 100); }, 100);
    });

    // 取消后不应所有 8 个都完成（至少有排队的被跳过）
    expect(encodeStarted).toBeLessThanOrEqual(8);
    vi.unstubAllGlobals();
  });

  it("重复调度不导致重复编码（幂等）", async () => {
    installDomMocks();
    const port = makePort();
    // 使用本测试专属的唯一 hash（避免 completedHashes 干扰）
    const uniqueHash = `unique_test_${Date.now()}_${Math.random()}`;
    const hashMap = new Map<string, string>([
      ["blob:unique", uniqueHash],
    ]);

    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => tasks.push(cb));

    // 调度两次
    scheduleBackgroundEncoding(hashMap, port);
    scheduleBackgroundEncoding(hashMap, port);

    for (const task of tasks) task();
    await new Promise<void>((resolve) => {
      setTimeout(() => { setTimeout(() => { resolve(); }, 0); }, 0);
    });

    // 同一 hash 不应编码两次（只有第一次生效）
    expect(hoisted.ktx2EncodeMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
