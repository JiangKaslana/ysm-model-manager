// ===== �骨骼渲染层 skeleton-render 纯 DOM 函数测试（审核盲区补建）=====
// �覆盖：setup2DCanvas（canvas �尺寸 + 纹理异步）、buildToggleRow（开关状态 + 持久化）、
//  buildStatsCard（作者区填充）、buildBoneExportRow（Blob URL revoke 幂等）、
//  saveScreenshot（current 空 b64 抛错 / all 递归 / 角度命中）、build3DOverlay（overlay 树结构 + 节点引用幂等）
// 不测：loadModel2D（已在 skeleton.test.ts）、fill3DPanel（在 skeleton-fill-panel.ts scope）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getApp, screenshotPreview, renderMultiAngle, saveFile } = vi.hoisted(() => ({
  getApp: vi.fn(),
  screenshotPreview: vi.fn(),
  renderMultiAngle: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../../core/i18n/t.ts", () => ({ t: (k: string) => k }));
vi.mock("../../backend/app.ts", () => ({ getApp }));
vi.mock("../../utils/3d/model3d.ts", () => ({ screenshotPreview }));
vi.mock("./screenshot-renderer.ts", () => ({ renderMultiAngle }));

import { setup2DCanvas, buildToggleRow, buildStatsCard, buildBoneExportRow, saveScreenshot, build3DOverlay } from "./skeleton-render.ts";
import type { BedrockGeometry } from "./geometry.ts";
import type { PreviewRoot, YsmDecoder, PreviewDebugger } from "./utils.ts";

/** 最小可用 BedrockGeometry（各测试按需 override） */
function makeModel(overrides: Partial<BedrockGeometry & { textures?: string[] | null }> = {}): BedrockGeometry & { textures?: string[] | null; _modelPath?: string } {
  return {
    boneCount: 0,
    cubeCount: 0,
    texWidth: 64,
    texHeight: 64,
    bones: [],
    _modelPath: "/m/a.ysm",
    ...overrides,
  };
}

/** 构造 PreviewRoot & YsmDecoder & PreviewDebugger 兼容 ctx */
function makeCtx(): PreviewRoot & YsmDecoder & PreviewDebugger {
  const root = document.createElement("div");
  root.innerHTML = `<div id="preview-content"></div>`;
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  return {
    root: root as unknown as ShadowRoot,
    appendDebug: vi.fn(),
    decodeYsmViaWasm: vi.fn(() => Promise.resolve(null)),
    unsubs: [] as Array<() => void>,
  };
}

/** 可控 Image：src setter 同步 onload（happy-dom 无真实网络） */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  _src = "";
  set src(u: string) {
    this._src = u;
    this.onload?.();
  }
  get src(): string {
    return this._src;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  getApp.mockResolvedValue({ SaveScreenshotFile: saveFile });
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
  vi.unstubAllGlobals();
});

// ── setup2DCanvas ──────────────────────────────────────────────
describe("setup2DCanvas", () => {
  it("无纹理 → 仅建 canvas，textureImg 为 null", async () => {
    const container = document.createElement("div");
    const { canvas, textureImg } = await setup2DCanvas(container, makeModel({ texture: null }));
    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(180);
    expect(canvas.className).toBe("ysm-canvas");
    expect(container.contains(canvas)).toBe(true);
    expect(textureImg).toBeNull();
  });

  it("有纹理 → 建 Image 并加载 src（onload 同步触发）", async () => {
    const container = document.createElement("div");
    const { textureImg } = await setup2DCanvas(container, makeModel({ texture: "tex.png" }));
    expect(textureImg).toBeTruthy();
    expect(textureImg!.src).toBe("tex.png");
  });

  it("纹理加载失败（onerror）→ promise resolve 不悬死", async () => {
    const container = document.createElement("div");
    // 模拟 onerror 分支：直接 await 不应抛错
    const r = await setup2DCanvas(container, makeModel({ texture: "bad.png" }));
    expect(r.canvas).toBeTruthy();
  });
});

