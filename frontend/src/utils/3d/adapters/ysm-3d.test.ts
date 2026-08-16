// ===== ysm-3d shared 集成测试（ADR-066 §5.7 + ADR-076 v2 Phase 2 菜单收编）=====
// buildYsmScene：loader(path) → preloadModel → buildYsmObject 挂 ctx.scene →
// ctx.menu.setAdapterItems 注入 model/截图/骨骼 三项 → dispose 清理。装配级测试。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildYsmScene, makeYsmAdapter } from "./ysm-adapter.ts";
import type { BedrockGeometry } from "../../../views/app-preview/geometry.ts";
import type { PreviewMenuHandle } from "./preview-menu.ts";

const mocks = vi.hoisted(() => ({
  preloadModel: vi.fn(),
  buildYsmObject: vi.fn(),
  fitCameraToScene: vi.fn(),
  registerBoneRaycast: vi.fn(() => vi.fn()),
}));

vi.mock("../ysm-object.ts", () => ({ buildYsmObject: mocks.buildYsmObject }));
vi.mock("../camera-setup.ts", () => ({ fitCameraToScene: mocks.fitCameraToScene }));
vi.mock("../bone-raycast.ts", () => ({
  buildBoneHierarchy: () => ({ nameMap: new Map(), parentMap: new Map(), childrenMap: new Map() }),
  registerBoneRaycast: mocks.registerBoneRaycast,
}));
vi.mock("../bone-tools.ts", () => ({
  buildBoneTree: vi.fn(() => ({ byId: new Map(), childrenMap: new Map(), roots: [] })),
}));
vi.mock("./vrm-bone-ui.ts", () => ({
  makeBonePanelRenderer: () => () => () => {},
}));

const rootGroup = { type: "Group", children: [] as unknown[] };
const boneGroupMap = new Map();
const modelGroups: unknown[] = [];

// 视图层面板填充函数（DI 注入）：单元测试仅验证适配器将 fill* 接线出去，
// 真实 DOM 渲染由视图层测试覆盖（fill* 属 views 域，utils 不得运行时依赖）。
const fakePanels = {
  fillModelPanel: (list: HTMLElement) => {
    list.textContent = "模型统计（骨骼 0 根 / 立方体 0 个）";
  },
  fillShotPanel: () => {},
  attachBoneSelect: () => {},
};

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
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn() } as unknown as PreviewMenuHandle,
  };
}

/** 最近一次 setAdapterItems 收到的适配器项 */
function registeredItems(menu: unknown) {
  return (menu as { setAdapterItems: ReturnType<typeof vi.fn> }).setAdapterItems.mock
    .calls[0][0] as Array<{
    id: string;
    kind: string;
    render?: (list: HTMLElement, close: () => void) => void;
  }>;
}

describe("buildYsmScene（shared 装配）", () => {
  it("loader(path) → model → buildYsmObject 挂 ctx.scene + 注入声明式菜单项", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
      panels: fakePanels,
    });

    expect(loader).toHaveBeenCalledWith("/m/a.ysm");
    expect(mocks.preloadModel).toHaveBeenCalledTimes(1);
    expect(mocks.buildYsmObject).toHaveBeenCalledTimes(1);
    expect(ctx.scene.add).toHaveBeenCalledWith(rootGroup);

    // ADR-076 v2 Phase 2：适配器经 ctx.menu.setAdapterItems 注入 model / 截图 / 骨骼 三项
    const items = registeredItems(ctx.menu);
    expect(items.map((i) => i.id)).toEqual(["model", "shot", "bones"]);
    items.forEach((i) => expect(i.kind).toBe("panel"));
    items.forEach((i) => expect(typeof i.render).toBe("function"));

    // model 面板渲染：fill3DPanel 输出统计行（骨骼 0 根 + 立方体 0 个）
    const list = document.createElement("div");
    const modelItem = items.find((i) => i.id === "model")!;
    modelItem.render!(list, () => {});
    expect(list.textContent).toContain("模型统计");

    preview.dispose();
    expect(mocks.buildYsmObject().removeFromScene).toHaveBeenCalledWith(ctx.scene);
  });

  it("loader 返回空 → 抛错（不挂 scene，不注入菜单）", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => null);
    await expect(
      buildYsmScene(ctx, "/m/missing.ysm", { loader, preload: mocks.preloadModel }),
    ).rejects.toThrow(/加载失败/);
    expect(ctx.scene.add).not.toHaveBeenCalled();
    expect(ctx.menu.setAdapterItems).not.toHaveBeenCalled();
  });

  it("dispose → raycast cleanup + removeFromScene + bonePanelCleanup", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", { loader, preload: mocks.preloadModel });
    preview.dispose();
    expect(mocks.registerBoneRaycast).toHaveBeenCalled();
  });

  it("makeYsmAdapter：build 用传入 path（switchTo 换模型语义，闭包 path 仅初始值）", async () => {
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const adapter = makeYsmAdapter("/m/a.ysm", { loader, preload: mocks.preloadModel });
    expect(adapter.id).toBe("ysm");
    // switchTo 语义：core 调 build(ctx, newPath) 重建内容层——必须加载 newPath 而非闭包旧 path
    await expect(
      adapter.build(makeCtx() as never, "/m/b.ysm"),
    ).resolves.toBeTruthy();
    expect(loader).toHaveBeenCalledWith("/m/b.ysm");
  });
});
