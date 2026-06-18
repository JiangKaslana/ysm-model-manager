# YSM Model Manager 开源整理版

> 面向 `JiangKaslana/ysm-model-manager` fork 的阶段性发布说明。  
> 这版重点是 UI、设置项、按需预览和 OpenYSM 兼容预览迁移，不代表 3D 渲染内核已经完全等价 OpenYSM。

## 亮点

- 重构主界面视觉：仓库、管理、预览和设置页统一为更现代的高科技风格。
- 保留按需预览：点击文件不会自动触发 2D/3D 解析或渲染，必须由用户显式打开预览。
- 保留文件夹轻量显示：文件夹只显示图标或用户选择的封面，禁止进入模型解析/渲染路径。
- 设置页支持自定义主题色，并保留 AI 整理/OpenAI 兼容接口配置。
- 下载镜像源增加自定义模式：
  - 通用 HTTPS 代理，例如 `https://all.hlmirror.com/https://github.com/...`
  - GitHub 模板，例如 `https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}`
- 3D 预览继续向 OpenYSM 靠拢：暗色预览背景、动作轮盘、动作列表、时间轴、速度控制、形态/配置控件、贴图槽选择、载具/投射物切换入口。

## OpenYSM 渲染迁移进度

已完成的阶段性能力：

- Go 端新增 OpenYSM 风格 baked geometry 输出。
- 保留 `inflate`、`mirror`、纹理槽和 render mode 信息。
- 动画播放接入更接近 OpenYSM 的 per-bone pose buffer 结构。
- 支持 Bedrock animation 的基础插值、循环模式、`hold_on_last_frame`。
- 增加 OpenYSM `ctrl.*`、`c.*`、`ysm.*` 变量和常用默认 query/control 变量。
- OpenYSM 文件夹和内嵌资源解析会优先选主模型，避免把多形态一次性全堆在一起渲染。
- 轮盘动作、额外动作、载具/投射物目前以可切换预览入口呈现。

仍未完成的已知限制：

- 玩家/Steve 骨架绑定、骑乘/挂载语义还没有完全迁移。
- 骨骼矩阵还没有完全等价 OpenYSM 的 native 矩阵链。
- Molang runtime 和 animation controller 只覆盖了预览所需的基础场景。
- 透明、发光、描边、preview bounds、禁用预览旋转等元数据还需继续对照 OpenYSM 迁移。

## 验证

本阶段需要通过以下命令后再发布：

```powershell
cd frontend
npm run build
cd ..
go test ./...
wails build
```

发布前请确认 `build/bin/YSM-Model-Manager.exe` 作为 GitHub Release 附件上传，不要提交进源码仓库。

## 发布建议

- 源码提交到 `JiangKaslana/ysm-model-manager`。
- 二进制产物放到 GitHub Releases。
- Release 标题建议使用：`YSM Model Manager 开源整理版`
- Release 描述可直接复制本文。
