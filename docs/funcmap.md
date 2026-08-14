# 函数映射表

> AI 找代码用。改功能前先 grep 此表定位文件:行。
> **自动生成** — 由 `scripts/funcmap.mjs` 生成（提取 Go/JS/TS 导出符号，参考 MikuMikuAR docs/function-map.md 风格）。

## 总览

| 模块 | 文件数 | 导出符号数 |
|------|--------|-----------|
| Go·头像 | 4 | 10 |
| Go·去重 | 1 | 5 |
| Go·下载 | 1 | 12 |
| go/executil | 2 | 2 |
| go/fileops | 4 | 13 |
| Go·文件系统 | 6 | 12 |
| Go·几何 | 2 | 8 |
| Go·导入 | 2 | 16 |
| Go·安装 | 1 | 9 |
| go/instance | 1 | 2 |
| go/internal | 1 | 3 |
| Go·Litematic | 4 | 9 |
| Go·日志 | 2 | 11 |
| Go·包管理 | 1 | 3 |
| Go·路径 | 1 | 4 |
| Go·回收站 | 2 | 19 |
| go/scanner | 1 | 8 |
| Go·同步 | 6 | 21 |
| Go·标签 | 1 | 8 |
| Go·Three.js | 1 | 6 |
| Go·类型 | 5 | 51 |
| Go·更新器 | 1 | 10 |
| Go·监听 | 1 | 6 |
| Go·YSM 核心 | 7 | 25 |
| Go(internal)·应用入口 | 22 | 179 |
| 前端·根 (app-modules/bus) | 2 | 13 |
| frontend/backend | 9 | 56 |
| 前端·核心 | 17 | 43 |
| 前端·特性 | 19 | 92 |
| 前端·服务 | 1 | 6 |
| frontend/test-utils | 4 | 34 |
| 前端·工具 | 54 | 196 |
| frontend/views | 78 | 210 |
| 前端·WASM | 3 | 6 |
| **合计** | **267** | **1108** |

## Go·头像

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SetNodeJS()` | `go/avatar/avatar_decode:38` | SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。 |
| `limitedBuffer.Write()` | `go/avatar/avatar_decode:53` | — |
| `DecodeYSMFiles()` | `go/avatar/avatar_decode:62` | DecodeYSMFiles 底层解码，返回完整文件列表。 |
| `ExtractAvatarURI()` | `go/avatar/avatar_extract:24` | ExtractAvatarURI 从模型文件中提取指定所有者的头像 data URI。 |
| `CacheAvatarsFromJSON()` | `go/avatar/avatar_extract:195` | CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。 |
| `CacheAvatarsFromModel()` | `go/avatar/avatar_extract:265` | CacheAvatarsFromModel 从 .ysm/.zip/.json 模型缓存所有作者头像。 |
| `ReadFileFromZip()` | `go/avatar/avatar_zip:16` | ReadFileFromZip 从 ZIP 读取指定路径的文件。 |
| `SafeName()` | `go/avatar/avatar:43` | SafeName 将非法文件名字符替换为下划线。 |
| `ReadCachedAvatar()` | `go/avatar/avatar:137` | ReadCachedAvatar 读取缓存中的头像，返回 data URI。 |
| `SaveAvatarData()` | `go/avatar/avatar:163` | SaveAvatarData 将头像数据写入缓存。 |

## Go·去重

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `FindDuplicateFiles()` | `go/dedup/dedup:40` | FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组 skipRecycle 为 true 时跳过 .recycle 子目录 |
| `CountDuplicates()` | `go/dedup/dedup:144` | CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数） |
| `CleanEmptyDirs()` | `go/dedup/dedup:209` | CleanEmptyDirs 递归删除指定目录下的所有空子目录（不含 dir 自身）。 |
| `FileEntry()` | `go/dedup/dedup:24` | FileEntry 文件条目 |
| `Group()` | `go/dedup/dedup:32` | Group 重复文件分组 |

## Go·下载

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `HTTPStatusError.Error()` | `go/download/download:63` | — |
| `TruncationError.Error()` | `go/download/download:71` | — |
| `TruncationError.Unwrap()` | `go/download/download:77` | Unwrap 让 errors.Is(err, ErrTruncated) 成立——调用方既可判断类别（errors.Is）， 又可提取数值（errors.As），无需文本匹配（# |
| `New()` | `go/download/download:89` | New 创建 Downloader，默认 5 分钟超时。 |
| `NewWithClient()` | `go/download/download:94` | NewWithClient 使用指定 HTTP client。 |
| `Downloader.File()` | `go/download/download:258` | File 从 URL 下载文件到 savePath，支持进度回调。ctx 取消/超时即中断下载。 |
| `Downloader.FromGitHubAPI()` | `go/download/download:263` | FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。 |
| `ResolveSavePath()` | `go/download/download:287` | ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。 |
| `HTTPStatusError()` | `go/download/download:59` | HTTPStatusError 携带 HTTP 状态码的类型化错误，调用方用 errors.As 提取码值， 替代 strings.Contains(err.Error(), "4 |
| `TruncationError()` | `go/download/download:66` | TruncationError 携带期望/实际字节数的截断错误，调用方用 errors.As 提取数值做诊断上报。 |
| `ProgressFn()` | `go/download/download:80` | ProgressFn 下载进度回调。downloaded / total 为字节数。 |
| `Downloader()` | `go/download/download:83` | Downloader 文件下载器。 |

## go/executil

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `HideWindow()` | `go/executil/hidewindow_other:8` | HideWindow 非 Windows no-op（Unix 无控制台窗口概念）。 |
| `HideWindow()` | `go/executil/hidewindow_windows:15` | HideWindow 隐藏子进程控制台窗口（Windows 专属）。 |

## go/fileops

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ToggleModelEnable()` | `go/fileops/fileops_enable:22` | ToggleModelEnable 切换 .ban 状态文件（返回是否处于启用态；缓存失效由薄壳处理） ADR-038 D3.7：src 为 ysm.json 时提升为父目录级 . |
| `IsFileBanned()` | `go/fileops/fileops_enable:137` | IsFileBanned 判断路径是否被 .ban 标记（文件级或目录级，ADR-038 D3.7） |
| `FindPreviewImage()` | `go/fileops/fileops_preview:24` | FindPreviewImage 查找模型同目录的预览图并转 data URI |
| `ExtractPreviewTexture()` | `go/fileops/fileops_preview:50` | ExtractPreviewTexture 从模型文件中提取预览纹理（zip/7z/ysm/json） |
| `GetPackInfo()` | `go/fileops/fileops_preview:153` | GetPackInfo 读取 ysm-pack.json（root 为空时按绝对路径处理） |
| `CreateDir()` | `go/fileops/fileops:43` | CreateDir 在 root 下创建子目录（校验非法字符，与 RenameDir 对齐） |
| `RenameDir()` | `go/fileops/fileops:61` | RenameDir 重命名目录（仅改末段，保持父目录） |
| `RemoveDir()` | `go/fileops/fileops:86` | RemoveDir 递归删除目录 |
| `RenameFile()` | `go/fileops/fileops:93` | RenameFile 重命名文件（校验非法字符；ysm.json 为模型目录清单，禁止改名） |
| `MoveModelFile()` | `go/fileops/fileops:121` | MoveModelFile 移动 src 到 dstDir（保留原名） root 用于路径安全校验（空则跳过校验，对齐 CopyModelFile 语义）； ADR-038 D3： |
| `CopyModelFile()` | `go/fileops/fileops:198` | CopyModelFile 复制 src 到 dstDir（root 用于路径安全校验，空则跳过校验） ADR-038 D3：支持目录递归复制（含 .ban 状态文件）；src 为 |
| `DeleteModelFile()` | `go/fileops/fileops:330` | DeleteModelFile 删除模型（目录感知，ADR-038 D3.6）： src 为 ysm.json 时删除整个模型目录（整组语义——包内 geometry/animat |
| `WriteModelFolder()` | `go/fileops/folder_import:20` | WriteModelFolder 写入文件夹整组到仓库（YSM 解压目录或普通模型文件夹）。 |

## Go·文件系统

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `IsCrossDeviceErr()` | `go/fsutil/crossdevice_other:14` | IsCrossDeviceErr 判断 rename/链接失败是否为跨设备（EXDEV）。 |
| `IsCrossDeviceErr()` | `go/fsutil/crossdevice_windows:18` | IsCrossDeviceErr 判断 rename/链接失败是否为跨设备（EXDEV）。 |
| `IsHardLink()` | `go/fsutil/hardlink_other:15` | IsHardLink 判断路径是否为硬链接（nlink &gt; 1）。 |
| `IsHardLink()` | `go/fsutil/hardlink_windows:14` | IsHardLink 判断路径是否为硬链接（NumberOfLinks &gt; 1）。 |
| `WalkAllFiles()` | `go/fsutil/walk:13` | WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名） skipRecycle 为 true 时跳过 .recycle 子目录 |
| `WalkAllDirs()` | `go/fsutil/walk:38` | WalkAllDirs 递归遍历目录，返回所有子目录路径（深度优先后序：子目录在前，父目录在后） 不包含根目录本身。后序便于删除类操作（先删深目录，父目录变空后可被继续删除）。 |
| `CountFiles()` | `go/fsutil/walk:70` | CountFiles 统计目录中的文件数（不限制扩展名） |
| `CleanEmptyDirs()` | `go/fsutil/walk:75` | CleanEmptyDirs 递归删除空子目录，返回删除数 |
| `IsRecycleDir()` | `go/fsutil/walk:91` | IsRecycleDir 判断路径是否指向 .recycle 回收站目录（大小写不敏感，ADR-044 策略 A 统一口径）—— dedup / scanner / sync 的回 |
| `IsResourcePackFolder()` | `go/fsutil/walk:99` | IsResourcePackFolder 检查目录是否为资源包文件夹（内含 pack.mcmeta）。 |
| `ReadLimitedEntry()` | `go/fsutil/write:45` | ReadLimitedEntry 读取 zip/7z 单条目：limit+1 探测截断（ADR-033 修复，ADR-044 策略 A 统一口径）—— 原 `io.ReadAll( |
| `WriteFileAtomic()` | `go/fsutil/write:65` | WriteFileAtomic 临时文件 + rename 原子落地目标文件。 |

## Go·几何

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ExtractFirstPNGFromZip()` | `go/geometry/archive:58` | ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览） |
| `ExtractFirstPNGFrom7z()` | `go/geometry/archive:79` | ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览） |
| `ParseFromZip()` | `go/geometry/archive:300` | — |
| `ParseFrom7z()` | `go/geometry/archive:610` | ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理 |
| `IsMainModelName()` | `go/geometry/archive:902` | IsMainModelName 判断模型文件是否为主组件（main.json / main.geo.json）。 |
| `ParseComponentsFromZip()` | `go/geometry/archive:914` | ParseComponentsFromZip 多组件解析（YSMViewer 式）：zip 内每个模型文件独立组件， 含 arm/载具等组件（不合并、不排除）；main 优先排序， |
| `ParseComponentsFrom7z()` | `go/geometry/archive:1012` | ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构， 复用 collectArchiveFiles/buil |
| `ParseBedrockGeometry()` | `go/geometry/parse:25` | ParseBedrockGeometry 解析标准 Bedrock geometry JSON（minecraft:geometry 格式） 注意：data 大小不应超过 maxP |

## Go·导入

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ImportFromBase64()` | `go/importer/importer_file:30` | ImportFromBase64 从 base64 导入模型文件（校验 + 类型检测 + 写文件） rootFn 按资源类型返回仓库根目录（薄壳注入 a.GetRepoRoot） |
| `WriteFileAtomic()` | `go/importer/importer_file:112` | WriteFileAtomic 已提升至 go/fsutil（ADR-044 策略 A：基础设施工具收敛，tags/logs/fileops 共用）。 |
| `DetectZipType()` | `go/importer/importer_file:123` | DetectZipType 扫描 ZIP local file header 中的文件名识别资源类型 |
| `ImportOptions()` | `go/importer/importer_file:20` | ImportOptions 导入选项 |
| `ImportLogger()` | `go/importer/importer_file:26` | ImportLogger 导入日志回调（薄壳注入 App.logger.Add） |
| `Register()` | `go/importer/importer:31` | Register 注册导入策略 |
| `Get()` | `go/importer/importer:36` | Get 获取指定类型的导入策略 |
| `NewSimpleCopy()` | `go/importer/importer:62` | NewSimpleCopy 创建简单文件复制导入器 |
| `SimpleCopyImporter.Type()` | `go/importer/importer:66` | — |
| `SimpleCopyImporter.Import()` | `go/importer/importer:68` | — |
| `NewDirectoryCopy()` | `go/importer/importer:263` | NewDirectoryCopy 创建文件夹复制导入器 |
| `DirectoryCopyImporter.Type()` | `go/importer/importer:267` | — |
| `DirectoryCopyImporter.Import()` | `go/importer/importer:272` | Import 复制源文件夹到目标目录 srcPath 可以是文件夹内任意文件路径，也可以是文件夹本身 若 srcPath 是文件则取父目录，若是目录则直接使用 |
| `Handler()` | `go/importer/importer:21` | Handler 资源导入策略接口 |
| `SimpleCopyImporter()` | `go/importer/importer:57` | — |
| `DirectoryCopyImporter()` | `go/importer/importer:258` | — |

## Go·安装

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Install()` | `go/installer/installer:44` | Install 安装模型到目标目录（支持链接模式） |
| `InstallLocked()` | `go/installer/installer:52` | InstallLocked 安装模型到目标目录（调用方须已持有 InstallLock，禁止直接调用）。 |
| `InstallDir()` | `go/installer/installer:145` | InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式） 用于 MMD/VRC 模型，.pmx/.pmd 文件所在文件夹包含纹理等配套文件 rtype 用于过滤文件 |
| `InstallDirLocked()` | `go/installer/installer:154` | InstallDirLocked 安装整个目录下的所有文件到目标目录（调用方须已持有 InstallLock， 禁止直接调用）。语义与 InstallDir 一致，但不重复加锁—— |
| `InstallToGlobal()` | `go/installer/installer:343` | InstallToGlobal 安装到全局 custom 目录 |
| `InstallWithOverlay()` | `go/installer/installer:368` | InstallWithOverlay 带冲突检查的安装 |
| `CopyFile()` | `go/installer/installer:449` | CopyFile 复制文件到目标目录（带互斥锁） |
| `CopyFileLocked()` | `go/installer/installer:457` | CopyFileLocked 复制文件到目标目录（调用方须已持有 InstallLock，禁止直接调用）。 |
| `IsValidRepoRoot()` | `go/installer/installer:607` | IsValidRepoRoot 禁止选择系统敏感目录作为仓库 跨平台实现：禁止根目录、系统关键目录 |

## go/instance

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BuildSyncItems()` | `go/instance/instance:24` | BuildSyncItems 组装整合包内各资源类型的同步状态项（纯逻辑，root 由调用方注入） |
| `ResourceTypeInfo()` | `go/instance/instance:17` | ResourceTypeInfo 资源类型注册表条目（BuildSyncItems 需要的字段） |

## go/internal

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `CreateTestFile()` | `go/internal/testutil/testutil:14` | CreateTestFile 在 dir 下创建 name 文件（自动建父目录），返回完整路径。 |
| `MakeZipBytes()` | `go/internal/testutil/testutil:28` | MakeZipBytes 构造内存 ZIP（entries: 条目名→内容），返回字节。 |
| `WriteZipFile()` | `go/internal/testutil/testutil:48` | WriteZipFile 构造 ZIP 并写入 t.TempDir()/name，返回文件路径。 |

## Go·Litematic

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `MapColor()` | `go/litematic/block_colors:10` | MapColor 返回 minecraft 方块名对应的近似十六进制颜色。 |
| `ResolveBlockName()` | `go/litematic/block_ids:12` | ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。 |
| `ResolveBlockZH()` | `go/litematic/block_ids:26` | ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。 |
| `ParseMeta()` | `go/litematic/parser:14` | — |
| `ParseSchematicSummary()` | `go/litematic/parser:173` | — |
| `ParseNbtStructure()` | `go/litematic/parser:267` | — |
| `BuildVoxelData()` | `go/litematic/voxel:92` | BuildVoxelData 构建体素渲染数据（按颜色分组） |
| `BuildNbtVoxelData()` | `go/litematic/voxel:286` | — |
| `BuildSchematicVoxelData()` | `go/litematic/voxel:379` | — |

## Go·日志

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewLogger()` | `go/logs/logs:39` | NewLogger 创建日志管理器 configDir 为应用配置根目录（含 "YSM-Model-Manager" 子目录）—— 由调用方（internal/app）注入，与 c |
| `Logger.Add()` | `go/logs/logs:143` | Add 添加一条导入日志（兼容旧调用） |
| `Logger.AddOp()` | `go/logs/logs:148` | AddOp 添加一条指定操作类型的日志 |
| `Logger.GetAll()` | `go/logs/logs:188` | GetAll 获取所有日志 |
| `Logger.Clear()` | `go/logs/logs:197` | Clear 清空日志 |
| `Logger()` | `go/logs/logs:29` | Logger 导入日志管理器 |
| `NewRuntimeBuffer()` | `go/logs/runtime:22` | NewRuntimeBuffer 创建环形缓冲 |
| `RuntimeBuffer.Write()` | `go/logs/runtime:30` | Write 实现 io.Writer：每次调用记录一条运行时日志（标准库 log 一行即一次 Write） |
| `RuntimeBuffer.GetAll()` | `go/logs/runtime:50` | GetAll 返回全部日志的副本 |
| `RuntimeBuffer.Clear()` | `go/logs/runtime:59` | Clear 清空缓冲 |
| `RuntimeBuffer()` | `go/logs/runtime:15` | RuntimeBuffer 运行时日志环形缓冲：捕获标准库 log 输出（watcher/sync 等），供诊断页展示。 |

