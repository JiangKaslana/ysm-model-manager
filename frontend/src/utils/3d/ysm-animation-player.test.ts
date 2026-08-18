import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createYsmAnimPlayer, type YsmAnimPlayer } from "./ysm-animation-player.ts";
import type { AnimationClip } from "../animation/animation.ts";
import type { BoneHierarchyNode } from "../animation/animation.ts";

function makeClip(length = 2.0, boneName = "root"): AnimationClip {
  return {
    name: "test",
    loop: true,
    length,
    bones: {
      [boneName]: {
        position: [
          { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          { time: 1, post: [1, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          { time: 2, post: [0, 0, 0], pre: [1, 0, 0], lerp: "linear" },
        ],
      },
    },
  };
}

const H: BoneHierarchyNode[] = [{ name: "root" }];

function makeBone(name: string): THREE.Object3D {
  const b = new THREE.Object3D();
  b.name = name;
  return b;
}

describe("createYsmAnimPlayer", () => {
  it("apply 后骨骼变换被更新", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    player.apply(1.0);
    expect(bone.position.x).toBeCloseTo(1.0, 5);
  });

  it("toggle/isPlaying 状态切换", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    expect(player.isPlaying()).toBe(true);
    player.toggle();
    expect(player.isPlaying()).toBe(false);
    const startX = bone.position.x;
    player.apply(0.5);
    expect(bone.position.x).toBeCloseTo(startX, 5);
  });

  it("loop 动画超过 clip.length 后取模", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    player.apply(3.0);
    expect(bone.position.x).toBeCloseTo(1.0, 5); // 3%2=1
  });

  it("非 loop 动画超过 clip.length 后暂停在末帧", () => {
    const bone = makeBone("root");
    const clip = { ...makeClip(2), loop: false };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clip], H, ["run"]);
    player.apply(3.0);
    expect(bone.position.x).toBeCloseTo(0.0, 5);
    expect(player.isPlaying()).toBe(false);
  });

  it("骨骼名不匹配静默跳过不抛错", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["head", bone]]), [makeClip(2)], H, ["run"]);
    expect(() => player.apply(1.0)).not.toThrow();
    expect(bone.position.x).toBe(0);
  });

  it("dispose 后重置状态", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    player.apply(1.5);
    player.dispose();
    expect(player.getTime()).toBe(0);
    expect(player.isPlaying()).toBe(true);
  });

  // ---- L2 多 clip ----
  it("clipCount 返回正确数量", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1), makeClip(2), makeClip(3)], H, ["idle", "run", "attack"]);
    expect(player.clipCount()).toBe(3);
  });

  it("clips() 返回正确标签列表", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1), makeClip(2)], H, ["idle", "run"]);
    expect(player.clips()).toEqual([{ label: "idle" }, { label: "run" }]);
  });

  it("selectClip 切换后 time 重置", () => {
    const bone = makeBone("root");
    const clip1 = makeClip(2);
    const clip2: AnimationClip = {
      name: "jump", loop: false, length: 2,
      bones: {
        root: {
          position: [
            { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 1, post: [0, 1, 0], pre: [0, 0, 0], lerp: "linear" },
          ],
        },
      },
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clip1, clip2], H, ["idle", "jump"]);
    player.selectClip(1);
    expect(player.currentIndex()).toBe(1);
    expect(player.getTime()).toBe(0);
    player.apply(1.0);
    expect(bone.position.y).toBeCloseTo(1.0, 5);
  });

  it("selectClip 越界静默忽略", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1)], H, ["idle"]);
    player.selectClip(99);
    expect(player.currentIndex()).toBe(0);
    player.selectClip(-1);
    expect(player.currentIndex()).toBe(0);
  });

  it("自定义 clipLabels 可选", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1)], H, ["custom"]);
    expect(player.clips()[0].label).toBe("custom");
  });

  it("缺省 clipLabels 自动生成", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1), makeClip(2)], H);
    expect(player.clips()[0].label).toBe("Clip 0");
    expect(player.clips()[1].label).toBe("Clip 1");
  });

  it("isAnimActive 播放中返回 true，暂停返回 false", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(2)], H, ["run"]);
    expect(player.isAnimActive()).toBe(true);
    player.toggle();
    expect(player.isAnimActive()).toBe(false);
  });
});
