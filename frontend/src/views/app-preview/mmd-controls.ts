// ===== MMD 底部根菜单（§5.7 范式：底部悬浮导航 + 分类弹窗，对齐 YSM buildYsmBottomNav）=====
// 弹窗外壳接入 🥉 ui/ 库 slide-menu 组件（createSlideMenu）；内容按【视图集】组织为两级层级：
//   模型根视图（信息卡 + 表情入口 + 切换模型入口）
//     ├─ 表情子集（55 个 morph 行，点击切换权重 0/1）
//     └─ 切换模型子集（同类型候选，点击经 ctx.switchTo 复用核心外壳重建）
//   摄像机视图（相机控件）/ 材料列表（显隐 + 透明度）为各自一级视图。
// 行组件用 cardContainer / addFieldRow / slideRow；外壳 slide-back 在根级=关闭(✕)、子集=返回(←)。
// 毛玻璃导航样式复用 fab.ts ensureFabStyles（ysm-3d-nav / ysm-3d-navbtn 类）。

import * as THREE from "three";
import type { MMD } from "@moeru/three-mmd";
import { t } from "../../core/i18n/t.ts";
import { ensureFabStyles } from "../../utils/dom/fab.ts";
import { buildCameraControls, type CameraControlBridge } from "../../utils/3d/adapters/mount-preview-core.ts";
import {
  cardContainer,
  addFieldRow,
  slideRow,
  createSlideMenu,
  type SlideMenuView,
} from "../../ui/ui-helpers.ts";
import { resolveMmdSiblings } from "./mmd-siblings.ts";
import {
  listMmdMaterials,
  getMmdMaterialDetail,
  setMmdMaterialVisible,
  setMmdMaterialOpacity,
  type MmdMaterialDetail,
  type MmdMaterialListItem,
} from "../../utils/3d/mmd-materials.ts";

export interface MmdBottomNavCtx {
  mmd: MMD;
  mesh: THREE.SkinnedMesh;
  modelName: string;
  /** 当前模型完整路径（切换区「当前」高亮判断） */
  modelPath?: string;
  /** shared 模式下核心的相机控制桥（视图菜单复用；self 模式 undefined 时降级默认值） */
  cameraControls?: CameraControlBridge;
  /** 切换到另一模型（复用核心外壳重建内容层；undefined 时不渲染切换区） */
  switchTo?(path: string): Promise<void>;
}

