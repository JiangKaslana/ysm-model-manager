// ===== 浏览器后端适配器（ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）=====
// Proxy 生成与 Wails AppBindings 同形状的后端：
// - 已实现 binding：Phase 2 起走真实数据（IndexedDB 模型库 + localStorage 配置）
// - 未实现 binding：fail-fast 抛 WebUnsupportedError（明确报错，杜绝 undefined
//   穿透静默失败——治理红线陷阱 #5）
// 虚拟根 /web：让前端路径语义（GetRepoRoot → ScanModelEntries → ReadFileBytes）
// 与桌面一致，业务调用零改动。
// ADR-040 按职责拆分：本文件退化为「编排/入口」薄壳——实现函数/状态迁移至
// web-common.ts（共享原语）/ web-fs.ts（文件系统）/ web-store.ts（配置/日志/标签/ban）/
// web-community.ts（社区/头像/作者），此处从新文件 import 组装 webImpls，
// 并保留 browserAdapter Proxy 导出（知识卡 backend-idb invariant_anchor）。
import type { AppBindings } from "./types.ts";
import type { WorkshopCreator, WorkshopSite } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 共享原语 re-export（保持对外 API 导出名/签名不变）
export { WebUnsupportedError, WEB_ROOT, MAX_IMPORT_BYTES, arrayBufferToBase64 } from "./web-common.ts";
import { WebUnsupportedError, WEB_ROOT } from "./web-common.ts";
// 文件系统类实现（web-fs.ts）；importWebFiles/selectLocalRepo 同时对外 re-export
export { importWebFiles, selectLocalRepo } from "./web-fs.ts";
// R2 FSA 持久化原语对外暴露（含授权状态查询，供 settings UI 启动引导）
export { getFsaAuthState, reauthorizeFsaRoot, rescanFsaRoot } from "./web-fs.ts";
import {
  scanWebModels,
  readWebFile,
  selectLocalRepo,
  getFsaAuthState,
  parseWebModelPath,
  parseWebModelDir,
  searchWebModels,
  deleteWebModel,
  renameWebDir,
  renameWebFile,
  getWebSubDirMap,
  listWebModelDirFiles,
} from "./web-fs.ts";
// 配置/日志/标签/ban（web-store.ts）
import {
  loadWebConfig,
  saveWebConfig,
  getWebImportLogs,
  getWebRuntimeLogs,
  addWebImportLog,
  addWebOpLog,
  clearWebImportLogs,
  clearWebRuntimeLogs,
  getWebTags,
  setWebTags,
  listByTagWeb,
  allTagsWeb,
  isWebBanned,
  toggleWebEnable,
} from "./web-store.ts";
// 社区/头像/作者（web-community.ts）
import {
  batchExtractCreatorAvatars,
  loadWebCreators,
  saveWebCreators,
  loadWebGitHubRepos,
  loadWebSites,
  saveWebSites,
  listWebAuthors,
  scanWebLocalAuthors,
  generateWebRepoIndex,
} from "./web-community.ts";
// 注册表驱动视图（LoadResourceTypes 内联 JSON，与 extensions.ts 同源）
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };

