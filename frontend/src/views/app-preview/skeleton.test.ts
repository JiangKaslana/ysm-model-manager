// ===== 2D 骨骼渲染层测试 =====
// 覆盖 loadModel2D：
//  - 无容器/无 bones/loadModelData 抛错 → 兜底不炸
//  - 成功路径：canvas + 统计卡片 + 作者区 + 骨骼名开关持久化
//  - 交互：拖拽旋转 / 滚轮缩放 / 2D 渲染异常捕获
//  - 导出骨骼名按钮 → Blob URL
//  - 3D 切换：overlay 创建 + preloadModel/renderModel3D 调用 + close3D 清理
//  - 3D 加载失败 → error toast
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "../../test-utils/index.ts";

const {
  getPrefer3D,
  setPrefer3D,
  loadModelData,
  renderModel2D,
  openFullPreview,
  getApp,
  busEmit,
  friendlyError,
  statsCardHTML,
  buildBoneNamesText,
  screenshotPreview,
  renderModel3D,
  renderMultiAngle,
  preloadModel,
} = vi.hoisted(() => ({
  getPrefer3D: vi.fn(() => false),
  setPrefer3D: vi.fn(),
  loadModelData: vi.fn(),
  renderModel2D: vi.fn(),
  openFullPreview: vi.fn(),
  getApp: vi.fn(),
  busEmit: vi.fn(),
  friendlyError: vi.fn((e: unknown) => `友好:${String((e as Error)?.message ?? e)}`),
  statsCardHTML: vi.fn(() => "<div>stats-card</div>"),
  buildBoneNamesText: vi.fn(() => ["root", "head"]),
  screenshotPreview: vi.fn(() => "b64data"),
  renderModel3D: vi.fn(),
  renderMultiAngle: vi.fn(),
  preloadModel: vi.fn(),
}));

vi.mock("./utils.ts", () => ({ getPrefer3D, setPrefer3D }));
// t 返回 key（skeleton 用 t("preview.*")，语言包无该命名空间时真实 t 也返回 key）
vi.mock("../../core/i18n/t.ts", () => ({
  t: (key: string) => key,
}));
vi.mock("./loader.ts", () => ({ loadModelData }));
vi.mock("../../utils/3d/model2d.ts", () => ({ renderModel2D }));
vi.mock("./zoom.ts", () => ({ openFullPreview }));
vi.mock("../../backend/app.ts", () => ({ getApp }));
vi.mock("../../bus.ts", () => ({ bus: { emit: busEmit } }));
vi.mock("../../utils/dom/errors.ts", () => ({ friendlyError }));
vi.mock("./tpl.ts", () => ({ statsCardHTML }));
vi.mock("./bone-names.ts", () => ({ buildBoneNamesText }));
vi.mock("../../utils/3d/model3d.ts", () => ({
  screenshotPreview,
  renderModel3D,
}));
vi.mock("./screenshot-renderer.ts", () => ({ renderMultiAngle }));
vi.mock("./model3d-loader.ts", () => ({ preloadModel }));

import { loadModel2D } from "./skeleton.ts";
import { fill3DPanel } from "./skeleton-render.ts";

/** 可控 Image：src setter 同步 onload（happy-dom 无真实网络） */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 32;
  _src = "";
  set src(u: string) {
    this._src = u;
    this.onload?.();
  }
  get src(): string {
    return this._src;
  }
}

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    bones: [{ id: "root", name: "根", parentId: null }],
    boneCount: 1,
    texture: "tex.png",
    textures: ["tex.png"],
    textureNames: ["tex.png"],
    _modelPath: "/m/a.ysm",
    _authors: [{ name: "作者A", role: "建模" }],
    ...overrides,
  };
}

function makeCtx() {
  const root = document.createElement("div");
  root.innerHTML = `<div id="preview-content"></div><button id="btn-3d-preview"></button><div id="ysm-author-avatars"></div>`;
  // PreviewCtx.root 需提供 getElementById（真实为组件宿主）
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  const ctx = {
    root: root as unknown as ShadowRoot,
    appendDebug: vi.fn(),
    decodeYsmViaWasm: vi.fn(() => Promise.resolve(null)),
    loadPreviewImage: vi.fn(() => Promise.resolve(null)),
    unsubs: [] as Array<() => void>,
  };
  return ctx;
}

