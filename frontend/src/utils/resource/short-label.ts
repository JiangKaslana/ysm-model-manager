// ===== 资源类型短标签（消除 app-nav / sync-manager 双份重复映射）=====
// 短标签用于紧凑展示（logo、当前类型指示）：YSM/MMD/VRC 用英文短名，
// 其余走 i18n rtype.* key（资源包/光影包/蓝图/投影，含 en/ja 翻译）。
// 与 RESOURCE_TYPE_LABELS（全名，硬编码中文）互补——短标签优先，
// 未命中回退全名（兜底覆盖 maid-model 等新类型，无需改本文件）。

import { t } from "../../core/i18n/t.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "./types.ts";

/** 资源类型短标签映射（仅需 i18n 化的 4 类；YSM/MMD/VRC 为通用英文缩写） */
const SHORT_LABEL_MAP: Record<string, string> = {
  [RESOURCE_TYPES.YSM]: "YSM",
  [RESOURCE_TYPES.MMD]: "MMD",
  [RESOURCE_TYPES.VRC]: "VRC",
  resourcepack: t("rtype.pack"),
  shaderpack: t("rtype.shader"),
  "create-blueprint": t("rtype.blueprint"),
  litematic: t("rtype.litematic"),
};

/** 资源类型短标签：map 命中 → 短名；否则全名（RESOURCE_TYPE_LABELS）→ 原始 id（兜底） */
export function shortLabelOf(rtype: string): string {
  return SHORT_LABEL_MAP[rtype] || RESOURCE_TYPE_LABELS[rtype] || rtype || RESOURCE_TYPES.YSM;
}
