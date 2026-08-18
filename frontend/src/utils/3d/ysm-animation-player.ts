// ===== YSM 骨骼动画播放器（ADR-100 L1）=====
// 把 parseBedrockAnimationJSON 产出的 AnimationClip 驱动到 THREE.Bone 上。
// 纯 Three.js 逻辑，0 backend import（ADR-072 边界纯净）。
//
// 与 VRM VRMA 的差异：
//   - VRM：GLTFLoader + VRMAnimationLoaderPlugin 自动解析 .vrma → vrmAnimations
//   - YSM：手动调 parseBedrockAnimationJSON → evaluateClip → 应用 Bone 变换
//
// 旋转格式：.animation.json 的 rotation keyframe = [rx, ry, rz] 弧度（欧拉），
// 与 SpecBone3D.localRotation 口径一致，直接 new THREE.Euler() 即可。

import * as THREE from "three";
import {
  evaluateClip,
  type AnimationClip,
  type BoneTransform,
  type BoneHierarchyNode,
} from "../animation/animation.ts";

/** YSM 骨骼动画播放器接口 */
export interface YsmAnimPlayer {
  /** 应用一帧变换到骨骼（由 adapter update 每帧调用，dt 秒） */
  apply(dt: number): void;
  /** 释放内部状态（dispose 时调用） */
  dispose(): void;
  /** 播放/暂停切换 */
  toggle(): void;
  /** 是否正在播放 */
  isPlaying(): boolean;
  /** 当前时间（秒） */
  getTime(): number;
  /** 动画总时长（秒） */
  getDuration(): number;
}

/** 构建 YSM 骨骼动画播放器 */
export function createYsmAnimPlayer(
  boneByName: Map<string, THREE.Bone>,
  clip: AnimationClip,
  boneHierarchy: BoneHierarchyNode[],
): YsmAnimPlayer {
  let elapsed = 0;
  let playing = true;

  return {
    apply(dt: number): void {
      if (!playing) return;
      elapsed += dt;
      if (clip.loop && clip.length > 0) {
        elapsed = ((elapsed % clip.length) + clip.length) % clip.length;
      } else if (elapsed > clip.length) {
        elapsed = clip.length;
        playing = false;
      }

      const transforms = evaluateClip(clip, elapsed, boneHierarchy, true);
      for (const [boneName, transform] of transforms) {
        const bone = boneByName.get(boneName);
        if (!bone) continue; // 未匹配骨骼静默跳过

        if (transform.rotation) {
          const [rx, ry, rz] = transform.rotation;
          bone.quaternion.setFromEuler(new THREE.Euler(rx, ry, rz, "XYZ"));
        }
        if (transform.position) {
          const [px, py, pz] = transform.position;
          bone.position.set(px, py, pz);
        }
        if (transform.scale) {
          const [sx, sy, sz] = transform.scale;
          bone.scale.set(sx, sy, sz);
        }
      }
    },

    dispose(): void {
      elapsed = 0;
      playing = true;
    },

    toggle(): void {
      if (elapsed >= clip.length && !clip.loop) {
        // 非循环动画播到末尾，toggle 从头重启
        elapsed = 0;
        playing = true;
      } else {
        playing = !playing;
      }
    },

    isPlaying(): boolean {
      return playing;
    },

    getTime(): number {
      return elapsed;
    },

    getDuration(): number {
      return clip.length || 0;
    },
  };
}