function make3DHandle() {
  return {
    cleanup: vi.fn(),
    dispose: vi.fn(),
    screenshot: vi.fn(() => null),
    resetCamera: vi.fn(),
    onBoneSelect: null as null | ((info: unknown) => void),
    getModelGroupCount: vi.fn(() => 1),
    getBoneList: vi.fn(() => []),
    setBoneVisible: vi.fn(),
    toggleBone: vi.fn(),
    setDebugMode: vi.fn(),
    setRotationMode: vi.fn(),
    setSpeed: vi.fn(),
    showModelGroup: vi.fn(),
    _timeTimer: undefined as undefined | ReturnType<typeof setInterval>,
    _keyHandler: null as null | ((e: KeyboardEvent) => void),
    _boneDetailEl: null as null | HTMLElement,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  renderModel2D.mockReset(); // 清 mockImplementation 防跨测试泄漏
  localStorage.clear();
  document.body.innerHTML = "";
  getPrefer3D.mockReturnValue(false);
  loadModelData.mockResolvedValue({ model: makeModel(), decodedBy: "go" });
  getApp.mockResolvedValue({ SaveScreenshotFile: vi.fn() });
  vi.stubGlobal("Image", FakeImage as never);
  vi.stubGlobal(
    "URL",
    Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals(); // 还原 stubGlobal 的 Image/URL，防跨文件泄漏
});

describe("loadModel2D — 防御路径", () => {
  it("无容器且 root 无 preview-content → 静默返回", async () => {
    const ctx = makeCtx();
    ctx.root.innerHTML = "";
    await loadModel2D(ctx, "/m/a.ysm", null);
    expect(loadModelData).not.toHaveBeenCalled();
  });

  it("loadModelData 抛错 → 解析失败提示（不向外抛）", async () => {
    loadModelData.mockRejectedValue(new Error("boom"));
    const ctx = makeCtx();
    const container = document.createElement("div");
    await loadModel2D(ctx, "/m/a.ysm", container);
    expect(container.querySelector(".ysm-error-title")).toBeTruthy();
    expect(container.textContent).toContain("boom");
  });

  it("model 无 bones → 未找到几何数据提示", async () => {
    loadModelData.mockResolvedValue({ model: { bones: [] }, decodedBy: "go" });
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    expect(container.textContent).toContain("noGeometry");
  });

  it("P1 守卫：容器被移除（切页重建）后迟到的渲染不再写 ctx.root（防跨文件污染）", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let resolveData: (v: unknown) => void = () => {};
    loadModelData.mockReturnValue(
      new Promise((r) => {
        resolveData = r;
      }),
    );
    const p = loadModel2D(ctx, "/m/a.ysm", container);
    // 模拟用户切到 B：showModelDetail 重建 ctx.root.innerHTML，A 的 container 被移除
    ctx.root.innerHTML = `<div id="preview-content"></div><button id="btn-3d-preview"></button><div id="ysm-author-avatars"></div>`;
    container.remove();
    resolveData({ model: makeModel(), decodedBy: "go" });
    await p;
    // A 不再把作者头像写进 B 的详情页、不再把 _toggle3D 绑到 B 的按钮
    const avatars = ctx.root.querySelector("#ysm-author-avatars") as HTMLElement;
    expect(avatars.innerHTML).not.toContain("作者A");
    const btn3d = ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement;
    expect(btn3d.onclick).toBeNull();
  });
});