// 不加 Record<string, ...> 注解：让 typeof webImpls 保留字面量键（供下方类型级对账校验），
// 用 satisfies 兜住原注解契约（每个实现都是 (...args: never[]) => Promise<unknown>）
const webImpls = {
  ScanModelEntries: (dir: string) => scanWebModels(dir),
  // 真实列表入口（loader/import-queue/resource-manager 等 6 处均调 WithLabel 版本）
  ScanModelEntriesWithLabel: (dir: string, _label: string) => scanWebModels(dir),
  ReadFileBytes: (path: string) => readWebFile(path),
  // rtype 含 / 时替换为 _，避免 /web/a/b 破坏 readWebFile 三段解析
  GetRepoRoot: (rtype: string) => Promise.resolve(`${WEB_ROOT}/${rtype.replace(/\//g, "_")}`),
  GetDefaultRepoRoot: () => Promise.resolve(WEB_ROOT),
  // 注册表驱动视图（recycle-bin/oldest-models/community/app-resource-manager）依赖
  // LoadResourceTypes；resource_types.json 已由 vite 构建期内联（extensions.ts 同源），
  // 直接返回同形状 JSON 字符串，消除 registry.ts 静默降级为空
  LoadResourceTypes: () => Promise.resolve(JSON.stringify(resourceTypesJson)),
  // P2 修复（审核）：网页版无 Go 侧 version.Version，补版本 binding 让导航/设置页
  // 不再触发 fail-fast（原缺失导致 app-nav catch 兜底硬编码 "v1.0.0"、设置页版本
  // 卡「加载中」）；返回 "web" 语义版本，与桌面版本号区分
  GetAppVersion: () => Promise.resolve("web"),
  CurrentVersion: () => Promise.resolve("web"),
  // 网页版无 Go 侧 Node 解码通道：GetModel3DSpec 恒空让 model3d-loader 的 WASM 兜底
  // 守卫可达。P2-2 已闭环（2026-08-12）：网页版渲染走 model3d-loader web 分支的
  // buildSpecFromGeometryJSON（spec-builder.ts 纯 TS 移植，Go app_model.go 同契约），
  // 本 binding 桩仅供 Android 兜底通道形状占位（网页版不会调用到它）。
  GetModel3DSpec: () => Promise.resolve("{}"),
  Build3DSpecFromGeometryJSON: (_geo: string) => {
    // 占位：网页版不调此 binding（TS 移植替代，见 spec-builder.ts）；仅保持 Proxy
    // binding 形状完整，Android 路径仍走 Go 真实现
    return Promise.resolve("{}");
  },
  LoadAppConfig: () => Promise.resolve(loadWebConfig()),
  SaveAppConfig: (filesRoot: string, rpRoot: string, mcRoot: string, linkMode: string, theme: string) => {
    // 字段名对齐 AppConfig（消费方读 resourcepackRoot，非 rpRoot）；spread 旧配置避免
    // 整体覆盖丢失 ysmRoot/shaderpackRoot 等；空串保留旧值（对齐桌面 orDefault 语义）
    const prev = loadWebConfig();
    saveWebConfig({
      ...prev,
      filesRoot: filesRoot || prev.filesRoot,
      resourcepackRoot: rpRoot || prev.resourcepackRoot,
      mcRoot: mcRoot || prev.mcRoot,
      linkMode: linkMode || prev.linkMode,
      theme: theme || prev.theme,
    });
    return Promise.resolve();
  },
  // 网页版内存日志环（替代 Go ImportLog / runtimeLogs，消除诊断页 fail-fast 红错）
  GetImportLogs: () => getWebImportLogs(),
  GetRuntimeLogs: () => getWebRuntimeLogs(),
  AddImportLog: (modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string) =>
    addWebImportLog(modelName, sourcePath, targetDir, fileSize, status, errMsg),
  AddOpLog: (op: string, modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string) =>
    addWebOpLog(op, modelName, sourcePath, targetDir, fileSize, status, errMsg),
  // 网页版创作者头像批量提取（复用 ScanModelEntries + ReadFileBytes + ysm-parser）
  BatchExtractCreatorAvatars: () => batchExtractCreatorAvatars(),
  // SelectLocalRepo 为网页版专属扩展（Go AppBindings 无此函数，Phase 3 能力探测不会误报）；
  // 用 FSA 授权本地仓库目录，替代 Go 本地文件系统扫描作为模型库文件来源
  SelectLocalRepo: () => selectLocalRepo(),
  // R2 FSA 授权状态查询（供 settings UI 启动引导；不触发权限弹窗）
  GetFsaAuthState: () => getFsaAuthState(),
  // ===== ADR-049 桥接增强 Batch 1：纯前端可复现绑定 =====
  // 搜索：关键词匹配（数值范围条件浏览器端无几何分析，降级忽略，如实标注）
  SearchModels: (filesRoot: string, keyword: string, ..._rest: number[]) => searchWebModels(filesRoot, keyword),
  // 启用开关：ban 标记翻转，返回新「已启用」态（对齐桌面 ToggleModelEnable 语义）
  IsFileBanned: (path: string) => isWebBanned(path),
  ToggleModelEnable: (path: string) => toggleWebEnable(path),
  // 标签：config store tags:<path>
  GetModelTags: (path: string) => getWebTags(path),
  SetModelTags: (path: string, tags: string[] | null) => setWebTags(path, tags),
  ListByTag: (tag: string) => listByTagWeb(tag),
  AllTags: () => allTagsWeb(),
  // 删除模型组（dir + file + 标记）
  DeleteModelDir: async (path: string) => {
    // 格式校验区分「非法路径」（reject）与「合法但组已删」（幂等通过，对齐桌面重复删除不报错）：
    // dir 反向匹配依赖 dir key 存在性，组删除后解析为 null——此时不得误报无效路径
    if (!/^\/web\/([^/]+)\/.+$/.test(path)) {
      return Promise.reject(new Error(`删除失败：无效路径: ${path}`));
    }
    const pm = await parseWebModelPath(path);
    if (pm) await deleteWebModel(pm.type, pm.name);
  },
  RemoveDir: (dir: string) => {
    const di = parseWebModelDir(dir);
    if (!di) return Promise.reject(new Error(`删除失败：无效路径: ${dir}`));
    return deleteWebModel(di.type, di.name);
  },
  // 重命名：模型目录整组 rekey / 组内单文件 rekey
  RenameDir: (oldPath: string, newName: string) => renameWebDir(oldPath, newName),
  RenameFile: (oldPath: string, newName: string) => renameWebFile(oldPath, newName),
  // 日志环清空（环状态封装在 web-store.ts）
  ClearImportLogs: () => {
    clearWebImportLogs();
    return Promise.resolve();
  },
  ClearRuntimeLogs: () => {
    clearWebRuntimeLogs();
    return Promise.resolve();
  },
  // 子目录映射（resource_types.json 派生）
  GetSubDirMap: () => getWebSubDirMap(),
  // R1 文件层级读取：递归列出 /web 目录下全部文件完整路径（对齐桌面 ListAllFilePaths，
  // 递归完整路径、不限制扩展名；bus-handlers 删除目录移入回收站联动依赖）
  ListAllFilePaths: (dir: string) => listWebModelDirFiles(dir),
  // 网页版无扫描缓存（scanWebModels 直读 IDB）：清缓存为 no-op。
  // 缺此实现会让 app-tree 切换 root 时（index.ts:170）fail-fast 抛错跳过 _load，树卡死。
  ClearScanCache: () => Promise.resolve(),
  InvalidateScanCache: () => Promise.resolve(),
  // ===== ADR-049 桥接增强 Batch 3：作者扫描 / 仓库索引（基于 IDB 模型库）=====
  ListModelAuthors: () => Promise.resolve(listWebAuthors()),
  ScanLocalAuthors: () => Promise.resolve(scanWebLocalAuthors()),
  GenerateRepoIndex: (repoPath: string) => Promise.resolve(generateWebRepoIndex(repoPath)),
  // ===== ADR-049 桥接增强 Batch 2：社区/工坊只读 + 本地覆盖写入 =====
  // bundled 默认 + localStorage 覆盖（对齐桌面 Save→Load 语义）；GitHub 仓库列表只读
  LoadWorkshopCreators: () => Promise.resolve(loadWebCreators()),
  SaveWorkshopCreators: (list: WorkshopCreator[] | null) => {
    saveWebCreators(list);
    return Promise.resolve();
  },
  LoadGitHubRepos: () => Promise.resolve(loadWebGitHubRepos()),
  DefaultWorkshopSites: () => Promise.resolve(loadWebSites()),
  // 网页版系统浏览器即当前浏览器：等价 Go Browser.OpenURL。
  // 不用 noopener 特性串（其下 window.open 恒返回 null 无法检测拦截）；
  // 成功后显式置 opener=null 保留 noopener 安全性
  OpenInBrowser: (url: string) => {
    const w = window.open(url, "_blank");
    if (w) {
      w.opener = null;
    } else {
      // 被弹窗拦截/iframe sandbox 无 allow-popups：留痕不静默
      console.warn("[web] OpenInBrowser 被浏览器拦截，无法打开:", url);
    }
    return Promise.resolve();
  },
  SaveWorkshopSites: (sites: WorkshopSite[] | null) => {
    saveWebSites(sites);
    return Promise.resolve();
  },
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;

// 类型级对账：webImpls 的键（排除网页版专属扩展白名单）必须 ⊆ AppBindings 导出键。
// 拼错键 / 漏实现（webImpls 没有但调用方误以为有）会在编译期暴露 TS2344。
type WebImplGoKeys = Exclude<keyof typeof webImpls, "SelectLocalRepo" | "GetFsaAuthState">;
type AssertSubset<T extends keyof AppBindings> = T;
type _WebImplKeyCheck = AssertSubset<WebImplGoKeys>;

// fail-fast 函数缓存：保证同一 binding 返回稳定引用（便于 Phase 3 能力探测 /
// spyOn / 记忆化）——避免每次 get 新建函数导致 adapter.Foo !== adapter.Foo
const failFastCache = new Map<string, (...args: never[]) => Promise<never>>();
function makeFailFast(name: string): (...args: never[]) => Promise<never> {
  let f = failFastCache.get(name);
  if (!f) {
    f = async () => {
      throw new WebUnsupportedError(name);
    };
    failFastCache.set(name, f);
  }
  return f;
}

/** 浏览器后端（Proxy 动态形状，未实现 binding 一律 fail-fast） */
export const browserAdapter = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    // thenable 探测陷阱：await/`Promise.resolve(adapter)` 会访问 .then——
    // 若返回 async 函数则被误判为 thenable，await 调它抛错导致挂起。
    // 返回 undefined 让 adapter 不是 thenable。
    if (prop === "then") return undefined;
    // symbol（如 Symbol.toStringTag）不拦截，返回 undefined 走默认行为
    if (typeof prop === "symbol") return undefined;
    const name = String(prop);
    // Object 原型成员（toString/constructor/valueOf/hasOwnProperty 等）不得路由到
    // fail-fast：`String(adapter)` / adapter.toString() 会拿到 rejected Promise，
    // 交由 target 原型链的正常实现（Reflect.get 沿原型找函数）
    if (PROTOTYPE_MEMBERS.has(name)) return Reflect.get(_target, prop);
    // 仅自有键命中（与下方 has trap 的 hasOwnProperty 口径对称，避免沿原型链误命中）
    if (Object.prototype.hasOwnProperty.call(webImpls, name)) return webImpls[name as keyof typeof webImpls];
    return makeFailFast(name);
  },
  // Phase 3 能力门控探测：`'Foo' in browserAdapter` 应反映是否真实现
  has(_target, prop) {
    if (typeof prop === "symbol") return false;
    const name = String(prop);
    // 原型成员沿原型链命中 Object.prototype（toString/constructor 等 8 个恒 true），
    // 与 get trap 的 PROTOTYPE_MEMBERS 豁免对称：门控契约只看自有实现
    if (PROTOTYPE_MEMBERS.has(name)) return false;
    // 仅自有键（webImpls 上的实现）；未实现 binding → false → 能力门控隐藏对应 UI（fail-fast 兜底）
    return Object.prototype.hasOwnProperty.call(webImpls, name);
  },
}) as unknown as AppBindings;

/** Object 原型自有成员白名单（Proxy get 不拦截，交由默认原型行为） */
const PROTOTYPE_MEMBERS = new Set([
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "constructor",
]);
