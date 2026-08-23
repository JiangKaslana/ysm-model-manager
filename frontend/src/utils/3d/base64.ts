// ===== base64.ts — base64/字节桥共享工具 =====
// 收编 fbx/mmd/vrm/pack 各适配器曾各自复制的 b64ToBytes（Go ReadFileBytes
// 返回 Go []byte 的 base64 序列化，前端统一在此解码）。

/** base64 → Uint8Array（Go []byte 的 base64 序列化） */
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView<ArrayBuffer>，规避 SharedArrayBuffer 泛型） */
export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