## Go·包管理

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ReadPackMeta()` | `go/packs/mcmeta:25` | ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图 |
| `DetectResourceType()` | `go/packs/mcmeta:123` | DetectResourceType 检测文件属于哪种资源类型 |
| `ReadShaderpackLang()` | `go/packs/mcmeta:229` | ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名 返回 {name, entries}，name 为空时前端用文件名兜 |

## Go·路径

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ErrPathEscalation.Error()` | `go/paths/safe:16` | — |
| `IsInside()` | `go/paths/safe:23` | IsInside 检查 path 是否在 baseDir 下，防止路径遍历。 |
| `ContainsMinecraftMarker()` | `go/paths/safe:71` | ContainsMinecraftMarker 检查路径中是否包含 .minecraft 或 minecraft 标记 PrismLauncher 实例目录下可能是 minecra |
| `ErrPathEscalation()` | `go/paths/safe:10` | ErrPathEscalation 路径越权错误 |

## Go·回收站

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `RemoveRepoDuplicates()` | `go/recycle/recycle_clean:22` | RemoveRepoDuplicates 清理整合包子目录中仓库已有的文件： 在 recycleRoot 内的移入回收站（可恢复），否则直接删除（仓库侧无损可重推） |
| `DeduplicateEntries()` | `go/recycle/recycle_clean:59` | DeduplicateEntries 按 SHA256 哈希分组去重：每组显式按路径排序保留第一个，其余移入回收站 |
| `CleanOpLogger()` | `go/recycle/recycle_clean:18` | CleanOpLogger 清理操作日志回调（薄壳注入 App.logger.Add） |
| `New()` | `go/recycle/recycle:33` | New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle |
| `TrashManager.RecycleDir()` | `go/recycle/recycle:42` | RecycleDir 返回回收站目录路径 |
| `TrashManager.Move()` | `go/recycle/recycle:47` | Move 移动文件到回收站 |
| `TrashManager.MoveEx()` | `go/recycle/recycle:53` | MoveEx 移动文件到回收站，返回操作详情 |
| `TrashManager.List()` | `go/recycle/recycle:160` | List 列出回收站中的文件。 |
| `TrashManager.Restore()` | `go/recycle/recycle:220` | Restore 从回收站恢复到原目录 |
| `TrashManager.Delete()` | `go/recycle/recycle:317` | Delete 永久删除回收站中的文件 ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll |
| `TrashManager.Empty()` | `go/recycle/recycle:337` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `Move()` | `go/recycle/recycle:47` | Move 移动文件到回收站 |
| `MoveEx()` | `go/recycle/recycle:53` | MoveEx 移动文件到回收站，返回操作详情 |
| `List()` | `go/recycle/recycle:160` | List 列出回收站中的文件。 |
| `Restore()` | `go/recycle/recycle:220` | Restore 从回收站恢复到原目录 |
| `Delete()` | `go/recycle/recycle:317` | Delete 永久删除回收站中的文件 ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll |
| `Empty()` | `go/recycle/recycle:337` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `MoveResult()` | `go/recycle/recycle:18` | MoveResult 回收操作结果 |
| `TrashManager()` | `go/recycle/recycle:24` | TrashManager 可配置的回收站管理器 |

## go/scanner

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `InvalidateCache()` | `go/scanner/scanner:59` | InvalidateCache 清空全部扫描缓存（下载/导入/同步后调用） |
| `InvalidatePath()` | `go/scanner/scanner:74` | InvalidatePath 删除指定目录的扫描缓存（启用/禁用 .ban 后调用） |
| `ScanEntries()` | `go/scanner/scanner:105` | ScanEntries 扫描目录下的模型文件（含 .recycle 排除、扩展名过滤、SHA256 哈希、30s TTL 缓存） |
| `ScanEntriesWithHit()` | `go/scanner/scanner:112` | ScanEntriesWithHit 同 ScanEntries，但额外返回是否命中 30s 缓存。 |
| `ComputeFileHash()` | `go/scanner/scanner:246` | ComputeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配） |
| `ListModelAuthors()` | `go/scanner/scanner:270` | ListModelAuthors 从扫描条目提取 [作者] 前缀统计（按出现次数降序） |
| `ScanLocalAuthors()` | `go/scanner/scanner:302` | ScanLocalAuthors 扫描各资源类型根目录，从文件名提取 [作者]（roots: rtype→root） |
| `GenerateRepoIndex()` | `go/scanner/scanner:370` | GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub Actions/Linux 消费，正斜杠路径） |

## Go·同步

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SyncResourcesDirLevel()` | `go/sync/sync_dirlevel:53` | SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹） 以文件夹名为单位，一个文件夹 |
| `ListVersions()` | `go/sync/sync_discovery:15` | — |
| `HasDotMinecraftSubdirs()` | `go/sync/sync_discovery:30` | HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录） |
| `FindMinecraftDir()` | `go/sync/sync_discovery:47` | FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径 |
| `ListVersionsFunc()` | `go/sync/sync_discovery:13` | ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock） |
| `CompareGlobalInstanceHashes()` | `go/sync/sync_hash:47` | CompareGlobalInstanceHashes 对比全局目录和整合包实例子目录，返回每个实例的 Missing / Extra / Synced 状态。 |
| `HasModInDirFn()` | `go/sync/sync_hash:38` | HasModInDirFn 判断 mods 目录是否含有指定类型 mod 的函数类型。 |
| `PushResources()` | `go/sync/sync_push:23` | PushResources 推送缺失资源到整合包（folder 级类型用 SyncResourcesDirLevel） |
| `PullResources()` | `go/sync/sync_push:66` | PullResources 拉取整合包多余资源回仓库 |
| `PullSingleResource()` | `go/sync/sync_push:138` | PullSingleResource 拉取单个资源（文件夹/文件）回仓库 |
| `PushSingleResource()` | `go/sync/sync_push:160` | PushSingleResource 推送单个资源到整合包： 文件夹 / .json/.pmx/.pmd（文件夹级类型）走 InstallDir，其余 Install |
| `SyncCustomToRepo()` | `go/sync/sync_push:173` | SyncCustomToRepo 同步整合包自定义目录的模型到仓库（哈希/名称去重） |
| `Logger()` | `go/sync/sync_push:20` | Logger 导入日志回调（薄壳注入 App.logger.Add） |
| `RelinkDir()` | `go/sync/sync_relink:18` | RelinkDir 按哈希比对重链接实例目录与仓库（原子替换，失败回滚） |
| `GetInstanceStatus()` | `go/sync/sync:26` | GetInstanceStatus 获取整合包状态（使用真实 ListVersions） |
| `GetInstanceStatusWith()` | `go/sync/sync:31` | GetInstanceStatusWith 可注入的整合包状态获取（测试用） |
| `SyncToggleStatus()` | `go/sync/sync:147` | SyncToggleStatus 同步启用/禁用状态 |
| `SyncResources()` | `go/sync/sync:277` | SyncResources 对比两个目录的资源文件差异，按文件名匹配 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步 只统计模型/资源相关扩展名的文件，忽略无关文件 |
| `SortEntries()` | `go/sync/sync:371` | SortEntries 按名称排序模型条目 |
| `GetLinkType()` | `go/sync/sync:378` | GetLinkType 判断文件的链接类型 |
| `ScanFunc()` | `go/sync/sync:23` | ScanFunc 扫描模型（函数类型，由 app.go 注入） |

## Go·标签

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewStore()` | `go/tags/tags:26` | NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取） |
| `Store.GetTags()` | `go/tags/tags:105` | GetTags 返回指定路径的所有标签（已排序） |
| `Store.SetTags()` | `go/tags/tags:122` | SetTags 设置指定路径的标签列表（覆盖写入） |
| `Store.AddTag()` | `go/tags/tags:161` | AddTag 追加单个标签（不会重复） |
| `Store.RemoveTag()` | `go/tags/tags:184` | RemoveTag 移除单个标签 |
| `Store.ListByTag()` | `go/tags/tags:213` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `Store.AllTags()` | `go/tags/tags:237` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `Store()` | `go/tags/tags:19` | Store 是标签存储，线程安全 |

## Go·Three.js

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Build()` | `go/threejs/spec:58` | Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec |
| `BuildMulti()` | `go/threejs/spec:74` | BuildMulti 多组件 spec：每个组件独立构建为 spec.models 元素（YSMViewer 式多组件同屏）。 |
| `Model3DSpec()` | `go/threejs/spec:17` | — |
| `ModelGroup()` | `go/threejs/spec:21` | — |
| `BoneData()` | `go/threejs/spec:32` | — |
| `MeshData()` | `go/threejs/spec:41` | — |

## Go·类型

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BedrockModel()` | `go/types/bedrock:4` | BedrockModel 基岩版模型几何体摘要（用于 2D 预览） |
| `Bone2D()` | `go/types/bedrock:19` | Bone2D 骨骼简化信息（只用于 2D 线条图） |
| `Cube2D()` | `go/types/bedrock:29` | Cube2D 立方体信息 |
| `AppConfig()` | `go/types/config:4` | AppConfig 应用持久化配置 |
| `PackInfo()` | `go/types/config:31` | PackInfo 模型整合包信息（ysm-pack.json） |
| `WorkshopPresetSearch()` | `go/types/config:38` | WorkshopPresetSearch 预设搜索词 |
| `WorkshopSite()` | `go/types/config:44` | WorkshopSite 创意工坊站点配置 |
| `WorkshopCreator()` | `go/types/config:57` | WorkshopCreator 创作者条目 Type 是平台标签，分号分隔，如 "bilibili;afdian" |
| `AllExts()` | `go/types/extensions:22` | AllExts 返回所有支持的扩展名（去重后） |
| `IsSupportedExt()` | `go/types/extensions:38` | IsSupportedExt 检查扩展名是否被任何资源类型支持 |
| `IsYsmEntryJSON()` | `go/types/extensions:54` | IsYsmEntryJSON 判断是否为 YSM 解压目录的唯一清单入口 ysm.json（大小写不敏感） ADR-038 D2：.json 仅放行 ysm.json；包内 geo |
| `ShouldHashExt()` | `go/types/extensions:61` | ShouldHashExt 判断扩展名是否需要计算 SHA256 哈希（用于同步系统文件匹配） 跳过非 YSM 类型的大文件（MMD/VRC 文件可达数十 MB，哈希全量太慢） 蓝 |
| `ExtBelongsTo()` | `go/types/extensions:70` | ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个） |
| `SupportedExtsForType()` | `go/types/extensions:85` | SupportedExtsForType 返回指定资源类型的所有扩展名 |
| `FindInstDir()` | `go/types/extensions:99` | FindInstDir 查找整合包中指定资源类型的子目录： 1. |
| `StorageSubDir()` | `go/types/extensions:144` | StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身 |
| `SubDirMap()` | `go/types/extensions:158` | SubDirMap 返回指定资源类型在整合包实例版本目录中的扫描子目录 |
| `SubDirAll()` | `go/types/extensions:170` | SubDirAll 返回所有资源类型在整合包实例中的版本扫描子目录映射 |
| `AllSubDirs()` | `go/types/extensions:182` | AllSubDirs 返回所有资源类型的版本子目录信息（遍历用） |
| `SubDirEntry()` | `go/types/extensions:152` | SubDirEntry 资源类型的版本子目录信息 |
| `SetRegistryPath()` | `go/types/resource:42` | SetRegistryPath 设置注册表文件路径（仅测试用） 加锁保护：并发调用 LoadRegistry + SetRegistryPath 触发数据竞争（审计 P1 #2）。 |
| `LoadRegistry()` | `go/types/resource:53` | LoadRegistry 加载资源类型注册表 优先读取外部 JSON 文件（可通过 SetRegistryPath 自定义路径）， 文件不存在或读取失败时回退到编译时嵌入的默认数据 |
| `RegistryType()` | `go/types/resource:142` | RegistryType 按 id 查找资源类型，不存在时返回 nil |
| `FormatRange.UnmarshalJSON()` | `go/types/resource:160` | UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式 |
| `PackMeta.Desc()` | `go/types/resource:256` | Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组） |
| `ResourceTypeRegistry()` | `go/types/resource:13` | ResourceTypeRegistry 资源类型注册表 |
| `ResourceType()` | `go/types/resource:18` | ResourceType 一种受支持的资源类型定义 |
| `FormatRange()` | `go/types/resource:154` | FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]） |
| `PackMeta()` | `go/types/resource:245` | PackMeta 资源包信息（来自 pack.mcmeta） |
| `LitematicMeta()` | `go/types/resource:263` | LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound） |
| `LitematicBlockStat()` | `go/types/resource:280` | LitematicBlockStat 方块类型统计 |
| `LitematicVoxelData()` | `go/types/resource:286` | LitematicVoxelData 体素渲染数据 |
| `VoxelGroup()` | `go/types/resource:294` | VoxelGroup 同一颜色的方块组 |
| `AppError.WithCause()` | `go/types/types:117` | WithCause 附加底层错误，使 errors.Is/As 可以穿透 AppError 判定 errno/哨兵。 |
| `AppError.Unwrap()` | `go/types/types:123` | Unwrap 暴露底层错误链（ADR-051：配合 WithCause 恢复结构化错误判定能力） |
| `AppError.Error()` | `go/types/types:125` | — |
| `WindowState()` | `go/types/types:6` | WindowState 窗口位置 |
| `AuthorInfo()` | `go/types/types:14` | AuthorInfo 作者信息（含模型计数） |
| `ModelEntry()` | `go/types/types:21` | ModelEntry 模型文件条目 |
| `ImportFileItem()` | `go/types/types:32` | ImportFileItem 文件夹型模型整组导入的文件项（ADR-038 关联：解压目录整组导入） |
| `VersionInstance()` | `go/types/types:38` | VersionInstance 整合包信息 |
| `SearchResult()` | `go/types/types:46` | SearchResult 模型搜索结果 |
| `ImportLog()` | `go/types/types:57` | ImportLog 应用操作日志（导入、扫描、下载、同步等） |
| `RuntimeLog()` | `go/types/types:69` | RuntimeLog 运行时日志（watcher/sync 等标准库 log 输出，诊断页可见） |
| `LinkType()` | `go/types/types:75` | LinkType 链接类型 |
| `CustomFileInfo()` | `go/types/types:85` | CustomFileInfo custom 目录下的文件信息 |
| `InstanceStatus()` | `go/types/types:91` | InstanceStatus 整合包状态 |
| `AppError()` | `go/types/types:104` | — |
| `ResourceSyncResult()` | `go/types/types:138` | ResourceSyncResult 资源同步结果 |
| `SyncStatus()` | `go/types/types:145` | SyncStatus 资源文件同步状态 |
| `ResourceSyncItem()` | `go/types/types:156` | ResourceSyncItem 单个资源文件的同步状态 |

## Go·更新器

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `progressWriter.Write()` | `go/updater/updater:66` | — |
| `Check()` | `go/updater/updater:125` | Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志） |
| `CheckWithClient()` | `go/updater/updater:131` | CheckWithClient 可注入 client 与 API URL 的测试变体（Check 的内部实现） |
| `Download()` | `go/updater/updater:234` | Download 下载更新包（裸 exe）到临时目录，返回更新包路径（无进度回调，兼容旧调用方）。 |
| `DownloadWithProgress()` | `go/updater/updater:243` | DownloadWithProgress 下载更新包；onProgress 在下载过程中节流回调 (done, total) 字节数 （total&lt;=0 表示 Content-Le |
| `CleanupOldVersion()` | `go/updater/updater:393` | CleanupOldVersion 启动时清理上一次更新留下的 .old 文件 |
| `InstallUpdate()` | `go/updater/updater:417` | InstallUpdate 校验下载的更新 exe 并通过 helper 进程替换当前 exe。 |
| `ReleaseAsset()` | `go/updater/updater:86` | ReleaseAsset GitHub Release 中的文件 |
| `Release()` | `go/updater/updater:92` | Release GitHub Release 信息 |
| `UpdateInfo()` | `go/updater/updater:101` | UpdateInfo 更新信息（序列化给前端） |

## Go·监听

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/watcher/watcher:42` | New 创建文件监听器 |
| `Watcher.Start()` | `go/watcher/watcher:58` | Start 开始监听 |
| `Watcher.Stop()` | `go/watcher/watcher:106` | Stop 停止监听 |
| `Watcher.IsRunning()` | `go/watcher/watcher:150` | IsRunning 返回是否正在运行 |
| `ScanFunc()` | `go/watcher/watcher:18` | ScanFunc matches mdsync.ScanFunc |
| `Watcher()` | `go/watcher/watcher:25` | Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包 |

## Go·YSM 核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SetDecoder()` | `go/ysm/decode_inject:18` | SetDecoder 注入 .ysm 解码器（internal/app init 阶段调用，替换 FindCLI 模式） |
| `DecodeYSM()` | `go/ysm/decode_inject:23` | DecodeYSM 解码 .ysm 字节；解码器未注入或解码失败返回 nil |
| `DecodedFile()` | `go/ysm/decode_inject:9` | DecodedFile 解码 .ysm 产出的一个文件（Path 为输出目录内相对路径） |
| `FindGeometryInExtractedYSM()` | `go/ysm/extracted:50` | FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理 ysmJsonPath: ysm.json 的完整路径 返回: |
| `FindComponentsInExtractedYSM()` | `go/ysm/extracted:392` | FindComponentsInExtractedYSM 多组件解析（YSMViewer 式）：解压目录内每个模型文件独立组件， **不合并 bones、不排除 arm**（arm |
| `AnalyzeYSMHeader()` | `go/ysm/header:167` | AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据 |
| `AnalyzeYSMHeaderFromBytes()` | `go/ysm/header:320` | AnalyzeYSMHeaderFromBytes 从字节数据解析 YSM 头部（适用于 base64 导入场景） |
| `YSMHeader()` | `go/ysm/header:12` | YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型） |
| `AnalyzeYSMModel()` | `go/ysm/parse:45` | AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据 |
| `YSMModelMeta()` | `go/ysm/parse:15` | YSMModelMeta 模型元数据（从 model.json 提取） |
| `ExtractYsmSummary()` | `go/ysm/summary:135` | ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要 |
| `Author()` | `go/ysm/summary:16` | — |
| `Link()` | `go/ysm/summary:22` | — |
| `AnimGroup()` | `go/ysm/summary:27` | — |
| `ConfigMenu()` | `go/ysm/summary:33` | — |
| `PreviewInfo()` | `go/ysm/summary:39` | — |
| `YsmSummary()` | `go/ysm/summary:47` | YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要 |
| `Stats()` | `go/ysm/summary:64` | — |
| `ScanModelTexSizes()` | `go/ysm/texsize:29` | ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM 仅支持 zip/7z 格式（未加密模型），加密 .ysm 返回 0,0 |
| `ScanFiles()` | `go/ysm/texsize:180` | ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用） |
| `TexInfo()` | `go/ysm/texsize:21` | TexInfo 轻量级纹理尺寸（不解析完整模型） |
| `ModelEntry()` | `go/ysm/texsize:44` | ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径） |
| `IsYSMJar()` | `go/ysm/ysm:13` | IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml） |
| `HasYSMMod()` | `go/ysm/ysm:78` | HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP） |
| `HasModInDir()` | `go/ysm/ysm:107` | HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar |

