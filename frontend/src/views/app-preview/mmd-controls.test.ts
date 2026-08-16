// ===== mmd-controls 底部根菜单测试 =====
// 覆盖：导航挂载（模型/视图按钮 + 弹窗初始隐藏）、模型菜单（信息卡 + 表情列表）、
// 表情行点击切换 morphTargetInfluences（0↔1 + 重绘高亮）、视图菜单（相机控件）、
// 同菜单再点收起 / 跨菜单切换。ui/ 库组件（cardContainer/collapsible/slideRow）真实执行。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { buildMmdBottomNav } from "./mmd-controls.ts";

const { resolveMmdSiblingsMock } = vi.hoisted(() => ({
  resolveMmdSiblingsMock: vi.fn(),
}));
vi.mock("./mmd-3d.ts", () => ({
  resolveMmdSiblings: resolveMmdSiblingsMock,
}));

function makeCtx() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.morphTargetDictionary = { "微笑": 0, "怒": 1, "哀": 2 };
  mesh.morphTargetInfluences = [0, 0, 0];
  const mmd = {
    pmx: { bones: new Array(364), materials: new Array(28), morphs: new Array(55) },
  };
  const overlay = document.createElement("div");
  const cameraControls = {
    getOrbit: vi.fn(() => true),
    setOrbit: vi.fn(),
    getSpeed: vi.fn(() => 20),
    setSpeed: vi.fn(),
    reset: vi.fn(),
  };
  return {
    ctx: {
      mmd,
      mesh,
      modelName: "子言.pmx",
      modelPath: "/mmd/子言/子言.pmx",
      cameraControls,
      switchTo: vi.fn(),
    },
    overlay,
  };
}

/** 最近一次 buildMmdBottomNav 挂载的 nav 按钮（模型=0，视图=1） */
function navBtns(overlay: HTMLElement): NodeListOf<HTMLButtonElement> {
  return overlay.querySelectorAll<HTMLButtonElement>(".ysm-3d-navbtn");
}
function popup(overlay: HTMLElement): HTMLElement {
  return overlay.querySelector(".ysm-3d-popup") as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
  resolveMmdSiblingsMock.mockResolvedValue([]);
});

describe("buildMmdBottomNav", () => {
  it("挂载底部导航（模型/视图按钮）+ 弹窗初始隐藏", () => {
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    expect(overlay.querySelector(".ysm-3d-nav")).not.toBeNull();
    expect(navBtns(overlay).length).toBe(2);
    expect(popup(overlay).style.display).toBe("none");
  });

  it("点击模型按钮 → 信息卡（名称/骨骼/材质/表情数）+ 表情列表渲染", () => {
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    navBtns(overlay)[0].click();
    const p = popup(overlay);
    expect(p.style.display).toBe("flex");
    expect(p.textContent).toContain("子言.pmx");
    expect(p.textContent).toContain("364");
    expect(p.textContent).toContain("28");
    expect(overlay.querySelector('[data-testid="mmd-morph-list"]')).not.toBeNull();
    // 表情行（slideRow 带 testid 前缀 mmd-morph-；排除 collapsible 容器 mmd-morph-list）
    expect(overlay.querySelector('[data-testid="mmd-morph-微笑"]')).not.toBeNull();
    expect(
      overlay.querySelectorAll('[data-testid^="mmd-morph-"]:not([data-testid="mmd-morph-list"])')
        .length,
    ).toBe(3);
  });

  it("点击表情行 → morphTargetInfluences 切换 0↔1，重绘后高亮当前开启", () => {
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    navBtns(overlay)[0].click();
    const row = overlay.querySelector('[data-testid="mmd-morph-微笑"]') as HTMLElement;
    expect(ctx.mesh.morphTargetInfluences![0]).toBe(0);
    row.click();
    expect(ctx.mesh.morphTargetInfluences![0]).toBe(1);
    // 再次点击关闭
    const row2 = overlay.querySelector('[data-testid="mmd-morph-微笑"]') as HTMLElement;
    row2.click();
    expect(ctx.mesh.morphTargetInfluences![0]).toBe(0);
  });

  it("点击视图按钮 → 相机控件渲染（select）；同菜单再点收起", () => {
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    const btns = navBtns(overlay);
    btns[1].click();
    const p = popup(overlay);
    expect(p.style.display).toBe("flex");
    expect(p.querySelector("select")).not.toBeNull(); // buildCameraControls 旋转下拉
    btns[1].click();
    expect(p.style.display).toBe("none");
  });

  it("跨菜单切换：模型 → 视图 内容替换", () => {
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    const btns = navBtns(overlay);
    btns[0].click();
    expect(popup(overlay).textContent).toContain("364");
    btns[1].click();
    expect(popup(overlay).textContent).not.toContain("364");
    expect(popup(overlay).querySelector("select")).not.toBeNull();
  });

  it("模型菜单渲染切换区：siblings 列表 + 当前模型行", async () => {
    resolveMmdSiblingsMock.mockResolvedValue([
      "/mmd/子言/子言.pmx",
      "/mmd/毒蛇/Viper.pmx",
    ]);
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    navBtns(overlay)[0].click();
    await vi.waitFor(() => {
      expect(overlay.querySelector('[data-testid^="mmd-load-"]')).not.toBeNull();
    });
    expect(popup(overlay).textContent).toContain("切换模型");
    expect(overlay.querySelectorAll('[data-testid^="mmd-load-"]').length).toBe(2);
    // 当前模型行存在（高亮判断基于 modelPath 匹配）
    expect(overlay.querySelector('[data-testid="mmd-load-子言.pmx"]')).not.toBeNull();
  });

  it("点击切换行 → ctx.switchTo(path) 调用（复用核心外壳重建内容层）", async () => {
    resolveMmdSiblingsMock.mockResolvedValue(["/mmd/毒蛇/Viper.pmx"]);
    const { ctx, overlay } = makeCtx();
    buildMmdBottomNav(overlay, ctx as never);
    navBtns(overlay)[0].click();
    await vi.waitFor(() => {
      expect(overlay.querySelector('[data-testid="mmd-load-Viper.pmx"]')).not.toBeNull();
    });
    (overlay.querySelector('[data-testid="mmd-load-Viper.pmx"]') as HTMLElement).click();
    expect(ctx.switchTo).toHaveBeenCalledWith("/mmd/毒蛇/Viper.pmx");
  });

  it("无 switchTo → 不渲染切换区（向后兼容）", async () => {
    resolveMmdSiblingsMock.mockResolvedValue(["/mmd/other.pmx"]);
    const { ctx, overlay } = makeCtx();
    delete (ctx as { switchTo?: unknown }).switchTo;
    buildMmdBottomNav(overlay, ctx as never);
    navBtns(overlay)[0].click();
    await Promise.resolve();
    await Promise.resolve();
    expect(overlay.querySelector('[data-testid^="mmd-load-"]')).toBeNull();
  });
});
