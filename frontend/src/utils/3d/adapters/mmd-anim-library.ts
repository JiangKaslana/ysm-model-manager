// ===== MMD 动作库路径解析（ADR-094 位置路由复用）=====
// 复用 loader.ts 的 MMD 子目录回溯逻辑：GetRepoRoot("EntityPlayer") 返回
// FilesRoot/mmd/EntityPlayer，回溯到 group 根再拼目标子目录，产出绝对路径。
// 各 MMD 类型（EntityPlayer/SceneModel/CustomAnim 等）现为独立顶级类型，
// 直接在所属 group 下平铺，不再通过 subtype 展开。

import { RESOURCE_TYPES } from "../../resource/types.ts";

/** MMD 动作库子目录名（独立顶级类型） */
const ANIM_SUBDIR = "CustomAnim";

/** VMD/VPD 扩展名（MMD 生态动作格式） */
const ANIM_EXTS = [".vmd", ".vpd"];

/**
 * 从 MMD 默认仓库根回溯到 group 根，再拼接目标子目录。
 * 复刻 loader.ts:76-78 的路径构造逻辑，确保导航栏文件树与 3D 预览器路径一致。
 *
 * @param repoRoot GetRepoRoot("EntityPlayer") 返回的路径，如 "FilesRoot/mmd/EntityPlayer"
 * @param subdir 目标子目录名，如 "CustomAnim"
 * @returns 拼接后的绝对路径，如 "FilesRoot/mmd/CustomAnim"
 */
export function resolveMmdSubdirPath(repoRoot: string, subdir: string): string {
  const groupRoot = repoRoot.replace(/[/\\]+$/, "").split(/[/\\]/).slice(0, -1).join("/");
  return groupRoot + "/" + subdir.replace(/^[/\\]+/, "");
}

/**
 * 获取 MMD 动作库（CustomAnim）的绝对路径。
 * 需要运行时 GetRepoRoot 结果，因此异步。
 */
export async function getCustomAnimPath(): Promise<string | null> {
  try {
    const { getApp } = await import("../../../backend/app.ts");
    const { GetRepoRoot } = await getApp();
    const repoRoot = await GetRepoRoot(RESOURCE_TYPES.MMD);
    if (!repoRoot) return null;
    return resolveMmdSubdirPath(repoRoot, ANIM_SUBDIR);
  } catch {
    return null;
  }
}

/** 从文件列表中筛选动作文件（.vmd / .vpd） */
export function filterAnimFiles(files: string[]): string[] {
  return files.filter((p) => {
    const lower = p.toLowerCase();
    return ANIM_EXTS.some((ext) => lower.endsWith(ext));
  });
}

/** 动作库子目录名（导出供 UI 展示） */
export const ANIM_LIB_SUBDIR = ANIM_SUBDIR;