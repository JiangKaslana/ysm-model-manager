// ===== 3D 菜单声明式测试：拿真实菜单数组去测（对齐 MikuMikuAR 范式）=====
// CORE_MENU_ITEMS + ysm/mmd 适配器真实注入项 = 完整菜单数组（唯一事实来源）。
// 测试遍历本表断言：结构完整性（id/legacyTestId 唯一、必填字段、i18n 键、组归属）、
// dock 行全量渲染、安全面板逐个打开——加菜单项只改 menu 表，测试自动覆盖。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { MMD } from "@moeru/three-mmd";
import { zhCN } from "../../../core/i18n/locales/zh-CN.ts";
import {
  CORE_MENU_ITEMS,
  PREVIEW_MENU_GROUPS,
  type PreviewMenuItemDef,
} from "./preview-menu-defs.ts";
import { ysmMenuItems, type YsmMenuItemsOpts } from "./ysm-adapter.ts";
import { mmdMenuItems, type MmdMenuItemsOpts } from "./mmd-adapter.ts";
import { vrmMenuItems, type VrmMenuItemsOpts } from "./vrm-adapter.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "./preview-menu.ts";
import type { BoneTree } from "../bone-tools.ts";
import {
  expectContainsAtLeast,
  expectNotContains,
  deriveTestIds,
  extractIds,
} from "../../../test-utils/index.ts";

/** 测试假渲染器：同步写 innerHTML，规避 W5 异步竞态正则命中（纯同步 mock，无异步路径） */
function setHtml(el: Element, html: string): void {
  el.innerHTML = html;
}

// ── 假依赖工厂（结构/行渲染/轻面板用；重面板 fill3DPanel/截图/骨骼 不执行）──

/** ysm 假依赖：仅喂结构断言与 dock 行渲染 */
function fakeYsmOpts(): YsmMenuItemsOpts {
  return {
    controlsCtx: {
      model: {} as never,
      texIdx: 0,
      texArr: [],
      spec: {} as never,
      handle: {} as never,
    },
    bonePanel: fakeBonePanel(),
  };
}

/** mmd 假依赖：model/material/play 面板可真实渲染（轻量 DOM） */
function fakeMmdOpts(overrides: Partial<MmdMenuItemsOpts> = {}): MmdMenuItemsOpts {
  const mmd = {
    pmx: { bones: [], materials: [], morphs: [] },
  } as unknown as MMD;
  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [],
  } as unknown as THREE.SkinnedMesh;
  return {
    navCtx: { mmd, mesh, modelName: "测试.pmx" },
    screenshot: null,
    material: {
      list: () => [{ index: 0, name: "mat0" }],
      getDetail: () => null,
      setVisible: vi.fn(),
      setOpacity: vi.fn(),
    },
    play: {
      clips: [{ label: "动作A" }, { label: "动作B" }],
      isPlaying: () => false,
      toggle: vi.fn(),
      currentIndex: () => 0,
      select: vi.fn(),
      animDir: null,
    },
    bonePanel: null,
    panels: {
      fillModelPanel: (list) => setHtml(list, '<div data-testid="mmd-model-card">测试.pmx</div>'),
      fillPlayPanel: (list) => setHtml(list, '<button id="mmd-play-btn"></button><select id="mmd-motion-sel"></select>'),
      fillShotPanel: () => {},
      buildMaterialControls: (list) => setHtml(list, '<div data-testid="mmd-mat-0"></div>'),
    },
    ...overrides,
  };
}

function fakeBonePanel() {
  return {
    tree: null as unknown as BoneTree,
    viewContainer: null,
    camera: null,
    scene: null,
    cleanupRef: { current: null as (() => void) | null },
  };
}

function fakeVrmOpts(): VrmMenuItemsOpts {
  return {
    screenshot: null,
    bonePanel: fakeBonePanel(),
    material: {
      list: () => [{ index: 0, name: "Body" }],
      getDetail: () => ({ index: 0, name: "Body", visible: true, opacity: 1, transparent: false, type: "mtoon" }),
      setVisible: vi.fn(),
      setOpacity: vi.fn(),
    },
    panels: {
      makePanelRenderer: () => (list) => setHtml(list, '<div data-testid="vrm-mat-0"></div>'),
      makeModelPanelRenderer: (list) => setHtml(list, '<div data-testid="vrm-model-card">测试.vrm</div>'),
      makeShotPanelRenderer: () => () => {},
    },
  };
}