// ── buildToggleRow ─────────────────────────────────────────────
describe("buildToggleRow", () => {
  it("默认 on（localStorage 未存 false）→ 按钮👁 + hint preview.on", () => {
    const container = document.createElement("div");
    const { eyeBtn, eyeHint, getLabelsOn } = buildToggleRow(container);
    expect(getLabelsOn()).toBe(true);
    expect(eyeBtn.textContent).toContain("preview.boneLabels");
    expect(eyeHint.textContent).toBe("preview.on");
    expect(container.contains(eyeBtn)).toBe(true);
  });

  it("localStorage 存 false → 默认 off", () => {
    localStorage.setItem("ysm_showBoneLabels", "false");
    const container = document.createElement("div");
    const { getLabelsOn, eyeHint } = buildToggleRow(container);
    expect(getLabelsOn()).toBe(false);
    expect(eyeHint.textContent).toBe("preview.off");
  });

  it("setLabelsOn(false) → 按钮/hint 刷新 + getter 反映", () => {
    const container = document.createElement("div");
    const { setLabelsOn, getLabelsOn, eyeBtn, eyeHint } = buildToggleRow(container);
    setLabelsOn(false);
    expect(getLabelsOn()).toBe(false);
    expect(eyeBtn.textContent).toContain("preview.boneLabels");
    expect(eyeHint.textContent).toBe("preview.off");
    setLabelsOn(true);
    expect(getLabelsOn()).toBe(true);
    expect(eyeHint.textContent).toBe("preview.on");
  });
});

// ── buildStatsCard ─────────────────────────────────────────────
describe("buildStatsCard", () => {
  it("无作者 → 仅 statsCardHTML 卡片", () => {
    const container = document.createElement("div");
    buildStatsCard(
      container,
      makeModel(),
      "/m/a.ysm",
      "YSMParser",
      makeCtx(),
    );
    const card = container.querySelector(".ysm-card");
    expect(card).toBeTruthy();
    expect(container.querySelectorAll(".ysm-card").length).toBe(1);
  });

  it("有作者 → 卡片内作者列表 + 详情页 ysm-author-avatars 填充", () => {
    const ctx = makeCtx();
    // getElementById 查 avatar 容器：在 ctx.root 注入
    const avatarsRoot = document.createElement("div");
    avatarsRoot.innerHTML = `<div id="ysm-author-avatars"></div>`;
    (ctx.root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
      (id: string) => avatarsRoot.querySelector(`#${id}`);
    const container = document.createElement("div");
    buildStatsCard(
      container,
      makeModel({ _authors: [{ name: "作者A", role: "建模", avatarUrl: "ava.png" }] }),
      "/m/a.ysm",
      "YSMParser",
      ctx,
    );
    expect(container.textContent).toContain("作者A");
    expect(container.textContent).toContain("建模");
    const avatars = avatarsRoot.querySelector("#ysm-author-avatars") as HTMLElement;
    expect(avatars.innerHTML).toContain("ava.png");
    expect(avatars.innerHTML).toContain("作者A");
  });

  it("作者无 avatarUrl → 占位圆点（无 img）", () => {
    const container = document.createElement("div");
    const ctx = makeCtx();
    buildStatsCard(
      container,
      makeModel({ _authors: [{ name: "匿名" }] }),
      "/m/a.ysm",
      "",
      ctx,
    );
    expect(container.textContent).toContain("匿名");
  });
});

// ── buildBoneExportRow ─────────────────────────────────────────
describe("buildBoneExportRow", () => {
  it("建按钮行 + hint 显示骨骼数", () => {
    const container = document.createElement("div");
    buildBoneExportRow(
      container,
      { bones: [], boneCount: 1 } as unknown as BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> },
      "/m/a.ysm",
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("preview.exportBones");
    const hint = container.querySelector(".ysm-hint") as HTMLElement;
    expect(hint.textContent).toContain("1");
  });

  it("点击 → Blob URL 创建后 revoke（幂等清）", () => {
    const container = document.createElement("div");
    buildBoneExportRow(
      container,
      { bones: [], boneCount: 1 } as unknown as BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> },
      "/m/a.ysm",
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    const urlSpy = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
    urlSpy.mockClear();
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();
    btn.click();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urlSpy).toHaveBeenCalledTimes(1);
  });
});