## Go(internal)·应用入口

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `App.CachedCreatorAvatar()` | `internal/app/app_avatar:16` | CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI |
| `App.BatchExtractCreatorAvatars()` | `internal/app/app_avatar:21` | BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像 |
| `App.DebugExtractCreatorAvatar()` | `internal/app/app_avatar:73` | DebugExtractCreatorAvatar 调试版：提取指定作者头像 |
| `App.CacheModelAvatars()` | `internal/app/app_avatar:128` | CacheModelAvatars 从模型文件缓存作者头像（覆盖 .ysm/.zip/.json 等所有格式） |
| `App.GetConfigPath()` | `internal/app/app_config:59` | GetConfigPath 返回应用配置文件路径（跨平台：Windows %APPDATA%，Linux ~/.config，macOS ~/Library/Application |
| `App.SaveAppConfig()` | `internal/app/app_config:135` | — |
| `App.SetDownloadMirror()` | `internal/app/app_config:205` | — |
| `App.LoadAppConfig()` | `internal/app/app_config:236` | — |
| `App.GetSubDirMap()` | `internal/app/app_config:257` | ========== 自动更新 ========== GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用） |
| `App.CurrentVersion()` | `internal/app/app_config:261` | — |
| `App.CheckUpdate()` | `internal/app/app_config:263` | — |
| `App.DoUpdate()` | `internal/app/app_config:290` | — |
| `App.RestartApplication()` | `internal/app/app_config:308` | — |
| `App.SaveWindowPosition()` | `internal/app/app_config:343` | — |
| `App.GetWindowPosition()` | `internal/app/app_config:357` | — |
| `App.SelectDirectory()` | `internal/app/app_config:390` | ========== 目录选择 ========== |
| `App.GetMinecraftPaths()` | `internal/app/app_config:453` | — |
| `App.ValidateMinecraftDir()` | `internal/app/app_config:455` | — |
| `NewDownloadQueue()` | `internal/app/app_download:51` | NewDownloadQueue 创建串行下载队列（回调由 App 初始化时注入） |
| `App.EnqueueDownloads()` | `internal/app/app_download:56` | — |
| `App.CancelQueue()` | `internal/app/app_download:86` | — |
| `App.QueueStatus()` | `internal/app/app_download:103` | — |
| `App.DownloadFromGitHub()` | `internal/app/app_download:256` | — |
| `App.GetModelTexSizes()` | `internal/app/app_download:267` | GetModelTexSizes 扫描仓库文件提取纹理尺寸（轻量级，不解析完整模型） |
| `QueueStatusInfo()` | `internal/app/app_download:18` | QueueStatusInfo 队列状态（替代多返回值，Wails 自动映射为 JS object） |
| `DownloadTask()` | `internal/app/app_download:24` | DownloadTask 下载队列任务 |
| `DownloadQueue()` | `internal/app/app_download:33` | DownloadQueue 串行下载队列 回调注入替代 *App 反向引用（ADR-002 P1：打破 DownloadQueue ↔ App 循环，解锁独立测试） |
| `App.CreateDir()` | `internal/app/app_files:21` | ========== 目录操作 ========== |
| `App.RenameDir()` | `internal/app/app_files:25` | — |
| `App.RemoveDir()` | `internal/app/app_files:37` | — |
| `App.RenameFile()` | `internal/app/app_files:49` | — |
| `App.FindPreviewImage()` | `internal/app/app_files:63` | ========== 预览提取 ========== |
| `App.ExtractPreviewTexture()` | `internal/app/app_files:67` | — |
| `App.GetPackInfo()` | `internal/app/app_files:72` | ========== 包信息 ========== |
| `App.MoveModelFile()` | `internal/app/app_files:78` | ========== 模型移动/复制 ========== MoveModelFile 移动（root 传 FilesRoot 做路径安全校验，对齐 CopyModelFile） |
| `App.CopyModelFile()` | `internal/app/app_files:84` | CopyModelFile 复制（root 传 FilesRoot 做路径安全校验） |
| `App.ImportModelFolder()` | `internal/app/app_files:91` | ImportModelFolder 文件夹型模型整组导入（YSM 解压目录，保留子目录层级，ADR-038 关联） folderName = 仓库文件夹名（模型名）；files = |
| `App.RevealInExplorer()` | `internal/app/app_files:104` | ========== 在资源管理器中显示 ========== |
| `App.ToggleModelEnable()` | `internal/app/app_files:130` | ========== 启用/禁用 ========== ToggleModelEnable 切换 .ban 状态（fileops 纯逻辑 + 薄壳缓存失效） |
| `App.IsFileBanned()` | `internal/app/app_files:138` | — |
| `App.InstallModelFile()` | `internal/app/app_install_import:19` | ========== 安装 ========== |
| `App.InstallModelTo()` | `internal/app/app_install_import:23` | — |
| `App.InstallModelWithOverlay()` | `internal/app/app_install_import:33` | — |
| `App.SyncCustomToRepo()` | `internal/app/app_install_import:38` | SyncCustomToRepo 同步整合包自定义目录到仓库（执行逻辑下沉 go/sync） |
| `App.ImportModelFile()` | `internal/app/app_install_import:42` | — |
| `App.DetectZipType()` | `internal/app/app_install_import:47` | DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用） |
| `App.ImportModelFileSkipCheck()` | `internal/app/app_install_import:55` | — |
| `App.ImportModelFileOverwrite()` | `internal/app/app_install_import:63` | — |
| `App.ImportModelFileTo()` | `internal/app/app_install_import:83` | — |
| `App.ImportModelFileOverwriteTo()` | `internal/app/app_install_import:87` | — |
| `App.CountInstanceResources()` | `internal/app/app_install_instance:26` | CountInstanceResources 统计指定整合包中可清空的资源文件数 只统计仓库中已有的文件（同 clearInstanceDir 逻辑） rtype 为空时统计全部类 |
| `App.ClearInstanceResources()` | `internal/app/app_install_instance:66` | ClearInstanceResources 清空指定整合包中已同步的文件 insName: 整合包名, rtype: 资源类型（空=全部, 非空=只清此类型） 返回清除的文件数量 |
| `App.DeduplicateCustomDir()` | `internal/app/app_install_instance:152` | DeduplicateCustomDir 按 SHA256 哈希去重（执行逻辑下沉 go/recycle） |
| `App.GetInstanceStatus()` | `internal/app/app_install_instance:195` | ========== 状态同步 ========== |
| `App.GetResourceInstanceStatus()` | `internal/app/app_install_instance:207` | GetResourceInstanceStatus 按资源类型获取整合包同步状态 repoDir 仅对 YSM 类型生效（其他类型从全局资源目录推导） |
| `App.SyncModelToggleStatus()` | `internal/app/app_install_instance:247` | — |
| `App.RelinkCustomDir()` | `internal/app/app_install_instance:252` | RelinkCustomDir 重新应用链接模式到指定目录（兼容旧版） |
| `App.RelinkAllInstanceResources()` | `internal/app/app_install_instance:272` | RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录 |
| `App.SyncResources()` | `internal/app/app_install_instance:314` | SyncResources 获取全局 ↔ 整合包的资源同步状态 |
| `App.PushResourceToInstance()` | `internal/app/app_install_instance:348` | PushResourceToInstance 将全局中缺失的资源推送到整合包 PushResourceToInstance 推送缺失资源到整合包（执行循环下沉 go/sync） |
| `App.PullResourceFromInstance()` | `internal/app/app_install_instance:366` | PullResourceFromInstance 拉取整合包多余资源回仓库（执行循环下沉 go/sync） |
| `App.PullSingleResourceFromInstance()` | `internal/app/app_install_instance:400` | PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库 PullSingleResourceFromInstance 从 |
| `App.PushSingleResourceToInstance()` | `internal/app/app_install_instance:417` | PushSingleResourceToInstance 推送单个资源到整合包（分派核心下沉 go/sync） |
| `App.GetInstanceSyncStatus()` | `internal/app/app_install_instance:437` | GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表） GetInstanceSyncStatus 整合包同步状态（组装逻辑已下沉 go/ins |
| `App.HasYSMMod()` | `internal/app/app_install_instance:489` | ========== YSM 检测 ========== |
| `App.SetLinkMode()` | `internal/app/app_install_link:11` | ========== 链接模式 ========== |
| `App.GetLinkMode()` | `internal/app/app_install_link:38` | — |
| `App.AddImportLog()` | `internal/app/app_install_log:8` | ========== 日志 ========== |
| `App.AddOpLog()` | `internal/app/app_install_log:12` | — |
| `App.GetImportLogs()` | `internal/app/app_install_log:16` | — |
| `App.ClearImportLogs()` | `internal/app/app_install_log:20` | — |
| `App.GetRuntimeLogs()` | `internal/app/app_install_log:25` | GetRuntimeLogs 获取运行时日志（watcher/sync 等标准库 log 输出） |
| `App.ClearRuntimeLogs()` | `internal/app/app_install_log:30` | ClearRuntimeLogs 清空运行时日志缓冲 |
| `App.MoveToRecycle()` | `internal/app/app_install_recycle:17` | ========== 回收站 ========== |
| `App.MoveToRecycleEx()` | `internal/app/app_install_recycle:38` | — |
| `App.ClearCustomDir()` | `internal/app/app_install_recycle:85` | — |
| `App.ListRecycleBin()` | `internal/app/app_install_recycle:165` | — |
| `App.RestoreFromRecycle()` | `internal/app/app_install_recycle:182` | — |
| `App.DeleteFromRecycle()` | `internal/app/app_install_recycle:203` | — |
| `App.EmptyRecycleBin()` | `internal/app/app_install_recycle:219` | EmptyRecycleBin 清空所有已配置资源根目录的回收站，返回删除条目总数。 |
| `App.AnalyzeYSMModel()` | `internal/app/app_model:37` | — |
| `App.ExtractYsmSummary()` | `internal/app/app_model:41` | — |
| `App.ExtractYSMHeader()` | `internal/app/app_model:55` | — |
| `App.ExtractYSMHeaderFromBase64()` | `internal/app/app_model:59` | — |
| `App.SavePreviewTempFile()` | `internal/app/app_model:67` | — |
| `App.ReadFileBytes()` | `internal/app/app_model:86` | — |
| `App.AnalyzeBedrockModel()` | `internal/app/app_model:100` | — |
| `App.GetModel3DSpec()` | `internal/app/app_model:152` | — |
| `App.Build3DSpecFromGeometryJSON()` | `internal/app/app_model:188` | Build3DSpecFromGeometryJSON 从 bedrock geometry JSON 构建 3D spec（纯 Go，无 Node 依赖）。 |
| `App.SaveScreenshotFile()` | `internal/app/app_model:250` | SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用） 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路 |
| `App.ExportBoneStructures()` | `internal/app/app_scan:25` | ========== 批量导出骨骼结构 ========== |
| `App.ExportModelStructureJSON()` | `internal/app/app_scan:81` | ExportModelStructureJSON 导出单模型骨骼结构 |
| `App.SearchModels()` | `internal/app/app_scan:118` | ========== 高级搜索 ========== |
| `App.ScanModelEntries()` | `internal/app/app_scan:189` | ScanModelEntries 用户可见的扫描入口（Wails 绑定），记录操作日志。 |
| `App.ScanModelEntriesWithLabel()` | `internal/app/app_scan:211` | ScanModelEntriesWithLabel 同 ScanModelEntries，但操作日志附带资源类型标签 （如「资源包」「光影包」「模型」），便于在操作日志面板区分扫描 |
| `App.ClearScanCache()` | `internal/app/app_scan:227` | ClearScanCache 清除扫描缓存（下载/导入后调用） |
| `App.ListModelAuthors()` | `internal/app/app_scan:232` | ListModelAuthors 统计 [作者] 前缀（走扫描缓存，不重复读磁盘） |
| `App.GenerateRepoIndex()` | `internal/app/app_scan:241` | GenerateRepoIndex 生成 index.json（含 GitHub Actions workflow 模板） |
| `App.ScanLocalAuthors()` | `internal/app/app_scan:249` | ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者 |
| `App.ListVersionInstances()` | `internal/app/app_scan:257` | — |
| `App.GetGlobalCustomDir()` | `internal/app/app_scan:261` | — |
| `App.ListFileNames()` | `internal/app/app_scan:265` | — |
| `App.ListAllFilePaths()` | `internal/app/app_scan:278` | ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名） |
| `App.CheckFileExists()` | `internal/app/app_scan:285` | — |
| `App.OpenFolder()` | `internal/app/app_scan:359` | — |
| `App.OpenInstanceFolder()` | `internal/app/app_scan:381` | OpenInstanceFolder 按资源类型打开整合包子目录；目录不存在时回退到实例根目录 |
| `progressReader.Read()` | `internal/app/app_scan:404` | — |
| `App.GetModelTags()` | `internal/app/app_tags:17` | GetModelTags 返回指定模型文件的所有标签 |
| `App.SetModelTags()` | `internal/app/app_tags:22` | SetModelTags 设置指定模型文件的标签列表（覆盖写入） |
| `App.ListByTag()` | `internal/app/app_tags:27` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `App.AllTags()` | `internal/app/app_tags:32` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `App.DefaultWorkshopSites()` | `internal/app/app_workshop:104` | — |
| `App.SaveWorkshopSites()` | `internal/app/app_workshop:115` | — |
| `App.LoadWorkshopCreators()` | `internal/app/app_workshop:157` | — |
| `App.SaveWorkshopCreators()` | `internal/app/app_workshop:168` | — |
| `App.SaveWorkshopCreatorsBySite()` | `internal/app/app_workshop:177` | SaveWorkshopCreatorsBySite 只替换指定站点的创作者，其他站点不动 |
| `App.SaveWorkshopPresetsBySite()` | `internal/app/app_workshop:193` | SaveWorkshopPresetsBySite 只替换指定站点的搜索词，其他站点不动 |
| `App.LoadGitHubRepos()` | `internal/app/app_workshop:206` | — |
| `App.ResetWorkshopConfigs()` | `internal/app/app_workshop:217` | — |
| `App.ExportWorkshopSitesCSV()` | `internal/app/app_workshop:235` | ========== CSV 导出/导入 ========== |
| `App.ExportWorkshopSitesJSONFile()` | `internal/app/app_workshop:247` | — |
| `App.ValidateWorkshopSites()` | `internal/app/app_workshop:260` | — |
| `App.ImportWorkshopSitesCSV()` | `internal/app/app_workshop:276` | — |
| `App.ExportWorkshopCreatorsJSONFile()` | `internal/app/app_workshop:302` | — |
| `App.BackupWorkshopCreators()` | `internal/app/app_workshop:309` | — |
| `App.MergeWorkshopCreatorsFromJSON()` | `internal/app/app_workshop:322` | — |
| `App.ReplaceWorkshopCreatorsFromJSON()` | `internal/app/app_workshop:364` | — |
| `NewApp()` | `internal/app/app:53` | — |
| `App.SetApp()` | `internal/app/app:79` | SetApp 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框/浏览器管理器 |
| `App.SetMainWindow()` | `internal/app/app:84` | SetMainWindow 注入主窗口实例，避免依赖 Window.Current()。 |
| `App.ServiceStartup()` | `internal/app/app:87` | ServiceStartup 对应 v2 的 startup，在 app.Run() 期间由框架调用 |
| `App.ServiceShutdown()` | `internal/app/app:167` | ServiceShutdown 对应 v2 的 shutdown，在应用退出前由框架调用 |
| `App.OpenInBrowser()` | `internal/app/app:202` | OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌） |
| `App.GetAppVersion()` | `internal/app/app:207` | GetAppVersion 返回当前版本号 |
| `App()` | `internal/app/app:25` | — |
| `SetEmbedded()` | `internal/app/assets:16` | SetEmbedded 由根包 main 的 init() 注入编译期嵌入的静态资产。 |
| `androidPathManager.AppDataRoot()` | `internal/app/pathmgr_android:43` | AppDataRoot 按候选序返回第一个可写目录；全不可写返回错误—— 直接返回 HOME/Getwd 可能退化为不可写的文件系统根 "/"（P2 审核发现）， 配置/标签将静默 |
| `androidPathManager.DefaultRepoRoot()` | `internal/app/pathmgr_android:72` | DefaultRepoRoot Android 固定公共仓库根：外部存储根 + 应用名。 |
| `desktopPathManager.AppDataRoot()` | `internal/app/pathmgr_desktop:10` | — |
| `desktopPathManager.DefaultRepoRoot()` | `internal/app/pathmgr_desktop:15` | DefaultRepoRoot 桌面无默认公共仓库——路径由用户在设置页配置（GetRepoRoot 走 FilesRoot） |
| `App.NavigatePlazaWindow()` | `internal/app/plaza_window:40` | — |
| `App.ClosePlazaWindow()` | `internal/app/plaza_window:77` | — |
| `App.PlazaGoBack()` | `internal/app/plaza_window:98` | — |
| `App.PlazaGoForward()` | `internal/app/plaza_window:102` | — |
| `App.PlazaReload()` | `internal/app/plaza_window:106` | — |
| `App.PlazaZoomIn()` | `internal/app/plaza_window:117` | — |
| `App.PlazaZoomOut()` | `internal/app/plaza_window:128` | — |
| `App.PlazaZoomReset()` | `internal/app/plaza_window:139` | — |
| `cookieJar.SetCookies()` | `internal/app/proxy:138` | — |
| `cookieJar.Cookies()` | `internal/app/proxy:160` | — |
| `App.LoadResourceTypes()` | `internal/app/resource_bindings:25` | LoadResourceTypes 加载资源类型注册表 |
| `App.ReadPackMeta()` | `internal/app/resource_bindings:34` | ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png） |
| `App.ReadShaderpackLang()` | `internal/app/resource_bindings:59` | ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名 |
| `App.GetNbtVoxelData()` | `internal/app/resource_bindings:86` | GetNbtVoxelData 读取 .nbt 结构文件体素数据 |
| `App.GetSchematicVoxelData()` | `internal/app/resource_bindings:91` | GetSchematicVoxelData 读取 .schematic 文件体素数据 |
| `App.ReadSchematic()` | `internal/app/resource_bindings:96` | ReadSchematic 读取 .schematic 文件基本信息 |
| `App.ReadNbtStructure()` | `internal/app/resource_bindings:106` | ReadNbtStructure 读取 .nbt 结构文件基本信息 |
| `App.ReadLitematicMeta()` | `internal/app/resource_bindings:116` | ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图） |
| `App.GetLitematicVoxelData()` | `internal/app/resource_bindings:127` | GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置） |
| `App.SetVoxelMaxBlocks()` | `internal/app/resource_bindings:132` | SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000 |
| `App.DetectResourceType()` | `internal/app/resource_bindings:142` | DetectResourceType 检测指定文件的资源类型 |
| `App.GetDefaultRepoRoot()` | `internal/app/resource_bindings:163` | GetDefaultRepoRoot 返回平台默认公共仓库根目录（不含类型子目录）。 |
| `App.GetRepoRoot()` | `internal/app/resource_bindings:178` | GetRepoRoot 根据资源类型返回对应的仓库根目录 |
| `App.ToggleResourcePack()` | `internal/app/resource_bindings:249` | ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled） 补路径守卫——原实现 os.Rename 对任意路径可重命名（对齐 T |
| `App.IsResourcePackEnabled()` | `internal/app/resource_bindings:296` | IsResourcePackEnabled 检查资源包是否启用 |
| `App.SelectImportZip()` | `internal/app/resource_bindings:301` | SelectImportZip 打开文件选择器选取 .zip 文件 |
| `App.SelectImportFile()` | `internal/app/resource_bindings:314` | SelectImportFile 打开文件选择器，按给定扩展名过滤 filter 格式: "显示名|*.ext1;*.ext2" |
| `App.SetResourceRoot()` | `internal/app/resource_bindings:337` | SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认） 非空入参经 filepath.Abs(filepath.Clean()) 规范化，防止含 .. |
| `App.ResetResourceRoot()` | `internal/app/resource_bindings:359` | ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值） |
| `App.ImportResourcePack()` | `internal/app/resource_bindings:390` | ImportResourcePack 使用策略模式导入资源包 |
| `App.ImportByType()` | `internal/app/resource_bindings:403` | ImportByType 统一导入入口——根据资源类型自动选择导入策略 |
| `App.DeleteResourcePack()` | `internal/app/resource_bindings:420` | DeleteResourcePack 删除资源（目录感知，ADR-038 D3.6）： src 为 ysm.json 时整组删除父目录（文件夹型模型），否则删除单文件。 |
| `App.DeleteModelDir()` | `internal/app/resource_bindings:431` | DeleteModelDir 删除文件夹型资源（MMD 模型等），删除文件所在父文件夹 路径守卫：限制在 FilesRoot 内，防止删除系统目录 |
| `App.FindDuplicateFiles()` | `internal/app/resource_bindings:461` | FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串）。 |
| `App.CountDuplicateFiles()` | `internal/app/resource_bindings:478` | CountDuplicateFiles 快速统计重复文件数量。 |
| `App.InvalidateScanCache()` | `internal/app/resource_bindings:492` | InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据（委托 ClearScanCache） |
| `App.InstallResourceToInstance()` | `internal/app/resource_bindings:498` | InstallResourceToInstance 将资源文件安装到指定整合包 rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文 |
| `limitedBuffer.Write()` | `internal/app/wasm_decoder:85` | — |
| `App.GetWasmBinary()` | `internal/app/wasm_embed:5` | GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）。 |