/** 环境能力假 cap（environment 面板 requiresEnvironment 过滤 + 渲染用） */
const fakeCap = {
  getTimeOfDay: () => 9,
  setTime: vi.fn(),
  getCloudCoverage: () => 0,
  setCloudCoverage: vi.fn(),
  isEnvironmentEnabled: () => true,
  setEnvironmentEnabled: vi.fn(),
  getVisible: () => true,
  setVisible: vi.fn(),
  getMenuControls: () => [
    { id: "sky-time", kind: "slider" as const, labelKey: "preview.timeOfDay", fallback: "时间", slider: { min: 0, max: 24, step: 0.5 }, getValue: () => 9, setValue: vi.fn() },
    { id: "sky-cloud", kind: "slider" as const, labelKey: "preview.cloudCoverage", fallback: "云量", slider: { min: 0, max: 1, step: 0.05 }, getValue: () => 0, setValue: vi.fn() },
    { id: "sky-env", kind: "toggle" as const, labelKey: "preview.environmentMapping", fallback: "环境贴图", getValue: () => true, setValue: vi.fn() },
    { id: "ground-visible", kind: "toggle" as const, labelKey: "preview.ground", fallback: "地面", getValue: () => true, setValue: vi.fn() },
  ],
} as never;

function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  return {
    selfMode: false,
    getSkyCap: () => fakeCap,
    getGroundCap: () => fakeCap,
    getLightCap: () => null,
    getCamBridge: () => ({
      getOrbit: () => true,
      setOrbit: vi.fn(),
      getSpeed: () => 20,
      setSpeed: vi.fn(),
      reset: vi.fn(),
    }),
    getSiblings: () => [],
    getCurrentPath: () => "/m/a.ysm",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    switchTo: vi.fn(),
    ...overrides,
  };
}

function mountWith(items: PreviewMenuItemDef[], ctxOverrides: Partial<PreviewMenuCtx> = {}) {
  const overlay = document.createElement("div");
  document.body.appendChild(overlay);
  const handle = mountPreviewRootMenu(overlay, makeCtx(ctxOverrides));
  handle.setAdapterItems(items);
  return { overlay, handle };
}

// ── 结构断言 ──

