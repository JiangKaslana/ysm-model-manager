// ===== 3D 骨骼列表（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 提供 spec 中骨骼的只读列表接口。
import type { Spec3D, SpecBone3D } from "./model3d.ts";

/** getBoneList 返回的扁平骨骼信息 */
export interface BoneInfoLite {
  id: string;
  name: string;
  parentId?: string;
}

/**
 * 从 spec 中提取第一组件（main）的骨骼列表。
 * YSM 动画驱动 main 骨骼（spec.models[0]），arm 等组件独立树静止。
 */
export function getBoneList(spec: Spec3D): BoneInfoLite[] {
  return spec.models?.[0]?.bones?.map((b: SpecBone3D) => ({
    id: b.id,
    name: b.name,
    parentId: b.parentId,
  })) || [];
}