## 前端·根 (app-modules/bus)

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `normalizeTheme()` | `frontend/src/app-modules:63` | 主题归一化：白名单外一律回落 system（P2 修复后持久层也只写合法值） |
| `applyTheme()` | `frontend/src/app-modules:67` | — |
| `initTheme()` | `frontend/src/app-modules:92` | — |
| `bus()` | `frontend/src/bus:187` | 默认实例（组件直接使用） |
| `ToastPayload()` | `frontend/src/bus:7` | — |
| `MenuItem()` | `frontend/src/bus:18` | — |
| `PageName()` | `frontend/src/bus:30` | 核心页面名（与 app-nav 导航菜单一致） |
| `NavPagePayload()` | `frontend/src/bus:38` | — |
| `ModelSelectPayload()` | `frontend/src/bus:42` | — |
| `CtxShowPayload()` | `frontend/src/bus:47` | — |
| `BusEvents()` | `frontend/src/bus:64` | — |
| `BusEventName()` | `frontend/src/bus:113` | — |
| `Bus()` | `frontend/src/bus:115` | — |

## frontend/backend

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `AppBindings()` | `frontend/src/backend/app` | — |
| `getApp()` | `frontend/src/backend/app:18` | 获取 Go App 绑定的缓存引用，避免重复动态 import |
| `WebUnsupportedError()` | `frontend/src/backend/browser-adapter` | — |
| `WEB_ROOT()` | `frontend/src/backend/browser-adapter` | — |
| `MAX_IMPORT_BYTES()` | `frontend/src/backend/browser-adapter` | — |
| `arrayBufferToBase64()` | `frontend/src/backend/browser-adapter` | — |
| `importWebFiles()` | `frontend/src/backend/browser-adapter` | — |
| `selectLocalRepo()` | `frontend/src/backend/browser-adapter` | — |
| `browserAdapter()` | `frontend/src/backend/browser-adapter:216` | 浏览器后端（Proxy 动态形状，未实现 binding 一律 fail-fast） |
| `STORES()` | `frontend/src/backend/idb:16` | — |
| `Store()` | `frontend/src/backend/idb:17` | — |
| `openDB()` | `frontend/src/backend/idb:21` | — |
| `_resetDBForTest()` | `frontend/src/backend/idb:139` | 仅测试用：重置单例连接 + 降级标志（避免用例间共享状态） |
| `idbGet()` | `frontend/src/backend/idb:156` | 读取单 key |
| `idbSet()` | `frontend/src/backend/idb:167` | 写入单 key（QuotaExceededError 走 onabort，必须监听否则 Promise 永不 settle） |
| `idbDel()` | `frontend/src/backend/idb:184` | 删除单 key |
| `idbKeys()` | `frontend/src/backend/idb:200` | 前缀扫描（MikuMikuAR 模式：dir:&lt;stem&gt;: / file:&lt;stem&gt;: 遍历模型库） |
| `readDeclaredBackend()` | `frontend/src/backend/platform:13` | 读取入口 HTML 声明的适配器身份（'go' | 'browser'），未声明返回 undefined |
| `isWebEntryMode()` | `frontend/src/backend/platform:19` | Tier 1：旧 web 短路标记 / vite MODE=web 构建 |
| `resolveWebMode()` | `frontend/src/backend/platform:28` | 同步判定：当前是否应路由到 browser adapter（网页版） |
| `AppBindings()` | `frontend/src/backend/types:6` | Wails v3 生成的 App 绑定模块形状（bindings 目录下 app.ts） |
| `WebUnsupportedError()` | `frontend/src/backend/web-common:8` | 网页版专属错误：binding 浏览器端未实现（Phase 3 能力门控隐藏对应 UI） |
| `WEB_ROOT()` | `frontend/src/backend/web-common:16` | 网页版虚拟仓库根（路径语义与桌面一致：/web/&lt;type&gt;/&lt;name&gt;/&lt;rel&gt;） |
| `MAX_IMPORT_BYTES()` | `frontend/src/backend/web-common:19` | 导入大小上限 100MB（对齐 import-dnd.ts MAX_FILE_SIZE，桌面 oversize 过滤同口径） |
| `arrayBufferToBase64()` | `frontend/src/backend/web-common:22` | ArrayBuffer → base64（分块，大文件避免栈溢出） |
| `loadWebCreators()` | `frontend/src/backend/web-community:27` | — |
| `saveWebCreators()` | `frontend/src/backend/web-community:39` | — |
| `loadWebSites()` | `frontend/src/backend/web-community:48` | — |
| `saveWebSites()` | `frontend/src/backend/web-community:60` | — |
| `loadWebGitHubRepos()` | `frontend/src/backend/web-community:70` | — |
| `batchExtractCreatorAvatars()` | `frontend/src/backend/web-community:86` | — |
| `listWebAuthors()` | `frontend/src/backend/web-community:146` | ListModelAuthors 网页版：从模型名 [作者] 前缀统计（计数降序），对齐 scanner.go:265 |
| `scanWebLocalAuthors()` | `frontend/src/backend/web-community:166` | ScanLocalAuthors 网页版：按 [作者] 提取并合并类型标签，对齐 scanner.go:297 |
| `generateWebRepoIndex()` | `frontend/src/backend/web-community:190` | GenerateRepoIndex 网页版：扫描虚拟根生成 index.json 内容（路径相对 repoPath，正斜杠） |
| `typeFromWebDir()` | `frontend/src/backend/web-fs:22` | 从 /web/&lt;type&gt;/... |
| `selectLocalRepo()` | `frontend/src/backend/web-fs:76` | 网页版授权本地仓库目录：showDirectoryPicker → 递归扫 .ysm → importWebFiles 落 IDB。 |
| `scanWebModels()` | `frontend/src/backend/web-fs:88` | — |
| `readWebFile()` | `frontend/src/backend/web-fs:141` | 读文件（/web/&lt;type&gt;/&lt;rest&gt; → IDB → base64；wasm.ts 解码链零改动复用） 模型组 name 与组内 rel 在 file key 中无缝拼接（ |
| `parseWebModelPath()` | `frontend/src/backend/web-fs:156` | /web/&lt;type&gt;/&lt;name&gt;/&lt;rel&gt; → 三段解析（多段 name 支持）。 |
| `parseWebModelDir()` | `frontend/src/backend/web-fs:173` | /web/&lt;type&gt;/&lt;name&gt; → 类型+模型名（目录形态；name 可含多段路径） |
| `scanAllWebModels()` | `frontend/src/backend/web-fs:180` | 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） |
| `searchWebModels()` | `frontend/src/backend/web-fs:194` | — |
| `loadWebConfig()` | `frontend/src/backend/web-store:11` | — |
| `saveWebConfig()` | `frontend/src/backend/web-store:19` | — |
| `getWebImportLogs()` | `frontend/src/backend/web-store:43` | — |
| `getWebRuntimeLogs()` | `frontend/src/backend/web-store:46` | — |
| `addWebImportLog()` | `frontend/src/backend/web-store:49` | — |
| `addWebOpLog()` | `frontend/src/backend/web-store:57` | — |
| `clearWebImportLogs()` | `frontend/src/backend/web-store:69` | 清空导入日志环（webImpls.ClearImportLogs 调用；状态封装在 web-store 内部） |
| `clearWebRuntimeLogs()` | `frontend/src/backend/web-store:73` | 清空运行时日志环（webImpls.ClearRuntimeLogs 调用；状态封装在 web-store 内部） |
| `getWebTags()` | `frontend/src/backend/web-store:79` | — |
| `setWebTags()` | `frontend/src/backend/web-store:83` | — |
| `listByTagWeb()` | `frontend/src/backend/web-store:106` | — |
| `allTagsWeb()` | `frontend/src/backend/web-store:117` | — |
| `isWebBanned()` | `frontend/src/backend/web-store:131` | — |
| `toggleWebEnable()` | `frontend/src/backend/web-store:134` | — |

## 前端·核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `DIR_HANDLERS()` | `frontend/src/core/context-menu-dir-handlers:9` | dir 类 handler 子表 |
| `FILE_HANDLERS()` | `frontend/src/core/context-menu-file-handlers:12` | file 类 handler 子表 |
| `refreshUI()` | `frontend/src/core/context-menu-handlers:17` | 通知树组件和统计面板刷新 |
| `toast()` | `frontend/src/core/context-menu-handlers:23` | 显示 toast 通知 |
| `isUnsafeFolderName()` | `frontend/src/core/context-menu-handlers:28` | 路径安全过滤：禁止逃逸段（. |
| `resolveDstDir()` | `frontend/src/core/context-menu-handlers:39` | 解析「移动/复制到文件夹」的目标路径（batch.move / batch.copy / file.move / file.copy 共用）。 |
| `runBatchFileOp()` | `frontend/src/core/context-menu-handlers:78` | — |
| `MenuCtx()` | `frontend/src/core/context-menu-handlers:129` | — |
| `HANDLERS()` | `frontend/src/core/context-menu-handlers:132` | 行为 handler 表（instance + batch + merge file/dir） |
| `refreshUI()` | `frontend/src/core/context-menus` | — |
| `toast()` | `frontend/src/core/context-menus` | — |
| `isUnsafeFolderName()` | `frontend/src/core/context-menus` | — |
| `resolveDstDir()` | `frontend/src/core/context-menus` | — |
| `runBatchFileOp()` | `frontend/src/core/context-menus` | — |
| `HANDLERS()` | `frontend/src/core/context-menus` | — |
| `registerContextMenus()` | `frontend/src/core/context-menus:56` | 注册右键菜单映射（ctx:show → menu:show）；由 registerGlobalHandlers 统一调用，unsub 收集进 unsubs 清理 |
| `__TEST__resetDiary()` | `frontend/src/core/error-diary:30` | 仅测试用：重置注册状态使下次 registerErrorDiary 可重新注册。 |
| `registerErrorDiary()` | `frontend/src/core/error-diary:52` | 注册 UI 报错落日记功能。 |
| `registerAndroidEvents()` | `frontend/src/core/handlers/android-events:17` | 注册 Android 系统事件消费，push 取消订阅函数到 unsubs |
| `registerGlobalHandlers()` | `frontend/src/core/handlers/global:12` | 注册所有 core 全局 handler，返回 unsub 函数数组（features/views 层注册由 app-content 编排） |
| `registerInstanceOps()` | `frontend/src/core/handlers/instance-ops:10` | 注册整合包操作 handler，push 返回的取消订阅函数到 unsubs |
| `requireMcRoot()` | `frontend/src/core/handlers/require-mcroot:12` | 读取游戏根目录（mcRoot），空时发 warn toast 并返回 null。 |
| `registerSync()` | `frontend/src/core/handlers/sync:10` | 注册同步 handler，push 返回的取消订阅函数到 unsubs |
| `SUPPORTED_LANGS()` | `frontend/src/core/i18n/locale:11` | 支持的语言列表（规划清单） |
| `LangCode()` | `frontend/src/core/i18n/locale:17` | — |
| `warnedKeys()` | `frontend/src/core/i18n/locale:31` | 缺失 key 告警节流（每 key 只告警一次；跨模块共享给 t.ts 用，故不带 _ 私有前缀） |
| `loadLocale()` | `frontend/src/core/i18n/locale:40` | 加载指定语言的 JSON 包（幂等：已加载不重复 fetch）。 |
| `getBundle()` | `frontend/src/core/i18n/locale:60` | 获取指定语言的翻译包（已加载时直接读缓存，空包/未加载回落非空基准 zh-CN）。 |
| `getLang()` | `frontend/src/core/i18n/locale:74` | 读取当前语言代码 |
| `setLang()` | `frontend/src/core/i18n/locale:79` | 切换语言（异步加载语言包后触发事件） |
| `initI18n()` | `frontend/src/core/i18n/locale:127` | 启动时调用：读取持久化/系统语言 → 预加载语言包 → 同步 HTML 属性。 |
| `en()` | `frontend/src/core/i18n/locales/en:4` | — |
| `ja()` | `frontend/src/core/i18n/locales/ja:5` | — |
| `zhCN()` | `frontend/src/core/i18n/locales/zh-CN:6` | — |
| `t()` | `frontend/src/core/i18n/t:12` | 翻译函数。 |
| `MenuDef()` | `frontend/src/core/menu-defs:19` | 单类菜单的完整声明 |
| `MENU_DEFS()` | `frontend/src/core/menu-defs:25` | 四类右键菜单的声明式规格（唯一事实来源） |
| `getMenuDef()` | `frontend/src/core/menu-defs:113` | 测试辅助：按 type 取声明（不存在返回 undefined） |
| `sanitizePage()` | `frontend/src/core/page-store:29` | — |
| `PAGE_WHITELIST()` | `frontend/src/core/page-store:27` | — |
| `resolveInitialPage()` | `frontend/src/core/page-store:39` | — |
| `PageStore()` | `frontend/src/core/page-store:59` | — |
| `registerPageStore()` | `frontend/src/core/page-store:66` | 注册页面状态同步（由 registerGlobalHandlers 统一调用，bus.on 的 unsub 收集进 unsubs 清理） |

