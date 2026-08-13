// ===== 骨骼工具函数 =====
/**
 * 面板分区标题（3D overlay 信息面板使用）
 * gap=false 用于面板首个分区（panel 已有 padding-top，避免顶部 10+12=22px 过空）
 */
export function sec(text: string, gap = true): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText =
    "margin-top:" + (gap ? "12px" : "0") + ";margin-bottom:4px;font-weight:600;color:rgba(255,255,255,0.9);font-size:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:3px";
  d.textContent = text;
  return d;
}

/** 信息行：标签 | 值 */
export function iRow(l: string, v: string): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText = "display:flex;justify-content:space-between;padding:2px 0";
  d.innerHTML = `<span style="color:rgba(255,255,255,0.5)">${l}</span><span>${v}</span>`;
  return d;
}

/**
 * 构建骨骼层级深度映射（用于骨骼列表缩进渲染）
 * parentId 为空的骨骼深度为 0，其余递归计算
 */
export function buildDepthMap(boneList: Array<{ id: string; name: string; parentId?: string }>): Record<string, number> {
  const depthMap: Record<string, number> = {};
  const calcDepth = (name: string): number => {
    if (depthMap[name] !== undefined) return depthMap[name];
    const b = boneList.find((x) => x.id === name);
    if (!b || !b.parentId) {
      depthMap[name] = 0;
      return 0;
    }
    depthMap[name] = calcDepth(b.parentId) + 1;
    return depthMap[name];
  };
  boneList.forEach((b) => calcDepth(b.id));
  return depthMap;
}
