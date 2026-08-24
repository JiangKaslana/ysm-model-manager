// ===== 创意工坊纯数据层 =====
import { t } from "../../core/i18n/t.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { withCached, invalidateCache, type CachePolicy } from "../../utils/cache/with-cached.ts";
import { getApp } from "../../backend/app.ts";
import type { WorkshopSite, WorkshopCreator } from "../../../bindings/ysm-model-manager/go/types/models.ts";

/** 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） */
export interface LocalCreator extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  type?: string;
  /** 行内编辑动态字段（fld 来自 dataset） */
  [key: string]: unknown;
}

/** 绑定 LocalAuthor（合并来源） */
interface LocalAuthorLike {
  name?: string;
  desc?: string;
  type?: string;
}

/** 站点 + 创作者 + 作者 数据包 */
export interface CommunityData {
  sites: WorkshopSite[];
  creators: LocalCreator[];
  authors: unknown[];
  /** 加载是否失败（ADR-082 续：区分「真无数据」与「加载失败」，调用方据此占位提示） */
  failed?: boolean;
}

// ===== 社区索引拉取缓存 =====
// 使用 withCached 统一缓存：6h TTL，STALE 策略（过期返回空不阻塞渲染）
const COMMUNITY_MERGE_TTL_MS = 6 * 3600 * 1000; // 6 小时
const COMMUNITY_MERGE_KEY = "community-merge";

// 磁盘扫描 TTL：作者数据变更不频繁，5 分钟足够
const SCAN_AUTHORS_TTL_MS = 5 * 60 * 1000; // 5 分钟
const SCAN_AUTHORS_KEY = "scan-authors";

// 站点索引 TTL：站点配置变更很少，30 分钟足够
const SITES_FETCH_TTL_MS = 30 * 60 * 1000; // 30 分钟
const SITES_FETCH_KEY = "community-sites";

/** 供测试强制刷新缓存 */
export function forceRefreshCommunityMerge(): void {
  invalidateCache(COMMUNITY_MERGE_KEY);
}

/** 供测试清除扫描缓存 */
export function forceRefreshScanAuthors(): void {
  invalidateCache(SCAN_AUTHORS_KEY);
}

/** 清除站点索引缓存 */
export function forceRefreshCommunitySites(): void {
  invalidateCache(SITES_FETCH_KEY);
}

/**
 * 动态缓存策略选择器（预留扩展点）
 *
 * @param isOnline    是否在线（默认 true，未来接入 navigator.onLine）
 * @param isFreshLoad 是否首次加载（默认 false，未来接入版本检测）
 * @param isManual    是否用户主动触发（默认 false，由设置页按钮传入）
 * @returns 推荐策略
 *
 * 策略矩阵：
 *   在线 + 非手动 → STALE（旧值立即可用，后台静默刷新）
 *   在线 + 手动   → FORCE（用户明确要最新数据）
 *   离线 + 有缓存 → STALE（无法刷新，返回旧值）
 *   离线 + 无缓存 → FORCE_SKIP（根本不尝试网络，直接返回空/降级）
 */
export type CommunityCacheStrategy = 'STALE' | 'FORCE' | 'FORCE_SKIP';

export function chooseCommunityCacheStrategy(
  opts: { isOnline?: boolean; isFreshLoad?: boolean; isManual?: boolean } = {},
): CommunityCacheStrategy {
  const { isOnline = true, isManual = false, isFreshLoad = false } = opts;
  if (!isOnline) return 'FORCE_SKIP';
  if (isManual || isFreshLoad) return 'FORCE';
  return 'STALE';
}

/**
 * 统一失效入口：数据变更时一次性清除所有社区相关缓存
 * 供导入/同步/下载完成后调用，替代分散的 invalidateCache 调用
 */
export function clearAllCommunityCache(): void {
  invalidateCache(COMMUNITY_MERGE_KEY);
  invalidateCache(SCAN_AUTHORS_KEY);
  invalidateCache(SITES_FETCH_KEY);
  dbg("cache", "all community cache cleared");
}

