// ===== 程序化天空能力（ADR-073 L1 首个落地能力）=====
// 复用 Three 官方 Sky（Preetham 大气散射，three/addons/objects/Sky.js），
// 禁止自写大气散射 shader（ADR-073 红线）。
// 本类仅做「接入 scene + uniform 管线 + 可选 IBL 环境联动」的薄封装，
// 后续 bloom/DOF/ground 等能力一律复用同一套路（核心 + 薄封装 + 注册表）。
//
// 设计要点：
// - Sky 材质 side=BackSide 且顶点 z 强制 far，故相机须始终位于天空盒内部：
//   天空盒半边长须 > 相机 maxDistance。预览核心 maxDistance=5000 → scale 默认 12000。
// - 天空依赖 tone mapping 才正确显色；本能力在 apply() 内为本次会话 renderer
//   设置 ACESFilmic + exposure，dispose() 时还原，作用域不泄漏到其它预览。
// - IBL 环境联动（scene.environment）默认开启（2026-08-16 目视验证通过，模型反射/环境光更真实）；
//   如需关闭调用 setEnvironmentEnabled(false)。

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

export interface SkyParams {
  /** 太阳高度角（度，0=地平线，90=天顶） */
  elevation: number;
  /** 太阳方位角（度） */
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** 云量 0=晴空；默认 0（预览偏好干净天空） */
  cloudCoverage: number;
  /** 天空盒缩放（半边长须 > 相机 maxDistance；预览核心=5000 → 12000） */
  scale: number;
  /** 是否联动 IBL 环境贴图（scene.environment）。默认 true（2026-08-16 目视验证通过） */
  environment: boolean;
  /** 时间-of-day（小时 0-24），太阳方位/高度的单一事实来源；默认 9（上午，观感较佳） */
  timeOfDay: number;
  /** ACES 曝光（天空正确显色所需，同时影响模型观感） */
  exposure: number;
}

export const DEFAULT_SKY_PARAMS: SkyParams = {
  elevation: 10,
  azimuth: 180,
  turbidity: 10,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  cloudCoverage: 0,
  scale: 12000,
  environment: true,
  timeOfDay: 9,
  exposure: 0.5,
};

/** 模型类别标识（取 PreviewAdapter.id：ysm/vrm/mmd/litematic） */
export type SkyModelType = "ysm" | "vrm" | "mmd" | "litematic" | "default";

/**
 * 按模型类别的散射/曝光预设（ADR-073 #3）。
 * 不同模型材质特性不同：VRM 为 PBR 角色、MMD 常带 toon/emissive 易过曝、
 * YSM/Litematic 为方块哑光。预设仅调散射与曝光，不改太阳位置（由 timeOfDay 控制）。
 * 数值为初始合理值，观感待目视微调。
 */
export const MODEL_SKY_PRESETS: Record<string, Partial<SkyParams>> = {
  default: { turbidity: 10, rayleigh: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.5 },
  vrm: { turbidity: 8, rayleigh: 2.2, mieCoefficient: 0.004, mieDirectionalG: 0.85, exposure: 0.55 },
  mmd: { turbidity: 10, rayleigh: 1.8, mieCoefficient: 0.006, mieDirectionalG: 0.8, exposure: 0.42 },
  ysm: { turbidity: 12, rayleigh: 2.5, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.6 },
  litematic: { turbidity: 10, rayleigh: 2, mieCoefficient: 0.005, mieDirectionalG: 0.8, exposure: 0.5 },
};

