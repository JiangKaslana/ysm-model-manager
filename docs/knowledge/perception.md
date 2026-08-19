---
kind: perception
name: 3D 感知系统 perception
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/perception/
use_when:
  - 自主动画
  - 自动跳舞
  - 眨眼
  - 呼吸
  - 视线追踪
  - 口型同步
  - 节拍检测
  - 模型感知
  - 自动运动
---

# 3D 感知系统 perception

## 概览

`utils/3d/perception/` 是实现模型「自主生命感」的感知层子系统：让 Minecraft 角色自动眨眼、呼吸、注视、对口型、随音乐律动。

## 核心职责

| 模块 | 文件 | 职责 |
|------|------|------|
| 自动跳舞 | `autodance.ts` | 模型随节拍/音频自动舞蹈，驱动骨骼动画 |
| 节拍检测 | `beat-detector.ts` | 从音频流中检测 BPM 与节拍，作为 autodance 的节奏输入 |
| 眨眼 | `blink.ts` | 周期性自动眨眼，模拟真人眼部微动 |
| 呼吸 | `breath.ts` | 模型胸/腹部的起伏呼吸动画 |
| 视线追踪 | `gaze.ts` | 模型头部/眼球追踪相机或关注点，提升交互真实感 |
| 口型同步 | `lipsync.ts` | 根据音频能量驱动嘴部骨骼动画（viseme） |

## 对外 API / 入口

各模块通过 `RenderSession` 的感知生命周期注册：

```
perception.createAll(session, audioContext?) → void
perception.loadAll(session, state) → void
perception.dispose() → void
```

## 与其他子系统关系

- **model3d**（`model3d.ts`）— 感知层挂载在 3D 渲染会话的 `RenderSession` 生命周期上
- **animation-system**（`animation.ts`）— 感知动画驱动依赖骨骼动画插值系统
- **preview_core**（`mount-preview-core.ts`）— 统一核心在 shared 模式下创建感知实例

## 不变量

- 感知层纯逻辑，零 DOM 依赖
- 所有感知模块可独立启用/禁用，互不依赖
- 无音频源时 autodance/lipsync 静默降级为无操作

## 相关

- [model3d](./model3d.md) — 3D 渲染会话
- [animation-system](./animation-system.md) — 骨骼动画系统
- [preview_core](./preview_core.md) — 统一预览核心