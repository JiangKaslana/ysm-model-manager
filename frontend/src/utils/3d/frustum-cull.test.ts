// ===== frustum-cull 险恶测试 =====
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import {
  registerModelRoot,
  unregisterModelRoot,
  cullModelGroups,
  clearModelRoots,
  getModelRootCount,
} from "./frustum-cull.ts";

// Mock THREE 的 Frustum/Matrix4 以控制裁剪结果
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return actual;
});

function makeGroup(name?: string): THREE.Group {
  const g = new THREE.Group();
  if (name) g.name = name;
  // 给一个默认的 bounding box（非空）
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geo);
  g.add(mesh);
  return g;
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
}

describe("frustum-cull", () => {
  beforeEach(() => {
    clearModelRoots();
  });

  it("register + getModelRootCount", () => {
    const g = makeGroup();
    expect(getModelRootCount()).toBe(0);
    registerModelRoot(g);
    expect(getModelRootCount()).toBe(1);
    registerModelRoot(g); // 重复注册不增加
    expect(getModelRootCount()).toBe(1);
  });

  it("unregister", () => {
    const g1 = makeGroup("a");
    const g2 = makeGroup("b");
    registerModelRoot(g1);
    registerModelRoot(g2);
    expect(getModelRootCount()).toBe(2);
    unregisterModelRoot(g1);
    expect(getModelRootCount()).toBe(1);
    unregisterModelRoot(makeGroup("unknown")); // 不存在的不报错
    expect(getModelRootCount()).toBe(1);
  });

  it("clearModelRoots", () => {
    registerModelRoot(makeGroup("a"));
    registerModelRoot(makeGroup("b"));
    registerModelRoot(makeGroup("c"));
    expect(getModelRootCount()).toBe(3);
    clearModelRoots();
    expect(getModelRootCount()).toBe(0);
  });

  it("cullModelGroups 清理已移除的引用", () => {
    const g = makeGroup();
    registerModelRoot(g);
    expect(getModelRootCount()).toBe(1);
    // 从父节点移除
    const parent = new THREE.Scene();
    parent.add(g);
    parent.remove(g);
    // cull 时应自动清理
    cullModelGroups(makeCamera());
    expect(getModelRootCount()).toBe(0);
  });

  it("cullModelGroups 不报错当无注册时", () => {
    expect(() => cullModelGroups(makeCamera())).not.toThrow();
  });

  it("cullModelGroups 对空组设置 visible=false", () => {
    const g = new THREE.Group(); // 空组，无子节点 → 空 bounding box
    registerModelRoot(g);
    const scene = new THREE.Scene();
    scene.add(g);
    cullModelGroups(makeCamera());
    // 空组应被裁剪
    expect(g.visible).toBe(false);
  });

  it("cullModelGroups 对有内容的组保留 visible", () => {
    const g = makeGroup("content");
    registerModelRoot(g);
    const scene = new THREE.Scene();
    scene.add(g);
    // 相机正对原点，组在原点 → 应该可见
    const cam = makeCamera();
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cullModelGroups(cam);
    expect(g.visible).toBe(true);
  });

  it("多模型独立裁剪", () => {
    const g1 = makeGroup("near");
    g1.position.set(0, 0, 0);
    const g2 = makeGroup("far");
    g2.position.set(10000, 10000, 10000); // 极远处
    registerModelRoot(g1);
    registerModelRoot(g2);
    const scene = new THREE.Scene();
    scene.add(g1);
    scene.add(g2);
    const cam = makeCamera();
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cullModelGroups(cam);
    // 近处组可见，极远组不可见
    expect(g1.visible).toBe(true);
    expect(g2.visible).toBe(false);
  });
});
