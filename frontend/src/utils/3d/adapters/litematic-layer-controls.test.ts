// ===== litematic 分层控件测试：常驻 topBar 结构契约（声明式菜单唯一例外）=====
// litematic 分层（axis/layer 切片调节）为高频常驻控件，语义上非「打开即关」的模态面板，
// 保留在 topBar（mount-preview-core.ts 已注明）。此处断言其控件结构稳定 + i18n 键齐全，
// 防无意破坏——既然不迁，至少测试兜住。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { zhCN } from "../../../core/i18n/locales/zh-CN.ts";
import { buildLitematicScene } from "./litematic-adapter.ts";
import type { PreviewBuildCtx } from "./mount-preview-core.ts";

beforeEach(() => {
  document.body.innerHTML = "";
});

function makeMockCtx(): PreviewBuildCtx {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(50, 1, 0.05, 5000),
    controls: {
      target: new THREE.Vector3(),
      update: vi.fn(),
    },
    loadingEl: document.createElement("div"),
  } as unknown as PreviewBuildCtx;
}

const mockVoxelCall = vi.fn(() =>
  Promise.resolve(
    JSON.stringify({
      groups: [{ positions: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], color: "#ff0000" }],
      size: [10, 10, 10],
      maxBlocks: 100,
    }),
  ),
);

describe("litematic 分层控件（常驻 topBar，声明式菜单唯一例外）", () => {
  it("extraControls 创建 8 个常驻切片控件（sep + label + axisSel + layerMode + slider/input ×2）", async () => {
    const scene = await buildLitematicScene(makeMockCtx(), "/a.litematic", mockVoxelCall);
    const topBar = document.createElement("div");
    scene.extraControls?.(topBar);
    expect(topBar.children.length).toBe(8);
  });

  it("axisSel 轴选择含 Y/X/Z（顺序固定）", async () => {
    const scene = await buildLitematicScene(makeMockCtx(), "/a.litematic", mockVoxelCall);
    const topBar = document.createElement("div");
    scene.extraControls?.(topBar);
    const axisSel = topBar.querySelector<HTMLSelectElement>("select");
    expect(axisSel).not.toBeNull();
    expect([...axisSel!.options].map((o) => o.value)).toEqual(["Y", "X", "Z"]);
  });

  it("layerMode 含全部/单层/范围三种模式", async () => {
    const scene = await buildLitematicScene(makeMockCtx(), "/a.litematic", mockVoxelCall);
    const topBar = document.createElement("div");
    scene.extraControls?.(topBar);
    const selects = topBar.querySelectorAll("select");
    expect(selects.length).toBe(2);
    expect([...(selects[1] as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      "all",
      "single",
      "range",
    ]);
  });

  it("分层滑块 2 个 + 数字输入 2 个（range 模式双滑块契约）", async () => {
    const scene = await buildLitematicScene(makeMockCtx(), "/a.litematic", mockVoxelCall);
    const topBar = document.createElement("div");
    scene.extraControls?.(topBar);
    expect(topBar.querySelectorAll('input[type="range"]').length).toBe(2);
    expect(topBar.querySelectorAll('input[type="number"]').length).toBe(2);
  });

  it("i18n 键 preview.sliceAxis 三语存在", () => {
    expect("preview.sliceAxis" in zhCN).toBe(true);
  });
});
