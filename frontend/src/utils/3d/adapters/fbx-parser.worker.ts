// ===== FBX 解析 Worker（ADR-112）=====
// 直接复用 three 官方 FBXLoader 源码副本（vendor/fbx/FBXLoader.ts，解析逻辑零改动），
// worker 内无权访问 DOM：FBXLoader.parse(FBXBuffer) 在 worker 中产出 THREE.Group，
// 再经 fbxSceneToData 序列化为纯数据回主线程（主线程凭 FbxSceneData 重建场景）。
//
// 纹理：FBXLoader.loadTexture 经 manager.getHandler(`.${extension}`) 命中 loader 后
// 调用 loader.load(fileName)。worker 内无 <img>/ImageBitmap（无 DOM）不能真正解码，
// 注册代理 handler 拦截全部扩展名 → 返回占位纹理 + captureTextureName 登记文件名，
// 主线程按文件名（texUrlMap）用 blob URL 重建真实纹理。

import * as THREE from "three";
import { FBXLoader } from "./vendor/fbx/FBXLoader.ts";
import { fbxSceneToData, captureTextureName, type FbxSceneData } from "./fbx-scene-to-data.ts";
import { safeErrorMessage } from "../../safe-error-msg.ts";

/** 主线程 → Worker 请求 */
export interface FbxParseRequest {
  id: number;
  bytes: ArrayBuffer; // FBX 文件二进制（transferable）
}

/** Worker → 主线程响应 */
export interface FbxParseResponse {
  id: number;
  ok: boolean;
  data?: FbxSceneData;
  error?: string;
}

/** 纹理文件名捕获 handler（继承 Loader 满足基类成员要求，FBXLoader.loadTexture 会调用） */
class TextureNameProxyLoader extends THREE.Loader {
  load(url: string, onLoad?: (tex: THREE.Texture) => void): THREE.Texture {
    const tex = new THREE.Texture();
    const fileName = url.split(/[\\/]/).pop() ?? url;
    captureTextureName(tex, fileName);
    onLoad?.(tex);
    return tex;
  }
}

/** 匹配全部扩展名（.png/.jpg/.tga/.dds/...），保证任何纹理都被捕获而非走 DOM 解码 */
function createTextureCaptureManager(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/^\./, new TextureNameProxyLoader());
  return manager;
}

// ===== Worker 消息处理 =====
self.onmessage = (e: MessageEvent<FbxParseRequest>) => {
  const { id, bytes } = e.data;
  try {
    const loader = new FBXLoader(createTextureCaptureManager());
    const group = loader.parse(bytes, "") as THREE.Group & { animations: THREE.AnimationClip[] };
    const data = fbxSceneToData(group);

    // 转移所有 TypedArray 底层 buffer（避免大模型结构化拷贝）
    const transferables: Transferable[] = [];
    const pushBuffer = (arr: { buffer: ArrayBufferLike } | undefined): void => {
      if (arr) transferables.push(arr.buffer as ArrayBuffer);
    };
    for (const mesh of data.meshes) {
      const g = mesh.geometry;
      pushBuffer(g.position);
      pushBuffer(g.normal);
      pushBuffer(g.uv);
      pushBuffer(g.uv2);
      pushBuffer(g.color);
      pushBuffer(g.skinIndex);
      pushBuffer(g.skinWeight);
      pushBuffer(g.index);
      if (mesh.skeleton) {
        pushBuffer(mesh.skeleton.boneInverses);
        pushBuffer(mesh.skeleton.bindMatrix);
      }
    }
    for (const clip of data.animations) {
      for (const track of clip.tracks) {
        pushBuffer(track.times);
        pushBuffer(track.values);
      }
    }
    const resp: FbxParseResponse = { id, ok: true, data };
    (self as unknown as Worker).postMessage(resp, transferables);
  } catch (err) {
    const resp: FbxParseResponse = { id, ok: false, error: safeErrorMessage(err) };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {};