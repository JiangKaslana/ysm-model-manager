// ===== YSM 骨骼动画播放器（ADR-100 L1+L2+L3）=====
// 把 parseBedrockAnimationJSON 产出的 AnimationClip 驱动到 THREE.Object3D 骨骼节点上。
// 纯 Three.js 逻辑，0 backend import（ADR-072 边界纯净）。
//
// 与 VRM VRMA 的差异：
//   - VRM：GLTFLoader + VRMAnimationLoaderPlugin 自动解析 .vrma → vrmAnimations
//   - YSM：手动调 parseBedrockAnimationJSON → evaluateClip → 应用 Group 变换
//
// YSM 骨骼是 THREE.Group 层级（非 THREE.Bone），变换直接作用在 group.position/quaternion/scale。
//
// L3 混合模型（对齐 YSMViewer 的过渡口径：从不硬切）：
//   - 三通道（rotation/position/scale）统一 alpha 累加混合：切换/开播时 rest
//     采集当前姿态，alpha 按 BLEND_RATE 累加到 1（大 dt 单帧即精确到位）。
//   - 构造期捕获各骨骼 base 姿态；当前 clip 未触及的骨骼目标回落到 base，
//     实现「停播骨骼渐回零位」（YSMViewer Aura3DRenderer 同款收尾）。

import * as THREE from "three";
import {
  evaluateClip,
  type AnimationClip,
  type BoneChannels,
  type BoneHierarchyNode,
  type Vec3,
} from "../animation/animation.ts";

export interface YsmAnimPlayer {
  apply(dt: number): void;
  dispose(): void;
  toggle(): void;
  isPlaying(): boolean;
  getTime(): number;
  getDuration(): number;
  currentIndex(): number;
  clips(): ReadonlyArray<{ label: string }>;
  clipCount(): number;
  selectClip(index: number): void;
  isAnimActive(): boolean;
}

/**
 * Builds a YSM animation player whose per-frame path reuses every temporary object.
 * boneHierarchy remains in the signature for API compatibility; Three.js already
 * propagates the local transforms through the Object3D hierarchy.
 */
