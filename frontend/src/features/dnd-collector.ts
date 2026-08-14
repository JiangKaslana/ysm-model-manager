// ===== DnD 文件收集器（桌面 webkitGetAsEntry 路径）=====
// 被 import-dnd.ts（仓库页全局拖拽）与 import-queue-data.ts（导入页队列拖拽）共用，
// 消除 ADR-060 立项前的两套收集器漂移问题。

/** 收集结果条目 */
export interface CollectedFile {
  file: File;
  relPath: string;
}

const FILE_ENTRY_TIMEOUT = 5000;
const READ_ENTRIES_TIMEOUT = 3000;
const MAX_DEPTH = 10;

/** 把 FileSystemFileEntry 转为 Promise<File>，带超时兜底 */
function getFileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("getFileFromEntry timeout"));
    }, FILE_ENTRY_TIMEOUT);
    entry.file(
      (f) => { clearTimeout(timer); resolve(f); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * 递归收集 DataTransferItem[] 或 FileSystemEntry[] 中的文件。
 * - isEntryArray=true 时 items 为 FileSystemEntry[]（递归子目录场景）
 * - isEntryArray=false 时 items 为 DataTransferItem[]（顶层 drop 场景）
 * depth > MAX_DEPTH 时停止递归防卡顿；readEntries 3s 超时防 WebView2 卡死。
 */
export async function collectFiles(
  items: DataTransferItem[] | FileSystemEntry[],
  isEntryArray: boolean,
  basePath = "",
): Promise<CollectedFile[]> {
  const result: CollectedFile[] = [];
  for (const item of items) {
    if (!item) continue;
    if (!isEntryArray && (item as DataTransferItem).kind !== "file") continue;
    const entry =
      (item as DataTransferItem).webkitGetAsEntry?.() ||
      (isEntryArray ? (item as FileSystemEntry) : null);
    if (entry?.isDirectory) {
      const subPath = basePath ? basePath + "/" + entry.name : entry.name;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        let settled = false;
        const done = (v: FileSystemEntry[]): void => {
          if (settled) return;
          settled = true;
          resolve(v);
        };
        reader.readEntries(
          (entries) => done(entries || []),
          () => {
            console.warn("[dnd-collector] 目录读取失败，跳过:", entry.name);
            done([]);
          },
        );
        setTimeout(() => done([]), READ_ENTRIES_TIMEOUT);
      });
      if (batch.length && basePath.length < MAX_DEPTH * 100) {
        const deeper = await collectFiles(batch, true, subPath);
        result.push(...deeper);
      }
    } else if (entry?.isFile) {
      const relPath = basePath ? basePath + "/" + entry.name : entry.name;
      try {
        result.push({
          file: await getFileFromEntry(entry as FileSystemFileEntry),
          relPath,
        });
      } catch (e) {
        console.warn("[dnd-collector] 单文件读取失败，已跳过:", relPath, e);
      }
    } else if ((item as DataTransferItem).getAsFile) {
      // fallback: 浏览器不支持 webkitGetAsEntry 时用 getAsFile
      const f = (item as DataTransferItem).getAsFile();
      if (f) result.push({ file: f, relPath: f.name });
    }
  }
  return result;
}

/**
 * 从 DropEvent 聚合 collected 条目：
 * 1. 先走 webkitGetAsEntry 路径（支持文件夹递归）；
 * 2. 合并 dataTransfer.files 兜底（WebView2 受限场景），按 name+size+lastModified 去重；
 * 3. 若最终仍为空，回退到纯 files 列表。
 */
