// ===== GroundCapability：地面能力（ADR-073 同款 caps/ 能力模式）=====
// 统一核心注入（mount-preview-core），YSM/VRM/MMD/Litematic 零改动继承。
// GridHelper 地面 + visible 开关；apply() 挂入场景，dispose() 移除并释放，
// 作用域不泄漏到其它预览（对齐 SkyCapability 生命周期口径）。
// 实现 SceneCapability 统一接口，支持注册表自动发现 + 菜单控件 + 持久化。

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export interface GroundParams {
  /** 地面网格尺寸（世界单位） */
  size: number;
  /** 网格分段 */
  divisions: number;
  /** 中心轴线颜色 */
  colorCenter: number;
  /** 网格线颜色 */
  colorGrid: number;
  /** 地面初始可见 */
  visible: boolean;
}

export const DEFAULT_GROUND_PARAMS: GroundParams = {
  size: 50,
  divisions: 50,
  colorCenter: 0x444466,
  colorGrid: 0x333355,
  visible: true,
};

export class GroundCapability implements SceneCapability {
  readonly id = "ground";
  readonly labelKey = "preview.ground";
  readonly icon = "🌐";
  readonly descKey = "preview.groundDesc";

  private scene: THREE.Scene;
  private grid: THREE.GridHelper;
  private params: GroundParams;
  private enabled: boolean;

  constructor(opts: {
    scene: THREE.Scene;
    params?: Partial<GroundParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.params = { ...DEFAULT_GROUND_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? true;
    this.grid = new THREE.GridHelper(
      this.params.size,
      this.params.divisions,
      this.params.colorCenter,
      this.params.colorGrid,
    );
    this.grid.visible = this.params.visible;
    this.grid.name = "ysm-ground";
  }

  /** 挂入场景（对齐 SkyCapability.apply 口径） */
  apply(): void {
    if (!this.enabled) return;
    if (!this.grid.parent) this.scene.add(this.grid);
  }

  /** 地面显隐开关 */
  setVisible(v: boolean): void {
    this.grid.visible = v;
  }

  getVisible(): boolean {
    return this.grid.visible;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else if (this.grid.parent) this.grid.parent.remove(this.grid);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 返回菜单控件定义（框架自动渲染） */
  getMenuControls(): MenuControlDef[] {
    return [
      {
        id: "ground-visible",
        kind: "toggle",
        labelKey: "preview.ground",
        fallback: "地面",
        getValue: () => this.getVisible(),
        setValue: (v) => this.setVisible(v as boolean),
      },
    ];
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      visible: this.params.visible,
      enabled: this.enabled,
    });
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") this.enabled = state.enabled;
    if (typeof state.visible === "boolean") {
      this.params.visible = state.visible;
      this.grid.visible = state.visible;
    }
  }

  /** 移除并释放（GridHelper 材质可能是数组，遍历 dispose） */
  dispose(): void {
    if (this.grid.parent) this.grid.parent.remove(this.grid);
    this.grid.geometry.dispose();
    const mat = this.grid.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  }
}
