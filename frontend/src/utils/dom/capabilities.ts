// ===== 能力门控（ADR-071 后收敛）=====
// 统一判断当前平台是否可用指定 binding——收敛散落的 isViewerMode()/resolveWebMode()
// 守卫（审计：browser-adapter has trap 设计完备但全 UI 无消费方）。
// 三级分层：
//   - 桌面（__YSM_BACKEND__="go" 或非 viewer）：Go 桥恒可用 → true
//   - 网页版（resolveWebMode）：browserAdapter has trap 探测（"X" in browserAdapter，
//     未实现 binding 返回 false → 能力门控隐藏对应 UI）
//   - Android viewer：无本地文件系统写能力 → false（Android 桥无对应 binding）
import { readDeclaredBackend, resolveWebMode } from "../../backend/platform.ts";
import { browserAdapter } from "../../backend/browser-adapter.ts";
import { getAndroidBridge } from "./android-bridge.ts";

/** 当前平台是否可用指定 binding（web 查 adapter 实现；桌面恒 true；Android viewer 假） */
export function can(binding: string): boolean {
  if (readDeclaredBackend() === "go") return true;
  if (resolveWebMode()) return binding in browserAdapter;
  // Android viewer：getAndroidBridge() 非 null → 无本地 FS 写，返回 false
  return getAndroidBridge() === null;
}