/**
 * 加载站点 + 创作者数据（纯数据，不碰 DOM）
 * 自动合并本地仓库提取的作者
 */
export async function loadCommunityData(): Promise<CommunityData> {
  const App = await getApp();
  // 网页版（ADR-049 桥接增强 Batch 2）：DefaultWorkshopSites/LoadWorkshopCreators 已由
  // browser-adapter 桥接（bundled JSON + localStorage 覆盖），与桌面共用同一条加载路径，
  // 桥接真正生效（不再走 GitHub 拉取旁路）。作者扫描（ListModelAuthors/ScanLocalAuthors）
  // 仍属桌面专属、网页版未桥接，各自 .catch(() => []) 降级为空，不影响站点/创作者透传
  // （与文件内既有 P2/P4 防御风格一致，避免单点 unbridged binding 拖垮整链）。
  let sites: WorkshopSite[] = [];
  let creators: WorkshopCreator[] = [];
  let authors: unknown[] = [];
  let localAuthors: LocalAuthorLike[] = [];
  let failed = false;
  try {
    const results = await Promise.all([
      App.DefaultWorkshopSites(),
      App.LoadWorkshopCreators(),
      // 作者列表：从已有 ModelEntry 统计，无 IO，直接调用
      App.ListModelAuthors().catch(() => []),
      // 本地作者扫描：磁盘 IO 密集，加 withCached 5min TTL 缓存
      withCached(SCAN_AUTHORS_KEY, SCAN_AUTHORS_TTL_MS, () =>
        App.ScanLocalAuthors().catch(() => []),
      ),
    ]);
    sites = results[0] || [];
    creators = results[1] || [];
    authors = results[2] || [];
    localAuthors = results[3] || [];
  } catch (e) {
    // 显式化（ADR-082 续）：不再只 console.warn 静默——failed 标记让调用方
    // 区分「加载失败」（提示重试）与「真无数据」（显示空态），避免页面空白无感知
    failed = true;
    console.warn("[community] 社区数据加载失败:", e);
  }

  // 合并本地作者到创作者列表
  const merged = (creators || []) as LocalCreator[];
  const existingNames = new Set(merged.map((c) => c.name));
  const localAuthorsList: LocalAuthorLike[] = localAuthors || [];
  if (localAuthorsList.length) {
    for (const la of localAuthorsList) {
      if (la && la.name && existingNames.has(la.name)) {
        const found = merged.find((c) => c.name === la.name);
        // P4 修复：按分号分段比较 type，避免子串误判（"bilibili" 包含 "bili" 时丢类型）
        if (found && la.type) {
          const hasType = (found.type || "").split(";").some((t) => t.trim() === la.type);
          if (!hasType) {
            found.type = found.type ? found.type + ";" + la.type : la.type;
          }
        }
        if (found) found._fromLocal = true;
      } else if (la && la.name) {
        merged.push({
          name: la.name,
          desc: la.desc || t("community.fromLocal"),
          type: la.type || "",
          _fromLocal: true,
        });
      }
    }
  }

  // 自动拉取社区索引（静默，后台执行）——R3-P0 后网页版已桥接
  // 自动合并（网络拉取失败静默，保存到 localStorage）
  tryAutoMergeCommunity([...merged]).catch((e) => { dbg("tryAutoMergeCommunity failed", e); });

  return {
    sites: sites || [],
    creators: merged,
    authors: authors || [],
    failed,
  };
}

