// ===== sidebar 渲染层 =====
import { vcHeaderHTML } from "./tpl.ts";
import type { SidebarInstance } from "./data.ts";
import { t } from "../../core/i18n/t.ts";
import { currentRepoType } from "../../features/repo-rtype.ts";

// 渲染所有整合包卡片到容器
export function renderVersionCards(
  container: HTMLElement,
  instances: SidebarInstance[],
): void {
  container.innerHTML = "";
  if (!instances.length) {
    container.innerHTML =
      '<div class="ws-empty" style="padding:24px">🔍 ' + t("sidebar.noMatchInstances") + '</div>';
    return;
  }
  instances.forEach((ins, idx) => {
    const vc = document.createElement("div");
    vc.className = "vc";
    vc.dataset.idx = String(idx);
    vc.style.animationDelay = `${idx * 40}ms`;
    vc.innerHTML = vcHeaderHTML(
      ins.name,
      ins.synced,
      ins.missing,
      ins.extra,
      ins.status,
      idx,
      ins.hasMod,
      ins.rtype || currentRepoType(),
    );
    container.appendChild(vc);
  });
}
