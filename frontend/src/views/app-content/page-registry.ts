// ===== 页面路由注册表（抽出 _render 的 switch，ADR-040 延伸）=====
// 新增页面只需在此处添加一行，无需触碰 _render()。
// 每项定义：html（模板函数）+ init（页面初始化函数）。

import {
  repositoryHTML,
  instancesHTML,
  settingsHTML,
  diagnosticsHTML,
  workshopHTML,
  githubHTML,
} from "./tpl.ts";
import {
  initRepositoryPage,
  initInstancesPage,
  initSettingsPage,
  initWorkshopPage,
  initGithubPage,
  initDiagnosticsPage,
} from "./init-pages.ts";
import type { AppContentHost } from "./init-workshop.ts";

export interface PageDefinition {
  html: () => string;
  // init 接收组件实例（统一 AppContentHost 接口，单一事实源在 init-workshop.ts）。
  // 可 async（如 settings）；调用方负责 reject 转 toast（ADR-044 ①异步范式）。
  init: (host: AppContentHost) => void | Promise<void>;
}

export const PAGE_REGISTRY: Record<string, PageDefinition> = {
  repository:   { html: repositoryHTML,  init: initRepositoryPage },
  instances:    { html: instancesHTML,   init: initInstancesPage },
  workshop:     { html: workshopHTML,    init: initWorkshopPage },
  github:       { html: githubHTML,      init: initGithubPage },
  diagnostics:  { html: diagnosticsHTML, init: initDiagnosticsPage },
  oldest:       { html: diagnosticsHTML, init: initDiagnosticsPage }, // 复用诊断页
  settings:     { html: settingsHTML,    init: initSettingsPage },
};
