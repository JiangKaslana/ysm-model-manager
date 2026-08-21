// ===== FBX 适配器测试（ADR-112 地基 TDD）====
// 覆盖：build 主路径（readBytes → FBXLoader.load → 挂场景 + 播内嵌动画 + 相机取景）、
// 空字节错误路径、无内嵌动画时 mixer 缺失路径健壮性、dispose 释放（scene.remove + 几何/材质释放）。
// three 用真实实现；FBXLoader 全 mock（避免在 vitest 内跑真实 FBX 解析）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { PreviewBuildCtx } from "./mount-preview-core.ts";
import { buildFbxScene } from "./fbx-adapter.ts";

const hoisted = vi.hoisted(() => {
  const loadImpl = vi.fn();
  let withAnim = true;
  return {
    loadImpl,
    readBytesMock: vi.fn(),
    setWithAnim: (v: boolean) => {
      withAnim = v;
    },
    getWithAnim: () => withAnim,
  };
});

vi.mock("three/addons/loaders/FBXLoader.js", () => ({
  FBXLoader: class {
    constructor(_manager?: unknown) {}
    load(_url: string, onLoad: (g: unknown) => void): void {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      g.add(mesh);
      if (hoisted.getWithAnim()) {
        (g as unknown as { animations: THREE.AnimationClip[] }).animations = [
          new THREE.AnimationClip("clip1", 1, []),
        ];
      }
      hoisted.loadImpl(_url, onLoad);
      onLoad(g);
    }
  },
}));

function makeCtx(): PreviewBuildCtx {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  const controls = {
    target: new THREE.Vector3(),
    minDistance: 0,
    maxDistance: 0,
    update: vi.fn(),
  } as unknown as NonNullable<PreviewBuildCtx["controls"]>;
  return { scene, camera, controls, renderer: null } as unknown as PreviewBuildCtx;
}

describe("fbx-adapter", () => {
  beforeEach(() => {
    hoisted.readBytesMock.mockReset();
    hoisted.loadImpl.mockReset();
    hoisted.setWithAnim(true);
  });

  it("build 主路径：读字节→加载→挂场景→播动画→相机取景", async () => {
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake fbx binary").toString("base64"));
    const ctx = makeCtx();
    const scene = ctx.scene as THREE.Scene;
    const addSpy = vi.spyOn(scene, "add");
    const removeSpy = vi.spyOn(scene, "remove");

    const built = await buildFbxScene(ctx, "/repo/mmd/CustomAnim/a.fbx", {
      readFileBytes: hoisted.readBytesMock,
    });

    // 字节按路径读取
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/repo/mmd/CustomAnim/a.fbx");
    // 模型挂入场景
    expect(addSpy).toHaveBeenCalledTimes(1);
    // 返回标准 PreviewScene 契约
    expect(typeof built.update).toBe("function");
    expect(typeof built.dispose).toBe("function");
    expect(typeof built.screenshot).toBe("function");
    // 相机取景已设置
    expect((ctx.camera as THREE.PerspectiveCamera).position.length()).toBeGreaterThan(0);
    expect((ctx.controls as { update: () => void }).update).toHaveBeenCalled();
    // perFrame 驱动不抛（mixer.update）
    expect(() => built.update?.(0.016)).not.toThrow();
    // dispose 释放并移出场景
    built.dispose();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("空字节抛错（ReadFileBytes 返回 null）", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await expect(
      buildFbxScene(ctx, "/x.fbx", { readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow();
  });

  it("无内嵌动画时 mixer 缺失，update/dispose 安全空转", async () => {
    hoisted.setWithAnim(false);
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake").toString("base64"));
    const ctx = makeCtx();
    const built = await buildFbxScene(ctx, "/y.fbx", { readFileBytes: hoisted.readBytesMock });
    expect(() => built.update?.(0.016)).not.toThrow();
    expect(() => built.dispose()).not.toThrow();
  });
});
