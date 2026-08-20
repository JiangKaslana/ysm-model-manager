# WASM 内存管理陷阱

> **tier**: architecture | **category**: pitfalls | **source_files**: `frontend/src/wasm/ysm-parser.ts`

## 核心问题

WASM 模块的 `HEAPU8` 视图在 `_malloc` 触发内存增长后会失效。如果在 `_malloc` 之前缓存了 `HEAPU8` 引用，后续写入会导致**静默数据损坏**。

## 错误示例

```typescript
function _writeHeap(data: Uint8Array): number {
  const len = data.length;
  const ptr = wasmModule!._malloc(len);
  if (!ptr) throw new Error("malloc 失败");
  
  // ❌ 错误：在 _malloc 之后使用缓存的 HEAPU8
  const heap = _getHeap();  // 如果 _malloc 触发了 growMemory，这个 heap 已经失效
  heap.set(data, ptr);      // 写入已分离的 ArrayBuffer，数据丢失但不报错
  return ptr;
}
```

## 正确做法

```typescript
function _writeHeap(data: Uint8Array): number {
  const len = data.length;
  const ptr = wasmModule!._malloc(len);
  if (!ptr) throw new Error("malloc 失败");
  
  // ✅ 正确：在 _malloc 之后立即获取最新的 HEAPU8
  _getHeap().set(data, ptr);  // 始终使用最新的视图
  return ptr;
}
```

## 为什么会这样？

1. WASM 内存是线性增长的，当 `_malloc` 需要更多内存时，会调用 `growMemory`
2. `growMemory` 会创建新的 `ArrayBuffer`，旧的 buffer 被标记为 "detached"（分离）
3. 旧的 `HEAPU8` 视图仍然指向已分离的 buffer
4. 向已分离的 buffer 写入数据**不会报错**，但数据不会出现在 WASM 内存中
5. 后续 WASM 代码读取到的是垃圾数据，导致解码输出全乱

## 症状

- WASM 解码输出全乱（花屏/白屏）
- 前端渲染异常（模型变形/贴图错位）
- **极难定位**：错误发生在数据写入阶段，但症状出现在渲染阶段

## 防御措施

1. **永远不要在 `_malloc` 之前缓存 `HEAPU8`**
2. 每次需要写入 WASM 内存时，都调用 `_getHeap()` 获取最新视图
3. 如果必须缓存，在 `_malloc` 之后立即获取

## 相关 ADR

- ADR-109：代码审查 Checklist（WASM 内存安全部分）

## 历史问题

- 2026-08-20：第六轮审核发现 `ysm-parser.ts` 的 `_writeHeap` 存在此问题，已修复
