// [doc:architecture] UI Helpers — barrel re-export（🥉 组件库，精简版）
// 仅 re-export 当前有消费方的 🥉 组件集。
// 不包含 MikuMikuAR 的 ui-resource-panel / ui-fullscreen-overlay / ui-virtual-grid
// （virtual-grid 已在 utils/core 单独迁移）等未纳入本批的模块。
//
// 2026-08-23 清理：删除 18 个无消费方 re-export（ui-rows 11：addModeRow/sliderRow/
// addDangerRow/addInfoGrid/addInfoCard/addEmptyRow/addCardTitle/addWatchDirRow/
// addActionRow/addDisabledRow/addInlineToggleRow；ui-collapsible 3；ui-preset 3；
// ui-slide-menu-styles 2）+ 4 个未使用 type（SlideRowExtra/TrailingAction/
// HeaderToggleConfig/PresetChipItem）。
//
// 2026-08-26 清理：删除 10 个无消费方 re-export（slideRow/initControl/addToggleRow/
// addSliderRow/toggleRow/createHeaderToggle/addColorSliderRow/addModeSlider/
// addVector3SliderRow/withLoadingIndicator）+ 3 个未使用 type（ControlOptions/
// SlideMenuHandle/SlideMenuView）——消费方均直接从源模块导入
// （deadcode-baseline 同步刷新，见 scripts/check-deadcode-baseline.mjs）。

export { cardContainer } from './ui-card.ts';
export { addFieldRow } from './ui-rows.ts';
export { createSlideMenu } from './ui-slide-menu.ts';
