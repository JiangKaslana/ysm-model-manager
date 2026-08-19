export interface ModelEntry {
  name: string;
  size: number;
  path: string;
  ext: string;
  hash: string;
  modTime: number;
  subdir: string;
}

export interface LibrarySnapshot {
  root: string;
  scanMs: number;
  scannedAt: number;
  entries: ModelEntry[];
  warnings: string[];
}

export type SortMode = "modified" | "name" | "size";
export type StatusFilter = "all" | "enabled" | "disabled";
