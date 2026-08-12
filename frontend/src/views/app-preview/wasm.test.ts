// @vitest-environment node
// ===== WASM 解码层测试（并发去重守卫）=====
// decodeYsmViaWasm 必须对同一路径并发去重：preloadModel 并行触发
// （纹理 + Android spec 兜底）时只解码一次，否则 atob/解析双份、WASM 状态竞争。
// 注意：cache.ts 为模块级持久 Map（无 clear API），各用例用不同路径隔离。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeYsmViaWasm } from "./wasm.ts";

const { initMock, decodeMemoryMock, readFileBytesMock } = vi.hoisted(() => ({
  initMock: vi.fn().mockResolvedValue(true),
  decodeMemoryMock: vi.fn(),
  readFileBytesMock: vi.fn(),
}));

vi.mock("../../wasm/ysm-parser.ts", () => ({
  initYSMParser: initMock,
  decodeYsmFileFromMemory: decodeMemoryMock,
  decodeYsmFile: vi.fn(),
}));

vi.mock("../../wails/app.ts", () => ({
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
});
