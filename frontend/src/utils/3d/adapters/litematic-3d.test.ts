// ===== litematic 体素 3D 测试 =====
// 覆盖：cleanupVoxel3D、createLitematic3D 主路径（overlay/DOM 控件/渲染循环）、
// ESC/关闭按钮清理、空体素数据、getApp 失败兜底、分层/旋转/速度控件交互、截断提示。
// three + OrbitControls 全 stub（渲染管线不真实执行）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("three", () => {
  class Scene {
    background: unknown;
    add = vi.fn();
  }
  class Color {
    constructor(..._a: unknown[]) {}
  }
  class PerspectiveCamera {
    position = { set: vi.fn(), add: vi.fn() };
    quaternion = { setFromEuler: vi.fn() };
    lookAt = vi.fn();
    aspect = 0;
    updateProjectionMatrix = vi.fn();
    getWorldDirection = vi.fn(() => ({ x: 0, y: 0, z: 1 }));
    constructor(..._a: unknown[]) {
      cameraInstances.push(this);
    }
  }
  class WebGLRenderer {
    domElement = document.createElement("div");
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
  class AmbientLight {
    constructor(..._a: unknown[]) {}
  }
  class DirectionalLight {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class GridHelper {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class BoxGeometry {
    dispose = vi.fn();
  }
  class MeshLambertMaterial {
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Object3D {
    position = { set: vi.fn() };
    updateMatrix = vi.fn();
    matrix = {};
  }
  // 记录每个被创建的 InstancedMesh 实例，供测试断言 count / setMatrixAt 调用
  const instancedMeshInstances: InstancedMesh[] = [];
  // 记录 PerspectiveCamera 实例（自身旋转拖拽断言用）
  const cameraInstances: PerspectiveCamera[] = [];
  class InstancedMesh {
    instanceMatrix = { needsUpdate: false };
    count = 0;
    setMatrixAt = vi.fn();
    dispose = vi.fn();
    constructor(..._a: unknown[]) {
      instancedMeshInstances.push(this);
    }
  }
  class Euler {
    setFromQuaternion = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Vector3 {
    x: number;
    y: number;
    z: number;
    normalize = vi.fn(function (this: Vector3) {
      return this;
    });
    add = vi.fn(function (this: Vector3) {
      return this;
    });
    sub = vi.fn(function (this: Vector3) {
      return this;
    });
    multiplyScalar = vi.fn(function (this: Vector3) {
      return this;
    });
    crossVectors = vi.fn(function (this: Vector3) {
      return this;
    });
    clone = vi.fn(() => new Vector3());
    length = vi.fn(function (this: Vector3) {
      return Math.hypot(this.x, this.y, this.z);
    });
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }
  return {
    Scene,
    Color,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    DirectionalLight,
    GridHelper,
    BoxGeometry,
    MeshLambertMaterial,
    Object3D,
    InstancedMesh,
    Euler,
    Vector3,
    _instancedMeshInstances: instancedMeshInstances,
    _cameraInstances: cameraInstances,
  };
});

vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    target = {
      set: vi.fn(),
      copy: vi.fn(() => ({ addScaledVector: vi.fn() })),
      clone: vi.fn(() => ({ copy: vi.fn(), add: vi.fn() })),
    };
    enableDamping = false;
    dampingFactor = 0;
    minDistance = 0;
    maxDistance = 0;
    enableRotate = true;
    update = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("../../backend/app.ts", () => ({ getApp: vi.fn() }));

import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import * as THREE from "three";
import { cleanupVoxel3D, createLitematic3D } from "./litematic-3d.ts";
import { sleep } from "../../test-utils/index.ts";

/** 访问 mock 暴露的 InstancedMesh 实例列表，供 count / setMatrixAt 断言 */
const meshInstances = (THREE as unknown as {
  _instancedMeshInstances: Array<{
    count: number;
    setMatrixAt: ReturnType<typeof vi.fn>;
  }>;
})._instancedMeshInstances;

/** 访问 mock 暴露的 PerspectiveCamera 实例列表（自身旋转拖拽断言用） */
const cameraInstances = (THREE as unknown as {
  _cameraInstances: Array<{ quaternion: { setFromEuler: ReturnType<typeof vi.fn> } }>;
})._cameraInstances;

/** 最近创建的 overlay（createLitematic3D append 到 body） */
function lastOverlay(): HTMLElement {
  const kids = document.body.children;
  return kids[kids.length - 1] as HTMLElement;
}

function voxelFn(json: string): (p: string) => Promise<string> {
  return vi.fn().mockResolvedValue(json);
}

const VALID_JSON = JSON.stringify({
  groups: [{ positions: [[1, 2, 3], [4, 5, 6]], color: "#ff0000" }],
  size: [16, 16, 16],
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  meshInstances.length = 0;
  cameraInstances.length = 0;
  vi.mocked(getApp).mockResolvedValue({
    GetLitematicVoxelData: voxelFn(VALID_JSON),
  } as never);
});

afterEach(() => {
  cleanupVoxel3D();
  document.body.innerHTML = "";
});

describe("cleanupVoxel3D", () => {
  it("无活跃实例 → no-op（不抛）", () => {
    expect(() => cleanupVoxel3D()).not.toThrow();
  });

  it("创建后 cleanup → overlay 移除（_voxel3d 复用清理）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    cleanupVoxel3D();
    expect(document.body.contains(overlay)).toBe(false);
  });
});

describe("createLitematic3D 主路径", () => {
  it("渲染 overlay + 顶层控件，加载完成后 loading 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    // topBar 控件：关闭按钮 / 旋转选择 / 速度滑块 / 切片轴 / 分层模式
    expect(overlay.querySelector("button")).toBeTruthy();
    expect(overlay.querySelector('select')).toBeTruthy();
    expect(overlay.querySelector('input[type="range"]')).toBeTruthy();
    // 加载占位已被移除
    expect(overlay.textContent).not.toContain("加载体素数据");
  });

  it("closeBtn 点击 → overlay 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const closeBtn = overlay.querySelector("button") as HTMLElement;
    closeBtn.click();
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("ESC 键 → overlay 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("第二次创建复用 → 先清理旧 overlay（WebGL 上下文防堆积）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const first = lastOverlay();
    await createLitematic3D("/b.litematic", "GetLitematicVoxelData");
    const second = lastOverlay();
    expect(document.body.contains(first)).toBe(false); // 旧 overlay 被清理
    expect(second).toBeTruthy();
    // 模块级 _voxel3d 指向新实例：cleanup 只移除新的
    cleanupVoxel3D();
    expect(document.body.contains(second)).toBe(false);
  });
});

describe("体素数据处理", () => {
  it("空 groups → voxelEmpty 提示，不崩溃", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(JSON.stringify({ groups: [], size: [10, 10, 10] })),
    } as never);
    await createLitematic3D("/empty.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("体素数据为空"); // test-setup t() 返回 zhCN
    unmountOverlay(overlay);
  });

  it("truncated → 显示方块数量上限提示条", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0]] }],
          size: [10, 10, 10],
          truncated: true,
          maxBlocks: 200000,
        }),
      ),
    } as never);
    await createLitematic3D("/trunc.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("200,000");
    unmountOverlay(overlay);
  });

  it("getApp 抛错 → 错误占位 + toast:show（escH 清理不泄漏）", async () => {
    vi.mocked(getApp).mockRejectedValue(new Error("no-voxel-binding"));
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    try {
      await createLitematic3D("/fail.litematic", "GetLitematicVoxelData");
      const overlay = lastOverlay();
      expect(overlay.textContent).toContain("加载失败");
      expect(toastSpy).toHaveBeenCalled();
      unmountOverlay(overlay);
    } finally {
      unsub();
    }
  });
});