/** 后台静默拉取社区索引并合并（withCached 6h TTL） */
async function tryAutoMergeCommunity(creators: LocalCreator[]): Promise<void> {
  const community = await withCached(COMMUNITY_MERGE_KEY, COMMUNITY_MERGE_TTL_MS, async () => {
    return fetchCommunityCreators(DEFAULT_COMMUNITY_URL);
  }, "STALE");
  if (!community.length) return;
  const { added } = mergeCommunityCreators(creators, community);
  if (added > 0) {
    try {
      const { LoadWorkshopCreators, SaveWorkshopCreators } =
        await getApp();
      // 数据安全（审核 2026-08-16）：原逐站点循环调 SaveWorkshopCreatorsBySite
      // （每次 load 全部→过滤当前站点→save 全部），中途失败会部分提交——
      // 前站点已保存、后站点未保存，覆盖层混合新旧数据。改为前端一次合并 +
      // 单次整体保存（localStorage setItem / 文件原子写 = 原子，无部分提交）。
      const all = (await LoadWorkshopCreators()) || [];
      // 按站点分组（type 分号段），对齐原 SaveWorkshopCreatorsBySite 语义
      const siteMap: Record<string, LocalCreator[]> = {};
      creators.forEach((c) => {
        const types = (c.type || "").split(";");
        types.forEach((t) => {
          if (!t) return;
          if (!siteMap[t]) siteMap[t] = [];
          siteMap[t].push(c);
        });
      });
      const siteIDs = Object.keys(siteMap);
      // 移除所有被更新站点的旧条目（type 精确/分号段匹配）
      const kept = all.filter((c) => {
        const t = c.type || "";
        return !siteIDs.some((sid) => t === sid || t.includes(sid + ";") || t.endsWith(";" + sid));
      });
      // 去重：多段 type（如 "bilibili;afdian"）会被 push 进多个 siteMap 组，
      // flat 后同名条目重复 → 按 name 去重（mergeCommunityCreators 本就用 name 作 key）
      const flat = Object.values(siteMap).flat();
      const deduped = new Map<string, LocalCreator>();
      for (const c of flat) {
        if (c.name) deduped.set(c.name, c);
      }
      const merged = [...kept, ...deduped.values()];
      await SaveWorkshopCreators(merged as WorkshopCreator[]);
    } catch (e) { dbg("SaveWorkshopCreators failed", e); }
  }
}

/**
 * 替换 &#123;&#123;q&#125;&#125; 为查询词
 */
export const fillSearch = (tpl: string, q: string): string =>
  tpl.replace(/\{\{q\}\}/g, encodeURIComponent(q));

/**
 * 三路回退拉取 JSON 数组（raw → jsdelivr → GitHub API）。
 * mirror 为 "jsdelivr" / "githubapi" 时调整优先级；api 源经 atob 解码 base64 内容。
 * 每路 8s 超时（AbortController）；全部失败返回 []。
 * @param attempts - 候选源列表（按尝试顺序）
 * @param mirror - 镜像配置，调整回退优先级
 * @param dbgTag - debug 日志模块标签（默认 "community"）
 */
async function fetchWithFallback<T>(
  attempts: Array<{ name: string; url: string; label: string }>,
  mirror?: string,
  dbgTag = "community",
): Promise<T[]> {
  // 防御：attempts 可能不足 3 项（本地 URL 场景），重排后滤掉缺失项，避免 undefined.url
  const order =
    mirror === "jsdelivr" ? [1, 0, 2]
      : mirror === "githubapi" ? [2, 0, 1]
        : null;
  const sorted = order
    ? order.map((i) => attempts[i]).filter((a): a is (typeof attempts)[number] => !!a)
    : attempts;

  for (const a of sorted) {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(a.url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      let data: unknown;
      if (a.name === "api") {
        const json = (await resp.json()) as { content?: string };
        if (!json.content) throw new Error("no content");
        data = JSON.parse(atob(json.content.replace(/\s/g, "")));
      } else {
        data = await resp.json();
      }
      if (Array.isArray(data)) return data as T[];
    } catch (err) {
      if (err && (err as Error)?.name !== "AbortError") {
        dbg(dbgTag, a.name + " failed:", (err as Error)?.message);
      }
    } finally {
      clearTimeout(tmr);
    }
  }
  return [];
}

/**
 * 从 GitHub 拉取 creators.json（三路回退）
 */
