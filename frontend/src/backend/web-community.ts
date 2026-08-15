// ===== 网页版社区数据持久化/头像/作者/仓库索引职责（ADR-040 拆分产物）=====
// 社区/工坊数据（bundled JSON 默认 + localStorage 覆盖层）、创作者头像批量提取、
// 本地作者扫描与仓库索引生成。文件系统访问（scanWebModels/readWebFile/
// collectAllWebEntries/typeFromWebDir）复用 web-fs.ts；browser-adapter.ts 从本文件
// import 组装 webImpls。
import type { WorkshopCreator, WorkshopSite, AuthorInfo } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 社区/工坊默认数据源（bundled JSON，build 期内联；与 resource_types.json 同源范式）
import creatorsJson from "../../../creators.json" with { type: "json" };
import workshopGithubJson from "../../../workshop-github.json" with { type: "json" };
import workshopSitesJson from "../../../workshop_sites.json" with { type: "json" };
// 网页版头像提取复用前端 YSM 解包能力（替代 Go ExtractAvatarURI，ADR-049 缺口补齐）
import { decodeYsmFile } from "../wasm/ysm-parser.ts";
import { scanWebModels, readWebFile, collectAllWebEntries, typeFromWebDir } from "./web-fs.ts";
import { WEB_ROOT, arrayBufferToBase64 } from "./web-common.ts";

// --- 社区/工坊数据（ADR-049 桥接增强 Batch 2）---
// 网页版无 Go 侧磁盘配置文件：bundled JSON 作默认，localStorage 作用户覆盖层
// （覆盖优先于默认，对齐桌面 Save→Load 语义）。GitHub 仓库列表为只读 bundled。
const WEB_CREATORS_KEY = "web:workshop-creators";
const WEB_SITES_KEY = "web:workshop-sites";
const WEB_GITHUB_KEY = "web:github-repos";

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function loadWebCreators(): WorkshopCreator[] {
  const ov = typeof localStorage !== "undefined" ? localStorage.getItem(WEB_CREATORS_KEY) : null;
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopCreator[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled，避免整个社区加载崩溃
    }
  }
  return cloneJson(creatorsJson as unknown as WorkshopCreator[]);
}

function saveWebCreators(list: WorkshopCreator[] | null): void {
  // null → 清除覆盖层，下次 Load 回退默认（对齐桌面 Save(null) 重置语义）
  if (list === null) {
    localStorage.removeItem(WEB_CREATORS_KEY);
    return;
  }
  localStorage.setItem(WEB_CREATORS_KEY, JSON.stringify(list));
}

function loadWebSites(): WorkshopSite[] {
  const ov = typeof localStorage !== "undefined" ? localStorage.getItem(WEB_SITES_KEY) : null;
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopSite[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled
    }
  }
  return cloneJson(workshopSitesJson as unknown as WorkshopSite[]);
}

function saveWebSites(sites: WorkshopSite[] | null): void {
  if (sites === null) {
    localStorage.removeItem(WEB_SITES_KEY);
    return;
  }
  localStorage.setItem(WEB_SITES_KEY, JSON.stringify(sites));
}

// B2 契约修复：网页版 GitHub 仓库列表补覆盖层（对齐 Go workshop-github.json 用户覆盖语义）。
// 此前为纯 bundled 只读，与 Go「用户配置优先」契约不一致（contract-b2 测试暴露）。
function loadWebGitHubRepos(): WorkshopCreator[] {
  const ov = typeof localStorage !== "undefined" ? localStorage.getItem(WEB_GITHUB_KEY) : null;
  if (ov !== null) {
    try {
      return JSON.parse(ov) as WorkshopCreator[];
    } catch {
      // 覆盖数据损坏则回退默认 bundled
    }
  }
  return cloneJson(workshopGithubJson as unknown as WorkshopCreator[]);
}


// --- 网页版创作者头像批量提取（替代 Go BatchExtractCreatorAvatars）---
// 复用已桥的 ScanModelEntries + ReadFileBytes + 前端 ysm-parser 解包，从 IndexedDB 模型库
// 真实提取头像（ADR-049 能力门控缺口补齐）。单模型失败不中断、返回可能为空 map。
async function batchExtractCreatorAvatars(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    const entries = await scanWebModels(`${WEB_ROOT}/ysm`);
    for (const e of entries) {
      // 作者名取自 [作者]模型 命名（对齐 Go app_avatar.go:38 解析口径）
      const base = e.Name.replace(/\.(ysm|zip|7z|json|ban)$/i, "");
      if (!base.startsWith("[")) continue;
      const idx = base.indexOf("]");
      if (idx <= 0) continue;
      const author = base.slice(1, idx).trim();
      if (!author || result[author]) continue;

      const b64 = await readWebFile(e.Path);
      if (!b64) continue;
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        continue;
      }
      try {
        const files = await decodeYsmFile(bytes);
        // 优先找 avatar/ 目录下首张图（对齐 Go ExtractAvatarURI 降级分支）
        for (const f of files) {
          const low = f.path.toLowerCase();
          if (!(low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg"))) continue;
          if (!low.startsWith("avatar/") && !low.includes("/avatar/")) continue;
          const mime = low.endsWith(".png") ? "image/png" : "image/jpeg";
          result[author] = `data:${mime};base64,${arrayBufferToBase64(
            f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer,
          )}`;
          break;
        }
      } catch {
        // 单模型解码失败：跳过，不中断批量（降级为无头像）
      }
    }
  } catch {
    // 模型库不可用：返回空 map（前端 index.ts 已处理空结果，无红错）
  }
  return result;
}

