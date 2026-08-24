// ===== 能力门控（ADR-071 后收敛）=====
// 统一判断当前平台是否可用指定 binding——收敛散落的 isViewerMode()/resolveWebMode()
// 守卫（审计：browser-adapter has trap 设计完备但全 UI 无消费方）。
// 三级分层：
//   - 桌面（__YSM_BACKEND__="go" 或非 viewer）：Go 桥恒可用 → true
//   - 网页版（resolveWebMode）：browserAdapter has trap 探测（"X" in browserAdapter，
//     未实现 binding 返回 false → 能力门控隐藏对应 UI）
//   - Android viewer：Go binding 全量可达（经 window.wails → @wailsio/runtime → Go，
//     授权 MANAGE_EXTERNAL_STORAGE 后 os.* 直读公共仓库），仅排除桌面专属/无意义项
//     （见 ANDROID_UNAVAILABLE，蓝本 = Android 平台守卫 go-android-platform-guard.md）
// 消费方清单（新增消费方前核对语义为「该 binding 当前平台是否可用」，勿误作查看器
// 模式判定）：app-nav/index.ts:83（ListVersionInstances）、app-tree/bus-handlers.ts、
// app-tree/events.ts、app-tree/index.ts（如 OpenFileDialog 等）。
import { readDeclaredBackend, resolveWebMode } from "../../backend/platform.ts";
import { browserAdapter } from "../../backend/browser-adapter.ts";
import { getAndroidBridge } from "./android-bridge.ts";

// Android 桌面专属/无意义 binding 黑名单。蓝本 = go-android-platform-guard.md
// （Go 侧 Android 平台守卫）：RevealInExplorer/OpenFolder/RestartApplication 显式拒绝；
// ListVersionInstances 无 MC 整合包目录扫描（Android scanMinecraftDirsPlatform 空实现）。
// 其余 Go binding 在 Android 授权公共目录下均可用（读+写），不得再一刀切 false。
const ANDROID_UNAVAILABLE = new Set([
  "RevealInExplorer",
  "OpenFolder",
  "RestartApplication",
  "ListVersionInstances",
]);

/** 当前平台是否可用指定 binding（web 查 adapter 实现；桌面恒 true；Android 查黑名单） */
export function can(binding: string): boolean {
  if (readDeclaredBackend() === "go") return true;
  if (resolveWebMode()) return binding in browserAdapter;
  // 无 Android 桥 → 桌面（Go 桥全量可用）；有桥（Android）→ Go binding 全量可达，
  // 仅桌面专属项不可用
  return getAndroidBridge() === null || !ANDROID_UNAVAILABLE.has(binding);
}
