// ===== 感知层：LipSync（程序化生命力 L2）=====
// 音频振幅 → 口型 morph 权重。
// 设计原则：
//   - 振幅来源解耦：通过 onAmplitude 回调注入，消费方决定用 Web Audio API / 麦克风 / 虚拟源
//   - 宽容缺省：无回调时静默跳过
//   - 线性映射：amplitude ∈ [0,1] → weight ∈ [0, intensity]
//
// 消费方接入示例（Web Audio API）：
//   const audio = new Audio('/speech.mp3');
//   const ctx = new AudioContext();
//   const source = ctx.createMediaElementSource(audio);
//   const analyser = ctx.createAnalyser();
//   source.connect(analyser); analyser.connect(ctx.destination);
//   const lipSync = createLipSyncController();
//   // in update():
//   const dataArray = new Uint8Array(analyser.frequencyBinCount);
//   analyser.getByteTimeDomainData(dataArray);
//   const rms = Math.sqrt(dataArray.reduce((s, v) => s + (v-128)**2, 0) / dataArray.length) / 128;
//   lipSync.apply(dt, rms);
//
// 消费方接入示例（无音频源，待机张嘴）：
//   const lipSync = createLipSyncController();
//   // in update():
//   lipSync.apply(dt, 0.3 + Math.sin(time * 2) * 0.15); // 模拟呼吸式张嘴

import { clamp01 } from "../../core/clamp.ts";

/** 振幅回调：消费方每帧提供归一化振幅（0..1，可超过 1 会被 clamp） */
export type AmplitudeProvider = () => number;

interface LipSyncState {
  /** 上次应用时的振幅（用于平滑） */
  prevWeight: number;
}

export interface LipSyncOptions {
  /** 灵敏度阈值：振幅低于此值时输出 0（过滤静音） */
  sensitivity?: number;
  /** 最大张嘴幅度 */
  intensity?: number;
  /** 平滑因子：0=不 smoothing，1=完全滞后（推荐 0.3-0.7） */
  smoothing?: number;
}

/**
 * 构建 LipSync controller。
 * 每次 build 调用一次；dispose 后停止。
 */
export function createLipSyncController(opts: LipSyncOptions = {}) {
  const sensitivity = opts.sensitivity ?? 0.15;
  const intensity = opts.intensity ?? 0.8;
  const smoothing = opts.smoothing ?? 0.5;

  let state: LipSyncState | null = null;
  let disposed = false;

  /**
   * 每帧调用（在 adapter update 内）。
   * @param dt         帧间隔（秒，当前未用于动态计算，保留接口一致性）
   * @param amplitude  归一化音频振幅（0..1+）
   * @param onLipSync  写入 morph weight 的 callback（格式特化）
   */
  function apply(_dt: number, amplitude: number, onLipSync: (weight: number) => void): void {
    if (disposed || !onLipSync) return;

    const raw = clamp01(amplitude);
    // 灵敏度阈值：低于 threshold 视为静音
    const target = raw > sensitivity ? (raw - sensitivity) / (1 - sensitivity) * intensity : 0;
    // 平滑：指数移动平均
    if (!state) state = { prevWeight: target };
    const weight = state.prevWeight * smoothing + target * (1 - smoothing);
    state.prevWeight = weight;
    onLipSync(weight);
  }

  function reset(): void {
    state = null;
  }

  function dispose(): void {
    disposed = true;
    state = null;
  }

  return { apply, reset, dispose };
}
