# YSM Model Manager 发行版报告

报告日期：2026-06-17  
目标仓库：`JiangKaslana/ysm-model-manager`  
发行阶段：开源整理版 / OpenYSM 兼容预览迁移阶段

## 发行产物

| 项目 | 内容 |
| --- | --- |
| 可执行文件 | `build/bin/YSM-Model-Manager.exe` |
| 平台 | Windows amd64 |
| 文件大小 | 22,299,136 bytes，约 21.27 MiB |
| SHA256 | `1AA2277750F5AEE141649C1C43613B514BDBCD8D71251138278EF30A06C99739` |
| 构建工具 | Wails CLI v2.12.0 |

建议将 `YSM-Model-Manager.exe` 作为 GitHub Release 附件上传，不要提交到源码仓库。

## 本版重点

- 完成开源前整理：补充 Apache-2.0 `LICENSE`、发布说明、发布指南、开源准备清单。
- README 和站点文档的下载/源码链接改为 `JiangKaslana/ysm-model-manager`。
- `.gitignore` 已排除本地缓存、构建输出、二进制产物、`node_modules`、`frontend/dist`、`.vite`、`.vs`、`.continue`、`Users`、`scripts`。
- UI 已重构为更统一的现代风格，设置页保留自定义主题色。
- 模型预览保持显式触发，点击文件不会自动渲染。
- 文件夹保持轻量显示，只显示图标或用户选择的封面，不进入 2D/3D 模型解析或渲染路径。
- AI 整理功能和 OpenAI 兼容接口配置保留。
- 下载镜像源支持自定义 HTTPS 代理和 GitHub URL 模板。

## OpenYSM 预览迁移状态

本版已经推进 OpenYSM 兼容预览，但不声称完整替换 OpenYSM 渲染内核。

已完成：

- Go 端新增 OpenYSM 风格 baked geometry 输出。
- 保留 `inflate`、`mirror`、纹理槽和 render mode 信息。
- 3D 预览增加暗色 OpenYSM 风格背景、贴图槽、动作列表、播放/停止、速度和时间轴控制。
- 增加动作轮盘、形态/配置控件、载具/投射物切换入口。
- 动画播放接入更接近 OpenYSM 的 per-bone pose buffer 结构。
- 支持基础 Bedrock animation 插值、循环模式和 `hold_on_last_frame`。
- 增加 `ctrl.*`、`c.*`、`ysm.*`、`q.is_on_ground`、动画完成标记等预览变量。

仍未完成：

- 玩家/Steve 骨架绑定仍需继续迁移。
- 载具、挂载、投射物、手持物等附着语义仍不完整。
- 骨骼矩阵链尚未完全等价 OpenYSM native 实现。
- Molang runtime 和 animation controller 只覆盖当前预览所需的基础场景。
- 透明、发光、描边、preview bounds、禁用预览旋转等元数据仍需继续对照 OpenYSM 迁移。

## 验证结果

本地已通过以下验证：

```powershell
cd frontend
npm run build
cd ..
go test ./...
wails build
```

结果：

- `npm run build`：通过。Vite 仍有既有的大 chunk 警告，不是构建失败。
- `go test ./...`：通过。
- `wails build`：通过，生成 `build/bin/YSM-Model-Manager.exe`。

## 发布卫生检查

- 已生成干净源码上传包，排除了 `.git`、`node_modules`、`frontend/dist`、`build/bin`、`build/release`、`Users`、`scripts`、`.vite`、`.vs`、`.continue`、`.exe`、`.zip`。
- 已进行真实密钥格式扫描，未发现 `sk-...`、GitHub token、Google API key、Bearer token 等真实密钥。
- `scripts/` 中存在本机绝对路径的维护脚本，因此保持忽略，不随源码上传。

## 建议 Release 附件

- `YSM-Model-Manager.exe`
- `RELEASE_REPORT.md`

Release 描述可使用 `RELEASE_NOTES_GITHUB.md`，本报告作为更完整的验证与风险说明。
