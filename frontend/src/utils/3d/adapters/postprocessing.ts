// ===== 后处理管线管理器（从 mount-preview-core.ts 拆出，ADR-040 P1 第4轮）=====
// EffectComposer + UnrealBloomPass 生命周期管理：延迟创建、每帧参数同步、释放。
// 仅在 volumetric engine=postprocess 且启用时激活，否则无开销。
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { LightCapability } from "../caps/light-capability.ts";

/** 数值 clamp 辅助 */
function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

/** 后处理对外最小契约（兼容 PostprocessingManager / PostprocessingCapability） */
export interface PostprocessingLike {
  /** 每帧渲染；返回 true 表示已接管渲染（composer.render），false 表示调用方需 renderer.render */
  render(dt: number, lightCap: LightCapability | null): boolean;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export class PostprocessingManager implements PostprocessingLike {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private _pendingWidth: number | null = null;
  private _pendingHeight: number | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  render(dt: number, lightCap: LightCapability | null): boolean {
    const params = lightCap?.getParams();
    const vol = params?.volumetric;
    const usePostProc = lightCap &&
      lightCap.getVolumetricEngine() === "postprocess" &&
      vol?.enabled === true;

    if (usePostProc) {
      if (!this.composer) {
        const w = this._pendingWidth ?? Math.max(this.renderer.domElement.width, 1);
        const h = this._pendingHeight ?? Math.max(this.renderer.domElement.height, 1);
        this.composer = new EffectComposer(this.renderer);
        this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.composer.setSize(w, h);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 1.0, 0.3);
        this.composer.addPass(this.bloomPass);
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
        this._pendingWidth = null;
        this._pendingHeight = null;
      }
      if (this.bloomPass) {
        const v = vol!;
        const opacity = clamp(v.opacity, 0, 1);
        const edgeFade = clamp(v.edgeFade, 0, 1);
        this.bloomPass.threshold = Math.max(0.1, 0.5 - opacity * 0.3);
        this.bloomPass.strength = opacity * 1.5;
        this.bloomPass.radius = edgeFade * 0.5 + 0.1;
      }
      this.composer.render(dt);
      return true;
    }

    if (this.composer && lightCap) {
      this.disposeComposer();
    }
    return false;
  }

  setSize(width: number, height: number): void {
    const w = clamp(width, 1, 8192);
    const h = clamp(height, 1, 8192);
    if (this.composer) {
      this.composer.setSize(w, h);
      if (this.bloomPass) {
        this.bloomPass.resolution = new THREE.Vector2(w, h);
      }
    } else {
      // composer 未创建时缓存尺寸，首次 render 时应用（P1-1 修复）
      this._pendingWidth = w;
      this._pendingHeight = h;
    }
  }

  dispose(): void {
    this.disposeComposer();
  }

  private disposeComposer(): void {
    this.renderPass?.dispose();
    this.renderPass = null;
    this.bloomPass?.dispose();
    this.bloomPass = null;
    // OutputPass 无 dispose 方法（Three.js 版本差异），防御性调用
    if (typeof this.outputPass?.dispose === "function") {
      this.outputPass.dispose();
    }
    this.outputPass = null;
    this.composer?.dispose();
    this.composer = null;
  }
}
