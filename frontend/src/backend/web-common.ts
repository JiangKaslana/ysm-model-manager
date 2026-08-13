// ===== 网页版后端共享原语（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 本文件存放 web-fs / web-store / web-community 三者共用的极小原语（错误类 + 常量 +
// 编码函数），避免新文件间互相依赖对方或回引 browser-adapter.ts 造成循环引用
// （对齐 types.ts「独立文件避免循环引用」的既有做法）。
// browser-adapter.ts 从本文件 re-export，保持对外 API 导出名/签名不变。

/** 网页版专属错误：binding 浏览器端未实现（Phase 3 能力门控隐藏对应 UI） */
export class WebUnsupportedError extends Error {
  constructor(binding: string) {
    super(`[web] binding ${binding} 浏览器端未实现（ADR-049 Phase 3：能力门控隐藏对应 UI）`);
    this.name = "WebUnsupportedError";
  }
}

/** 网页版虚拟仓库根（路径语义与桌面一致：/web/<type>/<name>/<rel>） */
export const WEB_ROOT = "/web";

/** 导入大小上限 100MB（对齐 import-dnd.ts MAX_FILE_SIZE，桌面 oversize 过滤同口径） */
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;

/** ArrayBuffer → base64（分块，大文件避免栈溢出） */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