## 前端·特性

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `showProgress()` | `frontend/src/features/community/data:7` | 创建进度条 UI（插入到 searchResults 容器） |
| `FetchModelsResult()` | `frontend/src/features/community/data:36` | 抓取结果 |
| `tryFetchModels()` | `frontend/src/features/community/data:49` | 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应） |
| `PctEl()` | `frontend/src/features/community/download-queue-progress:10` | 进度条元素的自定义属性（点动画） |
| `ProgressGuardHooks()` | `frontend/src/features/community/download-queue-progress:16` | createProgressGuard 依赖注入（controller 提供查找与收口回调） |
| `ProgressGuard()` | `frontend/src/features/community/download-queue-progress:24` | 进度条守卫控制器 |
| `createProgressGuard()` | `frontend/src/features/community/download-queue-progress:40` | — |
| `DownloadTask()` | `frontend/src/features/community/download-queue-store:27` | 下载任务 |
| `QueueError()` | `frontend/src/features/community/download-queue-store:35` | 队列错误项 |
| `DownloadState()` | `frontend/src/features/community/download-queue-store:41` | 队列状态快照 |
| `STATE()` | `frontend/src/features/community/download-queue-store:53` | 模块级共享状态（progress guard / UI 控制器 import 协作，不对外 re-export） |
| `subscribe()` | `frontend/src/features/community/download-queue-store:75` | 订阅 STATE 变更。返回取消订阅函数。 |
| `notify()` | `frontend/src/features/community/download-queue-store:83` | 广播 STATE 变更（UI 控制器 enqueue 失败回滚等场景也经此通知） |
| `getState()` | `frontend/src/features/community/download-queue-store:88` | 当前状态的只读快照 |
| `resume()` | `frontend/src/features/community/download-queue-store:97` | 页面切回时调用，从 Go 端恢复当前队列状态。 |
| `isActiveStatus()` | `frontend/src/features/community/download-queue-store:136` | 队列是否处于活跃下载中（downloading 或 enqueued）。 |
| `enqueueDownloads()` | `frontend/src/features/community/download-queue-store:144` | 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。 |
| `cancelDownloads()` | `frontend/src/features/community/download-queue-store:200` | 模块级取消 — 纯粹的 Go 调用。 |
| `subscribe()` | `frontend/src/features/community/download-queue` | — |
| `getState()` | `frontend/src/features/community/download-queue` | — |
| `resume()` | `frontend/src/features/community/download-queue` | — |
| `enqueueDownloads()` | `frontend/src/features/community/download-queue` | — |
| `cancelDownloads()` | `frontend/src/features/community/download-queue` | — |
| `isActiveStatus()` | `frontend/src/features/community/download-queue` | — |
| `DownloadTask()` | `frontend/src/features/community/download-queue` | — |
| `DownloadState()` | `frontend/src/features/community/download-queue` | — |
| `QueueError()` | `frontend/src/features/community/download-queue` | — |
| `QueueControllerOptions()` | `frontend/src/features/community/download-queue:43` | createDownloadQueue 选项 |
| `QueueController()` | `frontend/src/features/community/download-queue:52` | 队列控制器 |
| `createDownloadQueue()` | `frontend/src/features/community/download-queue:77` | 创建一个下载队列 UI 控制器。 |
| `DOWNLOAD_CONFIRM_BYTES()` | `frontend/src/features/community/download-tasks:7` | 超过该大小需弹窗确认（含边界值本身直接下载） |
| `DOWNLOAD_REJECT_BYTES()` | `frontend/src/features/community/download-tasks:9` | 超过该大小直接拒绝（含边界值本身需确认） |
| `DownloadSizeDecision()` | `frontend/src/features/community/download-tasks:11` | — |
| `classifyDownloadSize()` | `frontend/src/features/community/download-tasks:14` | 下载大小策略：≤4MB 直接下；4–10MB 需确认；&gt;10MB 拒绝 |
| `DownloadCandidate()` | `frontend/src/features/community/download-tasks:24` | 下载候选（结构类型，兼容 WorkshopModel） |
| `buildDownloadTasks()` | `frontend/src/features/community/download-tasks:31` | 选中集 → 下载任务列表（路径统一转正斜杠；未匹配的选中项静默跳过） |
| `RepoEventsContext()` | `frontend/src/features/community/events:15` | bindRepoEvents 上下文 |
| `RepoEventsHandle()` | `frontend/src/features/community/events:27` | 绑定返回值 |
| `bindRepoEvents()` | `frontend/src/features/community/events:40` | 绑定仓库模型页面的所有事件。 |
| `WorkshopModel()` | `frontend/src/features/community/render:10` | 工坊模型条目（index.json 结构） |
| `WorkshopSite()` | `frontend/src/features/community/render:18` | 工坊站点 |
| `isModelMissing()` | `frontend/src/features/community/render:28` | 判断模型是否缺失（本地不存在） |
| `countMissing()` | `frontend/src/features/community/render:44` | 计算缺失数量 |
| `filterModels()` | `frontend/src/features/community/render:55` | 过滤模型列表：关键词匹配（模型名）+ 「仅显示缺失」开关。 |
| `renderModelList()` | `frontend/src/features/community/render:99` | 渲染模型列表（DocumentFragment） |
| `SITE_GROUP_ORDER()` | `frontend/src/features/community/render:195` | 站点分组展示顺序（renderCardsHTML 使用） |
| `groupSites()` | `frontend/src/features/community/render:200` | 按 group 分组站点（缺省 browse）。纯函数，供单测覆盖（ADR-023 L3）。 |
| `renderCardsHTML()` | `frontend/src/features/community/render:217` | 生成左栏站点卡片 HTML |
| `renderRepoHeaderHTML()` | `frontend/src/features/community/render:267` | 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等） |
| `CollectedFile()` | `frontend/src/features/dnd-collector:6` | 收集结果条目 |
| `collectFiles()` | `frontend/src/features/dnd-collector:34` | 递归收集 DataTransferItem[] 或 FileSystemEntry[] 中的文件。 |
| `mergeDropFiles()` | `frontend/src/features/dnd-collector:94` | 从 DropEvent 聚合 collected 条目： 1. |
| `getExt()` | `frontend/src/features/dnd-shared:4` | — |
| `isSupportedFile()` | `frontend/src/features/dnd-shared:8` | 扩展名是否在支持列表 |
| `isImportableFile()` | `frontend/src/features/dnd-shared:14` | 是否可作为独立文件导入：.json 仅放行 ysm.json 入口清单 包内 geometry/animation/语言 json（main.json / *.animation. |
| `shouldEnterForm()` | `frontend/src/features/dnd-shared:22` | 判断文件是否需要进入命名表单 2026-08-05：导入默认直接（保留原文件名，后端自动路由类型/冲突覆盖确认）， 不再强制命名表单；ysm.json 单文件保留表单提示（整组导入 |
| `CollectedEntry()` | `frontend/src/features/dnd-shared:33` | 收集条目（文件 + 相对路径） |
| `FolderGroup()` | `frontend/src/features/dnd-shared:39` | 文件夹组：dir 为顶层目录名（可能含多级嵌套，组内文件保留完整 relPath） |
| `groupCollected()` | `frontend/src/features/dnd-shared:51` | 将收集到的条目分组： - 有目录前缀的条目 → 按「顶层目录」整组（dir = 第一段路径），组内保留完整 relPath（支持多层嵌套） - 无目录前缀的散落文件 → 单文件队列 |
| `handleTreeDrop()` | `frontend/src/features/import-dnd:31` | 处理 drop 事件：收集文件 → 过滤 → 执行导入。 |
| `bindTreeDnD()` | `frontend/src/features/import-dnd:140` | 在目标容器上注册仓库页 DnD 事件。 |
| `isImportableFile()` | `frontend/src/features/import-executor` | — |
| `ImportFile()` | `frontend/src/features/import-executor:14` | 带相对路径的 File（文件夹导入时标记 _relPath） |
| `ImportRecord()` | `frontend/src/features/import-executor:17` | 已导入历史条目（导入 tab「已导入」列表数据源） |
| `CollectedEntry()` | `frontend/src/features/import-executor:25` | 收集条目（文件 + 相对路径） |
| `ImportHistory()` | `frontend/src/features/import-executor:34` | — |
| `directImport()` | `frontend/src/features/import-executor:92` | 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） |
| `importFolder()` | `frontend/src/features/import-executor:133` | 文件夹整组导入（含 ysm.json 模型目录或普通文件夹；组内至少 1 个支持文件由调用方保证） |
| `executeCollected()` | `frontend/src/features/import-executor:197` | 执行一组拖拽收集的条目（静默导入入口）： 文件夹 → 整组（组内至少 1 个支持文件）；散落单文件 → 直导。 |
| `ImportFile()` | `frontend/src/features/import-queue-data:13` | 带相对路径的 File（文件夹导入时标记 _relPath） |
| `QueueItem()` | `frontend/src/features/import-queue-data:16` | 队列项数据类型 |
| `normalizeRepoName()` | `frontend/src/features/import-queue-data:29` | 仓库文件名归一化为「纯名」键（⚠️ 重名预警的 repoFiles Set 与查询共用契约）： 先剥 `.ban` 再剥扩展名（顺序不可反）——`foo.ysm` 与 `foo.y |
| `ImportQueueHost()` | `frontend/src/features/import-queue-data:34` | 应用主机接口 |
| `initDataLayer()` | `frontend/src/features/import-queue-data:40` | 初始化导入队列的数据层：返回状态对象和清理函数 |
| `bindFormEvents()` | `frontend/src/features/import-queue-events:24` | 表单输入事件绑定 |
| `bindDragEvents()` | `frontend/src/features/import-queue-events:55` | 拖拽事件绑定 |
| `bindInputEvents()` | `frontend/src/features/import-queue-events:160` | 文件输入框事件绑定 |
| `bindButtonEvents()` | `frontend/src/features/import-queue-events:276` | 按钮事件绑定 |
| `renderImportedList()` | `frontend/src/features/import-queue-render:16` | 渲染已导入列表（含队列） 纯函数：根据传入数据生成 HTML 并更新 DOM |
| `bindQueueEvents()` | `frontend/src/features/import-queue-render:80` | 渲染后绑定队列相关事件 返回 cleanup 函数集合 |
| `updateQueueCount()` | `frontend/src/features/import-queue-render:181` | 更新队列计数显示 |
| `normalizeRepoName()` | `frontend/src/features/import-queue` | — |
| `ImportQueueHost()` | `frontend/src/features/import-queue` | — |
| `initImportQueue()` | `frontend/src/features/import-queue:11` | 初始化导入队列，返回清理函数 |
| `loadOldestModel()` | `frontend/src/features/oldest-models:28` | 加载资历最深、仓库评分、热力图和每日推荐 |
| `RecycleHost()` | `frontend/src/features/recycle-bin:13` | app-content 组件实例（initRecycleBin 依赖的成员） |
| `isPathInRoot()` | `frontend/src/features/recycle-bin:24` | 判断条目路径是否位于资源根目录内（带路径分隔符边界，P3 修复）。 |
| `initRecycleBin()` | `frontend/src/features/recycle-bin:34` | 初始化回收站管理，返回清理函数 |
| `initResourcePacks()` | `frontend/src/features/resource-packs:13` | 初始化资源包 tab |
| `UpdateInfo()` | `frontend/src/features/version-updater:12` | 更新信息（CheckUpdate 返回） |
| `checkUpdateSilent()` | `frontend/src/features/version-updater:154` | 启动时静默检查更新（受 6h 频次限制） 有新版本则在右下角显示可点击的 toast 通知 |
| `initVersionUpdater()` | `frontend/src/features/version-updater:193` | 手动检查更新（设置页按钮） |

## 前端·服务

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ServiceName()` | `frontend/src/services/registry:11` | 已知服务名（新服务先在 app-modules.ts 注册，再在此登记） |
| `register()` | `frontend/src/services/registry:18` | 注册一个服务（.ts 调用方：register("name", impl as X) 声明类型；重复注册覆盖旧实例并告警） |
| `get()` | `frontend/src/services/registry:24` | 获取一个服务（.ts 调用方：get&lt;X&gt;("name") 断言期望类型；未注册抛错，错误含服务名） |
| `has()` | `frontend/src/services/registry:32` | 检查服务是否已注册 |
| `unregister()` | `frontend/src/services/registry:37` | 注销（测试用） |
| `clear()` | `frontend/src/services/registry:42` | 清空所有（测试用） |

## frontend/test-utils

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `fireEvent()` | `frontend/src/test-utils/events:6` | 构造一个基础 CustomEvent 并 dispatch |
| `fireClick()` | `frontend/src/test-utils/events:17` | 模拟鼠标点击 |
| `fireFocus()` | `frontend/src/test-utils/events:24` | 模拟焦点 |
| `fireBlur()` | `frontend/src/test-utils/events:31` | 模拟失焦 |
| `fireKeyDown()` | `frontend/src/test-utils/events:38` | 模拟键盘按下 |
| `fireInput()` | `frontend/src/test-utils/events:45` | 模拟输入变化（更新 input.value 并触发 input + change 事件） |
| `fireDrop()` | `frontend/src/test-utils/events:55` | 模拟拖拽 drop：构造 DragEvent 并注入 dataTransfer（happy-dom 忽略 DragEvent init 参数，需 defineProperty） |
| `fireDrag()` | `frontend/src/test-utils/events:67` | 模拟任意类型拖拽事件（dragstart/dragover/dragleave…），与 fireDrop 同款 dataTransfer 注入 |
| `queryByTestId()` | `frontend/src/test-utils/index` | — |
| `getByTestId()` | `frontend/src/test-utils/index` | — |
| `queryAllByTestId()` | `frontend/src/test-utils/index` | — |
| `getAllByTestId()` | `frontend/src/test-utils/index` | — |
| `fireEvent()` | `frontend/src/test-utils/index` | — |
| `fireClick()` | `frontend/src/test-utils/index` | — |
| `fireFocus()` | `frontend/src/test-utils/index` | — |
| `fireBlur()` | `frontend/src/test-utils/index` | — |
| `fireKeyDown()` | `frontend/src/test-utils/index` | — |
| `fireInput()` | `frontend/src/test-utils/index` | — |
| `fireDrop()` | `frontend/src/test-utils/index` | — |
| `fireDrag()` | `frontend/src/test-utils/index` | — |
| `renderComponent()` | `frontend/src/test-utils/index` | — |
| `mountCustomElement()` | `frontend/src/test-utils/index:27` | 同步渲染自定义元素到 body，返回已创建元素。 |
| `unmountElement()` | `frontend/src/test-utils/index:39` | 卸载元素：从 DOM 移除。 |
| `sleep()` | `frontend/src/test-utils/index:46` | 简单睡眠（测试中等待异步渲染）。 |
| `waitFor()` | `frontend/src/test-utils/index:55` | 轮询等待条件满足（兼容现有测试风格，作为统一导出）。 |
| `waitForElementToBeRemoved()` | `frontend/src/test-utils/index:84` | 轮询等待元素被移除。 |
| `QueryContainer()` | `frontend/src/test-utils/query-by-testid:11` | — |
| `queryByTestId()` | `frontend/src/test-utils/query-by-testid:30` | — |
| `getByTestId()` | `frontend/src/test-utils/query-by-testid:39` | — |
| `getAllByTestId()` | `frontend/src/test-utils/query-by-testid:48` | — |
| `queryAllByTestId()` | `frontend/src/test-utils/query-by-testid:57` | — |
| `RenderOptions()` | `frontend/src/test-utils/render:6` | 渲染配置 |
| `RenderResult()` | `frontend/src/test-utils/render:13` | — |
| `renderComponent()` | `frontend/src/test-utils/render:31` | 渲染一个自定义元素到 DOM。 |