describe("控件交互", () => {
  it("旋转模式切换 + 速度滑块更新显示", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const sel = overlay.querySelector("select") as HTMLSelectElement;
    const spd = overlay.querySelector('input[type="range"]') as HTMLInputElement;
    sel.value = "false";
    sel.dispatchEvent(new Event("change"));
    spd.value = "55";
    spd.dispatchEvent(new Event("input"));
    // 速度值标签跟随（数字文本的 span）
    const spdVal = [...overlay.querySelectorAll("span")].find(
      (s) => /^\d+$/.test(s.textContent || ""),
    );
    expect(spdVal?.textContent).toBe("55");
    unmountOverlay(overlay);
  });

  it("分层模式切换 → applyLayer（mesh.count 更新）；切片轴切换 → 层范围重置", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement; // 最后一个 select 是分层模式
    const axisSel = selects[1] as HTMLSelectElement; // 第二个 select 是切片轴
    // 单层模式 → 滑块显示
    layerMode.value = "single";
    layerMode.dispatchEvent(new Event("change"));
    // 切轴 → 层 max 重置（不抛）
    axisSel.value = "Z";
    axisSel.dispatchEvent(new Event("change"));
    // 范围模式 → 双滑块
    layerMode.value = "range";
    layerMode.dispatchEvent(new Event("change"));
    unmountOverlay(overlay);
  });
});