export function createYsmAnimPlayer(
  boneByName: Map<string, THREE.Object3D>,
  clips: AnimationClip[],
  boneHierarchy: BoneHierarchyNode[],
  clipLabels?: string[],
): YsmAnimPlayer {
  if (clips.length === 0) throw new Error("YSM animation player requires at least one clip");

  const rawLabels = clipLabels ?? clips.map((_, i) => `Clip ${i}`);
  const labels = rawLabels.slice(0, clips.length).map((label) => ({ label }));

  let currentIdx = 0;
  let elapsed = 0;
  let playing = true;

  // L3 混合状态：base = 构造期姿态（未动画骨骼的回落目标）；
  // rest = 混合段起点（selectClip/dispose 后从当前姿态重新采集），alpha 累加到 1。
  interface BonePose { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3; }
  const basePose = new Map<string, BonePose>();
  for (const [name, node] of boneByName) {
    basePose.set(name, { pos: node.position.clone(), quat: node.quaternion.clone(), scale: node.scale.clone() });
  }
  const restPose = new Map<string, BonePose>();
  const blendAlpha = new Map<string, number>();
  const BLEND_RATE = 5.0; // 混合速率：~0.2s 到达目标

  // 每帧复用的 scratch（避免骨骼数×帧率级的小对象分配）
  const _targetQuat = new THREE.Quaternion();
  const _targetEuler = new THREE.Euler();
  const _targetPos = new THREE.Vector3();
  const _targetScale = new THREE.Vector3();

  function getClip(): AnimationClip { return clips[currentIdx]; }

  return {
    apply(dt: number): void {
      if (!playing) return;
      const clip = getClip();
      elapsed += dt;
      if (clip.loop && clip.length > 0) {
        elapsed = ((elapsed % clip.length) + clip.length) % clip.length;
      } else if (elapsed > clip.length) {
        elapsed = clip.length;
        playing = false;
      }

      const transforms = evaluateClip(clip, elapsed, boneHierarchy, true);

      for (const [boneName, node] of boneByName) {
        const base = basePose.get(boneName);
        if (!base) continue;
        const transform = transforms.get(boneName);

        // 目标姿态：clip 通道值；缺通道回落 base（停播骨骼渐回零位的来源）
        // L4 修复（ADR-100 骨骼朝向遗留）：Bedrock 格式欧拉序为 ZYX（Blockbench bedrock.js
        // L648-882），而非 THREE.Euler 默认 XYZ。错误序会导致旋转轴错乱，角色"乱飞"。
        if (transform?.rotation) {
          const [rx, ry, rz] = transform.rotation;
          _targetQuat.setFromEuler(_targetEuler.set(rz, ry, rx, "ZYX"));
        } else {
          _targetQuat.copy(base.quat);
        }
        if (transform?.position) {
          // 游戏内口径（NativeModelRenderer.calculateBoneMatrix L217-221 / RenderUtils
          // prepMatrixForBone L95）：动画位移是**相对位移**——叠加到骨骼旋转中心
          // （localPosition），而非覆盖；X 轴取负（游戏内 -posX）。骨骼 Group 在像素
          // 空间（外层 modelScale=1/16 整体缩放），位移直接像素值叠加，与游戏内 /16
          // 换算后等效（对拍 compare-bone-anim.mjs 实证：修复前 posΔ 4~32 全红）。
          _targetPos.set(
            base.pos.x - transform.position[0],
            base.pos.y + transform.position[1],
            base.pos.z + transform.position[2],
          );
        } else {
          _targetPos.copy(base.pos);
        }
        if (transform?.scale) {
          const [sx, sy, sz] = transform.scale;
          if (sx === 0 && sy === 0 && sz === 0) {
            // 游戏内 scale=0 → 整骨不可见（calculateBoneMatrix L213-215 isVisible=false），
            // 而非塌缩成点
            node.visible = false;
          } else {
            node.visible = true;
            _targetScale.set(sx, sy, sz);
          }
        } else {
          _targetScale.copy(base.scale);
          node.visible = true;
        }

        let rest = restPose.get(boneName);
        let alpha = blendAlpha.get(boneName) ?? 0;
        if (!rest) {
          // 混合段起点：采集当前姿态；alpha 从本帧 dt 起步（大 dt 单帧精确到位）
          rest = { pos: node.position.clone(), quat: node.quaternion.clone(), scale: node.scale.clone() };
          restPose.set(boneName, rest);
          alpha = Math.min(1, dt * BLEND_RATE);
        } else {
          alpha = Math.min(1, alpha + dt * BLEND_RATE);
        }
        blendAlpha.set(boneName, alpha);

        node.quaternion.copy(rest.quat).slerp(_targetQuat, alpha);
        node.position.copy(rest.pos).lerp(_targetPos, alpha);
        node.scale.copy(rest.scale).lerp(_targetScale, alpha);
      }
    },

    dispose(): void {
      elapsed = 0;
      playing = true;
      restPose.clear();
      blendAlpha.clear();
    },
    toggle(): void {
      if (elapsed >= getClip().length && !getClip().loop) {
        elapsed = 0;
        playing = true;
      } else {
        playing = !playing;
      }
    },
    isPlaying: () => playing,
    getTime: () => elapsed,
    getDuration: () => getClip().length || 0,
    currentIndex: () => currentIdx,
    clips: () => labels,
    clipCount: () => clips.length,
    selectClip(index: number): void {
      if (index < 0 || index >= clips.length) return;
      currentIdx = index;
      elapsed = 0;
      playing = true;
      // 清空混合状态：下一帧从当前姿态重新采集 rest，实现平滑切入新 clip
      restPose.clear();
      blendAlpha.clear();
    },
    isAnimActive(): boolean {
      return playing && elapsed < (getClip().length || Infinity);
    },
  };
}
