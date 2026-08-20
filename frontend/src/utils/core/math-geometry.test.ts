// @vitest-environment node
// ===== 数学/几何辅助测试（math-geometry.ts）=====
import { describe, it, expect } from "vitest";
import { dist2d, dist3d, degToRad, radToDeg } from "./math-geometry.ts";

describe("dist2d — 2D 欧几里得距离", () => {
  it("同一点距离为 0", () => {
    expect(dist2d({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });

  it("水平距离", () => {
    expect(dist2d({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
  });

  it("垂直距离", () => {
    expect(dist2d({ x: 0, y: 0 }, { x: 0, y: 4 })).toBe(4);
  });

  it("经典 3-4-5 三角形", () => {
    expect(dist2d({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("负坐标", () => {
    expect(dist2d({ x: -1, y: -1 }, { x: 2, y: 3 })).toBe(5);
  });
});

describe("dist3d — 3D 欧几里得距离", () => {
  it("同一点距离为 0", () => {
    expect(dist3d({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBe(0);
  });

  it("经典 1-2-2 距离为 3", () => {
    expect(dist3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBe(3);
  });

  it("仅 z 轴偏移", () => {
    expect(dist3d({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 5 })).toBe(5);
  });

  it("负坐标", () => {
    expect(dist3d({ x: -1, y: -2, z: -3 }, { x: 1, y: 2, z: 3 })).toBeCloseTo(Math.sqrt(56));
  });
});

describe("degToRad — 角度转弧度", () => {
  it("0 度 = 0 弧度", () => {
    expect(degToRad(0)).toBe(0);
  });

  it("180 度 = π 弧度", () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  it("360 度 = 2π 弧度", () => {
    expect(degToRad(360)).toBeCloseTo(Math.PI * 2);
  });

  it("90 度 = π/2 弧度", () => {
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  it("负角度", () => {
    expect(degToRad(-90)).toBeCloseTo(-Math.PI / 2);
  });
});

describe("radToDeg — 弧度转角度", () => {
  it("0 弧度 = 0 度", () => {
    expect(radToDeg(0)).toBe(0);
  });

  it("π 弧度 = 180 度", () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
  });

  it("2π 弧度 = 360 度", () => {
    expect(radToDeg(Math.PI * 2)).toBeCloseTo(360);
  });

  it("π/2 弧度 = 90 度", () => {
    expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
  });

  it("degToRad 与 radToDeg 互逆", () => {
    expect(radToDeg(degToRad(42))).toBeCloseTo(42);
  });
});