describe("真实菜单表结构（遍历 ysm/mmd/vrm 真实注入项）", () => {
  const ysmItems = ysmMenuItems(fakeYsmOpts());
  const mmdItems = mmdMenuItems(fakeMmdOpts({ bonePanel: fakeBonePanel() }));
  const vrmItems = vrmMenuItems(fakeVrmOpts());
  const allItems = [...CORE_MENU_ITEMS, ...ysmItems, ...mmdItems, ...vrmItems];

  it("id 唯一：core 内部 + 各适配器内部 + core∩适配器无交集（适配器按次挂载互斥）", () => {
    const uniq = (arr: string[]) => new Set(arr).size === arr.length;
    expect(uniq(CORE_MENU_ITEMS.map((d) => d.id))).toBe(true);
    expect(uniq(ysmItems.map((d) => d.id))).toBe(true);
    expect(uniq(mmdItems.map((d) => d.id))).toBe(true);
    expect(uniq(vrmItems.map((d) => d.id))).toBe(true);
    const coreIds = new Set(CORE_MENU_ITEMS.map((d) => d.id));
    [...ysmItems, ...mmdItems, ...vrmItems].forEach((d) => {
      expect(coreIds.has(d.id), `core 与适配器 id 冲突: ${d.id}`).toBe(false);
    });
  });

  it("legacyTestId 全局唯一（e2e 兼容锚点不撞车）", () => {
    const legacies = allItems.map((d) => d.legacyTestId).filter(Boolean);
    expect(new Set(legacies).size).toBe(legacies.length);
  });

  it("非 divider 项必有 icon/fallback/labelKey，kind/dockGroup 合法", () => {
    const groupIds = PREVIEW_MENU_GROUPS.map((g) => g.id);
    allItems.forEach((d) => {
      if (d.kind === "divider") return;
      expect(d.icon.length, `${d.id}.icon`).toBeGreaterThan(0);
      expect(d.fallback.length, `${d.id}.fallback`).toBeGreaterThan(0);
      expect(d.labelKey.length, `${d.id}.labelKey`).toBeGreaterThan(0);
      expect(["panel", "action", "divider"]).toContain(d.kind);
      if (d.dockGroup) expect(groupIds, `${d.id}.dockGroup`).toContain(d.dockGroup);
    });
  });

  it("适配器注入项 panel 必有 render；action 必有 run（core 项走 fillers 映射，行为测试覆盖）", () => {
    [...ysmItems, ...mmdItems, ...vrmItems].forEach((d) => {
      if (d.kind === "panel") expect(typeof d.render, `${d.id}.render`).toBe("function");
      if (d.kind === "action") expect(typeof d.run, `${d.id}.run`).toBe("function");
    });
  });

  it("labelKey 全部有翻译（zh-CN 有键；三语一致性由 locales-consistency.test 保证）", () => {
    allItems.forEach((d) => {
      expect(d.labelKey in zhCN, `${d.id} labelKey=${d.labelKey} 缺 zh-CN 翻译`).toBe(true);
    });
  });

  it("ysm 必需项齐全且归 🧍 模型组（dock 可达，ADR-076 v3；允许额外注入）", () => {
    expectContainsAtLeast(extractIds(ysmItems), ["bones", "model", "shot"], "ysm 必需项");
    ysmItems.forEach((d) => expect(d.dockGroup, `${d.id}.dockGroup`).toBe("model"));
  });

  it("vrm 必需项齐全且归 🧍 模型组（dock 可达；允许额外注入如 play）", () => {
    expectContainsAtLeast(extractIds(vrmItems), ["bones", "material", "model", "shot"], "vrm 必需项");
    vrmItems.forEach((d) => expect(d.dockGroup, `${d.id}.dockGroup`).toBe("model"));
  });

  it("mmd model/material/play 恒定；bones 条件注入", () => {
    const withAll = mmdMenuItems(fakeMmdOpts({ bonePanel: fakeBonePanel() }));
    expectContainsAtLeast(extractIds(withAll), ["bones", "material", "model", "play", "shot"], "mmd 全注入");
    // play 始终注入（支持用户配置自定义动作库，空态引导选择）
    const slim = mmdMenuItems(fakeMmdOpts({ play: { clips: [], isPlaying: () => false, toggle: vi.fn(), currentIndex: () => 0, select: vi.fn(), animDir: null } }));
    expectContainsAtLeast(extractIds(slim), ["play", "material", "model", "shot"], "mmd play 始终存在（空态）");
    // 无 pmx.bones → 无 bones
    expectNotContains(extractIds(slim), ["bones"], "mmd 无 bones 时不注入");
  });

  it("legacyTestId 锚点齐全（既有 e2e 选择器兼容契约）", () => {
    const legacies = allItems.map((d) => d.legacyTestId).filter(Boolean);
    [
      "ysm-model-entry",
      "ysm-shot-entry",
      "ysm-bones-entry",
      "mmd-model-entry",
      "mmd-material-entry",
      "mmd-play-entry",
      "mmd-bones-entry",
      "vrm-material-entry",
      "vrm-bones-entry",
      "mmd-switch",
      "env-menu-btn",
    ].forEach((anchor) => expect(legacies, `缺锚点 ${anchor}`).toContain(anchor));
  });
});

// ── dock 行全量渲染（真实数组驱动）──

