// [doc:architecture] UI Helpers — barrel re-export（🥉 组件库，精简版）
// 仅 re-export 本次迁移的 🥉 组件集（ui-slide-row / ui-rows / ui-header-toggle /
// ui-advanced-rows / ui-preset / ui-card / ui-loading）。
// 不包含 MikuMikuAR 的 ui-resource-panel / ui-fullscreen-overlay / ui-virtual-grid
// （virtual-grid 已在 utils/core 单独迁移）等未纳入本批的模块。
//
// 2026-08-23 清理：删除 18 个无消费方 re-export（ui-rows 11：addModeRow/sliderRow/
// addDangerRow/addInfoGrid/addInfoCard/addEmptyRow/addCardTitle/addWatchDirRow/
// addActionRow/addDisabledRow/addInlineToggleRow；ui-collapsible 3；ui-preset 3；
// ui-slide-menu-styles 2）+ 4 个未使用 type（SlideRowExtra/TrailingAction/
// HeaderToggleConfig/PresetChipItem）——保留有消费方的 14 值 + 3 type
// （deadcode-baseline 同步刷新，见 scripts/check-deadcode-baseline.mjs）。

export type { ControlOptions } from './ui-types.ts';
export { slideRow } from './ui-slide-row.ts';
export {
    initControl,
    addToggleRow,
    addSliderRow,
    toggleRow,
    addFieldRow,
} from './ui-rows.ts';
export { createHeaderToggle } from './ui-header-toggle.ts';
export { addColorSliderRow, addModeSlider, addVector3SliderRow } from './ui-advanced-rows.ts';
export { cardContainer } from './ui-card.ts';
export { withLoadingIndicator } from './ui-loading.ts';
export { createSlideMenu } from './ui-slide-menu.ts';
export type { SlideMenuHandle, SlideMenuView } from './ui-slide-menu.ts';
