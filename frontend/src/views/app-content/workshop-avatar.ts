// ===== 创作者头像管理 =====
import { getApp } from "../../backend/app.ts";
import { dbg } from "../../utils/debug/debug.ts";
import type { AppContentHost } from "./init-workshop.ts";
import type { LocalCreator } from "./community-data.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import type { RepoAuthorLike } from "./site-view.ts";

/**
 * 提取创作者头像（后台批量）
 */
export async function extractAvatars(
  host: AppContentHost,
  browseMode: string,
  allSites: WorkshopSite[],
  allCreators: LocalCreator[],
  repoAuthors: RepoAuthorLike[],
  wsEditModeRef: { v: boolean },
): Promise<void> {
  try {
    const { BatchExtractCreatorAvatars } = await getApp();
    const result = await BatchExtractCreatorAvatars();
    const avatars = (result || {}) as Record<string, string>;
    const keys = Object.keys(avatars);
    if (keys.length > 0) {
      dbg("avatar", "提取了 " + keys.length + " 个头像: " + keys.join(", "));
      host._setAvatarCache(avatars);
      // 头像更新后触发站点视图刷新（由调用方处理）
    } else {
      dbg("avatar", "无头像可提取（无 .ysm 文件或无 avatar/ 目录）");
    }
  } catch (e) {
    dbg("avatar", "提取失败:", (e as Error)?.message);
  }
}