describe("loadModel2D — 2D 成功路径", () => {
  it("创建 canvas + 统计卡片 + 作者区 + 渲染骨骼图", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await loadModel2D(ctx, "/m/a.ysm", container);

    expect(container.querySelector(".ysm-canvas")).toBeTruthy();
    expect(statsCardHTML).toHaveBeenCalledWith(
      expect.objectContaining({ bones: expect.any(Array) }),
      "/m/a.ysm",
      "go",
    );
    expect(container.textContent).toContain("作者A");
    expect(renderModel2D).toHaveBeenCalledTimes(1);
    expect(renderModel2D).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.anything(),
      expect.any(FakeImage),
      expect.objectContaining({ showLabels: true, zoom: 1, rotation: 0 }),
    );
  });

  it("作者区同步填充详情页头像容器", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const avatars = ctx.root.querySelector("#ysm-author-avatars") as HTMLElement;
    expect(avatars.innerHTML).toContain("作者A");
  });

  it("骨骼名开关：点击 → localStorage 持久化 + 重渲染", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const eyeBtn = container.querySelector("button") as HTMLButtonElement;
    expect(eyeBtn.textContent).toContain("preview.boneLabels");

    eyeBtn.click();
    expect(localStorage.getItem("ysm_showBoneLabels")).toBe("false");
    expect(renderModel2D).toHaveBeenCalledTimes(2);
    expect(renderModel2D.mock.calls[1]![3]).toMatchObject({ showLabels: false });
  });

  it("2D 渲染抛错 → console.warn 不中断（doRender 内捕获）", async () => {
    renderModel2D.mockImplementation(() => {
      throw new Error("2d boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const container = document.createElement("div");
      document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
      await loadModel2D(ctx, "/m/a.ysm", container);
      expect(warn.mock.calls[0]?.[0]).toContain("[preview] 2D 渲染跳过");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("loadModel2D — 交互", () => {
  it("拖拽旋转：pointerdown + window pointermove → 重渲染 + click 被拦截", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const canvas = container.querySelector(".ysm-canvas") as HTMLCanvasElement;
    renderModel2D.mockClear();

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 10, bubbles: true }),
    );
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 30 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(renderModel2D).toHaveBeenCalledTimes(1);
    expect(renderModel2D.mock.calls[0]![3]).toMatchObject({ rotation: 10 });
    expect(openFullPreview).not.toHaveBeenCalled();

    // 组件销毁 → window 监听器移除
    for (const fn of [...ctx.unsubs]) fn();
    renderModel2D.mockClear();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100 }));
    expect(renderModel2D).not.toHaveBeenCalled();
  });

  it("滚轮缩放：缩放有界 [0.2, 10]", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const canvas = container.querySelector(".ysm-canvas") as HTMLCanvasElement;
    renderModel2D.mockClear();

    // 缩小 5 次（deltaY 大正值 → zoom 指数衰减趋近下限）
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true }),
      );
    }
    const last = renderModel2D.mock.calls.at(-1)![3] as { zoom: number };
    expect(last.zoom).toBeGreaterThanOrEqual(0.19);
    expect(last.zoom).toBeLessThan(0.3);

    // 放大
    renderModel2D.mockClear();
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -500, bubbles: true, cancelable: true }),
      );
    }
    const zoomed = renderModel2D.mock.calls.at(-1)![3] as { zoom: number };
    expect(zoomed.zoom).toBeLessThanOrEqual(10);
    expect(zoomed.zoom).toBeGreaterThan(5);
  });

  it("导出骨骼名按钮 → buildBoneNamesText + 下载链接触发", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await loadModel2D(ctx, "/m/a.ysm", container);
    const boneBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "📋 preview.exportBones",
    )!;
    boneBtn.click();
    expect(buildBoneNamesText).toHaveBeenCalledWith(
      "/m/a.ysm",
      1,
      expect.any(Array),
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});

