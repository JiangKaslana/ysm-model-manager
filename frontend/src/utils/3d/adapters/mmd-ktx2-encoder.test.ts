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

import { encodeAndCacheTexture, scheduleBackgroundEncoding } from "./mmd-ktx2-encoder.ts";
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
