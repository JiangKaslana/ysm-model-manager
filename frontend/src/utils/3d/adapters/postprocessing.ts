// ===== 后处理管线管理器（从 mount-preview-core.ts 拆出，ADR-040 P1 第4轮）=====
// EffectComposer + UnrealBloomPass 生命周期管理：延迟创建、每帧参数同步、释放。
// 仅在 volumetric engine=postprocess 且启用时激活，否则无开销。
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { LightCapability } from "../caps/light-capability.ts";

export class PostprocessingManager {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: OutputPass | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  render(dt: number, lightCap: LightCapability | null): boolean {
    const usePostProc = lightCap &&
      lightCap.getVolumetricEngine() === "postprocess" &&
      lightCap.getParams().volumetric.enabled;

    if (usePostProc) {
      if (!this.composer) {
        const w = Math.max(this.renderer.domElement.width, 1);
        const h = Math.max(this.renderer.domElement.height, 1);
        this.composer = new EffectComposer(this.renderer);
        this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.composer.setSize(w, h);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 1.0, 0.3);
        this.composer.addPass(this.bloomPass);
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
      }
      if (this.bloomPass) {
        const vol = lightCap!.getParams().volumetric;
        this.bloomPass.threshold = Math.max(0.1, 0.5 - vol.opacity * 0.3);
        this.bloomPass.strength = vol.opacity * 1.5;
        this.bloomPass.radius = vol.edgeFade * 0.5 + 0.1;
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
    if (this.composer) {
      this.composer.setSize(width, height);
      if (this.bloomPass) {
        this.bloomPass.resolution = new THREE.Vector2(width, height);
      }
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
    this.outputPass?.dispose();
    this.outputPass = null;
    this.composer?.dispose();
    this.composer = null;
  }
}