## 前端·工具

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BoneInfoLite()` | `frontend/src/utils/3d/bone-list:6` | getBoneList 返回的扁平骨骼信息 |
| `getBoneList()` | `frontend/src/utils/3d/bone-list:16` | 从 spec 中提取第一组件（main）的骨骼列表。 |
| `buildBoneHierarchy()` | `frontend/src/utils/3d/bone-raycast:10` | 构建骨骼层级路径映射（name/id/parent/children）。 |
| `getBonePath()` | `frontend/src/utils/3d/bone-raycast:35` | 骨骼名 → 全路径（如 "root / spine / head"）。 |
| `getMeshBoneId()` | `frontend/src/utils/3d/bone-raycast:48` | Mesh → 所属骨骼名（沿父链向上查找 has isGroup 且 name 在 nameMap 中的节点）。 |
| `assembleBoneSelectInfo()` | `frontend/src/utils/3d/bone-raycast:62` | 骨骼选中信息组装。 |
| `registerBoneRaycast()` | `frontend/src/utils/3d/bone-raycast:123` | 注册 pointermove / click 骨骼拾取监听器。 |
| `BoneGroupMap()` | `frontend/src/utils/3d/bone-visibility:6` | BoneGroupMap 类型别名：骨骼 id → THREE.Group |
| `setBoneVisible()` | `frontend/src/utils/3d/bone-visibility:11` | 设置指定骨骼组及其所有子网格的可见性。 |
| `toggleBone()` | `frontend/src/utils/3d/bone-visibility:19` | 切换指定骨骼组的可见性（取反）。 |
| `showModelGroup()` | `frontend/src/utils/3d/bone-visibility:29` | 按索引显示单个模型组件（idx &lt; 0 = 全部显示，NaN 防御）。 |
| `registerFreeCameraDrag()` | `frontend/src/utils/3d/camera-control:14` | 注册 free 模式 pointer drag 监听器。 |
| `fitCameraToScene()` | `frontend/src/utils/3d/camera-setup:11` | 根据场景包围盒适配相机位置和 controls.target。 |
| `disposeDebugGroup()` | `frontend/src/utils/3d/cleanup-helper:14` | 释放 debug 叠加层中的所有 Three.js 资源（geometry / material / texture）。 |
| `disposeSceneMeshes()` | `frontend/src/utils/3d/cleanup-helper:38` | 遍历 scene 释放所有 Mesh 的 geometry 和 material。 |
| `safeDisposeRenderer()` | `frontend/src/utils/3d/cleanup-helper:53` | 安全释放 renderer（dispose 可能因已释放而抛错）。 |
| `eulerToQuaternion()` | `frontend/src/utils/3d/cube-mesh` | — |
| `isIdentityQuat()` | `frontend/src/utils/3d/cube-mesh` | — |
| `hasBoneRotation()` | `frontend/src/utils/3d/cube-mesh` | — |
| `buildCubeMeshData()` | `frontend/src/utils/3d/cube-mesh:24` | 从 Bedrock cube 数据构建 THREE.Mesh 几何数据。 |
| `mergeCubes()` | `frontend/src/utils/3d/cube-mesh:199` | 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加。 |
| `parseUV()` | `frontend/src/utils/3d/cube-mesh:227` | 解析 UV：faceUV 优先、失败回退 expandBoxUV、c.UV 回退。 |
| `DebugBoneData()` | `frontend/src/utils/3d/debug-render:7` | — |
| `makeTextTexture()` | `frontend/src/utils/3d/debug-render:14` | 生成骨骼名 Canvas 纹理（Sprite 标签用） |
| `rebuildDebug()` | `frontend/src/utils/3d/debug-render:43` | 重建 debug 叠加层（pivot 标记 / 骨骼线框）。 |
| `TdKeyAction()` | `frontend/src/utils/3d/keymap:8` | — |
| `DEFAULT_TD_KEYMAP()` | `frontend/src/utils/3d/keymap:11` | 默认键位以 KeyboardEvent.code 存储（物理键，跨键盘布局一致） |
| `loadTdKeymap()` | `frontend/src/utils/3d/keymap:27` | 读取用户自定义键位（无/非法时回退默认） |
| `loadTdCamSpeed()` | `frontend/src/utils/3d/keymap:45` | 相机移动速度（2–200），默认 20 |
| `loadTdRotMode()` | `frontend/src/utils/3d/keymap:52` | true = 环绕（orbit），false = 自身（free） |
| `addMeshToBoneGroup()` | `frontend/src/utils/3d/mesh-builder:14` | 从 spec mesh group 数据构建 THREE.Mesh 并添加到 boneGroup。 |
| `compKey()` | `frontend/src/utils/3d/mesh:13` | 组件内骨骼 key（mi: 组件下标, id: 骨骼 id）。renderModel3D 与 buildSceneMesh 共用，随 mesh 迁移。 |
| `MaterialWithMap()` | `frontend/src/utils/3d/mesh:18` | 带贴图的材质（disposeMaterial 需释放 .map 位图） |
| `disposeMaterial()` | `frontend/src/utils/3d/mesh:23` | 释放材质（含位图 .map），null/undefined 安全。 |
| `buildSceneMesh()` | `frontend/src/utils/3d/mesh:31` | 构建 3D 场景网格（组件分组 + 骨骼树），返回供渲染/交互使用的组结构。 |
| `buildModelGroup()` | `frontend/src/utils/3d/model-group-builder:19` | 单组件 spec 构建核心。 |
| `BedrockCube()` | `frontend/src/utils/3d/model2d:15` | Bedrock cube（AnalyzeBedrockModel 结构） |
| `BedrockBone()` | `frontend/src/utils/3d/model2d:25` | Bedrock bone |
| `BedrockModel()` | `frontend/src/utils/3d/model2d:31` | BedrockModel（AnalyzeBedrockModel 返回） |
| `Model2DOptions()` | `frontend/src/utils/3d/model2d:36` | renderModel2D 选项 |
| `renderModel2D()` | `frontend/src/utils/3d/model2d:66` | 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转） |
| `calcBoneHitZones()` | `frontend/src/utils/3d/model2d:259` | 计算骨骼在屏幕上的命中热区（2D 正交投影，供鼠标拾取；导出供测试） |
| `SpecCube()` | `frontend/src/utils/3d/model3d-spec:10` | 立方体（骨骼上的 box 元素） |
| `SpecBone()` | `frontend/src/utils/3d/model3d-spec:22` | 骨骼 |
| `SpecModelInput()` | `frontend/src/utils/3d/model3d-spec:30` | 模型输入（buildSpecFromModel 参数） |
| `SpecBuildResult()` | `frontend/src/utils/3d/model3d-spec:37` | 构建产物：mesh data + bones |
| `SpecMeshData()` | `frontend/src/utils/3d/model3d-spec:45` | 单 mesh 数据（Go spec meshGroups 结构近似） |
| `buildSpecFromModel()` | `frontend/src/utils/3d/model3d-spec:66` | 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } |
| `TdKeyAction()` | `frontend/src/utils/3d/model3d` | — |
| `DEFAULT_TD_KEYMAP()` | `frontend/src/utils/3d/model3d` | — |
| `loadTdKeymap()` | `frontend/src/utils/3d/model3d` | — |
| `loadTdCamSpeed()` | `frontend/src/utils/3d/model3d` | — |
| `loadTdRotMode()` | `frontend/src/utils/3d/model3d` | — |
| `SpecBone3D()` | `frontend/src/utils/3d/model3d:19` | — |
| `SpecMeshGroup3D()` | `frontend/src/utils/3d/model3d:27` | — |
| `SpecModelGroup3D()` | `frontend/src/utils/3d/model3d:39` | — |
| `Spec3D()` | `frontend/src/utils/3d/model3d:47` | — |
| `BoneSelectInfo()` | `frontend/src/utils/3d/model3d:52` | 骨骼选中信息（window._3dOnBoneSelect 回调参数） |
| `RenderModel3DHandle()` | `frontend/src/utils/3d/model3d:74` | renderModel3D 返回的渲染句柄 |
| `renderModel3D()` | `frontend/src/utils/3d/model3d:109` | 渲染 3D 模型到容器，返回控制句柄 |
| `screenshotPreview()` | `frontend/src/utils/3d/model3d:412` | 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null |
| `eulerToQuaternion()` | `frontend/src/utils/3d/quaternion:13` | 欧拉角（度）→ 四元数，旋转顺序: Rx * Ry * Rz (Three.js 默认)。 |
| `isIdentityQuat()` | `frontend/src/utils/3d/quaternion:75` | 判定四元数是否≈单位四元数（浮点 epsilon）。 |
| `hasBoneRotation()` | `frontend/src/utils/3d/quaternion:86` | 判定骨骼旋转是否实际生效（四元数 ≠ 单位四元数，epsilon 口径）。 |
| `LoopContext()` | `frontend/src/utils/3d/render-loop:9` | loop 所需的运行时上下文接口 |
| `startRenderLoop()` | `frontend/src/utils/3d/render-loop:33` | 启动渲染循环并立即渲染一帧。 |
| `RendererComponents()` | `frontend/src/utils/3d/renderer-setup:7` | setupRenderer 返回的组件 |
| `setupRenderer()` | `frontend/src/utils/3d/renderer-setup:18` | 初始化渲染器和场景基础元素（灯光、网格、轴）。 |
| `RendererState()` | `frontend/src/utils/3d/session-state:7` | 模块级渲染器状态引用 |
| `resetRendererState()` | `frontend/src/utils/3d/session-state:18` | 复位所有模块级渲染器引用为 null。 |
| `detachRendererCanvas()` | `frontend/src/utils/3d/session-state:28` | 从 DOM 中移除 renderer 的 canvas 元素（安全，已 detached 时不操作）。 |
| `buildCubeMeshData()` | `frontend/src/utils/3d/spec-builder` | — |
| `mergeCubes()` | `frontend/src/utils/3d/spec-builder` | — |
| `parseUV()` | `frontend/src/utils/3d/spec-builder` | — |
| `eulerToQuaternion()` | `frontend/src/utils/3d/spec-builder` | — |
| `isIdentityQuat()` | `frontend/src/utils/3d/spec-builder` | — |
| `hasBoneRotation()` | `frontend/src/utils/3d/spec-builder` | — |
| `buildModelGroup()` | `frontend/src/utils/3d/spec-builder` | — |
| `Vec3()` | `frontend/src/utils/3d/spec-builder:26` | vec3 — Go threejs/spec.go L55 |
| `Cube2D()` | `frontend/src/utils/3d/spec-builder:33` | Cube2D — Go types/bedrock.go Cube2D |
| `Bone2D()` | `frontend/src/utils/3d/spec-builder:49` | Bone2D — Go types/bedrock.go Bone2D |
| `BedrockModel()` | `frontend/src/utils/3d/spec-builder:59` | BedrockModel — Go types/bedrock.go BedrockModel |
| `Model3DSpec()` | `frontend/src/utils/3d/spec-builder:70` | Model3DSpec — Go threejs/spec.go Model3DSpec |
| `ModelGroup()` | `frontend/src/utils/3d/spec-builder:75` | ModelGroup — Go threejs/spec.go ModelGroup |
| `BoneData()` | `frontend/src/utils/3d/spec-builder:87` | BoneData — Go threejs/spec.go BoneData |
| `MeshData()` | `frontend/src/utils/3d/spec-builder:97` | MeshData — Go threejs/spec.go MeshData |
| `buildSpecFromGeometryJSON()` | `frontend/src/utils/3d/spec-builder:116` | 从 bedrock geometry JSON 构建 3D spec（纯 TS，无 Go 依赖）。 |
| `animateNumber()` | `frontend/src/utils/animation/animate:12` | 里程表滚动进位动画 |
| `Vec3()` | `frontend/src/utils/animation/animation:9` | 三维向量 [x, y, z] |
| `Keyframe()` | `frontend/src/utils/animation/animation:12` | 关键帧 |
| `BoneChannels()` | `frontend/src/utils/animation/animation:20` | 单骨骼三通道 |
| `AnimationClip()` | `frontend/src/utils/animation/animation:27` | 动画剪辑 |
| `BoneTransform()` | `frontend/src/utils/animation/animation:36` | 骨骼变换（evaluateClip 结果值） |
| `BoneHierarchyNode()` | `frontend/src/utils/animation/animation:43` | 骨骼层级节点 |
| `parseBedrockAnimationJSON()` | `frontend/src/utils/animation/animation:204` | 解析完整的基岩版动画 JSON 字符串 |
| `evaluateKeyframes()` | `frontend/src/utils/animation/animation:301` | 在指定时间 t 对一组关键帧求值 |
| `evaluateClip()` | `frontend/src/utils/animation/animation:347` | 对整个动画 clip 在指定时间求值（支持骨骼层级） |
| `stagger()` | `frontend/src/utils/animation/stagger:11` | — |
| `moveItem()` | `frontend/src/utils/array:8` | 将 arr[from] 移到 arr[to]（原地修改，返回同一数组）。 |
| `dbg()` | `frontend/src/utils/debug/debug:38` | 输出调试日志（保留 tag 用于过滤） |
| `safeStr()` | `frontend/src/utils/debug/debug:61` | 任意值 → 可读字符串（200 字符截断；供单测导出的纯函数） |
| `WailsAndroidBridge()` | `frontend/src/utils/dom/android-bridge:7` | — |
| `getAndroidBridge()` | `frontend/src/utils/dom/android-bridge:13` | 返回 Android Java 桥（桌面端为 null），类型安全断言（无 as any） |
| `isViewerMode()` | `frontend/src/utils/dom/android-bridge:24` | 查看器模式判定（ADR-049 Phase 3 能力门控统一入口）： Android（双端桥存在）或网页版（browser adapter）——均无本地文件系统写能力、 无桌面专属 |
| `registerAndroidBackHandler()` | `frontend/src/utils/dom/android-bridge:39` | 注册安卓返回键处理器，返回取消函数（供调用方在自身销毁/关闭时注销）。 |
| `emitAndroidBack()` | `frontend/src/utils/dom/android-bridge:54` | 原生侧（MainActivity 系统 back）调用入口：依次从栈顶触发已注册处理器。 |
| `btnBaseCSS()` | `frontend/src/utils/dom/css:1` | — |
| `focusVisibleCSS()` | `frontend/src/utils/dom/css:32` | Shadow DOM 通用 focus-visible 规则（所有 button/input/select/textarea） |
| `AdvFilterValue()` | `frontend/src/utils/dom/dialogs/adv-filter-util:6` | 筛选条件 |
| `parseFilterNumber()` | `frontend/src/utils/dom/dialogs/adv-filter-util:21` | 解析范围输入框数字：空 / 非数字 / 负数 → null（null 表示不限制）。 |
| `validateAdvFilter()` | `frontend/src/utils/dom/dialogs/adv-filter-util:32` | 校验三组 min/max 范围（仅两端都填数字时比对），返回错误文案或 null。 |
| `AdvFilterValue()` | `frontend/src/utils/dom/dialogs/adv-filter` | — |
| `AdvFilterResult()` | `frontend/src/utils/dom/dialogs/adv-filter:18` | — |
| `modalAdvFilter()` | `frontend/src/utils/dom/dialogs/adv-filter:25` | 弹出高级筛选弹窗 |
| `rebuildParsedName()` | `frontend/src/utils/dom/dialogs/batch-rename-util:14` | 按 YSM 命名规范重建文件名：`[作者]【作品】角色 (日期).ext(.ban)` - 作者/作品空值跳过；角色缺省回退到「剥 .ban 与扩展名后的文件名」； - 扩展名取原 |
| `ReplaceResult()` | `frontend/src/utils/dom/dialogs/batch-rename-util:34` | — |
| `applyReplaceToName()` | `frontend/src/utils/dom/dialogs/batch-rename-util:44` | 查找替换：分离扩展名，仅对文件名主体做替换。 |
| `BatchRenameChange()` | `frontend/src/utils/dom/dialogs/batch-rename:19` | 应用变更载荷 |
| `showBatchRenameDialog()` | `frontend/src/utils/dom/dialogs/batch-rename:48` | 弹出批量重命名对话框 重复打开时先结算上一个 Promise，调用方 await 不会永远悬挂 |
| `esc()` | `frontend/src/utils/dom/dialogs/modal` | — |
| `trapFocus()` | `frontend/src/utils/dom/dialogs/modal:26` | 焦点陷阱：Tab 键在弹窗内可聚焦元素间循环，防止焦点逃逸到背后页面 |
| `closeDlg()` | `frontend/src/utils/dom/dialogs/modal:54` | 带退场动画关闭对话框 |
| `registerDlg()` | `frontend/src/utils/dom/dialogs/modal:81` | 弹窗 append 到 body 后调用，登记为当前活动弹窗 |
| `closeActiveDialog()` | `frontend/src/utils/dom/dialogs/modal:97` | 关闭当前活动弹窗（按取消值结算）。返回是否关闭了弹窗。 |
| `ModalPromptOptions()` | `frontend/src/utils/dom/dialogs/modal:108` | modalPrompt 选项 |
| `modalPrompt()` | `frontend/src/utils/dom/dialogs/modal:121` | 弹出带输入框的模态框，类似 styled prompt() |
| `ModalSelectOptions()` | `frontend/src/utils/dom/dialogs/modal:191` | modalSelect 选项 |
| `modalSelect()` | `frontend/src/utils/dom/dialogs/modal:204` | 弹出下拉选择框 |
| `ModalConfirmOptions()` | `frontend/src/utils/dom/dialogs/modal:270` | modalConfirm 选项 |
| `modalConfirm()` | `frontend/src/utils/dom/dialogs/modal:286` | 弹出确认对话框 |
| `ModalProgressOptions()` | `frontend/src/utils/dom/dialogs/modal:346` | — |
| `ModalProgressHandle()` | `frontend/src/utils/dom/dialogs/modal:354` | — |
| `fmtMB()` | `frontend/src/utils/dom/dialogs/modal:361` | 格式化字节为 MB（进度弹窗/窗口标题共用） |
| `modalProgress()` | `frontend/src/utils/dom/dialogs/modal:371` | 只读进度弹窗（无确认/取消按钮，Esc 或点遮罩关闭）。 |
| `RenameFields()` | `frontend/src/utils/dom/dialogs/rename-format:7` | 重命名字段（调用方已 trim） |
| `buildRenameName()` | `frontend/src/utils/dom/dialogs/rename-format:19` | 按 YSM 命名规范拼接新文件名：`[作者]【品牌】角色-变体 (年月).ext` 品牌缺省「未知」、角色缺省「?」，与预览一致。 |
| `showRenameDialog()` | `frontend/src/utils/dom/dialogs/rename:16` | 弹出重命名对话框 |
| `modalTagEditor()` | `frontend/src/utils/dom/dialogs/tag-editor:14` | 弹出标签编辑弹窗 |
| `TagSetResult()` | `frontend/src/utils/dom/dialogs/tag-set:6` | — |
| `MAX_TAG_LENGTH()` | `frontend/src/utils/dom/dialogs/tag-set:12` | 标签最大长度（与原 addTag 一致） |
| `addTagToSet()` | `frontend/src/utils/dom/dialogs/tag-set:19` | 向标签集合添加一个标签（已 trim）： 空输入 → 原样返回；重复 → error「标签已存在」；超长 → error「最多 20 个字符」； 合法 → 排序后返回新数组。错误文 |
| `resolveAndroidRepoDir()` | `frontend/src/utils/dom/directory-picker:25` | Android 共享仓库目录解析（双端桥接：授权引导 + 定位公共目录）。 |
| `pickDirectory()` | `frontend/src/utils/dom/directory-picker:65` | 选择目录：桌面走系统对话框；查看器模式（Android/网页版）走授权检查 + 自动定位公共目录 |
| `ParsedModelName()` | `frontend/src/utils/dom/display:6` | 解析后的模型文件名字段 |
| `parseModelName()` | `frontend/src/utils/dom/display:27` | 解析模型文件名 → 结构化字段 支持格式: [作者]【作品】角色变体2023-05.ysm 也兼容: [作者]《作品》角色变体2023-05.ysm |
| `renderDisplayName()` | `frontend/src/utils/dom/display:88` | 渲染美化文件名 HTML（通用接口） 应用 CSS 变量: --meta-author, --meta-work, --meta-date |
| `renderModelName()` | `frontend/src/utils/dom/display:179` | renderModelName = renderDisplayName 别名，options.showExt 支持 |
| `renderModelNameWithHighlight()` | `frontend/src/utils/dom/display:188` | 搜索高亮版：先对纯文本高亮，再渲染 HTML，避免 keyword 命中 HTML 标签内容破坏 DOM |
| `friendlyError()` | `frontend/src/utils/dom/errors:44` | 将 Go 错误转换为友好提示 |
| `stripPathSegments()` | `frontend/src/utils/dom/errors:72` | — |
| `YSW_FAB_CSS()` | `frontend/src/utils/dom/fab:6` | — |
| `ensureFabStyles()` | `frontend/src/utils/dom/fab:53` | 幂等注入 overlay 全局样式到 head（overlay 挂 body，light DOM 需全局 CSS 生效） |
| `IconButtonOpts()` | `frontend/src/utils/dom/fab:68` | — |
| `createIconButton()` | `frontend/src/utils/dom/fab:80` | 图标按钮工厂（ADR-057 §2.6）：统一 emoji/图标按钮，集中可达性；用 textContent 防 XSS。 |
| `FLASH_DURATION_MS()` | `frontend/src/utils/dom/feedback:10` | 默认闪烁时长（ms） |
| `FlashOptions()` | `frontend/src/utils/dom/feedback:13` | 闪烁反馈配置 |
| `flashBtn()` | `frontend/src/utils/dom/feedback:28` | 按钮/行闪烁反馈：加 flash class，duration 后移除。 |
| `formatBytes()` | `frontend/src/utils/dom/format:11` | 字节数 → 可读大小（B/KB/MB/GB），非法值或 0 返回空串 |
| `sizeColor()` | `frontend/src/utils/dom/format:23` | 文件大小颜色 class：&lt;1MB 绿色，1-3MB 正常，≥3MB 红色 |
| `fmtDate()` | `frontend/src/utils/dom/format:35` | 时间戳 → 友好日期：今天显时间，今年显 M月D日，往年显 YYYY/M/D |
| `esc()` | `frontend/src/utils/dom/html:4` | HTML 转义（治理红线：所有 innerHTML 拼接必须过 esc） |
| `safeGet()` | `frontend/src/utils/dom/storage:7` | 安全读：存储不可用时返回 null（调用方走默认值回退） |
| `safeSet()` | `frontend/src/utils/dom/storage:16` | 安全写：存储不可用时静默忽略持久化（不中断调用方） |
| `safeRemove()` | `frontend/src/utils/dom/storage:25` | 安全删：存储不可用时静默忽略（不中断调用方） |
| `renderFormattedText()` | `frontend/src/utils/format/mc-format:45` | 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。 |
| `PackMeta()` | `frontend/src/utils/format/pack-format:92` | ReadPackMeta 返回的 JSON 对象（仅覆盖用到的字段） |
| `describeVersionRange()` | `frontend/src/utils/format/pack-format:105` | 根据 meta 对象生成格式号 + 版本号描述 拼接用「 / 」作分隔符，避免出现 "1.9 ~ 1.10.2 ~ 1.11" 的四段歧义串。 |
| `SummaryAuthor()` | `frontend/src/utils/format/summarize:10` | — |
| `SummaryAnimGroup()` | `frontend/src/utils/format/summarize:16` | — |
| `SummaryConfigMenu()` | `frontend/src/utils/format/summarize:22` | — |
| `YsmSummary()` | `frontend/src/utils/format/summarize:27` | — |
| `YSMHeader()` | `frontend/src/utils/format/summarize:52` | — |
| `summaryCardHTML()` | `frontend/src/utils/format/summarize:156` | 从 YsmSummary + YSMHeader 渲染为精简摘要卡片 |
| `DecodedStats()` | `frontend/src/utils/format/summarize:283` | 解码统计结果（原 spike 侧 YsmSummary，改名避免与上方元数据接口撞名） |
| `findBones()` | `frontend/src/utils/format/summarize:295` | 递归找第一个数组（骨骼列表通常嵌在 model/bones 等层级）。 |
| `summarizeDecoded()` | `frontend/src/utils/format/summarize:313` | 解析 main.json 提取骨骼/几何摘要（只做统计，不渲染） |
| `YsmProperties()` | `frontend/src/utils/format/ysm-anim-config:14` | WASM 解码产物 ysm.json 的 properties 相关字段（仅取本模块需要的部分） |
| `extractAnimGroupsAndConfigs()` | `frontend/src/utils/format/ysm-anim-config:34` | 从 ysm.json properties 提取动画分组与配置菜单。 |
| `GH_REPO()` | `frontend/src/utils/gh-links:5` | — |
| `GH_RELEASES()` | `frontend/src/utils/gh-links:6` | — |
| `GH_DOCS()` | `frontend/src/utils/gh-links:7` | — |
| `fileIcon()` | `frontend/src/utils/icon/icon:40` | 按扩展名返回图标 emoji |
| `isYsmName()` | `frontend/src/utils/icon/icon:56` | 是否为 YSM 文件 |
| `ICONS()` | `frontend/src/utils/icon/workshop-icons:3` | — |
| `getSiteIcon()` | `frontend/src/utils/icon/workshop-icons:46` | — |
| `getTagIconFromRole()` | `frontend/src/utils/icon/workshop-icons:54` | — |
| `RESOURCE_EXTS()` | `frontend/src/utils/resource/extensions:28` | 每种资源类型对应的扩展名（从 resource_types.json 派生，单一事实来源） |
| `ALL_EXTS()` | `frontend/src/utils/resource/extensions:33` | 所有支持的扩展名列表（去重，用于 UI 提示文案） |
| `getExts()` | `frontend/src/utils/resource/extensions:48` | 获取某资源类型支持的扩展名 |
| `isSupportedExt()` | `frontend/src/utils/resource/extensions:53` | 检查扩展名是否被某资源类型支持 |
| `extBelongsTo()` | `frontend/src/utils/resource/extensions:58` | 返回扩展名所属的资源类型 ID |
| `ResourceTypeEntry()` | `frontend/src/utils/resource/registry:6` | 资源类型注册表条目（对应 resource_types.json 结构） |
| `loadResourceRegistry()` | `frontend/src/utils/resource/registry:19` | 加载资源类型注册表（失败不缓存：Go 桥瞬断后下次调用重试，避免整会话降级） |
| `RESOURCE_TYPES()` | `frontend/src/utils/resource/types:9` | 资源类型 ID（键为类型标签，值为内部 ID） |
| `RESOURCE_TYPE_LABELS()` | `frontend/src/utils/resource/types:20` | 资源类型显示标签（内部 ID → 中文名） |
| `ALL_RESOURCE_TYPES()` | `frontend/src/utils/resource/types:43` | 全部资源类型 ID 列表（从 resource_types.json id 派生，单一事实来源） |

## frontend/views

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `LocalCreator()` | `frontend/src/views/app-content/community-data:9` | 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） |
| `CommunityData()` | `frontend/src/views/app-content/community-data:25` | 站点 + 创作者 + 作者 数据包 |
| `loadCommunityData()` | `frontend/src/views/app-content/community-data:35` | 加载站点 + 创作者数据（纯数据，不碰 DOM） 自动合并本地仓库提取的作者 |
| `fillSearch()` | `frontend/src/views/app-content/community-data:133` | 替换 &#123;&#123;q&#125;&#125; 为查询词 |
| `fetchCommunityCreators()` | `frontend/src/views/app-content/community-data:187` | 从 GitHub 拉取 creators.json（三路回退） |
| `mergeCommunityCreators()` | `frontend/src/views/app-content/community-data:216` | 合并社区索引到本地 creators.json |
| `fetchCommunitySites()` | `frontend/src/views/app-content/community-data:253` | 从 GitHub 拉取 workshop_sites.json（三路回退） |
| `mergeCommunitySites()` | `frontend/src/views/app-content/community-data:277` | 合并社区站点到本地 workshop_sites.json |
| `DEFAULT_COMMUNITY_URL()` | `frontend/src/views/app-content/community-data:298` | 社区索引的默认 URL（可配置为社区维护的独立 creators JSON） 贡献通道：https://github.com/eghrhegpe/ysm-model-manager |
| `contentCreatorCSS()` | `frontend/src/views/app-content/content-creator:2` | — |
| `contentCSS()` | `frontend/src/views/app-content/content-css:12` | — |
| `contentDiagCSS()` | `frontend/src/views/app-content/content-diag:2` | — |
| `contentLayoutCSS()` | `frontend/src/views/app-content/content-layout:5` | — |
| `contentRepoCSS()` | `frontend/src/views/app-content/content-repo:2` | — |
| `contentUtilCSS()` | `frontend/src/views/app-content/content-util:2` | — |
| `scanConflicts()` | `frontend/src/views/app-content/diagnostics/conflicts:15` | — |
| `startDedup()` | `frontend/src/views/app-content/diagnostics/dedup:25` | 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。 |
| `startDedup()` | `frontend/src/views/app-content/diagnostics/init` | — |
| `initDiagnostics()` | `frontend/src/views/app-content/diagnostics/init:20` | 初始化诊断页所有功能 |
| `EscFn()` | `frontend/src/views/app-content/diagnostics/logs:8` | 转义函数签名（与组件 _esc 一致） |
| `loadDiagnosticsLogs()` | `frontend/src/views/app-content/diagnostics/logs:43` | — |
| `loadRuntimeLogs()` | `frontend/src/views/app-content/diagnostics/logs:164` | 加载运行时日志（watcher/sync 等标准库 log 输出） |
| `AppContentHost()` | `frontend/src/views/app-content/init-github:16` | app-content 组件接口（供 github 初始化函数访问） |
| `initGithubPage()` | `frontend/src/views/app-content/init-github:30` | 初始化 GitHub 页 |
| `AppContentHost()` | `frontend/src/views/app-content/init-pages:17` | app-content 组件接口（供页面初始化函数访问） |
| `initDiagnosticsPage()` | `frontend/src/views/app-content/init-pages:26` | 初始化诊断页 |
| `initInstancesPage()` | `frontend/src/views/app-content/init-pages:33` | 初始化实例页 |
| `initWorkshopPage()` | `frontend/src/views/app-content/init-pages:201` | 初始化创意工坊页（委托到 init-workshop.ts） |
| `initGithubPage()` | `frontend/src/views/app-content/init-pages:208` | 初始化 GitHub 页（委托到 init-github.ts） |
| `initPreviewResize()` | `frontend/src/views/app-content/init-preview:8` | 初始化预览面板拖拽调整宽度 |
| `AppContentHost()` | `frontend/src/views/app-content/init-workshop:28` | app-content 组件完整接口（供 workshop/github 初始化函数访问） |
| `initWorkshopPage()` | `frontend/src/views/app-content/init-workshop:52` | 初始化创意工坊页 |
| `resetAvatarConfigLoaded()` | `frontend/src/views/app-content/init-workshop:511` | 供 app-content disconnectedCallback 调用：回收 config-loaded 订阅并复位注册 flag， 组件销毁后新实例可重新注册（拆分后模块级状 |
| `initSettings()` | `frontend/src/views/app-content/settings/init:26` | 初始化设置页所有事件绑定 |
| `initKeymap()` | `frontend/src/views/app-content/settings/keymap:122` | 初始化 3D 预览操作：键位网格 + 恢复默认 + 相机速度 + 默认旋转模式 |
| `saveCfg()` | `frontend/src/views/app-content/settings/path-cards:23` | — |
| `bindPathClick()` | `frontend/src/views/app-content/settings/path-cards:51` | — |
| `initAdvancedGrid()` | `frontend/src/views/app-content/settings/path-cards:193` | — |
| `initMcDetect()` | `frontend/src/views/app-content/settings/path-cards:320` | — |
| `SettingsCfg()` | `frontend/src/views/app-content/settings/store:10` | 设置页当前配置类型（LoadAppConfig 返回值，经 Wails $CancellablePromise 解包） |
| `cfg()` | `frontend/src/views/app-content/settings/store:13` | 当前配置：initSettings 加载后注入，各模块就地更新字段（saveCfg/检测/主题/链接模式） |
| `cardRefreshers()` | `frontend/src/views/app-content/settings/store:16` | 所有路径卡片的刷新函数列表（绑定后收集，重排/重置时统一调用） |
| `isBusy()` | `frontend/src/views/app-content/settings/store:20` | — |
| `setBusy()` | `frontend/src/views/app-content/settings/store:21` | — |
| `toastError()` | `frontend/src/views/app-content/settings/store:26` | — |
| `resetSettingsStore()` | `frontend/src/views/app-content/settings/store:35` | 重置模块级状态（initSettings 开头调用；重复执行时清空上次残留） |
| `initTheme()` | `frontend/src/views/app-content/settings/theme:19` | 初始化主题段：主题卡片点击切换 + 自动切换下拉框 |
| `applyUIPrefs()` | `frontend/src/views/app-content/settings/ui-prefs:8` | 应用 UI 偏好到 CSS 变量（字号/字体/密度/动画）——启动链与设置页共用（ADR-040 拆分去重） |
| `initUiPrefs()` | `frontend/src/views/app-content/settings/ui-prefs:48` | 初始化界面与体验设置：应用偏好 + 绑定字号/字体/密度/动画/默认页变更 |
| `RepoAuthorLike()` | `frontend/src/views/app-content/site-view:12` | 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） |
| `RenderSiteViewCtx()` | `frontend/src/views/app-content/site-view:15` | 竚点视图渲染上下文（index.ts _initWorkshop 传入） |
| `LocalCreatorLike()` | `frontend/src/views/app-content/site-view:38` | 本地创作者（绑定 + 运行时附加字段） |
| `renderSiteView()` | `frontend/src/views/app-content/site-view:49` | 站点视图渲染主入口 — 编排壳：构造数据 → 构 HTML → 绑事件 → 聚 cleanup。 |
| `bindDragEvents()` | `frontend/src/views/app-content/site/drag:14` | 绑定拖拽 JSON 导入事件：创作者 JSON / 站点 JSON 识别 + 合并。 |
| `bindEditEvents()` | `frontend/src/views/app-content/site/edit:17` | 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 / 删除创作者 / 拖拽排序 / 增删搜索词 / 搜索过滤。 |
| `bindBrowseEvents()` | `frontend/src/views/app-content/site/events:26` | 绑定浏览态事件：空状态按钮 / 创作者卡片网格 / 预设搜索 / 收藏 / 头像调试 / 卡片点击详情浮层 / 键盘导航 / storage 同步。 |
| `CrCardCtx()` | `frontend/src/views/app-content/site/render:13` | 创作者卡片工厂上下文 |
| `BuildSiteHtmlCtx()` | `frontend/src/views/app-content/site/render:24` | buildSiteHtml 依赖的渲染上下文 |
| `createCrCard()` | `frontend/src/views/app-content/site/render:44` | 创作者卡片工厂 |
| `SiteViewState()` | `frontend/src/views/app-content/site/types:12` | SiteViewState —— renderSiteView 内部闭包共享变量的显式收拢。 |
| `CleanupFn()` | `frontend/src/views/app-content/site/types:40` | bindXxxEvents 函数的统一返回：清理函数，主入口聚合成单一 cleanup |
| `downloadsHTML()` | `frontend/src/views/app-content/tpl-downloads:6` | — |
| `recycleHTML()` | `frontend/src/views/app-content/tpl-recycle:5` | — |
| `aboutHTML()` | `frontend/src/views/app-content/tpl-settings-about:6` | About 标签页（版本/特性/技术栈/链接/快速上手） |
| `creditsHTML()` | `frontend/src/views/app-content/tpl-settings-about:84` | Credits 标签页（灵感来源/特别感谢） |
| `settingsHTML()` | `frontend/src/views/app-content/tpl-settings:7` | — |
| `settingsHTML()` | `frontend/src/views/app-content/tpl` | — |
| `downloadsHTML()` | `frontend/src/views/app-content/tpl` | — |
| `recycleHTML()` | `frontend/src/views/app-content/tpl` | — |
| `repositoryHTML()` | `frontend/src/views/app-content/tpl:9` | — |
| `instancesHTML()` | `frontend/src/views/app-content/tpl:60` | — |
| `diagnosticsHTML()` | `frontend/src/views/app-content/tpl:85` | — |
| `githubHTML()` | `frontend/src/views/app-content/tpl:149` | ===== GitHub 仓库页面 ===== |
| `workshopHTML()` | `frontend/src/views/app-content/tpl:180` | — |
| `CreatorIdentity()` | `frontend/src/views/app-content/workshop-data:8` | 创作者身份识别结果 |
| `CreatorIdentityInput()` | `frontend/src/views/app-content/workshop-data:15` | 创作者输入（role/tag 可空，_fromLocal 为运行时附加字段） |
| `getCreatorIdentity()` | `frontend/src/views/app-content/workshop-data:22` | — |
| `getTagFromRole()` | `frontend/src/views/app-content/workshop-data:48` | — |
| `parseDescTags()` | `frontend/src/views/app-content/workshop-data:53` | — |
| `loadFavs()` | `frontend/src/views/app-content/workshop-data:63` | — |
| `isFaved()` | `frontend/src/views/app-content/workshop-data:75` | — |
| `toggleFav()` | `frontend/src/views/app-content/workshop-data:79` | — |
| `BoneEntry()` | `frontend/src/views/app-preview/bone-names:5` | 骨骼条目（结构类型，兼容 DecodedYsm.bones 元素） |
| `buildBoneNamesText()` | `frontend/src/views/app-preview/bone-names:15` | 构建骨骼名导出文本行： 首行 `模型: &lt;path&gt;`、次行 `骨骼总数: &lt;n&gt;`，其后每根骨骼 有方块则 `名称 (n 方)`，结构骨骼（无方块）则 `名称 (结构骨骼,无方) |
| `CacheValue()` | `frontend/src/views/app-preview/cache:10` | 缓存条目值 |
| `cacheSetEvictHandler()` | `frontend/src/views/app-preview/cache:39` | 注册 evict 回调，淘汰条目时调用 |
| `cacheGet()` | `frontend/src/views/app-preview/cache:43` | — |
| `cacheSet()` | `frontend/src/views/app-preview/cache:65` | — |
| `previewCSS()` | `frontend/src/views/app-preview/css:2` | — |
| `showModelDetail()` | `frontend/src/views/app-preview/detail:18` | 显示模型详情（YSM 模型） |
| `showResourcePack()` | `frontend/src/views/app-preview/detail:129` | 显示资源包信息（pack.mcmeta + pack.png） |
| `showSimplePreview()` | `frontend/src/views/app-preview/detail:166` | 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 |
| `BedrockCube()` | `frontend/src/views/app-preview/geometry:4` | Bedrock 方块 |
| `BedrockBone()` | `frontend/src/views/app-preview/geometry:15` | Bedrock 骨骼 |
| `BedrockGeometry()` | `frontend/src/views/app-preview/geometry:30` | 解析后的 Bedrock geometry |
| `parseBedrockGeometryFromJSON()` | `frontend/src/views/app-preview/geometry:63` | 从 JSON 字符串解析 Bedrock geometry |
| `cleanupVoxel3D()` | `frontend/src/views/app-preview/litematic-3d:36` | 清理体素 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 |
| `createLitematic3D()` | `frontend/src/views/app-preview/litematic-3d:43` | — |
| `invalidateLitematicPreview()` | `frontend/src/views/app-preview/litematic-meta:26` | P2 修复（code_review）：任意新预览派发时推进代际——原 litematicGen 只在 showLitematic 自身递增，litematic A 解析中切到 YS |
| `showLitematic()` | `frontend/src/views/app-preview/litematic-meta:107` | 显示投影文件详情面板（tab 布局） |
| `cleanupLitematic3D()` | `frontend/src/views/app-preview/litematic-meta:235` | 组件销毁时清理体素 3D（转发至 litematic-3d，避免 index 静态依赖 Three.js 渲染模块） |
| `loadModelData()` | `frontend/src/views/app-preview/loader:13` | 加载模型几何数据 + 纹理 + 作者信息 统一路径：缓存 → WASM 解码 → Go AnalyzeBedrockModel 兜底 |
| `ModelLike()` | `frontend/src/views/app-preview/model3d-loader:10` | 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） |
| `ModelSpec()` | `frontend/src/views/app-preview/model3d-loader:20` | Go 返回的 3D spec（models 数组） |
| `loadTextures()` | `frontend/src/views/app-preview/model3d-loader:49` | 并行加载纹理 URL 列表，返回 THREE.Texture 数组 |
| `preloadModel()` | `frontend/src/views/app-preview/model3d-loader:137` | 预加载：spec 先行，纹理按全量清单加载（texArr 槽位 = cube texSlot 下标） |
| `parseYsmJsonDirect()` | `frontend/src/views/app-preview/parse-ysm-json:23` | 直接解析纯 JSON 格式的 ysm.json（解压后的 YSM 模型文件） |
| `AngleShot()` | `frontend/src/views/app-preview/screenshot-renderer:10` | — |
| `renderMultiAngle()` | `frontend/src/views/app-preview/screenshot-renderer:16` | — |
| `fill3DPanel()` | `frontend/src/views/app-preview/skeleton-fill-panel:9` | — |
| `fill3DPanel()` | `frontend/src/views/app-preview/skeleton-render` | — |
| `Model3DHandleX()` | `frontend/src/views/app-preview/skeleton-render:19` | RenderModel3DHandle 运行时扩展（_keyHandler/_timeTimer/_boneDetailEl 为 JS 时代附加字段） |
| `setup2DCanvas()` | `frontend/src/views/app-preview/skeleton-render:28` | 创建 2D 骨骼画布并异步加载纹理 |
| `buildToggleRow()` | `frontend/src/views/app-preview/skeleton-render:53` | 构建骨骼名开关行（不含放大按钮，放大按钮由调用方单独添加） |
| `buildStatsCard()` | `frontend/src/views/app-preview/skeleton-render:93` | 构建统计卡片（含作者列表） |
| `buildBoneExportRow()` | `frontend/src/views/app-preview/skeleton-render:142` | 构建导出骨骼名按钮行 |
| `saveScreenshot()` | `frontend/src/views/app-preview/skeleton-render:175` | 截图保存内部逻辑（供 3D overlay 使用） |
| `build3DOverlay()` | `frontend/src/views/app-preview/skeleton-render:212` | 构建 3D overlay 完整 DOM 结构 返回所有关键节点引用及 state holder |
| `sec()` | `frontend/src/views/app-preview/skeleton-utils:6` | 面板分区标题（3D overlay 信息面板使用） gap=false 用于面板首个分区（panel 已有 padding-top，避免顶部 10+12=22px 过空） |
| `iRow()` | `frontend/src/views/app-preview/skeleton-utils:15` | 信息行：标签 | 值 |
| `buildDepthMap()` | `frontend/src/views/app-preview/skeleton-utils:26` | 构建骨骼层级深度映射（用于骨骼列表缩进渲染） parentId 为空的骨骼深度为 0，其余递归计算 |
| `closeActive3DOverlay()` | `frontend/src/views/app-preview/skeleton:39` | 关闭当前活跃的 3D 全屏 overlay（若存在）。供 app-preview/index.ts 切换模型前调用。 |
| `loadModel2D()` | `frontend/src/views/app-preview/skeleton:57` | 加载模型 2D 骨骼线条图 + 统计面板 |
| `OrderedTexInput()` | `frontend/src/views/app-preview/texture-order:7` | — |
| `buildOrderedTexKeys()` | `frontend/src/views/app-preview/texture-order:21` | 计算 3D 渲染/纹理选择器用的有序纹理名列表 |
| `ModelDetailMeta()` | `frontend/src/views/app-preview/tpl:6` | 模型统计元数据（modelDetailHTML 入参） |
| `modelDetailHTML()` | `frontend/src/views/app-preview/tpl:20` | 模型详情面板（仓库页面） |
| `StatsCardModel()` | `frontend/src/views/app-preview/tpl:58` | 模型统计卡片（statsCardHTML 入参的几何视图） |
| `statsCardHTML()` | `frontend/src/views/app-preview/tpl:67` | 模型统计卡片 |
| `devLog()` | `frontend/src/views/app-preview/utils:6` | DEV 模式下输出调试日志 |
| `DecodedYsm()` | `frontend/src/views/app-preview/utils:11` | WASM 解码结果（decodeYsmViaWasm 返回） |
| `PreviewRoot()` | `frontend/src/views/app-preview/utils:32` | 渲染容器 + 生命周期（detail/litematic-meta/skeleton 消费 root，skeleton 消费 unsubs） |
| `YsmDecoder()` | `frontend/src/views/app-preview/utils:39` | WASM 解码能力（loader/skeleton 消费） |
| `PreviewDebugger()` | `frontend/src/views/app-preview/utils:44` | 调试输出能力（loader/skeleton 消费） |
| `PreviewImageLoader()` | `frontend/src/views/app-preview/utils:49` | 预览图加载能力（detail 消费） |
| `PreviewCtx()` | `frontend/src/views/app-preview/utils:56` | 组合接口：实现方（AppPreview）与兼容旧调用方的完整视图。 |
| `getPrefer3D()` | `frontend/src/views/app-preview/utils:60` | — |
| `setPrefer3D()` | `frontend/src/views/app-preview/utils:63` | — |
| `stripYsgpTextHeader()` | `frontend/src/views/app-preview/utils:130` | 剥离 YSGP 文本头部，返回标准二进制格式 |
| `decodeYsmViaWasm()` | `frontend/src/views/app-preview/wasm:19` | — |
| `doDecodeYsmViaWasm()` | `frontend/src/views/app-preview/wasm:60` | 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations } 不依赖组件实例（无 this 引用），可独立调用 |
| `openFullPreview()` | `frontend/src/views/app-preview/zoom:7` | 全窗放大预览（独立函数，不依赖组件实例） |
| `registerResourceManagerGlobal()` | `frontend/src/views/app-resource-manager/index:57` | 全局配置刷新监听：registerGlobalHandlers 统一收集 unsub （替代顶层无守卫注册 — ADR-008 违规点，TS 化后收敛） F8 修复：仅清模块缓存— |
| `AppResourceManager()` | `frontend/src/views/app-resource-manager/index:73` | — |
| `PackMetaDetail()` | `frontend/src/views/app-resource-manager/tpl:8` | 详情面板元数据（ReadPackMeta / ReadShaderpackLang 返回 JSON 的兼容视图） |
| `sidebarHTML()` | `frontend/src/views/app-resource-manager/tpl:21` | 侧栏布局（路径 + 操作栏 + 列表） |
| `itemHTML()` | `frontend/src/views/app-resource-manager/tpl:63` | 列表项 HTML |
| `detailHTML()` | `frontend/src/views/app-resource-manager/tpl:100` | 详情面板 HTML |
| `placeholderHTML()` | `frontend/src/views/app-resource-manager/tpl:159` | 空状态占位 |
| `SidebarInstance()` | `frontend/src/views/app-sidebar/data:4` | sidebar 整合包实例（loader 转换后的渲染格式） |
| `bindCardEvents()` | `frontend/src/views/app-sidebar/events:30` | — |
| `resetSelectedEmit()` | `frontend/src/views/app-sidebar/events:147` | 复位去重标记：组件真正卸载（disconnectedCallback）时调用—— 同组件 reload 不复位（去重跨 reload 生效），仅新挂载会话才需重置（P2 复核修复） |
| `bindFooter()` | `frontend/src/views/app-sidebar/events:180` | — |
| `MmdVariantGroups()` | `frontend/src/views/app-sidebar/loader:20` | MMD 变体聚合结果 |
| `loadInstances()` | `frontend/src/views/app-sidebar/loader:27` | 从 Go 加载整合包实例列表，转换为 render 需要的格式 |
| `groupMmdVariants()` | `frontend/src/views/app-sidebar/loader:150` | 对 MMD 类型，按父文件夹聚合 .pmx 变体文件。 |
| `renderVersionCards()` | `frontend/src/views/app-sidebar/render:8` | — |
| `sidebarCSS()` | `frontend/src/views/app-sidebar/sidebar-css:3` | — |
| `headerHTML()` | `frontend/src/views/app-sidebar/tpl:19` | — |
| `footerHTML()` | `frontend/src/views/app-sidebar/tpl:38` | — |
| `listContainerHTML()` | `frontend/src/views/app-sidebar/tpl:83` | — |
| `vcHeaderHTML()` | `frontend/src/views/app-sidebar/tpl:102` | 单个整合包卡片头部。 |
| `AppSyncManager()` | `frontend/src/views/app-sync-manager/index:50` | — |
| `SyncItem()` | `frontend/src/views/app-sync-manager/tpl:9` | 同步列表项（GetInstanceSyncStatus 返回 JSON 条目） |
| `containerHTML()` | `frontend/src/views/app-sync-manager/tpl:21` | 容器骨架 |
| `statusTabHTML()` | `frontend/src/views/app-sync-manager/tpl:60` | 状态筛选标签 HTML |
| `itemHTML()` | `frontend/src/views/app-sync-manager/tpl:89` | 列表项 HTML |
| `emptyHTML()` | `frontend/src/views/app-sync-manager/tpl:147` | 空状态 HTML |
| `loadingHTML()` | `frontend/src/views/app-sync-manager/tpl:161` | 加载中 |
| `treeCSS()` | `frontend/src/views/app-tree/app-tree-styles:3` | — |
| `AuthorInfo()` | `frontend/src/views/app-tree/authors:5` | 作者统计（Go ListModelAuthors 返回） |
| `loadAuthors()` | `frontend/src/views/app-tree/authors:13` | 从 Go 端加载作者列表 |
| `bindBusEvents()` | `frontend/src/views/app-tree/bus-handlers:15` | — |
| `selectState()` | `frontend/src/views/app-tree/data:4` | 多选状态 |
| `toggleSelect()` | `frontend/src/views/app-tree/data:16` | 切换选中状态 |
| `selectSingle()` | `frontend/src/views/app-tree/data:31` | 单选：清空后选中单个并设为 lastKey（用于单击选中，避免外部直接写 selectState） |
| `updateSelectCount()` | `frontend/src/views/app-tree/events:16` | — |
| `bindTreeEvents()` | `frontend/src/views/app-tree/events:115` | — |
| `AppTree()` | `frontend/src/views/app-tree/index:44` | — |
| `TreeEntry()` | `frontend/src/views/app-tree/loader:11` | 树条目（loader 转换后的渲染格式） |
| `loadEntries()` | `frontend/src/views/app-tree/loader:64` | 从 Go 后端加载仓库文件列表，返回格式化的 entries |
| `TreeRow()` | `frontend/src/views/app-tree/render:21` | 扁平化行（虚拟滚动数据单元） |
| `TreeNode()` | `frontend/src/views/app-tree/render:31` | buildTree 嵌套节点（文件夹 = 子节点对象，文件 = { _e: entry }） |
| `RenderMode()` | `frontend/src/views/app-tree/render:37` | 渲染模式 |
| `getRenderMode()` | `frontend/src/views/app-tree/render:43` | Get render mode from localStorage, default to 'grid' |
| `setRenderMode()` | `frontend/src/views/app-tree/render:53` | Set render mode to localStorage |
| `buildTree()` | `frontend/src/views/app-tree/render:60` | — |
| `flattenVisible()` | `frontend/src/views/app-tree/render:118` | — |
| `cleanupVirtualScroll()` | `frontend/src/views/app-tree/render:264` | 断开虚拟滚动相关监听 |
| `renderTree()` | `frontend/src/views/app-tree/render:273` | — |
| `updateStat()` | `frontend/src/views/app-tree/render:337` | — |
| `fileRowCommon()` | `frontend/src/views/app-tree/row-common:11` | 文件行公共计算：path 转义、开关状态、禁用 class、类型图标、缩进 |
| `folderRowCommon()` | `frontend/src/views/app-tree/row-common:34` | 文件夹行公共计算：图标、颜色、箭头、开关 class、显示名、缩进 |
| `listFileRowHTML()` | `frontend/src/views/app-tree/row-tpl-list:8` | 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） |
| `listFolderRowHTML()` | `frontend/src/views/app-tree/row-tpl-list:25` | 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） |
| `fileRowHTML()` | `frontend/src/views/app-tree/row-tpl:9` | 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） |
| `folderRowHTML()` | `frontend/src/views/app-tree/row-tpl:32` | 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） |
| `openAdvFilterDialog()` | `frontend/src/views/app-tree/toolbar-events` | — |
| `pickWebFilesAndImport()` | `frontend/src/views/app-tree/toolbar-events` | — |
| `bindToolbarEvents()` | `frontend/src/views/app-tree/toolbar-events:60` | — |
| `openAdvFilterDialog()` | `frontend/src/views/app-tree/toolbar-search:17` | — |
| `pickWebFilesAndImport()` | `frontend/src/views/app-tree/toolbar-search:193` | — |
| `headerHTML()` | `frontend/src/views/app-tree/tpl:5` | — |
| `footerHTML()` | `frontend/src/views/app-tree/tpl:29` | — |
| `emptyHTML()` | `frontend/src/views/app-tree/tpl:37` | — |
| `spinnerHTML()` | `frontend/src/views/app-tree/tpl:41` | — |
| `ROW_H_GRID()` | `frontend/src/views/app-tree/virtual-scroll:3` | — |
| `ROW_H_LIST()` | `frontend/src/views/app-tree/virtual-scroll:4` | — |
| `calcVisibleRange()` | `frontend/src/views/app-tree/virtual-scroll:14` | 根据滚动位置计算可见行范围（支持动态行高） |
| `installScrollSync()` | `frontend/src/views/app-tree/virtual-scroll:31` | 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行 |

## 前端·WASM

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `_getGlueCode()` | `frontend/src/wasm/ysm-glue-data:3` | — |
| `YsmDecodedFile()` | `frontend/src/wasm/ysm-parser:46` | 解码输出文件 |
| `initYSMParser()` | `frontend/src/wasm/ysm-parser:69` | — |
| `decodeYsmFileFromMemory()` | `frontend/src/wasm/ysm-parser:161` | 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组） 返回 [{path, data}]，失败返回 null |
| `decodeYsmFile()` | `frontend/src/wasm/ysm-parser:210` | 通过 callMain + MEMFS 解码 .ysm（回退路径） 保留以兼容旧的 WASM 编译 |
| `_getWasmBinary()` | `frontend/src/wasm/ysm-wasm-data:3` | — |

---

> 说明列由 funcmap 自动提取导出符号紧邻 JSDoc/注释的首句摘要（无注释则留 —）。
> Go 方法记为 `Type.Method`；符号列统一以 `()` 结尾（与 MikuMikuAR 约定一致）。