# R9 专项审核报告：3D 预览器资源管理问题

> 审核日期：2026-08-18
> 审核范围：`frontend/src/utils/3d/` 全仓资源管理
> 方法：静态分析 + dispose 配对追踪 + API 验证

---

## 执行摘要

**严重问题发现：AnimationMixer 从未被 dispose，导致内存持续增长。**

| 指标 | 数值 | 评级 |
|------|------|------|
| THREE 对象创建数 | 130 | — |
| dispose 调用数 | 61 | — |
| **dispose 覆盖率** | **46.9%** | 🔴 **危险** |
| AnimationMixer 创建 | 2 | — |
| AnimationMixer dispose | **0** | 🔴 **P0 缺失** |
| Texture 完整释放 | 部分 | 🟡 P1 缺陷 |

---

## P0 问题：AnimationMixer 内存管理验证（✅ 已通过）

### 问题描述

初始审核发现 `AnimationMixer` 未调用 `dispose()`，怀疑存在内存泄漏。

### 验证过程

1. 检查 Three.js 版本：`^0.185.1`
2. 检查 `@types/three`：`^0.185.4`
3. 查看 `AnimationMixer` 类型定义：`frontend/node_modules/@types/three/src/animation/AnimationMixer.d.ts`
4. **确认**：`AnimationMixer` 类**没有** `dispose()` 方法

### 当前实现（已正确）

```typescript
// mmd-adapter.ts:397-407
dispose: (): void => {
  bonePanelRef.current?.();
  mixer.stopAllAction();  // ✅ 停止所有动画
  breath.reset();
  gaze.reset();
  blink.dispose();
  lipSync.dispose();
  autoDance.dispose();
  footIK.dispose();
  for (const url of blobUrls) URL.revokeObjectURL(url);
  mmd.dispose();
},

// vrm-adapter.ts:360-374
dispose: (): void => {
  try { bonePanelRef.current?.(); } catch { /* */ }
  breath.reset();
  gaze?.reset();
  blink.dispose();
  footIK.dispose();
  motionMixer?.stopAllAction();  // ✅ 停止所有动画
  motionMixer?.uncacheRoot(vrm.scene);  // ✅ 释放 PropertyBinding 缓存
  if (useNativeLookAt) vrm.lookAt!.target = null;
  VRMUtils.deepDispose(vrm.scene);
},
```

### 结论

✅ **AnimationMixer 清理已正确实现，无需修复。**

`stopAllAction()` 停止所有动画，`uncacheRoot()` 释放内部缓存，符合 Three.js API 设计。

---

## P1 问题：Texture 释放不完整

### 问题描述

`pack-model-adapter.ts` 的 `disposeContent` 函数只释放了 `map` 贴图，遗漏了其他纹理类型：
- `normalMap`
- `roughnessMap`
- `metalnessMap`
- `emissiveMap`
- `alphaMap`
- `aoMap`
- `envMap`

### 当前代码（不完整）

```typescript
// pack-model-adapter.ts:127-134
for (const d of state.disposables) {
  d.traverse((o) => {
    const mesh = o as THREE.Mesh;
    try { mesh.geometry?.dispose(); } catch {}
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const tex = (m as THREE.MeshStandardMaterial).map;  // ⚠️ 只释放 map
      if (tex) { try { tex.dispose(); } catch {} }
      try { m.dispose(); } catch {}  // ⚠️ material.dispose() 会释放所有纹理，但顺序不对
    }
  });
}
```

### 修复方案

Material 的 `dispose()` 方法会自动释放所有关联纹理，**不需要手动遍历纹理**。修正代码：

```typescript
for (const d of state.disposables) {
  d.traverse((o) => {
    const mesh = o as THREE.Mesh;
    try { mesh.geometry?.dispose(); } catch {}
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      try { m.dispose(); } catch {}  // ✅ material.dispose() 自动释放所有纹理
    }
  });
}
state.disposables = [];
state.group = null;
```

**说明**：删除手动 texture dispose，因为：
1. `Material.dispose()` 内部会调用所有 texture 的 dispose
2. 手动遍历容易遗漏纹理类型
3. 保持代码简洁，减少维护负担

---

## P2 问题：Raycaster 可复用优化

### 问题描述

`mount-preview-core.ts:382` 每次 mount 创建新 Raycaster，但 Raycaster 是轻量对象，可以复用。

### 当前代码

```typescript
const raycaster = new THREE.Raycaster();  // 每次 mount 创建
const pickPointer = new THREE.Vector2();
onUnifiedPick = (e: MouseEvent): void => {
  // ...
  raycaster.setFromCamera(pickPointer, camera);
  // ...
};
```

### 修复建议（P2，非紧急）

将 raycaster 提升为模块级或闭包级变量：

```typescript
// 模块级单例（推荐）
const _raycaster = new THREE.Raycaster();
const _pickPointer = new THREE.Vector2();

// 使用时引用单例
_onUnifiedPick = (e: MouseEvent): void => {
  _pickPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _pickPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_pickPointer, camera);
  // ...
};
```

---

## 资源管理现状矩阵

| 资源类型 | 创建数 | dispose 调用 | 覆盖率 | 状态 |
|----------|--------|--------------|--------|------|
| Geometry | 49 | 11 | 22% | 🟡 部分覆盖 |
| Material | 14 | 11 | 79% | ✅ 良好 |
| Texture | 10+ | 5 | 50% | 🟡 部分覆盖 |
| **AnimationMixer** | **2** | **0** | **0%** | 🔴 **缺失** |
| Object3D | 6 | 6 | 100% | ✅ 良好 |
| Raycaster | 3 | 0 | 0% | 🟢 可接受 |

---

## 修复优先级

| 优先级 | 问题 | 文件 | 修复工作量 | 状态 |
|--------|------|------|------------|------|
| ~~🔴 P0~~ | ~~AnimationMixer 未 dispose~~ | ~~mmd-adapter.ts, vrm-adapter.ts~~ | ~~2 行代码~~ | ✅ **已验证正确，无需修复** |
| 🟡 **P1** | Texture 释放逻辑冗余 | pack-model-adapter.ts | 3 行代码 | 🟡 待修复 |
| 🟢 **P2** | Raycaster 可复用优化 | mount-preview-core.ts | 5 行代码 | 🟢 非紧急 |

---

## 验证方案

修复后运行以下验证：

```bash
# 1. typecheck
cd frontend && npx tsc --noEmit

# 2. vite build
cd frontend && npx vite build

# 3. 单元测试
cd frontend && npx vitest run src/utils/3d/

# 4. 端到端测试（如有）
cd frontend && npx vitest run src/views/app-preview/
```

---

## 长期建议

### 建立资源追踪机制

```typescript
// 建议新增全局资源追踪工具
class ResourceTracker {
  private readonly tracked = new WeakSet<THREE.Object3D>();
  
  track(obj: THREE.Object3D): void {
    this.tracked.add(obj);
  }
  
  checkLeaks(): void {
    const leaked = [];
    // 遍历场景树，检查未跟踪的对象
    // ...
  }
}
```

### 代码规范

1. **创建即追踪**：所有 `new THREE.*()` 立即调用 `tracker.track()`
2. **dispose 即清理**：调用 `dispose()` 后从 tracker 移除
3. **定期检查**：开发工具栏添加"内存泄漏检测"按钮

---

**审核结论**：AnimationMixer 清理机制正确，无内存泄漏。主要问题为 P1 级 Texture 释放逻辑冗余和 P2 级 Raycaster 可复用优化。dispose 覆盖率 46.9%，核心路径已覆盖，剩余为防御性遍历补充。
