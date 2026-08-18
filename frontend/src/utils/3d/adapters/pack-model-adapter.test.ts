// ===== 资源包模型适配器测试 =====
// 覆盖：buildPackScene 主路径、tint 渲染、错误路径、GPU 释放。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

const hoisted = vi.hoisted(() => ({
  parseMock: vi.fn(),
  renderable: vi.fn(() => true),
}));

vi.mock("../screenshot.ts", () => ({
  screenshotFromRenderer: vi.fn(() => Promise.resolve("screenshot-url")),
}));
vi.mock("../texture-cache.ts", () => ({
  textureCache: {
    acquire: vi.fn((u: string, f: (u: string) => THREE.Texture) => {
      const img = new Image(); img.src = u;
      return new THREE.Texture(img);
    }),
    release: vi.fn(),
  },
}));
vi.mock("../parse-java-model.ts", () => ({
  parseJavaModel: hoisted.parseMock,
  isRenderableModel: hoisted.renderable,
}));
vi.mock("../mc-tints.ts", () => ({
  loadMcTints: vi.fn(() => Promise.resolve()),
  getTintColorSync: vi.fn(() => 0x4a9d2b),
}));

import { buildPackScene, makePackAdapter, type PackDeps } from "./pack-model-adapter.ts";

/** 构造假 Java 模型 */
function makeJavaModel(overrides: Partial<{
  faces: Array<{
    dir: string;
    verts: number[];
    uv: number[];
    texEntry: string | null;
    tintindex: number | null;
    texColor: string | null;
    cullface: string;
  }>;
}> = {}) {
  return {
    version: 1,
    display: { rotation: { x: 0, y: 0, z: 0 }, translation: [0, 0, 0] },
    elements: [],
    groups: {},
    texture_size: [64, 64],
    textures: {},
    faces: [
      { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/dirt.png", tintindex: null, texColor: null, cullface: "north" },
      { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/dirt.png", tintindex: null, texColor: null, cullface: "south" },
    ],
    ...overrides,
  };
}

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return {
    scene, camera,
    controls: { target: new THREE.Vector3(), minDistance: 0, maxDistance: 0, update: vi.fn() },
    viewContainer: document.createElement("div"),
    loadingEl: document.createElement("div"),
    overlay: document.createElement("div"),
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn(), dispose: vi.fn() },
    renderer: { domElement: document.createElement("div") },
    cameraControls: { setOrbit: vi.fn(), setSpeed: vi.fn() },
  } as unknown as PreviewBuildCtx;
}

function makeDeps(overrides: Partial<PackDeps> = {}): PackDeps {
  return { readEntry: vi.fn(() => Promise.resolve(btoa("DIRT_TEX"))), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.parseMock.mockResolvedValue(makeJavaModel());
  hoisted.renderable.mockReturnValue(true);
});

describe("buildPackScene 主路径", () => {
  it("解析模型 → 合并面 → 挂场景 + 取景", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "assets/minecraft/models/block/dirt.json", deps, "/packs/dirt.zip");

    expect(hoisted.parseMock).toHaveBeenCalledWith(
      "assets/minecraft/models/block/dirt.json", expect.any(Function),
    );
    expect(deps.readEntry).toHaveBeenCalledWith("/packs/dirt.zip", "textures/block/dirt.png");
    expect(ctx.scene.children.length).toBeGreaterThan(0);
    expect(ctx.camera.near).toBe(0.05);
    preview.dispose!();
  });

  it("多面同材质 → 合并为单一 BufferGeometry", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [
        { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t.png", tintindex: null, texColor: null, cullface: "north" },
        { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t.png", tintindex: null, texColor: null, cullface: "south" },
        { dir: "up", verts: [0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t.png", tintindex: null, texColor: null, cullface: "up" },
      ],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    // group 是 scene 的第一个孩子，Mesh 在 group.children 里
    const group = ctx.scene.children[0] as THREE.Group;
    const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBe(1);
    const positions = (meshes[0] as THREE.Mesh).geometry.attributes.position.array as Float32Array;
    expect(positions.length).toBe(12 * 3);
    preview.dispose!();
  });
});

describe("tint 渲染", () => {
  it("face.tintindex → 取 MC biome 色", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [{ dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: null, tintindex: 0, texColor: null, cullface: "north" }],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "grass.json", deps, "/packs.zip");
    expect(deps.readEntry).not.toHaveBeenCalled();
    preview.dispose!();
  });

  it("face.texColor → 直接使用颜色值", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [{ dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: null, tintindex: null, texColor: "#ff0000", cullface: "north" }],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "wool.json", deps, "/packs.zip");
    expect(deps.readEntry).not.toHaveBeenCalled();
    preview.dispose!();
  });
});

describe("错误路径", () => {
  it("parseJavaModel 抛错 → 抛错 + loadingEl 移除", async () => {
    hoisted.parseMock.mockRejectedValue(new Error("parse fail"));
    const deps = makeDeps();
    const ctx = makeCtx();
    await expect(buildPackScene(ctx, "bad.json", deps, "/packs.zip")).rejects.toThrow("资源包内模型解析失败");
    expect(ctx.loadingEl.parentNode).toBeNull();
  });

  it("isRenderableModel 返回 false → 抛错", async () => {
    hoisted.renderable.mockReturnValue(false);
    const deps = makeDeps();
    const ctx = makeCtx();
    await expect(buildPackScene(ctx, "empty.json", deps, "/packs.zip")).rejects.toThrow("无完整纹理引用");
  });

  it("ctx.scene 缺失 → 抛错", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    (ctx.scene as unknown) = null;
    await expect(buildPackScene(ctx as never, "test.json", deps, "/packs.zip")).rejects.toThrow("shared 模式需要核心提供");
  });
});

describe("GPU 释放", () => {
  it("dispose → 移除 group", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    const group = ctx.scene.children[0];
    preview.dispose!();
    expect(ctx.scene.children).not.toContain(group);
  });
});

describe("makePackAdapter", () => {
  it("build 用传入的 buildPath", async () => {
    const deps = makeDeps();
    const adapter = makePackAdapter(deps, "/packs/dirt.zip");
    expect(adapter.id).toBe("resourcepack");
    await adapter.build(makeCtx(), "assets/minecraft/models/block/dirt.json");
    expect(hoisted.parseMock).toHaveBeenCalledWith("assets/minecraft/models/block/dirt.json", expect.any(Function));
    await adapter.build(makeCtx(), "assets/minecraft/models/block/grass.json");
    expect(hoisted.parseMock).toHaveBeenCalledWith("assets/minecraft/models/block/grass.json", expect.any(Function));
  });
});