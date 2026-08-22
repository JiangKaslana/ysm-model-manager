import * as THREE from "three";
import {
  evaluateKeyframesInto,
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

interface CompiledTrack {
  node: THREE.Object3D;
  channels: BoneChannels;
  rotation: Vec3;
  position: Vec3;
  scale: Vec3;
  euler: THREE.Euler;
  targetQuaternion: THREE.Quaternion;
  restQuaternion: THREE.Quaternion | null;
  slerpAlpha: number;
}

/**
 * Builds a YSM animation player whose per-frame path reuses every temporary object.
 * boneHierarchy remains in the signature for API compatibility; Three.js already
 * propagates the local transforms through the Object3D hierarchy.
 */
export function createYsmAnimPlayer(
  boneByName: Map<string, THREE.Object3D>,
  clips: AnimationClip[],
  _boneHierarchy: BoneHierarchyNode[],
  clipLabels?: string[],
): YsmAnimPlayer {
  if (clips.length === 0) throw new Error("YSM animation player requires at least one clip");

  const rawLabels = clipLabels ?? clips.map((_, i) => `Clip ${i}`);
  const labels = rawLabels.slice(0, clips.length).map((label) => ({ label }));
  const compiledClips = clips.map((clip) =>
    Object.entries(clip.bones).flatMap(([boneName, channels]): CompiledTrack[] => {
      const node = boneByName.get(boneName);
      if (!node) return [];
      return [{
        node,
        channels,
        rotation: [0, 0, 0],
        position: [0, 0, 0],
        scale: [1, 1, 1],
        euler: new THREE.Euler(0, 0, 0, "XYZ"),
        targetQuaternion: new THREE.Quaternion(),
        restQuaternion: null,
        slerpAlpha: 0,
      }];
    }),
  );

  let currentIdx = 0;
  let elapsed = 0;
  let playing = true;
  const slerpRate = 5;

  const getClip = (): AnimationClip => clips[currentIdx];
  const resetCompiledState = (): void => {
    for (const tracks of compiledClips) {
      for (const track of tracks) {
        track.restQuaternion = null;
        track.slerpAlpha = 0;
      }
    }
  };

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

      for (const track of compiledClips[currentIdx]) {
        const { node, channels } = track;
        if (channels.rotation && evaluateKeyframesInto(channels.rotation, elapsed, track.rotation)) {
          track.euler.set(track.rotation[0], track.rotation[1], track.rotation[2], "XYZ");
          track.targetQuaternion.setFromEuler(track.euler);
          if (!track.restQuaternion) {
            track.restQuaternion = node.quaternion.clone();
            track.slerpAlpha = 0;
          } else {
            track.slerpAlpha = Math.min(1, track.slerpAlpha + dt * slerpRate);
          }
          if (track.slerpAlpha >= 1) node.quaternion.copy(track.targetQuaternion);
          else node.quaternion.copy(track.restQuaternion).slerp(track.targetQuaternion, track.slerpAlpha);
        }
        if (channels.position && evaluateKeyframesInto(channels.position, elapsed, track.position)) {
          node.position.set(track.position[0], track.position[1], track.position[2]);
        }
        if (channels.scale && evaluateKeyframesInto(channels.scale, elapsed, track.scale)) {
          node.scale.set(track.scale[0], track.scale[1], track.scale[2]);
        }
      }
    },

    dispose(): void {
      elapsed = 0;
      playing = true;
      resetCompiledState();
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
      resetCompiledState();
    },
    isAnimActive: () => playing && elapsed < (getClip().length || Infinity),
  };
}
