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
// - IBL 环境联动（scene.environment）默认关闭，避免未经验证的模型打光回归；
//   视觉验证后调用 setEnvironmentEnabled(true) 开启。

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
  /** 是否联动 IBL 环境贴图（scene.environment）。默认 false（避免打光回归） */
  environment: boolean;
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
  environment: false,
  exposure: 0.5,
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
