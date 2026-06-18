# 发布指南

目标仓库：`JiangKaslana/ysm-model-manager`

这份指南用于把当前源码整理版发布到 GitHub。源码和 Release 附件分开处理：源码提交到 git，`exe/zip` 放到 GitHub Releases，不提交进仓库。

## 发布前检查

- [ ] `LICENSE` 存在，README 中的许可证链接可打开。
- [ ] `.gitignore` 已排除 `build/bin/`、`frontend/dist/`、`node_modules/`、`.vite/`、`.vs/`、`.continue/`、`Users/` 等本地产物。
- [ ] 没有提交本地模型包、缓存、截图临时文件和打包产物。
- [ ] `RELEASE_NOTES_GITHUB.md` 已更新。
- [ ] `docs/open-source-readiness.md` 已更新。
- [ ] 通过构建验证。

## 构建验证

```powershell
cd frontend
npm run build
cd ..
go test ./...
wails build
```

如果 Go SDK 或 Wails 不在 PATH，请先补充本机路径后再运行。

## 创建提交

```powershell
git status --short
git add .gitignore LICENSE README.md PUBLISH_GUIDE.md RELEASE_NOTES_GITHUB.md docs/
git commit -m "docs: prepare open-source release"
```

如果当前目录不是 git 仓库，建议先克隆 fork，再把整理后的源码复制进去提交，避免产生和上游无关的历史：

```powershell
git clone https://github.com/JiangKaslana/ysm-model-manager.git
cd ysm-model-manager
git checkout -b open-source-prep
```

## GitHub Release

1. 打开 Releases 页面：

   `https://github.com/JiangKaslana/ysm-model-manager/releases`

2. 点击 `Draft a new release`。

3. 填写：

   - Tag：例如 `v1.7.0-preview.1` 或你准备正式发布的版本号。
   - Title：`YSM Model Manager 开源整理版`
   - Description：复制 `RELEASE_NOTES_GITHUB.md`。

4. 上传二进制附件：

   - `build/bin/YSM-Model-Manager.exe`
   - 如需 zip，可由本地打包脚本生成后上传，不提交到 git。

5. 发布后检查：

   - Release 页面显示正常。
   - 附件可以下载。
   - Tag 指向正确提交。
   - README 下载链接指向 fork release 页面。

## 后续 PR

准备向上游提 PR 时，推荐流程：

1. 在 fork 上创建主题分支。
2. 保持一次 PR 只讲清楚一个阶段：UI/开源整理/渲染迁移不要混成一团。
3. PR 描述写明保留行为：按需预览、文件夹不解析/不渲染、AI 整理配置不破坏。
4. 附上验证结果：`npm run build`、`go test ./...`、`wails build`。
