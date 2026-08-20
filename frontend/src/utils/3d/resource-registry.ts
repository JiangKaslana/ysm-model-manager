// ===== 3D 资源注册表（Disposable 模式统一 GPU 资源生命周期）=====
// 问题：各 adapter 各自管理 dispose 逻辑，新 adapter 容易遗漏释放（GPU 泄漏）。
// cleanup-3d.ts 的 allBuilt: { dispose(): void }[] 已隐含此模式，但未形式化。
// 方案：Disposable 接口 + ResourceRegistry 集中管理 track/disposeAll。
//
// 用法：
//   const registry = new ResourceRegistry();
//   const tex = registry.track(new THREE.Texture());
//   const mat = registry.track(new THREE.MeshBasicMaterial());
//   // session 结束时：
//   registry.disposeAll(); // 全部释放，内部 try-catch 防御

/** 可释放资源接口（Three.js Texture/Material/Geometry/Controls 等均满足） */
export interface Disposable {
  dispose(): void;
}

/**
 * 资源注册表：集中跟踪 + 批量释放 GPU 资源。
 * 替代手写 `const disposables: { dispose(): void }[] = []; ... for (const d of ...) d.dispose()` 模式。
 */
export class ResourceRegistry {
  private items: Disposable[] = [];

  /** 注册资源并返回同一实例（便于内联：`const tex = registry.track(new Texture())`） */
  track<T extends Disposable>(item: T): T {
    this.items.push(item);
    return item;
  }

  /** 批量释放所有已注册资源（防御性：单个 dispose 抛错不阻塞后续释放） */
  disposeAll(): void {
    for (const item of this.items) {
      try {
        item.dispose();
      } catch {
        /* 防御性：个别资源 dispose 抛错不阻塞全量释放 */
      }
    }
    this.items.length = 0;
  }

  /** 当前已注册资源数量（测试/调试用） */
  get size(): number {
    return this.items.length;
  }
}
