---
kind: optimization_log
name: 优化记录 optimization-log
tier: architecture
category: config
source_files:
  - frontend/src/utils/3d/adapters/mmd-adapter.ts
  - frontend/src/utils/3d/adapters/mmd-ktx2-encoder.ts
  - internal/app/app_model.go
  - internal/app/app_texture_cache.go
  - go/texture_cache/texture_cache.go
use_when:
  - 优化
  - 性能
  - 瓶颈
  - 优化记录
  - optimization
  - perf
  - KTX2
  - 纹理缓存
  - 加载速度
  - 内存
  - GPU 内存
  - 闪退
  - 泄漏
  - dispose
---

# 优化记录 optimization-log

按时间倒序排列的优化日志。每行记录一个优化改动，新 AI 读完本表即可了解项目性能演进历史。

## 优化日志

| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |
|------|------|------|---------|------|------|
| 2026-08-19 | KTX2 缓存 | 加载时间翻倍（getCachedTexture 对每个纹理读文件+算 SHA256，而 readFileBytesBatch 已读一次） | 新增 `ReadFileBytesBatchWithMeta` 一次 RPC 返回数据+哈希；新增 `HasCachedTextures` 批量缓存检查；KTX2 替换改为 `Promise.all` 并发执行 | 加载：1 次 RPC 替代 N+1 次；缓存检查：1 次替代 N 次；替换：并行替代串行 | `fd068ac` |
| 2026-08-18 | KTX2 编码 | PNG 纹理无 KTX2 缓存，GPU 内存 1-2GB 导致移动端 OOM | WASM basis_encoder 后台编码（`@loaders.gl/textures` + `encodeKTX2BasisTexture`），加载后自动编码未缓存纹理到用户目录 | 首次加载不阻塞，后续加载命中 KTX2 缓存，GPU 内存降到 1/4~1/8 | `c5953531` |
| 2026-08-18 | KTX2 替换 | 模型加载后 PNG 纹理仍占用 GPU 内存 | KTX2Loader 在 post-load 阶段替换材质纹理，dispose 旧 PNG | 有 KTX2 缓存时自动替换，释放旧 PNG 纹理 | `cfca7c08` |
| 2026-08-18 | KTX2 缓存 | 无 KTX2 缓存基础设施 | Go 侧 `texture_cache` 包（SHA256 内容哈希 key、用户目录落盘、原子写入）+ `GetCachedTexture`/`SaveCachedTexture` 绑定 | 缓存目录可用，可手动放置 KTX2 文件验证管线 | `31713991` |
| 2026-08-18 | MMD dispose | 切换模型 GPU 内存泄漏（`@moeru/three-mmd` 的 `MMD.dispose()` 仅释放物理引擎，不释放几何/材质/纹理） | `disposeMmdMesh()` 遍历 13 个纹理字段 + `mat.dispose()` + `geometry.dispose()`，输出释放统计到环形日志 | 切换 5 个模型不再闪退，dispose 日志：`tex=58 gpu≈1232.1MB` | `80679cd7` |
| 2026-08-18 | MMD 加载 | 单个模型纹理 GPU 内存 1-2GB（4096²×24 + 8192²×2） | manager.onLoad 输出 GPU 内存估算到环形日志，可追踪单模型显存占用 | 日志可见 `gpu≈2053.3MB`，量化优化目标 | `80679cd7` |

## 当前瓶颈

- **纹理编码**：WASM basis_encoder 从 CDN 加载，首次编码慢（~1-2s/纹理），且 encoded 文件未落盘前缓存不命中
- **KTX2 替换竞态**：快速切换模型时 KTX2Loader 仍在加载，dispose 后纹理变孤儿
- **SHA256 计算**：Go 侧 `readFileWithHash` 对每个文件做全量 SHA256，大文件（~10MB+）有延迟

## 关键指标

| 指标 | 优化前 | 优化后 | 目标 |
|------|--------|--------|------|
| 模型切换（5 次） | 闪退 | 正常 | 稳定 |
| 单模型 GPU 内存 | 1-2GB | 1-2GB（仍需 KTX2 缓存命中） | ~200MB |
| 纹理加载 RPC 次数 | N+1 次 | 1 次 | 1 次 |
| 缓存检查 RPC 次数 | N 次 | 1 次 | 1 次 |

## 相关

- [ADR-098: 3D 预览性能优化](adr/ADR-098-3d-preview-perf.md)
- [ADR-101: MMD 场景加载性能分析与优化方向](adr/ADR-101-mmd-loading-perf.md)
- [MMD 适配器知识卡](knowledge/app-preview.md)
