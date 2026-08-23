// ===== 资历最深 + 仓库评分 + 每日推荐（类型化版 — ADR-014 P3 features）=====
// 响应全局类型切换
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { renderDisplayName } from "../utils/dom/display.ts";
import { formatBytes } from "../utils/dom/format.ts";
import { loadResourceRegistry } from "../utils/resource/registry.ts";
import { getApp } from "../backend/app.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../utils/resource/types.ts";
import { useCurrentResourceType } from "./repo-rtype.ts";

// ===== 业务常量（审核：魔法数值集中化，数值与既有行为完全一致）=====
const MS_PER_DAY = 86400000;
const SCORE_BAN_PENALTY = 40; // 每 1% ban 占比的扣分权重
const SCORE_DUP_PENALTY = 5; // 每个多余副本扣分
const SCORE_DUP_PENALTY_CAP = 55; // 重复扣分上限
const SCORE_HEALTH_GOOD = 80; // >=80 健康
const SCORE_HEALTH_OK = 50; // >=50 亚健康，否则需整理
const HEATMAP_BASE_HT = 4; // 热力图最低柱高 px
const HEATMAP_MAX_EXTRA = 44; // 热力图最高柱额外高度 px
const HEATMAP_STRONG = 0.66; // 热度占比 >66% 绿色
const HEATMAP_MID = 0.33; // 热度占比 >33% 琥珀
const OLDEST_CARD_COUNT = 4; // 资历最深卡片数
const DAILY_PICK_COUNT = 3; // 每日推荐条数

/** ScanModelEntries 返回的条目 */
interface ModelEntry {
  Name: string;
  Size: number;
  Path: string;
  Ext: string;
  Hash: string;
  ModTime: number;
}

/**
 * 加载资历最深、仓库评分、热力图和每日推荐
 * @param container 渲染容器
 * @param esc HTML 转义函数
 * @returns 清理函数
 */