describe("loadModel2D — 3D 切换", () => {
  it("btn-3d-preview 点击 → overlay + preloadModel/renderModel3D + 面板统计", async () => {
    const handle = make3DHandle();
    renderModel3D.mockResolvedValue(handle);
    preloadModel.mockResolvedValue({
      texArr: [],
      spec: {
        models: [
          {
            bones: [{ _cubeCount: 2 }],
            textureWidth: 64,
            textureHeight: 32,
            name: "m0",
          },
        ],
      },
    });
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    await waitFor(() => document.getElementById("ysm-overlay-3d"));

    expect(preloadModel).toHaveBeenCalledTimes(1);
    expect(renderModel3D).toHaveBeenCalledTimes(1);
    expect(handle.cleanup).not.toHaveBeenCalled();
    const panel = document.getElementById("ysm-3d-panel") as HTMLElement;
    expect(panel.textContent).toContain("1 根");
    expect(panel.textContent).toContain("2 个");
    expect(panel.textContent).toContain("64×32");

    // close3D 已在 unsubs（组件销毁自动清理），执行后 renderer 释放 + overlay 移除
    for (const fn of [...ctx.unsubs]) fn();
    expect(handle.cleanup).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ysm-overlay-3d")).toBeNull();
  });

  it("3D 加载失败 → error toast + 错误占位", async () => {
    preloadModel.mockRejectedValue(new Error("wasm 崩了"));
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    await waitFor(() => busEmit.mock.calls.length > 0);

    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({
        msg: expect.stringContaining("wasm 崩了"),
        type: "error",
      }),
    );
    expect(friendlyError).toHaveBeenCalled();
  });

  it("3D 加载期间用户关闭（ESC）→ 立即 cleanup 防 WebGL 泄漏", async () => {
    const handle = make3DHandle();
    let resolveRender: (h: typeof handle) => void = () => {};
    renderModel3D.mockReturnValue(
      new Promise((r) => {
        resolveRender = r;
      }),
    );
    preloadModel.mockResolvedValue({ texArr: [], spec: { models: [] } });
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    // 加载未完成前先关闭（触发 close3D → _model3dGen++）
    const closeFn = ctx.unsubs.at(-1)!;
    closeFn();
    resolveRender(handle);
    await new Promise((r) => setTimeout(r, 0));

    expect(handle.cleanup).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ysm-overlay-3d")).toBeNull();
  });

  it("3D 加载期间用户关闭 → 迟到的加载失败不再弹错（gen 守卫）", async () => {
    preloadModel.mockRejectedValue(new Error("迟到的失败"));
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    // 在 preloadModel reject 之前先关闭 → _model3dGen++，使在途失败过期
    const closeFn = ctx.unsubs.at(-1)!;
    closeFn();
    await new Promise((r) => setTimeout(r, 0));

    // 修复前：关闭后仍弹「加载失败」toast；修复后：gen 不匹配 → 静默丢弃
    expect(busEmit).not.toHaveBeenCalled();
    expect(friendlyError).not.toHaveBeenCalled();
  });
});