describe("陷阱 #11 坐标对齐 + #17 零值哨兵", () => {
  it("原点体素 [0,0,0] 保留：0 坐标不被当成缺失丢弃", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0], [0, 0, 5]], color: "#00ff00" }],
          size: [16, 16, 16],
        }),
      ),
    } as never);
    await createLitematic3D("/origin.litematic", "GetLitematicVoxelData");
    // 至少创建一个 InstancedMesh，且 applyLayer 触发后 count > 0（原点方块仍在）
    expect(meshInstances.length).toBeGreaterThanOrEqual(1);
    // 切到 single 并触发 applyLayer，使 mesh.count 被显式写入
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    layerMode.value = "all";
    layerMode.dispatchEvent(new Event("change"));
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2); // 两个合法方块都保留
    unmountOverlay(overlay);
  });

  it("缺失/NaN 坐标整条丢弃，不聚到原点造幽灵方块（#17）", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [
            {
              positions: [
                [1, 2, 3], // 合法
                [0, 0, 0], // 合法原点
                [5, undefined, 1], // 非法 → 丢弃
                [NaN, 0, 0], // 非法 → 丢弃
                [9, 9, 9], // 合法
              ],
              color: "#ff0000",
            },
          ],
          size: [16, 16, 16],
        }),
      ),
    } as never);
    await createLitematic3D("/mixed.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    layerMode.value = "all";
    layerMode.dispatchEvent(new Event("change"));
    // 5 条 → 3 条合法（1 个原点 + 2 个），2 条非法被丢弃
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(3);
    unmountOverlay(overlay);
  });

  it("边界体素 [size-1] 渲染：chunk 索引不越界", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[15, 15, 15], [0, 0, 0]], color: "#0000ff" }],
          size: [16, 16, 16],
        }),
      ),
    } as never);
    await createLitematic3D("/edge.litematic", "GetLitematicVoxelData");
    expect(meshInstances.length).toBeGreaterThanOrEqual(1);
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    layerMode.value = "all";
    layerMode.dispatchEvent(new Event("change"));
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2); // 边界 + 原点都在
    unmountOverlay(overlay);
  });

  it("applyLayer single 模式：只保留目标层方块，count 过滤正确", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [
            { positions: [[0, 0, 0], [1, 0, 0], [2, 5, 2]], color: "#abcdef" },
          ],
          size: [16, 16, 16],
        }),
      ),
    } as never);
    await createLitematic3D("/layer.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    // 切到 single 后，把 layerVal 调到 1（target 层 0）
    layerMode.value = "single";
    layerMode.dispatchEvent(new Event("change"));
    const layerSlider = overlay.querySelectorAll<HTMLInputElement>(
      'input[type="range"]',
    );
    // single 模式下第一个可见 layer slider（非速度滑块）控制 layerVal
    const ls = [...layerSlider].find(
      (el) => el.style.display !== "none" && el.min === "1",
    ) as HTMLInputElement;
    ls.value = "1";
    ls.dispatchEvent(new Event("input"));
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2); // [0,0,0] 和 [1,0,0] 在 Y=0 层；[2,5,2] 被过滤
    unmountOverlay(overlay);
  });
});