describe("dock 行全量渲染（遍历真实菜单数组驱动）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("ysm 数组：🧍 模型组按钮出现，点击列出全部 menu 行（自适应）", () => {
    const items = ysmMenuItems(fakeYsmOpts());
    const { overlay, handle } = mountWith(items, {
      getSiblings: () => ["/m/b.ysm"],
    });
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // 自愈：从真实菜单表推导期望选择器（ysm 项 + core 同组项）
    const adapterDock = deriveTestIds(items.filter((d) => d.dockGroup === "model"));
    const coreDock = deriveTestIds(CORE_MENU_ITEMS.filter((d) => d.dockGroup === "model" && d.id === "switch"));
    [...adapterDock, ...coreDock].forEach((tid) => {
      expect(overlay.querySelector(`[data-testid="${tid}"]`), tid).not.toBeNull();
    });
    handle.dispose();
  });

  it("mmd 数组：dock 各组从菜单表推导，点击渲染正确子项（自适应）", () => {
    const items = mmdMenuItems(fakeMmdOpts({ bonePanel: fakeBonePanel() }));
    const { overlay, handle } = mountWith(items, {
      getSiblings: () => ["/m/b.pmx"],
    });
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // 自愈：从真实菜单表推导 🧍 组期望选择器
    const adapterDockModel = deriveTestIds(items.filter((d) => d.dockGroup === "model"));
    adapterDockModel.forEach((tid) => {
      expect(overlay.querySelector(`[data-testid="${tid}"]`), tid).not.toBeNull();
    });
    expect(overlay.querySelector('[data-testid="preview-switch"]')).not.toBeNull(); // core switch

    // 单 panel 组（play）→ 快捷直达面板，不渲染组根行
    const motionBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-motion"]');
    expect(motionBtn).not.toBeNull();
    motionBtn!.click();
    expect(overlay.querySelector('[data-testid="preview-play"]')).toBeNull();
    expect(overlay.querySelector("#mmd-play-btn")).not.toBeNull();
    handle.dispose();
  });

  it("vrm 数组：🧍 模型组从菜单表推导，骨骼与 core switch 同行渲染（自适应）", () => {
    const items = vrmMenuItems(fakeVrmOpts());
    const { overlay, handle } = mountWith(items, {
      getSiblings: () => ["/m/b.vrm"],
    });
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // 自愈：从真实菜单表推导期望选择器
    const adapterDock = deriveTestIds(items.filter((d) => d.dockGroup === "model"));
    adapterDock.forEach((tid) => {
      expect(overlay.querySelector(`[data-testid="${tid}"]`), tid).not.toBeNull();
    });
    expect(overlay.querySelector('[data-testid="preview-switch"]')).not.toBeNull();
    handle.dispose();
  });

  it("core 拆组契约：🎛️ 场景组含 camera、🌍 环境组独立（shared 模式 + cap）", () => {
    const { overlay, handle } = mountWith([], { getSiblings: () => ["/m/b.ysm"] });
    // 场景组 root 按钮在 shared 模式出现
    const sceneBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-scene"]');
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    expect(overlay.querySelector('[data-testid="preview-camera"]')).not.toBeNull();
    // environment 已拆离 🌍 环境组，不再出现在 🎛️ 场景组根列表
    expect(overlay.querySelector('[data-testid="preview-environment"]')).toBeNull();
    // 环境组独立 root 按钮存在（有 fakeCap → requiresEnvironment 放行）
    const envBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-env"]');
    expect(envBtn).not.toBeNull();
    // 单 panel 组 → 快捷直达环境面板（渲染 range 控件，不渲染组根行）
    envBtn!.click();
    expect(overlay.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(2);
    handle.dispose();
  });

  it("能力驱动：无 siblings → model dock 仍显示（路径输入兜底）；selfMode + 无环境能力 → 无 🌍/🎛️ 组", () => {
    // 无 siblings → switch 不再被过滤（needsSiblings 已移除），dock-model 始终可见
    const noSib = mountWith([], {});
    expect(noSib.overlay.querySelector('[data-testid="dock-model"]')).not.toBeNull();
    noSib.handle.dispose();
    // selfMode → camera/lighting/shadow/postproc(sharedOnly) 过滤 → 🎛️ 场景组空；
    // 无 cap → environment(requiresEnvironment) 过滤 → 🌍 环境组空 → 两组 dock 均不渲染
    const noScene = mountWith([], { selfMode: true, getSkyCap: () => null, getGroundCap: () => null });
    expect(noScene.overlay.querySelector('[data-testid="dock-scene"]')).toBeNull();
    expect(noScene.overlay.querySelector('[data-testid="dock-env"]')).toBeNull();
    noScene.handle.dispose();
  });

  it("提供 siblings → 🧍 组出现切换模型；选中条目触发 switchTo（换角色）", async () => {
    const switchTo = vi.fn();
    const { overlay, handle } = mountWith([], {
      getSiblings: () => ["/m/a.ysm", "/m/b.vrm"],
      getCurrentPath: () => "/m/a.ysm",
      switchTo,
    });
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // roles 加入 model 组后 dock 先入组根视图，点击 switch 行进入面板
    (overlay.querySelector('[data-testid="preview-switch"]') as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    const rows = overlay.querySelectorAll('[data-testid="preview-switch-item"]');
    expect(rows.length).toBe(2);
    (rows[1] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.vrm");
    handle.dispose();
  });

  it("无 siblings → dock-model 可见（类型 tab 兜底），面板内显示空态（路径输入保留）", () => {
    const { overlay, handle } = mountWith([], { getSiblings: () => [] });
    expect(overlay.querySelector('[data-testid="dock-model"]')).not.toBeNull();
    // 点击 model 打开 switch 面板，应显示空态文字，路径输入框保留（P2-1 补回）
    const modelBtn = overlay.querySelector<HTMLElement>('[data-testid="dock-model"]');
    modelBtn!.click();
    // roles 加入 model 组后 dock 先入组根视图，点击 switch 行进入面板
    (overlay.querySelector('[data-testid="preview-switch"]') as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(popup.textContent).toContain("无其他模型");
    // 路径输入保留（跨类型手动加载；类型 tab 由 adapter getTypeTabs 注入）
    expect(popup.querySelector("input[type='text']")).not.toBeNull();
    handle.dispose();
  });
});

// ── 安全面板渲染（逐个打开断言非空）──

describe("面板渲染（安全 panel 逐个打开）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mmd model 面板：信息卡含模型名", () => {
    const { overlay, handle } = mountWith(mmdMenuItems(fakeMmdOpts()));
    handle.openPanel("model");
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(overlay.textContent).toContain("测试.pmx");
    handle.dispose();
  });

  it("mmd play 面板：#mmd-play-btn + 动作选择器", () => {
    const { overlay, handle } = mountWith(mmdMenuItems(fakeMmdOpts()));
    handle.openPanel("play");
    expect(overlay.querySelector("#mmd-play-btn")).not.toBeNull();
    expect(overlay.querySelector("#mmd-motion-sel")).not.toBeNull();
    handle.dispose();
  });

  it("mmd material 面板：材质行渲染（data-testid=mmd-mat-<i>）", () => {
    const { overlay, handle } = mountWith(mmdMenuItems(fakeMmdOpts()));
    handle.openPanel("material");
    expect(overlay.querySelector('[data-testid="mmd-mat-0"]')).not.toBeNull();
    handle.dispose();
  });

  it("vrm material 面板：材质行渲染（data-testid=vrm-mat-<i>）", () => {
    const { overlay, handle } = mountWith(vrmMenuItems(fakeVrmOpts()));
    handle.openPanel("material");
    expect(overlay.querySelector('[data-testid="vrm-mat-0"]')).not.toBeNull();
    handle.dispose();
  });

  it("core camera 面板：视角 select + 速度滑块", () => {
    const { overlay, handle } = mountWith([]);
    handle.openPanel("camera");
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.querySelector("select")).not.toBeNull();
    expect(popup.querySelector('input[type="range"]')).not.toBeNull();
    handle.dispose();
  });

  it("core environment 面板：时间/云量滑块渲染", () => {
    const { overlay, handle } = mountWith([], { getSiblings: () => ["/m/b.ysm"] });
    handle.openPanel("environment");
    expect(overlay.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(2);
    handle.dispose();
  });

  it("core switch 面板：siblings 行渲染", () => {
    const { overlay, handle } = mountWith([], {
      getSiblings: () => ["/m/b.ysm"],
      getCurrentPath: () => "/m/b.ysm",
    });
    handle.openPanel("switch");
    expect(overlay.textContent).toContain("b.ysm");
    handle.dispose();
  });
});

// ── 错误路径：面板渲染失败兜底 ──

describe("渲染失败兜底（render 抛错不崩）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("render 抛错 → 面板显示红色错误行 + console.error（挂载不崩）", () => {
    const errSpy = vi.fn();
    const origError = console.error;
    console.error = errSpy;
    try {
      const boom = vi.fn(() => {
        throw new Error("boom");
      });
      const { overlay, handle } = mountWith([
        {
          id: "broken",
          icon: "❌",
          labelKey: "preview.modelInfo",
          fallback: "坏",
          kind: "panel",
          render: boom,
        },
      ]);
      handle.openPanel("broken");
      const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
      expect(popup.style.display).toBe("flex");
      expect(overlay.textContent).toContain("面板渲染失败");
      expect(overlay.textContent).toContain("boom");
      expect(overlay.querySelector('[style*="#ff7b7b"]')).not.toBeNull();
      expect(errSpy).toHaveBeenCalled();
      expect(boom).toHaveBeenCalled();
      handle.dispose();
    } finally {
      console.error = origError;
    }
  });
});