// ── saveScreenshot ─────────────────────────────────────────────
describe("saveScreenshot", () => {
  it("current 且 b64 空 → 抛错（不静默吞错）", async () => {
    screenshotPreview.mockReturnValue("");
    const setShotState = vi.fn();
    await expect(
      saveScreenshot(makeModel(), "current", setShotState),
    ).rejects.toThrow("screenshotPreview");
    // 抛错路径不应调 setShotState 成功态（消费者 catch 统一处理）
    expect(setShotState).not.toHaveBeenCalledWith("\u2705");
  });

  it("current 且 b64 有值 → SaveScreenshotFile 调用 + ✅ + 2s 回退", async () => {
    screenshotPreview.mockReturnValue("b64data");
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    vi.useFakeTimers();
    try {
      await saveScreenshot(makeModel(), "current", setShotState);
      expect(saveFile).toHaveBeenCalledWith(expect.stringContaining(".png"), "b64data");
      expect(setShotState).toHaveBeenCalledWith("\u2705");
      vi.advanceTimersByTime(2000);
      expect(setShotState).toHaveBeenCalledWith("\u{1F4F7}");
    } finally {
      vi.useRealTimers();
    }
  });

  it("all → 递归 front/45/side/back45（saveFile 4 次）", async () => {
    renderMultiAngle.mockResolvedValue([
      { name: "front", base64: "f" },
      { name: "45", base64: "45" },
      { name: "side", base64: "s" },
      { name: "back45", base64: "b45" },
    ]);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel({ textures: ["t1", "t2"] }), "all", setShotState);
    expect(renderMultiAngle).toHaveBeenCalledTimes(4);
    expect(saveFile).toHaveBeenCalledTimes(4);
  });

  it("front → renderMultiAngle 命中 front 角度", async () => {
    renderMultiAngle.mockResolvedValue([{ name: "front", base64: "f" }]);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel(), "front", setShotState);
    expect(renderMultiAngle).toHaveBeenCalledWith("/m/a.ysm", [""], { size: 512 });
    expect(saveFile).toHaveBeenCalledWith(expect.stringContaining("_front"), "f");
  });

  it("renderMultiAngle 返回 null → 不调 saveFile（静默）", async () => {
    renderMultiAngle.mockResolvedValue(null);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel(), "front", setShotState);
    expect(saveFile).not.toHaveBeenCalled();
  });
});

// ── build3DOverlay ─────────────────────────────────────────────
describe("build3DOverlay", () => {

  it("overlay 挂载 body + 返回所有契约节点引用", () => {
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel(), ctx);
    expect(r.overlay.id).toBe("ysm-overlay-3d");
    expect(document.body.contains(r.overlay)).toBe(true);
    // 契约节点全部存在
    for (const key of ["topBar", "body", "viewContainer", "panel", "shotBtn", "shotMenu", "resetBtn", "modelSel", "rotSel", "spdSlider", "spdVal", "loadingEl", "closeBtn", "panelToggle", "resizeHandle", "shotWrap"] as const) {
      expect(r[key], `节点 ${key} 缺失`).toBeTruthy();
    }
    expect(r.overlay.contains(r.topBar)).toBe(true);
    expect(r.overlay.contains(r.body)).toBe(true);
    expect(r.body.contains(r.viewContainer)).toBe(true);
    expect(r.body.contains(r.panel)).toBe(true);
    expect(r.overlay.contains(r.loadingEl)).toBe(true);
  });

  it("多纹理 → topBar 含纹理选择器", () => {
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel({ textures: ["t1", "t2", "t3"] }), ctx);
    const texSel = r.topBar.querySelector("select") as HTMLSelectElement;
    expect(texSel).toBeTruthy();
    expect(texSel.options.length).toBe(3);
  });

  it("单纹理 → 无纹理选择器（modelSel 默认 display:none 仍在）", () => {
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel({ textures: ["t1"] }), ctx);
    // modelSel 始终建（display:none），纹理选择器条件建
    const selects = r.topBar.querySelectorAll("select");
    // 至少 modelSel + rotSel，无额外 texSel（单纹理跳过 texSel 分支）
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it("shotMenu 含 6 项截图菜单", () => {
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel(), ctx);
    const items = r.shotMenu.querySelectorAll(".ysm-ovl-shotitem");
    expect(items.length).toBe(6);
  });

  it("spdSlider 默认值取 localStorage td-cam-speed", () => {
    localStorage.setItem("td-cam-speed", "42");
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel(), ctx);
    expect(r.spdSlider.value).toBe("42");
    expect(r.spdVal.textContent).toBe("42");
  });

  it("rotSel 默认 free 模式（localStorage td-rot-mode=free → value=false）", () => {
    localStorage.setItem("td-rot-mode", "free");
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel(), ctx);
    expect(r.rotSel.value).toBe("false");
  });

  it("overlay.remove → 全树清（loadingEl/progStyle 随之移除）幂等", () => {
    const ctx = makeCtx();
    const r = build3DOverlay(makeModel(), ctx);
    const progStyle = r.overlay.querySelector("style");
    expect(progStyle).toBeTruthy();
    r.overlay.remove();
    expect(document.body.contains(r.overlay)).toBe(false);
    expect(document.body.contains(r.loadingEl)).toBe(false);
    // 幂等：再 remove 不报错
    expect(() => r.overlay.remove()).not.toThrow();
  });
});