describe("审核补充：边界与异步路径", () => {
  it("truncated 且无 maxBlocks → 使用兜底上限 200,000", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0]] }],
          size: [10, 10, 10],
          truncated: true, // 无 maxBlocks 字段
        }),
      ),
    } as never);
    await createLitematic3D("/trunc-fallback.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("200,000");
    unmountOverlay(overlay);
  });

  it("加载期间 ESC 关闭 → aborted 守卫：迟到的数据不重建 overlay", async () => {
    let resolveFn: (v: string) => void = () => {};
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: (() =>
        new Promise<string>((r) => {
          resolveFn = r;
        })) as never,
    } as never);
    const p = createLitematic3D("/slow.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay(); // overlay 同步已挂载（首个 await 之前）
    // 让 build 越过首个 await getApp()、真正进入 await fn(path)：此刻 resolveFn 才被真实赋值；
    // 必须在此微任务让出后、再发 ESC，才能命中「加载中关闭」分支（迟到的数据不重建 overlay）。
    await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.contains(overlay)).toBe(false);
    resolveFn(VALID_JSON); // 此刻 resolveFn 已是 fn(path) 的真实 resolver
    await p;
    expect(document.body.contains(overlay)).toBe(false); // 迟到数据不复活
  });

  it("非立方体模型切单层：layerVal 在 setupRange 后同步（原 bug：整屏空白）", async () => {
    // size=[16,8,16]，默认 Y 轴 layerMax=8；[0,7,0] 在 Y=7 层
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 7, 0], [0, 5, 0]], color: "#ffffff" }],
          size: [16, 8, 16],
        }),
      ),
    } as never);
    await createLitematic3D("/noncube.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    layerMode.value = "single";
    layerMode.dispatchEvent(new Event("change"));
    // 修复前 layerVal=16 → target=15 → 全部过滤（count=0）；修复后 target=7 → 只留 Y=7
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(1);
    unmountOverlay(overlay);
  });

  it("layerInput 输入越界值 → 钳到 [1, layerMax]", async () => {
    await createLitematic3D("/clamp.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    layerMode.value = "single";
    layerMode.dispatchEvent(new Event("change"));
    const numInput = overlay.querySelector('input[type="number"]') as HTMLInputElement;
    expect(numInput.style.display).not.toBe("none"); // single 模式下数字输入可见
    numInput.value = "999";
    numInput.dispatchEvent(new Event("change"));
    expect(numInput.value).toBe("16"); // size=16 → layerMax=16，越界钳回
    numInput.value = "0";
    numInput.dispatchEvent(new Event("change"));
    expect(numInput.value).toBe("1"); // 低于下限钳到 1
    unmountOverlay(overlay);
  });

  it("范围模式双滑块：slider2 决定区间上界，过滤正确", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0], [1, 1, 1], [2, 2, 2]], color: "#ffffff" }],
          size: [16, 16, 16],
        }),
      ),
    } as never);
    await createLitematic3D("/range.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const selects = overlay.querySelectorAll("select");
    const layerMode = selects[selects.length - 1] as HTMLSelectElement;
    layerMode.value = "range";
    layerMode.dispatchEvent(new Event("change"));
    // range 模式：layerSlider 设 1（lo=0），slider2 设 2（hi=2）→ 区间 [0,2) 保留 Y=0/1
    const ranges = overlay.querySelectorAll<HTMLInputElement>('input[type="range"]');
    ranges[1].value = "1"; // layerSlider
    ranges[1].dispatchEvent(new Event("input"));
    ranges[2].value = "2"; // layerSlider2
    ranges[2].dispatchEvent(new Event("input"));
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2);
    unmountOverlay(overlay);
  });

  it("自身旋转模式拖拽：pointerdown + pointermove → quaternion 更新", async () => {
    await createLitematic3D("/drag.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    const sel = overlay.querySelector("select") as HTMLSelectElement;
    sel.value = "false"; // 自身模式（非 orbit）
    sel.dispatchEvent(new Event("change"));
    const rendererEl = Array.from(overlay.querySelectorAll("div")).find(
      (d) => d.style.touchAction === "none",
    ) as HTMLElement;
    expect(rendererEl).toBeTruthy();
    const cam = cameraInstances.at(-1)!;
    rendererEl.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 40 }));
    expect(cam.quaternion.setFromEuler).toHaveBeenCalled();
    // 松开指针后右键不触发自身旋转
    window.dispatchEvent(new PointerEvent("pointerup"));
    cam.quaternion.setFromEuler.mockClear();
    rendererEl.dispatchEvent(new PointerEvent("pointerdown", { button: 2, clientX: 10, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 40 }));
    expect(cam.quaternion.setFromEuler).not.toHaveBeenCalled();
    unmountOverlay(overlay);
  });
});

/** 通过关闭按钮移除 overlay（避免污染后续用例） */
function unmountOverlay(overlay: HTMLElement): void {
  const btn = overlay.querySelector("button") as HTMLElement | null;
  if (btn) btn.click();
  else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  void sleep;
}