// --- 作者扫描 / 仓库索引（ADR-049 桥接增强 Batch 3）---
// 纯前端可复现：基于 IDB 模型库（scanWebModels）推导，与桌面 scanner.go 同口径
// （[作者] 前缀提取、计数降序、类型合并）。网页版无磁盘，GenerateRepoIndex 返回
// index.json 内容字符串（调用方在 web 模式触发下载，对齐桌面写盘语义）。
/** 从文件名提取 [作者] 前缀（去除 .ban 后缀）；非括号名返回 null */
function extractBracketAuthor(name: string): string | null {
  let n = name;
  if (n.toLowerCase().endsWith(".ban")) n = n.slice(0, -4);
  if (!n.startsWith("[")) return null;
  const idx = n.indexOf("]");
  if (idx <= 0) return null;
  const author = n.slice(1, idx);
  return author || null;
}

/** ListModelAuthors 网页版：从模型名 [作者] 前缀统计（计数降序），对齐 scanner.go:265 */
async function listWebAuthors(): Promise<AuthorInfo[]> {
  const entries = await collectAllWebEntries();
  const m = new Map<string, { count: number; sample: string }>();
  for (const e of entries) {
    const a = extractBracketAuthor(e.Name);
    if (!a) continue;
    const cur = m.get(a);
    if (cur) cur.count++;
    else m.set(a, { count: 1, sample: e.Path });
  }
  const result: AuthorInfo[] = [...m.entries()].map(([name, v]) => ({
    Name: name,
    Count: v.count,
    SampleFile: v.sample,
  }));
  result.sort((x, y) => y.Count - x.Count);
  return result;
}

/** ScanLocalAuthors 网页版：按 [作者] 提取并合并类型标签，对齐 scanner.go:297 */
async function scanWebLocalAuthors(): Promise<WorkshopCreator[]> {
  const entries = await collectAllWebEntries();
  const seen = new Set<string>();
  const result: WorkshopCreator[] = [];
  for (const e of entries) {
    const a = extractBracketAuthor(e.Name);
    if (!a) continue;
    const rtype = typeFromWebDir(e.Path);
    const key = `${a}@${rtype}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = result.find((c) => c.name === a);
    if (existing) {
      if (!existing.type?.includes(rtype)) {
        existing.type = existing.type ? `${existing.type};${rtype}` : rtype;
      }
    } else {
      result.push({ name: a, desc: "来自本地仓库", type: rtype });
    }
  }
  return result;
}

/** GenerateRepoIndex 网页版：扫描虚拟根生成 index.json 内容（路径相对 repoPath，正斜杠） */
async function generateWebRepoIndex(repoPath: string): Promise<string> {
  const entries = repoPath && repoPath.startsWith(WEB_ROOT)
    ? await scanWebModels(repoPath)
    : await collectAllWebEntries();
  const list = entries.map((e) => {
    let rel = e.Path;
    if (repoPath && e.Path.startsWith(repoPath)) {
      rel = e.Path.slice(repoPath.length).replace(/^[/\\]/, "");
    } else if (e.Path.startsWith(WEB_ROOT)) {
      rel = e.Path.slice(WEB_ROOT.length).replace(/^[/\\]/, "");
    }
    // 对齐 go/scanner/scanner.go indexEntry json tag：小写 name/path/size + hash,omitempty
    const entry: { name: string; path: string; size: number; hash?: string } = {
      name: e.Name,
      path: rel.replace(/\\/g, "/"),
      size: e.Size,
    };
    if (e.Hash) entry.hash = e.Hash;
    return entry;
  });
  return JSON.stringify(list, null, 2);
}

// ===== 社区/头像/作者/仓库索引类 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 收敛自 browser-adapter.ts webImpls 的 community 类条目（创作者/工坊站点/GitHub 仓库/
// 本地作者扫描/仓库索引）。
export const webCommunityBindings = {
  // 网页版创作者头像批量提取（复用 ScanModelEntries + ReadFileBytes + ysm-parser）
  BatchExtractCreatorAvatars: () => batchExtractCreatorAvatars(),
  ListModelAuthors: () => Promise.resolve(listWebAuthors()),
  ScanLocalAuthors: () => Promise.resolve(scanWebLocalAuthors()),
  GenerateRepoIndex: (repoPath: string) => Promise.resolve(generateWebRepoIndex(repoPath)),
  // bundled 默认 + localStorage 覆盖（对齐桌面 Save→Load 语义）；GitHub 仓库列表只读
  LoadWorkshopCreators: () => Promise.resolve(loadWebCreators()),
  SaveWorkshopCreators: (list: WorkshopCreator[] | null) => {
    saveWebCreators(list);
    return Promise.resolve();
  },
  LoadGitHubRepos: () => Promise.resolve(loadWebGitHubRepos()),
  DefaultWorkshopSites: () => Promise.resolve(loadWebSites()),
  SaveWorkshopSites: (sites: WorkshopSite[] | null) => {
    saveWebSites(sites);
    return Promise.resolve();
  },
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;
