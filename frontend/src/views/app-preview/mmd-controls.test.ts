// ===== mmd-controls 菜单面板测试（ADR-076 v2 Phase 2：底部导航收编为根菜单面板填充）=====
// 覆盖：fillMmdModelPanel（信息卡 + 表情列表 + morph 权重切换）、buildMaterialControls
// （材质显隐 + 透明度）。切换模型/相机视图归 core 根菜单（switch/camera 项），此处不再覆盖。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import {
  fillMmdModelPanel,
  buildMaterialControls,
  type MmdBottomNavCtx,
  type MaterialControlBridge,
} from "./mmd-controls.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
} from "../../utils/3d/mmd-materials.ts";

function makeCtx() {
  // MMD 的 SkinnedMesh 是多材质数组（材料列表按数组访问 mats[i]）
  const rawMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    Array.from({ length: 28 }, () => new THREE.MeshBasicMaterial()),
  );
  rawMesh.morphTargetDictionary = { "微笑": 0, "怒": 1, "哀": 2 };
  rawMesh.morphTargetInfluences = [0, 0, 0];
  const mesh = rawMesh as unknown as THREE.SkinnedMesh;
  const mmd = {
    pmx: {
      bones: new Array(364),
      materials: Array.from({ length: 28 }, (_, i) => ({ name: `mat${i}` })),
      morphs: new Array(55),
    },
  };
  const ctx: MmdBottomNavCtx = {
    mmd: mmd as never,
    mesh,
    modelName: "子言.pmx",
    modelPath: "/mmd/子言/子言.pmx",
  };
  return { ctx, mesh, mmd };
}

/** 真实操作 mesh.material 的材质桥（复用 mmd-materials.ts 纯逻辑层，对齐 mmd-adapter 组装口径） */
function makeMatBridge(ctx: MmdBottomNavCtx): MaterialControlBridge {
  const mats = ctx.mesh.material as THREE.Material[];
  return {
    list: () => listMmdMaterials(ctx.mmd.pmx.materials),
    getDetail: (i: number) => getMmdMaterialDetail(ctx.mmd.pmx.materials, mats, i),
    setVisible: (i: number, v: boolean) => setMmdMaterialVisible(mats, i, v),
    setOpacity: (i: number, o: number) => setMmdMaterialOpacity(mats, i, o),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("fillMmdModelPanel", () => {
  it("渲染信息卡（名称 + 骨骼/材质/表情计数）", () => {
    const { ctx } = makeCtx();
    const list = document.createElement("div");
    fillMmdModelPanel(list, ctx);
    expect(list.textContent).toContain("子言.pmx");
    expect(list.textContent).toContain("364");
    expect(list.textContent).toContain("28");
    expect(list.textContent).toContain("55");
  });

  it("表情行 = morph 数（testId mmd-morph-<name>），点击切换权重 0↔1 + ✓ 高亮", () => {
    const { ctx, mesh } = makeCtx();
    const list = document.createElement("div");
    fillMmdModelPanel(list, ctx);
    const rows = list.querySelectorAll('[data-testid^="mmd-morph-"]');
    expect(rows.length).toBe(3);
    const row = list.querySelector('[data-testid="mmd-morph-微笑"]') as HTMLElement;
    expect(mesh.morphTargetInfluences![0]).toBe(0);
    row.click();
    expect(mesh.morphTargetInfluences![0]).toBe(1);
    expect(row.querySelector("span")?.textContent).toBe("✓");
    row.click();
    expect(mesh.morphTargetInfluences![0]).toBe(0);
    expect(row.querySelector("span")?.textContent).toBe("🙂");
  });
});

describe("buildMaterialControls", () => {
  it("渲染材质面板（显隐 + 透明度滑条），行数 = pmx.materials 长度", () => {
    const { ctx } = makeCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    expect(container.querySelector(".mmd-mat-row")).not.toBeNull();
    expect(container.querySelectorAll(".mmd-mat-row").length).toBe(28); // = pmx.materials.length
    expect(container.querySelector(".mmd-mat-op")).not.toBeNull(); // 透明度滑条
  });

  it("点击显隐按钮 → Material.visible 切换", () => {
    const { ctx, mesh } = makeCtx();
    const container = document.createElement("div");
    buildMaterialControls(container, makeMatBridge(ctx));
    const eye = container.querySelector(".mmd-mat-eye") as HTMLElement;
    const mat = (mesh.material as THREE.Material[])[0]; // 多材质数组，取第 0 个
    const before = mat.visible;
    eye.click();
    expect(mat.visible).toBe(!before);
  });
});
