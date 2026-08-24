// ===== sidebar 渲染层 =====
import { instanceCardHeaderHTML } from "./tpl.ts";
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
    const card = document.createElement("div");
    card.className = "instance-card";
    card.dataset.idx = String(idx);
    card.style.animationDelay = `${idx * 40}ms`;
    card.innerHTML = instanceCardHeaderHTML(
      ins.name,
      ins.synced,
      ins.missing,
      ins.extra,
      ins.status,
      idx,
      ins.hasMod,
      ins.rtype || currentRepoType(),
    );
    container.appendChild(card);
  });
}
