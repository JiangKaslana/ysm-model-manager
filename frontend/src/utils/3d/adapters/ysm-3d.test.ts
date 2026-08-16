// ===== ysm-3d shared 集成测试（ADR-066 §5.7）=====
// buildYsmScene：loader(path) → preloadModel → buildYsmObject 挂 ctx.scene →
// 底部导航出现 → dispose 清理。装配级测试（mock 内容构建/相机/射线，
// 导航 DOM 走真实 buildYsmBottomNav）；skeleton.test.ts 已 mock ysm-3d 编排层。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildYsmScene, makeYsmAdapter } from "./ysm-adapter.ts";
import type { BedrockGeometry } from "../../../views/app-preview/geometry.ts";
import { buildYsmBottomNav } from "../../../views/app-preview/ysm-controls.ts";

const mocks = vi.hoisted(() => ({
  preloadModel: vi.fn(),
  buildYsmObject: vi.fn(),
  fitCameraToScene: vi.fn(),
  registerBoneRaycast: vi.fn(() => vi.fn()),
}));

// ADR-072 根治：preload 与 navBuilder 由视图壳注入（adapter 0 views import），
// 测试直接注入 mock preload + 真实 buildYsmBottomNav（导航 DOM 走真实）
vi.mock("../ysm-object.ts", () => ({ buildYsmObject: mocks.buildYsmObject }));
vi.mock("../camera-setup.ts", () => ({ fitCameraToScene: mocks.fitCameraToScene }));
vi.mock("../bone-raycast.ts", () => ({
  buildBoneHierarchy: () => ({ nameMap: new Map(), parentMap: new Map(), childrenMap: new Map() }),
  registerBoneRaycast: mocks.registerBoneRaycast,
}));

const rootGroup = { type: "Group", children: [] as unknown[] };
const boneGroupMap = new Map();
const modelGroups: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildYsmObject.mockReturnValue({
    rootGroup,
    boneGroupMap,
    modelGroups,
    showModelGroup: vi.fn(),
    getModelGroupCount: () => 1,
    setBoneVisible: vi.fn(),
    toggleBone: vi.fn(),
    getBoneList: () => [],
    removeFromScene: vi.fn(),
  });
  mocks.fitCameraToScene.mockImplementation(() => {});
  mocks.preloadModel.mockResolvedValue({
    texArr: [],
    spec: { models: [{ bones: [], textureWidth: 64, textureHeight: 32 }] },
  });
  document.body.innerHTML = "";
});

function makeCtx() {
  const scene = { add: vi.fn(), remove: vi.fn() } as unknown as import("three").Scene;
  const camera = {
    position: { clone: () => ({ copy: vi.fn() }), set: vi.fn() },
    lookAt: vi.fn(),
  } as unknown as import("three").PerspectiveCamera;
  const controls = {
    target: { clone: () => ({ copy: vi.fn() }), set: vi.fn(), copy: vi.fn() },
    update: vi.fn(),
  } as never;
  const renderer = { domElement: document.createElement("div") } as unknown as import("three").WebGLRenderer;
  const overlay = document.createElement("div");
  document.body.appendChild(overlay);
  return {
    scene,
    camera,
    controls,
    renderer,
    viewContainer: document.createElement("div"),
    loadingEl: document.createElement("div"),
    overlay,
  };
}

describe("buildYsmScene（shared 装配）", () => {
  it("loader(path) → model → buildYsmObject 挂 ctx.scene + 底部导航出现", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(
      ctx,
      "/m/a.ysm",
      { loader, preload: mocks.preloadModel, navBuilder: buildYsmBottomNav },
    );

    expect(loader).toHaveBeenCalledWith("/m/a.ysm");
    expect(mocks.preloadModel).toHaveBeenCalledTimes(1);
    expect(mocks.buildYsmObject).toHaveBeenCalledTimes(1);
    expect(ctx.scene.add).toHaveBeenCalledWith(rootGroup);
    // §5.7 底部悬浮导航（模型/视图弹窗入口）
    expect(ctx.overlay.querySelector(".ysm-3d-nav")).toBeTruthy();
    expect(ctx.overlay.querySelectorAll(".ysm-3d-navbtn").length).toBeGreaterThanOrEqual(2);

    preview.dispose();
    expect(mocks.buildYsmObject().removeFromScene).toHaveBeenCalledWith(ctx.scene);
  });

  it("loader 返回空 → 抛错（不挂 scene、不建导航）", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => null);
    await expect(buildYsmScene(ctx, "/m/missing.ysm", { loader, preload: mocks.preloadModel, navBuilder: buildYsmBottomNav })).rejects.toThrow(/加载失败/);
    expect(ctx.scene.add).not.toHaveBeenCalled();
  });

  it("dispose → raycast cleanup + removeFromScene", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", { loader, preload: mocks.preloadModel, navBuilder: buildYsmBottomNav });
    preview.dispose();
    expect(mocks.registerBoneRaycast).toHaveBeenCalled();
  });

  it("makeYsmAdapter：build 用传入 path（switchTo 换模型语义，闭包 path 仅初始值）", async () => {
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const adapter = makeYsmAdapter("/m/a.ysm", { loader, preload: mocks.preloadModel, navBuilder: buildYsmBottomNav });
    expect(adapter.id).toBe("ysm");
    // switchTo 语义：core 调 build(ctx, newPath) 重建内容层——必须加载 newPath 而非闭包旧 path
    await expect(
      adapter.build(makeCtx() as never, "/m/b.ysm"),
    ).resolves.toBeTruthy();
    expect(loader).toHaveBeenCalledWith("/m/b.ysm");
  });
});