export class SkyCapability {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private pmrem: THREE.PMREMGenerator;
  private sky: Sky;
  private envScene: THREE.Scene;
  private envSky: Sky;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private params: SkyParams;
  private enabled: boolean;
  private prevToneMapping: THREE.ToneMapping;
  private prevExposure: number;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<SkyParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    this.params = { ...DEFAULT_SKY_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.prevToneMapping = this.renderer.toneMapping;
    this.prevExposure = this.renderer.toneMappingExposure;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.sky = this.createSky();
    this.envSky = this.createSky();
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envSky);
  }

  private createSky(): Sky {
    const sky = new Sky();
    sky.scale.setScalar(this.params.scale);
    sky.material.uniforms["cloudCoverage"].value = this.params.cloudCoverage;
    return sky;
  }

  /** 应用天空到场景（背景 + 可选 IBL + tone mapping） */
  apply(): void {
    this.syncSunFromTime();
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (!this.enabled) {
      this.detach();
      return;
    }
    if (!this.sky.parent) this.scene.add(this.sky);
    // 天空依赖 tone mapping 显色；作用域限制在本会话 renderer
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.params.exposure;
    if (this.params.environment) this.regenerateEnvironment();
    else this.clearEnvironment();
  }

  private writeUniforms(sky: Sky): void {
    const u = sky.material.uniforms;
    u["turbidity"].value = this.params.turbidity;
    u["rayleigh"].value = this.params.rayleigh;
    u["mieCoefficient"].value = this.params.mieCoefficient;
    u["mieDirectionalG"].value = this.params.mieDirectionalG;
    u["cloudCoverage"].value = this.params.cloudCoverage;
    const phi = THREE.MathUtils.degToRad(90 - this.params.elevation);
    const theta = THREE.MathUtils.degToRad(this.params.azimuth);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u["sunPosition"].value.copy(sun);
  }

  private regenerateEnvironment(): void {
    // 生成环境贴图时隐藏太阳盘，避免光斑伪影（Sky 文档建议）
    this.envSky.material.uniforms["showSunDisc"].value = 0;
    if (this.renderTarget) this.renderTarget.dispose();
    this.renderTarget = this.pmrem.fromScene(this.envScene);
    this.envSky.material.uniforms["showSunDisc"].value = 1;
    this.scene.environment = this.renderTarget.texture;
  }

  private clearEnvironment(): void {
    if (this.scene.environment === this.renderTarget?.texture) {
      this.scene.environment = null;
    }
  }

  /** 调整太阳位置（度） */
  setSun(elevation: number, azimuth: number): void {
    this.params.elevation = elevation;
    this.params.azimuth = azimuth;
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (this.enabled && this.params.environment) this.regenerateEnvironment();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else this.detach();
  }

  setEnvironmentEnabled(v: boolean): void {
    this.params.environment = v;
    if (!this.enabled) return;
    if (v) this.regenerateEnvironment();
    else this.clearEnvironment();
  }

  /** 按模型类别套用散射/曝光预设（ADR-073 #3）；modelType 取 adapter.id（ysm/vrm/mmd/litematic） */
  setPreset(modelType: string): void {
    const preset = MODEL_SKY_PRESETS[modelType] ?? MODEL_SKY_PRESETS.default;
    this.params = { ...this.params, ...preset };
    if (!this.enabled) return;
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (this.params.environment) this.regenerateEnvironment();
  }

  /** 设置云量 0=晴空 1=多云（ADR-073 #4）；regenerate=true 时同步刷新 IBL 环境 */
  setCloudCoverage(v: number, regenerate = false): void {
    this.params.cloudCoverage = Math.max(0, Math.min(1, v));
    this.sky.material.uniforms["cloudCoverage"].value = this.params.cloudCoverage;
    this.envSky.material.uniforms["cloudCoverage"].value = this.params.cloudCoverage;
    if (regenerate && this.enabled && this.params.environment) this.regenerateEnvironment();
  }

  /** 由 timeOfDay 推导太阳 elevation/azimuth（单一事实来源，避免与 setSun 双写冲突） */
  private syncSunFromTime(): void {
    const { elevation, azimuth } = this.hourToSun(this.params.timeOfDay);
    this.params.elevation = elevation;
    this.params.azimuth = azimuth;
  }

  /** 按一天中的小时（0-24）映射太阳位置：6=日出(东)、12=正午(南)、18=日落(西)，夜间在地平线下 → 天空转暗 */
  private hourToSun(hour: number): { elevation: number; azimuth: number } {
    const h = ((hour % 24) + 24) % 24;
    const dayAngle = ((h - 6) / 12) * Math.PI; // 6→0, 12→π/2, 18→π
    const elevation = Math.sin(dayAngle) * 70; // 峰值 70°，夜间为负 → 天空转暗
    const azimuth = 90 + ((h - 6) / 12) * 180; // 90(东)→180(南)→270(西)
    return { elevation, azimuth };
  }

  /** 按时间设置太阳位置（time-of-day），联动天空与 IBL 环境 */
  setTime(hour: number): void {
    this.params.timeOfDay = ((hour % 24) + 24) % 24;
    this.syncSunFromTime();
    if (!this.enabled) return;
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (this.params.environment) this.regenerateEnvironment();
  }

  getTimeOfDay(): number {
    return this.params.timeOfDay;
  }

  private detach(): void {
    if (this.sky.parent) this.sky.parent.remove(this.sky);
    this.clearEnvironment();
  }

  dispose(): void {
    this.detach();
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    this.renderer.toneMapping = this.prevToneMapping;
    this.renderer.toneMappingExposure = this.prevExposure;
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.envSky.geometry.dispose();
    (this.envSky.material as THREE.Material).dispose();
    this.pmrem.dispose();
  }
}