export async function fetchCommunityCreators(
  url: string,
  mirror?: string,
): Promise<WorkshopCreator[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    { name: "raw", url, label: "⏳ 社区索引: raw…" },
  ];
  // 仅在 raw URL 看起来有效时才加兜底
  if (url && !url.includes("localhost") && !url.includes("127.0.0.1")) {
    attempts.push(
      {
        name: "jsd",
        url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/creators.json",
        label: "⏳ 社区索引: jsdelivr…",
      },
      {
        name: "api",
        url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/creators.json",
        label: "⏳ 社区索引: api…",
      },
    );
  }
  return fetchWithFallback<WorkshopCreator>(attempts, mirror);
}

/**
 * 合并社区索引到本地 creators.json
 * @returns {{ merged: LocalCreator[]; added: number; updated: number }} 合并后的创作者列表、新增数、更新数
 */
export function mergeCommunityCreators(
  local: LocalCreator[],
  community: WorkshopCreator[],
): { merged: LocalCreator[]; added: number; updated: number } {
  const nameMap = new Map(local.map((c) => [c.name, c]));
  let added = 0,
    updated = 0;
  for (const cc of community) {
    const existing = nameMap.get(cc.name);
    if (existing) {
      // 补充缺失的字段
      let changed = false;
      if (cc.desc && !existing.desc) {
        existing.desc = cc.desc;
        changed = true;
      }
      if (cc.type && !existing.type) {
        existing.type = cc.type;
        changed = true;
      }
      if (cc.role && !existing.role) {
        existing.role = cc.role;
        changed = true;
      }
      if (changed) updated++;
    } else {
      local.push({ ...cc, _fromCommunity: true });
      nameMap.set(cc.name, local[local.length - 1]);
      added++;
    }
  }
  return { merged: local, added, updated };
}

/**
 * 从 GitHub 拉取 workshop_sites.json（三路回退，withCached 30min TTL）
 */
export async function fetchCommunitySites(mirror?: string): Promise<WorkshopSite[]> {
  return withCached(SITES_FETCH_KEY, SITES_FETCH_TTL_MS, () => _fetchCommunitySitesRaw(mirror));
  const attempts: Array<{ name: string; url: string; label: string }> = [
    {
      name: "raw",
      url: "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/workshop_sites.json",
      label: "⏳ 站点索引: raw…",
    },
    {
      name: "jsd",
      url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/workshop_sites.json",
      label: "⏳ 站点索引: jsdelivr…",
    },
    {
      name: "api",
      url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/workshop_sites.json",
      label: "⏳ 站点索引: api…",
    },
  ];
  return fetchWithFallback<WorkshopSite>(attempts, mirror);
}

/** 原始拉取实现（供 withCached 包裹） */
async function _fetchCommunitySitesRaw(mirror?: string): Promise<WorkshopSite[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    {
      name: "raw",
      url: "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/workshop_sites.json",
      label: "⏳ 站点索引: raw…",
    },
    {
      name: "jsd",
      url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/workshop_sites.json",
      label: "⏳ 站点索引: jsdelivr…",
    },
    {
      name: "api",
      url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/workshop_sites.json",
      label: "⏳ 站点索引: api…",
    },
  ];
  return fetchWithFallback<WorkshopSite>(attempts, mirror);
}

/**
 * 合并社区站点到本地 workshop_sites.json
 */
export function mergeCommunitySites(
  local: WorkshopSite[],
  community: WorkshopSite[],
): { added: number } {
  const idMap = new Map(local.map((s) => [s.id, s]));
  let added = 0;
  for (const cs of community) {
    if (!cs.id) continue;
    if (!idMap.has(cs.id)) {
      local.push(cs);
      idMap.set(cs.id, cs);
      added++;
    }
  }
  return { added };
}

/**
 * 社区索引的默认 URL（可配置为社区维护的独立 creators JSON）
 * 贡献通道：https://github.com/eghrhegpe/ysm-model-manager（仓库根目录 creators.json）
 */
export const DEFAULT_COMMUNITY_URL =
  "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/creators.json";
