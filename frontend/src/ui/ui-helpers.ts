// [doc:architecture] UI Helpers — barrel re-export（🥉 组件库，精简版）
// 仅 re-export 本次迁移的 🥉 组件集（ui-slide-row / ui-rows / ui-header-toggle /
// ui-advanced-rows / ui-collapsible / ui-preset / ui-card / ui-loading）。
// 不包含 MikuMikuAR 的 ui-resource-panel / ui-fullscreen-overlay / ui-virtual-grid
// （virtual-grid 已在 utils/core 单独迁移）等未纳入本批的模块。

export type { ControlOptions } from './ui-types.ts';
export { slideRow } from './ui-slide-row.ts';
export type { SlideRowExtra, TrailingAction } from './ui-slide-row.ts';
export {
    initControl,
    addToggleRow,
    addSliderRow,
    addModeRow,
    sliderRow,
    toggleRow,
    addDangerRow,
    addFieldRow,
    addInfoGrid,
    addInfoCard,
    addEmptyRow,
    addCardTitle,
    addWatchDirRow,
    addActionRow,
    addDisabledRow,
    addInlineToggleRow,
    addBoneSelectRow,
    isIkBone,
    buildBoneGroups,
} from './ui-rows.ts';
export type { BoneSelectOptions } from './ui-rows.ts';
export { createHeaderToggle } from './ui-header-toggle.ts';
export type { HeaderToggleConfig } from './ui-header-toggle.ts';
export { addColorSliderRow, addModeSlider, addVector3SliderRow } from './ui-advanced-rows.ts';
export { addCollapsible, addSectionTitle, addPresetChip } from './ui-collapsible.ts';
export { buildPresetChipGroup, addClearRow } from './ui-preset.ts';
export type { PresetChipItem } from './ui-preset.ts';
export { cardContainer } from './ui-card.ts';
export { withLoadingIndicator } from './ui-loading.ts';
export { createSlideMenu } from './ui-slide-menu.ts';
export type { SlideMenuHandle } from './ui-slide-menu.ts';
export { installSlideMenuStyles, slideMenuStyleSheet } from './ui-slide-menu-styles.ts';