// ── fill3DPanel（skeleton-fill-panel.ts，审核盲区补建）────────────
describe("fill3DPanel", () => {
  const makeFakeTex = (over: Record<string, unknown> = {}): unknown => ({
    userData: { imgWidth: 64, imgHeight: 32 },
    image: null, // happy-dom drawImage 不接受普通对象，置空跳过绘制分支
    ...over,
  });

  function setup(over: {
    bones?: Array<{ id: string; name: string; parentId: string | null }>;
    groupCount?: number;
    cubeCounts?: number[];
    textures?: string[] | null;
    textureNames?: string[];
  } = {}) {
    const panel = document.createElement("div");
    panel.id = "ysm-3d-panel";
    document.body.appendChild(panel);
    const model = makeModel({
      textures: over.textures ?? ["t1.png", "t2.png"],
      textureNames: over.textureNames ?? ["skin", "tail"],
    }) as unknown as Parameters<typeof fill3DPanel>[1];
    const count = over.groupCount ?? 1;
    const spec = {
      models: Array.from({ length: Math.max(count, 1) }, () => ({
        bones: (over.cubeCounts ?? [2, 3]).map((c) => ({ _cubeCount: c })),
        textureWidth: 64,
        textureHeight: 32,
      })),
    } as never;
    const handle = make3DHandle();
    handle.getModelGroupCount = vi.fn(() => count) as typeof handle.getModelGroupCount;
    handle.getBoneList = vi.fn(() => over.bones ?? []) as typeof handle.getBoneList;
    const modelSel = document.createElement("select");
    return { panel, model, handle, modelSel, spec };
  }

  it("统计 + 纹理列表 + 多组件选择器 + 骨骼列表缩进 + 详情框", () => {
    const { panel, model, handle, modelSel, spec } = setup({
      groupCount: 2,
      bones: [
        { id: "root", name: "根", parentId: null },
        { id: "arm", name: "手臂", parentId: "root" },
      ],
    });
    const texArr = [
      makeFakeTex(),
      makeFakeTex({ userData: {}, image: null }), // 无尺寸信息 → 0×0
    ] as unknown as import("three").Texture[];

    const r = fill3DPanel(panel, model, texArr, spec, handle, modelSel);

    // 统计
    expect(panel.textContent).toContain("2 根");
    expect(panel.textContent).toContain("5 个");
    expect(panel.textContent).toContain("64×32");
    // 纹理列表：名 + 尺寸（第二张无 userData → 0×0）
    expect(panel.textContent).toContain("纹理 (2)");
    expect(panel.textContent).toContain("skin");
    expect(panel.textContent).toContain("tail");
    expect(panel.textContent).toContain("64×32");
    expect(panel.textContent).toContain("0×0");
    // 多组件：选择器显示 + all 选项 + 2 个组件
    expect(modelSel.style.display).not.toBe("none");
    expect(modelSel.options.length).toBe(3);
    expect(modelSel.options[0]!.textContent).toContain("preview.allComponents");
    // 骨骼列表：根无缩进，手臂缩进 12px（depth=1）
    expect(r.boneContainer).not.toBeNull();
    const labels = r.boneContainer!.querySelectorAll("label");
    expect(labels.length).toBe(2);
    const armSpan = [...r.boneContainer!.querySelectorAll("label")]
      .find((l) => l.textContent === "手臂")!
      .querySelector("span")!;
    expect(armSpan.style.marginLeft).toBe("12px");
    // 详情框绑定
    expect(handle._boneDetailEl).toBeTruthy();
    document.body.removeChild(panel);
  });

  it("无骨骼 → boneContainer 为 null，无骨骼列表", () => {
    const { panel, model, handle, modelSel, spec } = setup();
    const r = fill3DPanel(panel, model, [], spec, handle, modelSel);
    expect(r.boneContainer).toBeNull();
    expect(panel.querySelector("input[type=checkbox]")).toBeNull();
    document.body.removeChild(panel);
  });

  it("搜索过滤：输入关键词后仅保留命中骨骼", () => {
    const { panel, model, handle, modelSel, spec } = setup({
      bones: [
        { id: "head", name: "头", parentId: null },
        { id: "arm", name: "手臂", parentId: "head" },
        { id: "leg", name: "腿", parentId: "head" },
      ],
    });
    fill3DPanel(panel, model, [], spec, handle, modelSel);
    const search = panel.querySelector('input[type="text"]') as HTMLInputElement;
    expect(search).toBeTruthy();
    search.value = "手";
    search.dispatchEvent(new Event("input"));
    const labels = panel.querySelectorAll("label");
    expect(labels.length).toBe(1);
    expect(labels[0]!.textContent).toBe("手臂");
    document.body.removeChild(panel);
  });

  it("显示/隐藏全部按钮：setBoneVisible 调用 + 复选框同步", () => {
    const { panel, model, handle, modelSel, spec } = setup({
      bones: [
        { id: "head", name: "头", parentId: null },
        { id: "arm", name: "手臂", parentId: "head" },
      ],
    });
    fill3DPanel(panel, model, [], spec, handle, modelSel);
    const btns = [...panel.querySelectorAll("button")].map((b) => b.textContent);
    // 按钮序：👁（显示全部）→ ⊘（隐藏全部）→ 详情复制
    expect(btns[0]).toBe("👁");
    expect(btns[1]).toBe("⊘");
    const hideAll = [...panel.querySelectorAll("button")].find((b) => b.textContent === "⊘")!;
    hideAll.click();
    expect(handle.setBoneVisible).toHaveBeenCalledTimes(2);
    expect(handle.setBoneVisible).toHaveBeenCalledWith("head", false);
    expect(handle.setBoneVisible).toHaveBeenCalledWith("arm", false);
    // 复选框同步为未选中
    const boxes = [...panel.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.every((c) => c.checked === false)).toBe(true);
    // 显示全部 → 复选框恢复选中
    const showAll = [...panel.querySelectorAll("button")].find((b) => b.textContent === "👁")!;
    showAll.click();
    expect(handle.setBoneVisible).toHaveBeenCalledWith("head", true);
    expect(boxes.every((c) => c.checked === true)).toBe(true);
    document.body.removeChild(panel);
  });

  it("骨骼详情复制按钮：成功 → ✅ + 2s 恢复；失败 → 直接恢复", async () => {
    const { panel, model, handle, modelSel, spec } = setup();
    fill3DPanel(panel, model, [], spec, handle, modelSel);
    const copyBtn = [...panel.querySelectorAll("button")].find(
      (b) => b.textContent === "📋 common.copy",
    )!;
    // 成功路径
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      copyBtn.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("");
      expect(copyBtn.textContent).toContain("preview.copied");
      vi.advanceTimersByTime(1500);
      expect(copyBtn.textContent).toBe("📋 common.copy");
    } finally {
      vi.useRealTimers();
    }
    document.body.removeChild(panel);
  });
});
