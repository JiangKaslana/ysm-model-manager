import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { createYsmAnimPlayer, type YsmAnimPlayer } from "./ysm-animation-player.ts";
import type { AnimationClip } from "../animation/animation.ts";

/** 构造一个最简单的 loop 动画 clip：root 骨骼在 X 轴上来回移动 */
function makeSimpleClip(length = 2.0): AnimationClip {
  return {
    name: "test",
    loop: true,
    length,
    bones: {
      root: {
        position: [
          { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          { time: 1, post: [1, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          { time: 2, post: [0, 0, 0], pre: [1, 0, 0], lerp: "linear" },
        ],
      },
    },
  };
}

function makeBone(name: string): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  return b;
}

describe("createYsmAnimPlayer", () => {
  it("apply 后骨骼变换被更新", () => {
    const bone = makeBone("root");
    const boneByName = new Map([["root", bone]]);
    const clip = makeSimpleClip(2);
    const player = createYsmAnimPlayer(boneByName, clip, [{ name: "root" }]);

    player.apply(1.0); // t=1 → position=[1,0,0]
    expect(bone.position.x).toBeCloseTo(1.0, 5);
  });

  it("toggle/isPlaying 状态切换", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), makeSimpleClip(2), [{ name: "root" }]);
    expect(player.isPlaying()).toBe(true);
    player.toggle();
    expect(player.isPlaying()).toBe(false);
    // dt 推进但 playing=false 不应改变位置
    const startX = bone.position.x;
    player.apply(0.5);
    expect(bone.position.x).toBeCloseTo(startX, 5);
  });

  it("loop 动画超过 clip.length 后取模", () => {
    const bone = makeBone("root");
    const clip = makeSimpleClip(2);
    const player = createYsmAnimPlayer(new Map([["root", bone]]), clip, [{ name: "root" }]);

    player.apply(3.0); // t=3, loop → t=1（3%2=1）
    expect(bone.position.x).toBeCloseTo(1.0, 5);
  });

  it("非 loop 动画超过 clip.length 后暂停在末帧", () => {
    const bone = makeBone("root");
    const clip = { ...makeSimpleClip(2), loop: false };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), clip, [{ name: "root" }]);

    player.apply(3.0); // t=3 > length=2 → clamp to 2, playing=false
    expect(bone.position.x).toBeCloseTo(0.0, 5); // t=2 → position=[0,0,0]
    expect(player.isPlaying()).toBe(false);
  });

  it("骨骼名不匹配静默跳过不抛错", () => {
    const bone = makeBone("root");
    // boneByName 里没有 "root"，只有 "head"
    const boneByName = new Map([["head", bone]]);
    const clip = makeSimpleClip(2);
    const player = createYsmAnimPlayer(boneByName, clip, [{ name: "root" }]);

    expect(() => player.apply(1.0)).not.toThrow();
    // 骨骼位置不变
    expect(bone.position.x).toBe(0);
  });

  it("dispose 后重置状态", () => {
    const bone = makeBone("root");
    const clip = makeSimpleClip(2);
    const player = createYsmAnimPlayer(new Map([["root", bone]]), clip, [{ name: "root" }]);
    player.apply(1.5);
    player.dispose();
    expect(player.getTime()).toBe(0);
    expect(player.isPlaying()).toBe(true);
    // dispose 后 apply 不再报错
    expect(() => player.apply(0.1)).not.toThrow();
  });

  it("getDuration 返回 clip.length", () => {
    const player = createYsmAnimPlayer(
      new Map(),
      makeSimpleClip(5.0),
      [],
    );
    expect(player.getDuration()).toBe(5.0);
  });

  it("rotate 通道通过 quaternion 应用", () => {
    const bone = makeBone("root");
    const clip: AnimationClip = {
      name: "rot",
      loop: false,
      length: 1,
      bones: {
        root: {
          rotation: [
            { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 1, post: [Math.PI / 2, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          ],
        },
      },
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), clip, [{ name: "root" }]);
    player.apply(1.0);
    // Euler(PI/2, 0, 0) → quaternion 的 x 分量应非零
    expect(bone.quaternion.x).not.toBe(0);
  });
});
