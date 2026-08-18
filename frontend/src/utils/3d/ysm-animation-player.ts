// ===== YSM 骨骼动画播放器（ADR-100 L1+L2）=====
// 把 parseBedrockAnimationJSON 产出的 AnimationClip 驱动到 THREE.Object3D 骨骼节点上。
// 纯 Three.js 逻辑，0 backend import（ADR-072 边界纯净）。
//
// 与 VRM VRMA 的差异：
//   - VRM：GLTFLoader + VRMAnimationLoaderPlugin 自动解析 .vrma → vrmAnimations
//   - YSM：手动调 parseBedrockAnimationJSON → evaluateClip → 应用 Group 变换
//
// YSM 骨骼是 THREE.Group 层级（非 THREE.Bone），变换直接作用在 group.position/quaternion/scale。
// 旋转用四元数 slerp 路径平滑（避免欧拉角跳变）。

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
  /** 当前 clip 时长（秒） */
  getDuration(): number;
  /** 当前 clip 索引 */
  currentIndex(): number;
  /** 可用 clip 列表 */
  clips(): ReadonlyArray<{ label: string }>;
  /** 总 clip 数 */
  clipCount(): number;
  /** 切换到指定 clip（0-based index；越界静默忽略） */
  selectClip(index: number): void;
  /** 是否正在播放有效动画（供感知层判断是否暂停呼吸/眨眼） */
  isAnimActive(): boolean;
}

/**
 * 构建 YSM 骨骼动画播放器。
 * @param boneByName   spec.bones[].name → THREE.Object3D（骨骼节点，通常是 Group）映射
 * @param clips        动画剪辑列表（至少 1 个）
 * @param boneHierarchy 骨骼层级 [{name, parent}] 供 evaluateClip 传播
 * @param clipLabels   每 clip 的显示名；缺省时用 "Clip 0", "Clip 1"...
 */
export function createYsmAnimPlayer(
  boneByName: Map<string, THREE.Object3D>,
  clips: AnimationClip[],
  boneHierarchy: BoneHierarchyNode[],
  clipLabels?: string[],
): YsmAnimPlayer {
  if (clips.length === 0) throw new Error("YSM animation player requires at least one clip");

  const rawLabels = clipLabels ?? clips.map((_, i) => `Clip ${i}`);
  const labels: readonly { label: string }[] = rawLabels.slice(0, clips.length).map((l) => ({ label: l }));
  let currentIdx = 0;
  let elapsed = 0;
  let playing = true;

  // slerp 支持：记录每个骨骼的 rest quaternion（首次 apply 时保存）
  const restQuaternions = new Map<string, THREE.Quaternion>();

  function getClip(): AnimationClip { return clips[currentIdx]; }

  return {
    apply(dt: number): void {
      if (!playing || clips.length === 0) return;
      const clip = getClip();

      elapsed += dt;
      if (clip.loop && clip.length > 0) {
        elapsed = ((elapsed % clip.length) + clip.length) % clip.length;
      } else if (elapsed > clip.length) {
        elapsed = clip.length;
        playing = false;
      }

      const transforms = evaluateClip(clip, elapsed, boneHierarchy, true);

      for (const [boneName, transform] of transforms) {
        const node = boneByName.get(boneName);
        if (!node) continue; // 未匹配骨骼静默跳过

        if (transform.rotation) {
          const [rx, ry, rz] = transform.rotation;
          const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "XYZ"));
          const rest = restQuaternions.get(boneName);
          if (rest) {
            // slerp 路径：从 rest 姿态到目标姿态的旋转增量
            node.quaternion.copy(rest).multiplyQuaternions(rest.clone().conjugate(), targetQuat);
          } else {
            node.quaternion.copy(targetQuat);
            restQuaternions.set(boneName, node.quaternion.clone());
          }
        }

        if (transform.position) {
          const [px, py, pz] = transform.position;
          node.position.set(px, py, pz);
        }
        if (transform.scale) {
          const [sx, sy, sz] = transform.scale;
          node.scale.set(sx, sy, sz);
        }
      }
    },

    dispose(): void {
      elapsed = 0;
      playing = true;
      restQuaternions.clear();
    },

    toggle(): void {
      if (elapsed >= getClip().length && !getClip().loop) {
        elapsed = 0;
        playing = true;
      } else {
        playing = !playing;
      }
    },

    isPlaying(): boolean { return playing; },
    getTime(): number { return elapsed; },
    getDuration(): number { return getClip().length || 0; },
    currentIndex(): number { return currentIdx; },
    clips(): ReadonlyArray<{ label: string }> { return labels; },
    clipCount(): number { return clips.length; },
    selectClip(index: number): void {
      if (index < 0 || index >= clips.length) return;
      currentIdx = index;
      elapsed = 0;
      playing = true;
      restQuaternions.clear();
    },
    isAnimActive(): boolean {
      return playing && elapsed < (getClip().length || Infinity);
    },
  };
}