/** 在统一外壳（overlay）挂载 MMD 底部悬浮导航 + 分类弹窗（§5.7 范式，对齐 YSM） */
export function buildMmdBottomNav(overlay: HTMLElement, ctx: MmdBottomNavCtx): void {
  ensureFabStyles();

  const nav = document.createElement("div");
  nav.className = "ysm-3d-nav";
  const modelBtn = mkNavBtn("🧍", t("preview.modelInfo"));
  const viewBtn = mkNavBtn("🎥", t("preview.cameraView"));
  const matBtn = mkNavBtn("🎨", t("preview.materialList"));
  nav.appendChild(modelBtn);
  nav.appendChild(viewBtn);
  nav.appendChild(matBtn);
  overlay.appendChild(nav);

  // 定位容器（.ysm-slide-popup）+ slide-menu 卡片外壳（标题栏 + 关闭/返回 + 内容区）
  const popup = document.createElement("div");
  popup.className = "ysm-slide-popup";
  popup.style.display = "none";
  overlay.appendChild(popup);

  const menu = createSlideMenu({ title: t("preview.modelInfo") });
  popup.appendChild(menu.root);

  /** 关闭弹窗（nav 激活态同步 + 导航栈复位）——对齐 YSM closePopup 口径 */
  const closePopup = (): void => {
    popup.style.display = "none";
    menu.reset();
    nav
      .querySelectorAll<HTMLElement>(".ysm-3d-navbtn--on")
      .forEach((b) => b.classList.remove("ysm-3d-navbtn--on"));
  };
  menu.setOnClose(() => closePopup());

  /** 切换弹窗：同菜单再点收起，跨菜单切换内容（对齐 YSM togglePopup 口径）；
   *  经导航栈 home 进入一级视图，关闭时栈已复位，故重新打开恒为根视图。 */
  const openMenu = (view: SlideMenuView, btn: HTMLElement): void => {
    const wasOpen = popup.style.display !== "none";
    const isSame = btn.classList.contains("ysm-3d-navbtn--on");
    closePopup();
    if (wasOpen && isSame) return;
    btn.classList.add("ysm-3d-navbtn--on");
    menu.home(view);
    popup.style.display = "flex";
  };

  /** 表情开/关切换（morphTargetInfluences 权重 0/1），切换后 refresh 重绘当前视图同步高亮 */
  const toggleMorph = (name: string): void => {
    const dict = ctx.mesh.morphTargetDictionary || {};
    const idx = dict[name];
    if (idx === undefined || !ctx.mesh.morphTargetInfluences) return;
    ctx.mesh.morphTargetInfluences[idx] = ctx.mesh.morphTargetInfluences[idx] > 0.5 ? 0 : 1;
    menu.refresh();
  };
  const morphActive = (name: string): boolean => {
    const dict = ctx.mesh.morphTargetDictionary || {};
    const idx = dict[name];
    return idx !== undefined && (ctx.mesh.morphTargetInfluences?.[idx] ?? 0) > 0.5;
  };

  /** 同类型模型候选缓存（类型根固定不随当前模型变，切换后无需刷新；首次进入子集拉取） */
  let siblingsCache: string[] | null = null;

  // ── 模型根视图：信息卡 + 表情入口 + 切换模型入口 ──
  const viewModelRoot: SlideMenuView = {
    title: t("preview.modelInfo"),
    render: (l) => {
      const pmx = ctx.mmd.pmx;
      cardContainer(l, (c) => {
        addFieldRow(c, t("preview.nameLabel"), ctx.modelName);
        addFieldRow(
          c,
          t("preview.modelOverview"),
          `${pmx.bones.length} 骨骼 · ${pmx.materials.length} 材质 · ${pmx.morphs.length} 表情`,
        );
      });
      const morphNames = Object.keys(ctx.mesh.morphTargetDictionary || {});
      if (morphNames.length > 0) {
        slideRow(
          l,
          "😀",
          `${t("preview.mmdMorph")} (${morphNames.length})`,
          true, // 箭头指示可下钻
          () => menu.navigate(viewMorphList),
          undefined,
          undefined,
          false,
          undefined,
          { testId: "mmd-morph-entry" },
        );
      }
      if (ctx.switchTo) {
        slideRow(
          l,
          "📦",
          t("preview.mmdLoadModel"),
          true, // 箭头指示可下钻
          () => menu.navigate(viewSwitchList),
          undefined,
          undefined,
          false,
          undefined,
          { testId: "mmd-switch-entry" },
        );
      }
    },
  };

  // ── 表情子集：55 个 morph 行（点击切换权重，focused 高亮当前开启）──
  const viewMorphList: SlideMenuView = {
    title: `😀 ${t("preview.mmdMorph")}`,
    render: (l) => {
      const morphNames = Object.keys(ctx.mesh.morphTargetDictionary || {});
      morphNames.forEach((name) => {
        slideRow(
          l,
          "🙂",
          name,
          false,
          () => toggleMorph(name),
          undefined,
          undefined,
          morphActive(name), // focused：当前开启的表情高亮
          undefined,
          { testId: "mmd-morph-" + name },
        );
      });
    },
  };

  // ── 切换模型子集：同类型候选列表（resolveMmdSiblings；点击经 ctx.switchTo 复用核心外壳）──
  const viewSwitchList: SlideMenuView = {
    title: `📦 ${t("preview.mmdLoadModel")}`,
    render: (l) => {
      const siblings = siblingsCache;
      if (!siblings) {
        const loading = document.createElement("div");
        loading.className = "slide-sublabel";
        loading.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
        loading.textContent = "加载中…";
        l.appendChild(loading);
        void resolveMmdSiblings().then((s) => {
          siblingsCache = s;
          // 守卫：若用户已返回/切菜单，子集不再是栈顶，则不写入失效 list
          if (menu.isShowing(viewSwitchList)) menu.refresh();
        });
        return;
      }
      if (siblings.length === 0) {
        const empty = document.createElement("div");
        empty.className = "slide-sublabel";
        empty.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
        empty.textContent = "（无同类型模型）";
        l.appendChild(empty);
        return;
      }
      siblings.forEach((p) => {
        const isCurrent = !!ctx.modelPath && p.toLowerCase() === ctx.modelPath.toLowerCase();
        slideRow(
          l,
          "📦",
          p.split(/[/\\]/).pop() || p,
          false,
          () => void ctx.switchTo?.(p),
          undefined,
          undefined,
          isCurrent, // focused：当前模型高亮
          undefined,
          { testId: "mmd-load-" + (p.split(/[/\\]/).pop() || "model") },
        );
      });
    },
  };

  // ── 摄像机视图：相机控件（复用 core cameraControls bridge，对齐 YSM fillViewMenu）──
  const viewCamera: SlideMenuView = {
    title: t("preview.cameraView"),
    render: (l) => {
      buildCameraControls(l, {
        getOrbit: () => ctx.cameraControls?.getOrbit() ?? true,
        setOrbit: (v: boolean) => ctx.cameraControls?.setOrbit(v),
        getSpeed: () => ctx.cameraControls?.getSpeed() ?? 20,
        setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
        reset: () => ctx.cameraControls?.reset(),
      });
    },
  };

  // ── 材料列表视图：显隐 + 透明度（复用 mmd-materials.ts 纯逻辑层，DOM 渲染在视图层，ADR-072）──
  const viewMaterial: SlideMenuView = {
    title: t("preview.materialList"),
    render: (l) => {
      const mats = ctx.mesh.material as unknown as THREE.Material[];
      buildMaterialControls(l, {
        list: () => listMmdMaterials(ctx.mmd.pmx.materials),
        getDetail: (i: number) => getMmdMaterialDetail(ctx.mmd.pmx.materials, mats, i),
        setVisible: (i: number, v: boolean) => setMmdMaterialVisible(mats, i, v),
        setOpacity: (i: number, o: number) => {
          setMmdMaterialOpacity(mats, i, o);
          const m = mats[i];
          if (m) m.needsUpdate = true; // 透明状态变更需重编译着色器
        },
      });
    },
  };

  modelBtn.onclick = (): void => openMenu(viewModelRoot, modelBtn);
  viewBtn.onclick = (): void => openMenu(viewCamera, viewBtn);
  matBtn.onclick = (): void => openMenu(viewMaterial, matBtn);
}

