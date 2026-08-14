// @vitest-environment node
// ===== WASM 解码层测试（并发去重守卫）=====
// decodeYsmViaWasm 必须对同一路径并发去重：preloadModel 并行触发
// （纹理 + Android spec 兜底）时只解码一次，否则 atob/解析双份、WASM 状态竞争。
// 注意：cache.ts 为模块级持久 Map（无 clear API），各用例用不同路径隔离。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeYsmViaWasm } from "./wasm.ts";

const { initMock, decodeMemoryMock, readFileBytesMock, memfsMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(true),
  decodeMemoryMock: vi.fn(),
  readFileBytesMock: vi.fn(),
  memfsMock: vi.fn(),
}));

vi.mock("../../wasm/ysm-parser.ts", () => ({
  initYSMParser: initMock,
  decodeYsmFileFromMemory: decodeMemoryMock,
  decodeYsmFile: memfsMock,
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ ReadFileBytes: readFileBytesMock }),
}));

// 有效 base64（空文件解码也会被内部字节长度守卫拦截；此处用最小非空）
const FAKE_B64 = "AQID"; // 3 bytes

/** 构造一个可被 parseBedrockGeometryFromJSON 解析的 main.json */
const MAIN_JSON = JSON.stringify({
  format_version: "1.16.0",
  "minecraft:geometry": [
    {
      description: { identifier: "geometry.test" },
      bones: [
        { name: "root", cubes: [{ origin: [0, 0, 0], size: [1, 1, 1] }] },
      ],
    },
  ],
});

/** 构造可被 parseYsmJsonDirect 引导 + parseBedrockGeometryFromJSON 解析的输出文件 */
function fakeDecodedFiles() {
  const encoder = new TextEncoder();
  const ysmJson = {
    spec: {},
    files: {
      player: { model: "models/main.json", texture: "textures/body.png" },
    },
    metadata: { authors: [] },
    properties: { texture_width: 64, texture_height: 64, default_texture: "textures/body.png" },
    minecraft: { geometry: [] },
  };
  return [
    { path: "ysm.json", data: encoder.encode(JSON.stringify(ysmJson)) },
    { path: "models/main.json", data: encoder.encode(MAIN_JSON) },
    { path: "textures/body.png", data: encoder.encode("PNGDATA") },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 无 URL.createObjectURL 实现（生产浏览器有）——补 mock 防纹理提取抛错
  URL.createObjectURL = URL.createObjectURL || (() => "blob:mock");
  URL.revokeObjectURL = URL.revokeObjectURL || (() => {});
  readFileBytesMock.mockResolvedValue(FAKE_B64);
  decodeMemoryMock.mockResolvedValue(fakeDecodedFiles());
  memfsMock.mockResolvedValue([]); // 默认无 MEMFS 输出（快路径成功时不触发）
});

describe("decodeYsmViaWasm 并发去重", () => {
  it("同一路径并发调用只读文件/解码一次，返回同一结果", async () => {
    const [a, b] = await Promise.all([
      decodeYsmViaWasm("/repo/a.ysm"),
      decodeYsmViaWasm("/repo/a.ysm"),
    ]);
    expect(readFileBytesMock).toHaveBeenCalledTimes(1); // 去重：只读一次
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1); // 去重：只解码一次
    expect(a?.geometryRaw).toBeTruthy();
    expect(b?.geometryRaw).toBeTruthy();
    expect(a).toBe(b); // 共享同一结果
  });

  it("不同路径各自解码", async () => {
    await Promise.all([
      decodeYsmViaWasm("/repo/b.ysm"),
      decodeYsmViaWasm("/repo/c.ysm"),
    ]);
    expect(readFileBytesMock).toHaveBeenCalledTimes(2);
    expect(decodeMemoryMock).toHaveBeenCalledTimes(2);
  });

  it("解码失败缓存 _wasmFailed：同一路径不再重读（in-flight 已清）", async () => {
    decodeMemoryMock.mockRejectedValueOnce(new Error("wasm boom"));
    const first = await decodeYsmViaWasm("/repo/d.ysm");
    expect(first).toBeNull();
    // 失败已缓存 _wasmFailed：第二次直接命中缓存，不再读文件/解码
    const second = await decodeYsmViaWasm("/repo/d.ysm");
    expect(second).toBeNull();
    expect(readFileBytesMock).toHaveBeenCalledTimes(1);
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1);
  });

  it("3 次同路径并发合并：只解码一次，三者引用相等", async () => {
    // 3+ 次并发是 preloadModel + 纹理 + Android spec 兜底的真实并发强度，
    // 去重 Map 必须合并所有在途调用（而非仅首个），否则第 3 次会重复解码
    const [a, b, c] = await Promise.all([
      decodeYsmViaWasm("/repo/e.ysm"),
      decodeYsmViaWasm("/repo/e.ysm"),
      decodeYsmViaWasm("/repo/e.ysm"),
    ]);
    expect(readFileBytesMock).toHaveBeenCalledTimes(1);
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c); // 共享同一结果对象
  });

  it("缓存命中 geometry 快路径：不再读文件/解码", async () => {
    // 首次解码成功后缓存含 geometry.bones，二次调用走 L51 快路径直接返回缓存
    const first = await decodeYsmViaWasm("/repo/f.ysm");
    expect(first?.geometryRaw).toBeTruthy();
    const calls0 = readFileBytesMock.mock.calls.length;
    const decodes0 = decodeMemoryMock.mock.calls.length;
    // 二次走快路径：断言不重读/重解码（核心目的），且结果几何一致
    const second = await decodeYsmViaWasm("/repo/f.ysm");
    expect(second?.geometryRaw).toBe(first?.geometryRaw);
    expect(readFileBytesMock.mock.calls.length).toBe(calls0); // 不重读
    expect(decodeMemoryMock.mock.calls.length).toBe(decodes0); // 不重解码
  });

  it("原始字节解码抛 abort 后回退 MEMFS 成功（硬崩溃不阻断回退链）", async () => {
    // 模拟 WASM 硬崩溃（abort/trap）：decodeYsmFileFromMemory reject，
    // wasm.ts 的 catch 不静默吞错且不中断——继续走 MEMFS 回退路径。
    // ysm-parser 内部的 resetYSMParser 由单例 mock 替身，此处只验 wasm.ts 层行为：
    // 崩溃信号被吞后 MEMFS 仍能产出有效结果（非 null）。
    decodeMemoryMock.mockRejectedValueOnce(new Error("abort"));
    memfsMock.mockResolvedValueOnce(fakeDecodedFiles());
    const result = await decodeYsmViaWasm("/repo/g.ysm");
    expect(result?.geometryRaw).toBeTruthy(); // MEMFS 回退成功输出几何
    expect(decodeMemoryMock).toHaveBeenCalledTimes(1); // 快路径崩溃一次
    expect(memfsMock).toHaveBeenCalledTimes(1); // 回退链触发 MEMFS
  });
});