export async function loadOldestModel(
  container: HTMLElement,
  esc: (s: string) => string,
): Promise<() => void> {
  if (!container) return () => {};
  // 渲染代数：rtype 快速切换时丢弃过期结果（与 recycle-bin 的 _loadGen 同模式）
  let _loadGen = 0;

  // 命名函数，用于安全地移除/添加 click 监听，避免重复绑定
  function handleContainerClick(e: MouseEvent): void {
    const card = (e.target as Element).closest("[data-path]") as HTMLElement | null;
    if (card) {
      const path = card.dataset.path;
      if (path) bus.emit("model:select", { path });
    }
  }

  async function render(): Promise<void> {
    const gen = ++_loadGen; // 每次渲染自增：慢响应返回后若已过期则丢弃
    container.innerHTML =
      '<div style="padding:12px;color:var(--muted);font-size:var(--fs-base)">⏳ ' + t("oldest.scanning") + '</div>';
    try {
      const { ScanModelEntriesWithLabel, GetRepoRoot } = await getApp();
      const filesRoot = await GetRepoRoot(getCurrentType());
      if (gen !== _loadGen) return;
      if (!filesRoot) {
        container.innerHTML =
          '<div style="padding:12px;color:var(--status-error);font-size:var(--fs-base)">' + t("oldest.configTypeDir") + '</div>';
        return;
      }

      const entries: ModelEntry[] = (await ScanModelEntriesWithLabel(filesRoot, RESOURCE_TYPE_LABELS[getCurrentType()] ?? RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
      if (gen !== _loadGen) return; // 已切换类型，丢弃过期结果
      if (!entries || !entries.length) {
        container.innerHTML =
          '<div style="padding:12px;color:var(--muted);font-size:var(--fs-base)">' + t("oldest.repoEmpty") + '</div>';
        return;
      }

      // 基础统计
      let totalSize = 0;
      let banned = 0;
      const hashMap: Record<string, number> = {};
      entries.forEach((e) => {
        totalSize += e.Size || 0;
        if (/\.(disabled|ban)$/i.test(e.Name || "")) banned++;
        if (e.Hash) hashMap[e.Hash] = (hashMap[e.Hash] || 0) + 1;
      });
      const dupGroups = Object.values(hashMap).filter((c) => c > 1).length;
      const dupTotal = Object.values(hashMap).reduce(
        (s, c) => s + (c > 1 ? c - 1 : 0),
        0,
      );

      // 仓库评分评分
      let score = 100;
      if (entries.length > 0) {
        const banPenalty = Math.round((banned / entries.length) * SCORE_BAN_PENALTY);
        const dupPenalty = Math.min(dupTotal * SCORE_DUP_PENALTY, SCORE_DUP_PENALTY_CAP);
        score = Math.max(0, 100 - banPenalty - dupPenalty);
      }
      const healthColor =
        score >= SCORE_HEALTH_GOOD
          ? "var(--free)"
          : score >= SCORE_HEALTH_OK
            ? "var(--tag-amber)"
            : "var(--paid)";
      const healthLabel =
        score >= SCORE_HEALTH_GOOD ? t("oldest.health.good") : score >= SCORE_HEALTH_OK ? t("oldest.health.ok") : t("oldest.health.bad");
      const healthTagClass =
        score >= SCORE_HEALTH_GOOD ? "good" : score >= SCORE_HEALTH_OK ? "ok" : "bad";

      // 热力图
      const monthCounts = buildMonthHeatmap(entries);
      const maxMonth = Math.max(1, ...monthCounts);
      const heatmapHtml =
        '<div style="display:flex;gap:4px;justify-content:center;align-items:end;padding:4px 0;min-height:48px">' +
        monthCounts
          .map((c, i) => {
            const pct = c / maxMonth;
            const ht = HEATMAP_BASE_HT + Math.round(pct * HEATMAP_MAX_EXTRA);
            const color =
              c === 0
                ? "var(--bd)"
                : pct > HEATMAP_STRONG
                  ? "var(--free)"
                  : pct > HEATMAP_MID
                    ? "var(--tag-amber)"
                    : "var(--paid)";
            const nowYear = new Date().getFullYear();
            const monthLabel = esc(
              new Date(nowYear, i, 1).toLocaleDateString("zh-CN", {
                month: "short",
              }),
            );
            return (
              '<div class="heatmap-bar-wrap">' +
              '<div class="heatmap-bar" style="height:' +
              ht +
              "px;background:" +
              color +
              '" title="' +
              t("oldest.heatmapTip", { month: monthLabel, count: c }) +
              '"></div>' +
              '<span class="heatmap-bar-label">' +
              monthLabel +
              "</span></div>"
            );
          })
          .join("") +
        "</div>";

      // 资历最深
      const sorted = [...entries]
        // P4（审核发现）：`filter(e => e.ModTime)` truthiness 把合法 ModTime=0（epoch）
        // 与 NaN 一并剔出资历最深——显式守卫，语义与热力图/推荐分支一致
        .filter((e) => Number.isFinite(e.ModTime) && e.ModTime > 0)
        .sort((a, b) => a.ModTime - b.ModTime);
      const oldest4 = sorted.slice(0, OLDEST_CARD_COUNT);
      let oldestHtml = "";
      if (oldest4.length) {
        oldestHtml =
          '<div class="oldest-cards-row">' +
          oldest4
            .map((e) => {
              const ageDays = Math.floor((Date.now() - e.ModTime) / MS_PER_DAY);
              const dateStr = new Date(e.ModTime).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
              return (
                '<div class="model-card-sm" style="width:calc(50% - 3px);box-sizing:border-box" data-path="' +
                esc(e.Path || e.Name || "") +
                '" title="' +
                t("oldest.clickDetail", { name: esc(e.Name || "") }) +
                '">' +
                '<div class="oldest-card-name" title="' +
                esc(e.Name || "") +
                '">' +
                renderDisplayName(e.Name) +
                "</div>" +
                '<div class="oldest-card-meta"><span>📏 ' +
                formatBytes(e.Size) +
                "</span><span>📅 " +
                dateStr +
                "</span><span> " +
                t("oldest.daysAgo", { n: ageDays }) +
                "</span></div></div>"
              );
            })
            .join("") +
          "</div>";
      }

      // 每日推荐
      const renderPicks = (): string => {
        // Fisher-Yates 洗牌后取前 3 个，避免重复且简洁可靠
        const shuffled = [...entries];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const total = Math.min(DAILY_PICK_COUNT, shuffled.length);
        const picks: string[] = [];
        for (let i = 0; i < total; i++) {
          const p = shuffled[i];
          if (!p) continue;
          const sizeStr = formatBytes(p.Size);
          const dateStr = p.ModTime
            ? new Date(p.ModTime).toLocaleDateString("zh-CN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "";
          picks.push(
            '<div class="pick-card" data-path="' +
              esc(p.Path || p.Name || "") +
              '" title="' +
              t("oldest.clickDetail", { name: esc(p.Name || "") }) +
              '">' +
              '<div class="name" title="' +
              esc(p.Name || "") +
              '">' +
              renderDisplayName(p.Name) +
              "</div>" +
              '<div class="meta"><span> ' +
              sizeStr +
              "</span>" +
              (dateStr ? "<span> " + dateStr + "</span>" : "") +
              "</div></div>",
          );
        }
        if (!picks.length)
          return '<div style="color:var(--muted);font-size:var(--fs-base)">' + t("oldest.noPicks") + '</div>';
        return (
          '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
          picks.join("") +
          "</div>"
        );
      };

      const reg = await loadResourceRegistry();
      if (gen !== _loadGen) return; // 已切换类型，丢弃过期结果
      const curIcon = (reg[getCurrentType()] && reg[getCurrentType()].icon) || "📦";
      container.innerHTML =
        '<div class="oldest-page">' +
        '<div class="oldest-stats-bar">' +
        '<div class="oldest-health-box">' +
        '<div class="oldest-health-label">📊 ' + t("repo.score") + '</div>' +
        '<div class="oldest-health-ring" style="background:conic-gradient(' +
        healthColor +
        " " +
        score +
        "%, var(--bd) " +
        score +
        '% 100%)">' +
        '<div class="oldest-health-ring-inner">' +
        '<span class="oldest-health-ring-num">' +
        score +
        "</span></div></div>" +
        '<span class="health-tag ' +
        healthTagClass +
        '" style="font-size:var(--fs-sm)">' +
        healthLabel +
        "</span></div>" +
        '<div class="oldest-stats-divider"></div>' +
        '<div class="oldest-stats-row">' +
        '<span class="oldest-stat-pill">' +
        curIcon +
        " " +
        entries.length +
        "</span>" +
        '<span class="oldest-stat-pill">📏 ' +
        formatBytes(totalSize) +
        "</span>" +
        '<span class="oldest-stat-pill"> ' +
        banned +
        "</span>" +
        '<span class="oldest-stat-pill">🔗 ' +
        dupGroups +
        "</span></div></div>" +
        '<div class="oldest-section">' +
        '<div class="oldest-section-title">🏆 ' + t("repo.tab.oldest") + '</div>' +
        '<div style="display:flex;justify-content:center">' +
        oldestHtml +
        "</div></div>" +
        '<div class="oldest-section">' +
        '<div class="oldest-section-title-sm">📅 ' + t("oldest.monthly") + '</div>' +
        heatmapHtml +
        "</div>" +
        '<div class="oldest-section" style="text-align:center">' +
        '<div class="oldest-section-title">🎲 ' + t("oldest.daily") + '</div>' +
        '<div style="display:flex;justify-content:center">' +
        renderPicks() +
        "</div></div></div>";

      // 先移除旧监听再添加，避免重复绑定导致内存泄漏
      container.removeEventListener("click", handleContainerClick);
      container.addEventListener("click", handleContainerClick);
    } catch (err) {
      if (gen !== _loadGen) return; // 已切换类型，丢弃过期结果
      container.innerHTML =
        '<div style="padding:12px;color:var(--status-error);font-size:var(--fs-base)">❌ ' +
        t("resource.loadFailed") +
        ": " +
        esc((err as Error).message || String(err)) +
        "</div>";
    }
  }

  // 监听全局类型切换（收敛至 useCurrentResourceType，索引 4.3）：
  // currentType 初值取 localStorage（持久化权威源，由 app-nav 写入）；运行期以
  // repo:rtype-changed 事件载荷为准，二者一致时不会重复渲染
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => {
    render();
  });

  await render();

  // 返回清理函数
  return () => {
    container.removeEventListener("click", handleContainerClick);
    cleanupRtype();
    // P3 修复（审核发现）：cleanup 后递增代数——若 render 在清理后完成（迟到响应），
    // 仍会向容器写 innerHTML 并重新 addEventListener；容器若被复用则残留点击监听
    // （幽灵路径/泄漏）。递增后任何在途 render 的 gen 比对都会丢弃结果。
    _loadGen++;
  };
}

// ====== 工具函数 ======
function buildMonthHeatmap(entries: ModelEntry[]): number[] {
  const months = new Array(12).fill(0);
  entries.forEach((e) => {
    if (!e.ModTime) return;
    const d = new Date(e.ModTime);
    const m = d.getMonth();
    const now = new Date();
    const yearDiff = now.getFullYear() - d.getFullYear();
    if (yearDiff === 0 || (yearDiff === 1 && d.getMonth() >= now.getMonth())) {
      months[m]++;
    }
  });
  return months;
}