/** 底部导航按钮（毛玻璃 HUD 样式类来自 fab.ts ensureFabStyles） */
function mkNavBtn(icon: string, label: string): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "ysm-3d-navbtn";
  btn.innerHTML = `<span class="ysm-ic">${icon}</span><span class="ysm-3d-navlabel">${label}</span>`;
  return btn;
}

/** 材质控制桥：复用 mmd-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在视图层（ADR-072） */
export interface MaterialControlBridge {
  /** 材质清单（index 与 mesh.material 对齐） */
  list(): MmdMaterialListItem[];
  /** 材质详情（当前可见/透明） */
  getDetail(index: number): MmdMaterialDetail | null;
  /** 设置显隐（Material.visible） */
  setVisible(index: number, visible: boolean): void;
  /** 设置透明度（0-1，联动 transparent） */
  setOpacity(index: number, opacity: number): void;
}

/**
 * 在 container 渲染 MMD 材质面板：每行 = 显隐开关（👁/🚫）+ 名称 + 透明度滑条。
 * 复用 🥉 slide-item 行样式，控件走行内样式（对齐 buildCameraControls 口径）。
 * 纯渲染层——所有状态变更经 bridge 下沉到 mmd-materials.ts，本函数零业务逻辑。
 */
export function buildMaterialControls(container: HTMLElement, bridge: MaterialControlBridge): void {
  const items = bridge.list();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "slide-sublabel";
    empty.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
    empty.textContent = "（无材质）";
    container.appendChild(empty);
    return;
  }
  items.forEach((it) => {
    const detail = bridge.getDetail(it.index);
    const visible = detail?.visible ?? true;
    const opacity = Math.round((detail?.opacity ?? 1) * 100);

    const row = document.createElement("div");
    row.className = "slide-item mmd-mat-row";
    row.setAttribute("data-testid", "mmd-mat-" + it.index);
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "mmd-mat-eye";
    eye.title = visible ? "隐藏" : "显示";
    eye.textContent = visible ? "👁" : "🚫";
    eye.style.cssText =
      "flex:0 0 auto;background:none;border:none;cursor:pointer;font-size:14px;padding:0 6px 0 0;line-height:1";
    eye.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      const cur = bridge.getDetail(it.index)?.visible ?? true;
      bridge.setVisible(it.index, !cur);
      const nv = bridge.getDetail(it.index)?.visible ?? true;
      eye.textContent = nv ? "👁" : "🚫";
      eye.title = nv ? "隐藏" : "显示";
    };

    const label = document.createElement("span");
    label.className = "slide-label";
    label.textContent = it.name;
    label.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0";

    const op = document.createElement("input");
    op.type = "range";
    op.min = "0";
    op.max = "100";
    op.value = String(opacity);
    op.className = "mmd-mat-op";
    op.setAttribute("data-testid", "mmd-mat-op-" + it.index);
    op.style.cssText = "flex:0 0 auto;width:72px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
    op.oninput = (): void => {
      bridge.setOpacity(it.index, Number(op.value) / 100);
    };
    op.onclick = (e: MouseEvent): void => e.stopPropagation();

    row.appendChild(eye);
    row.appendChild(label);
    row.appendChild(op);
    row.onclick = (): void => {
      eye.click();
    };
    container.appendChild(row);
  });
}
