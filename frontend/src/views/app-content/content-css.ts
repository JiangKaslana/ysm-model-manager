// ===== <app-content> 样式组合层（按职责拆分为 5 个域文件）=====
// content-layout   : host 变量 + 通用 keyframes + 骨架 + 通用卡片系统
// content-repo     : 仓库/实例/站点骨架 + 资历页 + 热力图 + 通用标签
// content-creator  : 创作者 .cr-* 全族（标签/频道/卡片/详情/编辑）
// content-diag     : 诊断 + 设置 + GitHub .gh-* + 二级菜单 + 队列
// content-util     : 回收站/资源管理器/预览/主题选择器/响应式
import { contentLayoutCSS } from "./content-layout.ts";
import { contentRepoCSS } from "./content-repo.ts";
import { contentCreatorCSS } from "./content-creator.ts";
import { contentDiagCSS } from "./content-diag.ts";
import { contentUtilCSS } from "./content-util.ts";
import { contentStgCSS } from "./content-stg.ts";
export const contentCSS: string = [
  contentLayoutCSS,
  contentRepoCSS,
  contentCreatorCSS,
  contentDiagCSS,
  contentUtilCSS,
  contentStgCSS,
].join("\n");
