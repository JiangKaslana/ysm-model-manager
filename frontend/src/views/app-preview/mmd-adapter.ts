// ===== MMD 内容适配器（ADR-066 P2：富格式前端直引 @moeru/three-mmd）=====
// 本文件只负责 MMD 专属逻辑：经 Go 绑定 ReadFileBytes 取 PMX/PMD 字节 →
// MMDLoader（@moeru/three-mmd，parser 自带，无 babylon 依赖）解析 →
// LoadingManager.setURLModifier 把模型同目录纹理映射为 blob URL（Wails 环境
// 浏览器读不了本地磁盘路径）→ 挂入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { MMDLoader } from "@moeru/three-mmd";
import { getApp } from "../../backend/app.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

/** base64 → Uint8Array（ReadFileBytes 返回 Go []byte 的 base64 序列化） */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView<ArrayBuffer>，规避 SharedArrayBuffer 泛型） */
function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 同目录纹理候选扩展名（PMX/PMD 引用的贴图；.spa/.sph 特殊格式 Image 解不了，命中后降级无贴图） */
const TEXTURE_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".tga", ".gif", ".webp"];

interface MmdEntry {
  Name?: string;
  Path?: string;
  Size?: number;
}

/**
 * MMD 内容构建：读 PMX/PMD 字节 + 同目录纹理 → 挂入核心 scene，返回每帧 update + dispose。
 * 成功路径自行移除 loadingEl（对齐 vrm/litematic 既有口径）。
 */
export async function buildMmdScene(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene> {
  ctx.loadingEl.innerHTML =
    '<div style="font-size:32px">🎭</div><div>' + t("preview.loadingModel") + '</div><div style="width:200px;height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden"><div style="height:100%;width:30%;background:var(--accent,#7c83ff);border-radius:2px;animation:ysm-prog 1.5s ease-in-out infinite"></div></div>';

  const App = await getApp();
  const readFn = (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"];
  const b64 = await readFn(path);
  if (!b64) throw new Error("ReadFileBytes 返回空");
  const bytes = b64ToBytes(b64);
  const modelBase = (path.split(/[/\\]/).pop() || "").toLowerCase();

  // ---- 同目录纹理预读：URLModifier 同步接管，必须预先建好 blob URL ----
  const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  const texMap = new Map<string, string>();
  const blobUrls: string[] = [];
  // 模型本体也注册 blob：MMDLoader 内部 FileLoader 从 URL 读字节（WebView2 读不了磁盘路径），
  // URLModifier 拦截模型 URL → blob 后才可加载。
  const modelBlobUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(bytes)]));
  blobUrls.push(modelBlobUrl);
  texMap.set(modelBase, modelBlobUrl);
  try {
    const scanFn = (App as unknown as Record<string, (d: string) => Promise<MmdEntry[] | null>>)["ScanModelEntries"];
    const entries = (await scanFn(dirPath)) || [];
    const texs = entries.filter((e) => {
      const name = (e.Name || "").toLowerCase();
      return name !== modelBase && TEXTURE_EXTS.some((ext) => name.endsWith(ext));
    });
    // 并行预读纹理（避免 N 次串行 RPC 拖慢预览打开；单张失败降级不影响整体）
    await Promise.all(
      texs.map(async (e) => {
        const texB64 = await readFn(e.Path || dirPath + "/" + e.Name);
        if (!texB64) return;
        const blob = new Blob([bytesToArrayBuffer(b64ToBytes(texB64))]);
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        const name = (e.Name || "").toLowerCase();
        texMap.set(name, url);
        // PMX 内纹理路径可能带子目录（如 "sub/face.tga"），注册目录相对路径键
        texMap.set(name.split(/[/\\]/).pop() || "", url);
      }),
    );
  } catch {
    /* 纹理缺失/目录不可扫 → 白模降级，不阻断模型渲染 */
  }

  // ---- URLModifier：模型自身 + 纹理 URL → blob URL（未命中原样返回，toon 内置 dataURL 天然放行）----
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url: string): string => {
    const lower = url.toLowerCase();
    // 最长路径后缀匹配（保留目录上下文：同名纹理在不同子目录时各归其位，basename 冲突兜底）
    let best: string | undefined;
    let bestLen = -1;
    for (const [key, blobUrl] of texMap) {
      if (key.length > bestLen && lower.endsWith(key)) {
        best = blobUrl;
        bestLen = key.length;
      }
    }
    return best ?? url;
  });

  const loader = new MMDLoader(manager);
  let mmd;
  try {
    mmd = await loader.loadAsync(path);
  } catch (e) {
    // 加载失败：回收已建 blob（模型 + 已读纹理），避免 WebView2 会话期内泄漏内存
    for (const url of blobUrls) URL.revokeObjectURL(url);
    throw e;
  }
  const mesh = mmd.mesh;

  ctx.scene!.add(mesh);
  ctx.loadingEl.remove(); // 加载完成，移除占位（对齐 vrm-adapter 口径）

  // 包围盒定相机（MMD Y-up、单位约厘米，原点一般在脚底；尺寸差由相机距离吸收，不缩放模型）
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  ctx.camera!.near = 0.05;
  ctx.camera!.far = maxDim * 50;
  ctx.camera!.position.set(center.x, center.y + size.y * 0.1, center.z + maxDim * 1.6);
  ctx.camera!.updateProjectionMatrix();

  ctx.controls!.target.copy(center);
  ctx.controls!.minDistance = maxDim * 0.1;
  ctx.controls!.maxDistance = maxDim * 12;
  ctx.controls!.update();

  // MMDToon 材质对光有响应，补环境 + 主光 + 半球光（对齐 vrm-adapter 灯位）
  ctx.scene!.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.2);
  dl.position.set(1, 2, 1);
  ctx.scene!.add(dl);
  ctx.scene!.add(new THREE.HemisphereLight(0xffffff, 0x444466, 0.4));

  return {
    // MMD 动态部分（IK/追加变换姿态解算）靠 mmd.update 驱动；静态模型也会摆正初始姿势
    update: (dt: number): void => {
      mmd.update(dt, { ik: true, grant: true });
    },
    // 先回收 blob URL（防御：库 dispose 抛错也不泄漏内存），再释放 MMD 资源（geometry/材质经核心 fullCleanup 防御释放）
    dispose: (): void => {
      for (const url of blobUrls) URL.revokeObjectURL(url);
      mmd.dispose();
    },
  };
}
