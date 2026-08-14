// ===== extract.ts 契约测试 =====
// 覆盖：detectZipType / parseZipCentralDir / extractZip / GBK 解码
import { describe, it, expect } from "vitest";
import {
  detectZipType,
  parseZipCentralDir,
  extractZip,
  gbkDecodeEntry,
  type ZipEntryMeta,
  type ZipType,
} from "./extract.ts";

// --- ZIP 构造工具 ---

/** 构造最小 ZIP：STORE 压缩，单个 entry */
function buildMinimalZip(name: string, data: Uint8Array, utf8Flag: boolean = false): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const gpf = utf8Flag ? 0x800 : 0;

  // Local File Header (30 + nameLen + extraLen(0) + dataSize)
  const lfh = new Uint8Array(30);
  const lfhDv = new DataView(lfh.buffer);
  lfhDv.setUint32(0, 0x04034b50, true); // signature
  lfhDv.setUint16(4, 20, true); // version needed
  lfhDv.setUint16(6, gpf, true); // gpf
  lfhDv.setUint16(8, 0, true); // compression (STORE)
  lfhDv.setUint16(14, 0, true); // mod time
  lfhDv.setUint16(16, 0, true); // mod date
  lfhDv.setUint32(18, data.length, true); // compressed size
  lfhDv.setUint32(22, data.length, true); // uncompressed size
  lfhDv.setUint16(26, nameBytes.length, true); // name length
  lfhDv.setUint16(28, 0, true); // extra length

  // Central Directory Entry (46 + nameLen + extraLen(0) + commentLen(0))
  const cde = new Uint8Array(46);
  const cdeDv = new DataView(cde.buffer);
  cdeDv.setUint32(0, 0x02014b50, true); // signature
  cdeDv.setUint16(4, 20, true); // version made by
  cdeDv.setUint16(6, 20, true); // version needed
  cdeDv.setUint16(8, gpf, true); // gpf
  cdeDv.setUint16(10, 0, true); // compression
  cdeDv.setUint16(12, 0, true); // mod time
  cdeDv.setUint16(14, 0, true); // mod date
  cdeDv.setUint32(16, 0, true); // crc32
  cdeDv.setUint32(20, data.length, true); // compressed size
  cdeDv.setUint32(24, data.length, true); // uncompressed size
  cdeDv.setUint16(28, nameBytes.length, true); // name length
  cdeDv.setUint16(30, 0, true); // extra length
  cdeDv.setUint16(32, 0, true); // comment length
  cdeDv.setUint16(34, 0, true); // disk number
  cdeDv.setUint16(36, 0, true); // internal attrs
  cdeDv.setUint32(38, 0, true); // external attrs
  cdeDv.setUint32(42, 0, true); // local header offset

  // End of Central Directory (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdDv = new DataView(eocd.buffer);
  eocdDv.setUint32(0, 0x06054b50, true); // signature
  eocdDv.setUint16(4, 0, true); // disk number
  eocdDv.setUint16(6, 0, true); // start disk
  eocdDv.setUint16(8, 1, true); // entries on disk
  eocdDv.setUint16(10, 1, true); // total entries
  eocdDv.setUint32(12, cde.length + nameBytes.length, true); // CDE size
  eocdDv.setUint32(16, lfh.length + nameBytes.length + data.length, true); // CDE offset
  eocdDv.setUint16(20, 0, true); // comment length

  // Assemble: LFH + name + data + CDE + name + EOCD
  const total = lfh.length + nameBytes.length + data.length + cde.length + nameBytes.length + eocd.length;
  const zip = new Uint8Array(total);
  let offset = 0;
  zip.set(lfh, offset); offset += lfh.length;
  zip.set(nameBytes, offset); offset += nameBytes.length;
  zip.set(data, offset); offset += data.length;
  zip.set(cde, offset); offset += cde.length;
  zip.set(nameBytes, offset); offset += nameBytes.length;
  zip.set(eocd, offset);

  return zip;
}

/** 构造含多 entry 的 ZIP */
function buildMultiEntryZip(entries: Array<{ name: string; data: Uint8Array; utf8?: boolean }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const cdeParts: Uint8Array[] = [];
  let localHeaderOffset = 0;
  let totalCdeSize = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const gpf = entry.utf8 ? 0x800 : 0;
    const data = entry.data;

    // Local File Header
    const lfh = new Uint8Array(30);
    const lfhDv = new DataView(lfh.buffer);
    lfhDv.setUint32(0, 0x04034b50, true);
    lfhDv.setUint16(4, 20, true);
    lfhDv.setUint16(6, gpf, true);
    lfhDv.setUint16(8, 0, true);
    lfhDv.setUint16(14, 0, true);
    lfhDv.setUint16(16, 0, true);
    lfhDv.setUint32(18, data.length, true);
    lfhDv.setUint32(22, data.length, true);
    lfhDv.setUint16(26, nameBytes.length, true);
    lfhDv.setUint16(28, 0, true);

    // Central Directory Entry
    const cde = new Uint8Array(46);
    const cdeDv = new DataView(cde.buffer);
    cdeDv.setUint32(0, 0x02014b50, true);
    cdeDv.setUint16(4, 20, true);
    cdeDv.setUint16(6, 20, true);
    cdeDv.setUint16(8, gpf, true);
    cdeDv.setUint16(10, 0, true);
    cdeDv.setUint16(12, 0, true);
    cdeDv.setUint16(14, 0, true);
    cdeDv.setUint32(16, 0, true);
    cdeDv.setUint32(20, data.length, true);
    cdeDv.setUint32(24, data.length, true);
    cdeDv.setUint16(28, nameBytes.length, true);
    cdeDv.setUint16(30, 0, true);
    cdeDv.setUint16(32, 0, true);
    cdeDv.setUint16(34, 0, true);
    cdeDv.setUint16(36, 0, true);
    cdeDv.setUint32(38, 0, true);
    cdeDv.setUint32(42, localHeaderOffset, true);

    parts.push(lfh, nameBytes, data);
    cdeParts.push(cde, nameBytes);
    localHeaderOffset += lfh.length + nameBytes.length + data.length;
    totalCdeSize += cde.length + nameBytes.length;
  }

  // End of Central Directory
  const eocd = new Uint8Array(22);
  const eocdDv = new DataView(eocd.buffer);
  eocdDv.setUint32(0, 0x06054b50, true);
  eocdDv.setUint16(8, entries.length, true);
  eocdDv.setUint16(10, entries.length, true);
  eocdDv.setUint32(12, totalCdeSize, true);
  eocdDv.setUint32(16, localHeaderOffset, true);
  eocdDv.setUint16(20, 0, true);

  const total = parts.reduce((s, p) => s + p.length, 0) +
    cdeParts.reduce((s, p) => s + p.length, 0) + eocd.length;
  const zip = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { zip.set(p, offset); offset += p.length; }
  for (const p of cdeParts) { zip.set(p, offset); offset += p.length; }
  zip.set(eocd, offset);

  return zip;
}

// --- detectZipType ---

describe("detectZipType", () => {
  it("含 ysm.json 的 ZIP → ysm", () => {
    const zip = buildMinimalZip("ysm.json", new TextEncoder().encode("{}"));
    expect(detectZipType(zip)).toBe("ysm");
  });

  it("含 models/ 前缀的 ZIP → ysm", () => {
    const zip = buildMinimalZip("models/main.json", new TextEncoder().encode("{}"));
    expect(detectZipType(zip)).toBe("ysm");
  });

  it("含 pack.mcmeta 的 ZIP → resourcepack", () => {
    const zip = buildMinimalZip("pack.mcmeta", new TextEncoder().encode("{}"));
    expect(detectZipType(zip)).toBe("resourcepack");
  });

  it("含 shaders/ 前缀的 ZIP → shaderpack", () => {
    const zip = buildMinimalZip("shaders/minecraft.json", new TextEncoder().encode("{}"));
    expect(detectZipType(zip)).toBe("shaderpack");
  });

  it("无可识别文件的 ZIP → ysm（保守默认）", () => {
    const zip = buildMinimalZip("readme.txt", new Uint8Array([0x52, 0x45, 0x41, 0x44]));
    expect(detectZipType(zip)).toBe("ysm");
  });

  it("多 entry 优先命中首个识别特征", () => {
    const zip = buildMultiEntryZip([
      { name: "readme.txt", data: new Uint8Array(4) },
      { name: "ysm.json", data: new Uint8Array(2) },
    ]);
    expect(detectZipType(zip)).toBe("ysm");
  });
});

// --- parseZipCentralDir ---

describe("parseZipCentralDir", () => {
  it("UTF-8 文件名（gpf bit 11 设）→ fflateKey 正确", () => {
    const zip = buildMinimalZip("ysm.json", new Uint8Array(2), true);
    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    expect(metas[0].fflateKey).toBe("ysm.json");
    expect(metas[0].gpfUtf8).toBe(true);
  });

  it("Latin-1 文件名（gpf bit 11 未设）→ fflateKey = Latin-1 解码", () => {
    const zip = buildMinimalZip("ysm.json", new Uint8Array(2), false);
    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    expect(metas[0].fflateKey).toBe("ysm.json");
    expect(metas[0].gpfUtf8).toBe(false);
  });

  it("多 entry 全部解析", () => {
    const zip = buildMultiEntryZip([
      { name: "ysm.json", data: new Uint8Array(2) },
      { name: "models/main.json", data: new Uint8Array(4) },
      { name: "textures/skin.png", data: new Uint8Array(8) },
    ]);
    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(3);
    expect(metas[0].fflateKey).toBe("ysm.json");
    expect(metas[1].fflateKey).toBe("models/main.json");
    expect(metas[2].fflateKey).toBe("textures/skin.png");
  });

  it("无效 ZIP → 空数组（过短）", () => {
    const metas = parseZipCentralDir(new Uint8Array([0, 1, 2, 3]));
    expect(metas).toHaveLength(0);
  });

  it("无效 ZIP → 空数组（≥22B 但无 EOCD 签名，不抛 RangeError）", () => {
    // 60000 字节的垃圾数据，无 0x06054b50 签名 → eocd 递减到 searchStart 以下
    // 修复前：dv.getUint32(-1) 抛 RangeError；修复后：提前返回空数组
    const garbage = new Uint8Array(60000);
    for (let i = 0; i < 60000; i++) garbage[i] = i & 0xff;
    const metas = parseZipCentralDir(garbage);
    expect(metas).toHaveLength(0);
  });

  it("detectZipType 非 LFH 魔数 → break 终止循环", () => {
    // 构造含非 LFH 魔数的数据：PK\x03\x04 后跟着垃圾字节，第二次读取时签名不匹配
    const data = new Uint8Array(60);
    data[0] = 0x50; data[1] = 0x4b; data[2] = 0x03; data[3] = 0x04;
    // local file header 需要 30 字节 + 文件名，这里故意不填全，第 4 字节后直接垃圾
    for (let i = 4; i < 60; i++) data[i] = 0xff;
    // 第一个 LFH 签名有效，读取 nameLen(0xff00) 后发现 nameStart+nameLen 超出范围 → break
    expect(detectZipType(data)).toBe("ysm");
  });
});

// --- extractZip ---

describe("extractZip", () => {
  it("正常解压", () => {
    const zip = buildMinimalZip("ysm.json", new Uint8Array([0x7b, 0x7d]));
    const result = extractZip(zip);
    expect(result.entries).toEqual({ "ysm.json": expect.any(Uint8Array) });
    expect(result.entries["ysm.json"]).toEqual(new Uint8Array([0x7b, 0x7d]));
  });

  it("解压后 entries 与 metas 同序", () => {
    const zip = buildMultiEntryZip([
      { name: "ysm.json", data: new Uint8Array([1]) },
      { name: "models/main.json", data: new Uint8Array([2]) },
    ]);
    const result = extractZip(zip);
    expect(result.metas).toHaveLength(2);
    expect(result.entries["ysm.json"]).toBeDefined();
    expect(result.entries["models/main.json"]).toBeDefined();
  });

  it("ZIP 炸弹防护：总大小超限（构造含虚假超大 uncompressedSize 的 ZIP）", () => {
    // 构造一个单 entry ZIP，中央目录中 uncompressedSize 设为 1GB
    // parseZipCentralDir 读到此值 → extractZip 总大小超限
    const nameBytes = new TextEncoder().encode("test.txt");
    const data = new Uint8Array([0x54, 0x45, 0x53, 0x54]);
    const fakeSize = 1024 * 1024 * 1024; // 1GB

    const lfh = new Uint8Array(30);
    const lfhDv = new DataView(lfh.buffer);
    lfhDv.setUint32(0, 0x04034b50, true);
    lfhDv.setUint16(4, 20, true);
    lfhDv.setUint32(18, data.length, true);
    lfhDv.setUint32(22, data.length, true);
    lfhDv.setUint16(26, nameBytes.length, true);

    const cde = new Uint8Array(46);
    const cdeDv = new DataView(cde.buffer);
    cdeDv.setUint32(0, 0x02014b50, true);
    cdeDv.setUint16(4, 20, true);
    cdeDv.setUint16(6, 20, true);
    cdeDv.setUint32(20, data.length, true);
    cdeDv.setUint32(24, fakeSize, true); // 虚假超大
    cdeDv.setUint16(28, nameBytes.length, true);
    cdeDv.setUint32(42, 30 + nameBytes.length + data.length, true);

    const eocd = new Uint8Array(22);
    const eocdDv = new DataView(eocd.buffer);
    eocdDv.setUint32(0, 0x06054b50, true);
    eocdDv.setUint16(8, 1, true);
    eocdDv.setUint16(10, 1, true);
    eocdDv.setUint32(12, 46 + nameBytes.length, true);
    eocdDv.setUint32(16, 30 + nameBytes.length + data.length, true);

    const total = 30 + nameBytes.length + data.length + 46 + nameBytes.length + 22;
    const zip = new Uint8Array(total);
    let off = 0;
    zip.set(lfh, off); off += 30;
    zip.set(nameBytes, off); off += nameBytes.length;
    zip.set(data, off); off += data.length;
    zip.set(cde, off); off += 46;
    zip.set(nameBytes, off); off += nameBytes.length;
    zip.set(eocd, off);

    expect(() => extractZip(zip)).toThrow("解压后总大小");
  });
});

// --- gbkDecodeEntry ---

describe("gbkDecodeEntry", () => {
  it("UTF-8 文件名 → 原样返回", () => {
    const meta: ZipEntryMeta = {
      fflateKey: "ysm.json",
      nameBytes: new TextEncoder().encode("ysm.json"),
      gpfUtf8: true,
      compression: 0,
      compressedSize: 0,
      uncompressedSize: 0,
    };
    const r = gbkDecodeEntry(meta);
    expect(r.realName).toBe("ysm.json");
    expect(r.fflateKey).toBe("ysm.json");
  });
});

// --- 集成场景 ---

describe("集成：GBK 中文文件名 ZIP 解压", () => {
  it("GBK 原始字节 → parseZipCentralDir 正确提取 nameBytes → gbkDecodeEntry 尝试解码", () => {
    // 模拟 Windows GBK 文件名 "角色.png" 的原始字节
    // 角: 0xB1D6 (GBK)  色: 0xB4DC (GBK)  .:0x2E  p:0x70  n:0x6E  g:0x47
    const gbkBytes = new Uint8Array([0xB1, 0xD6, 0xB4, 0xDC, 0x2E, 0x70, 0x6E, 0x67]);
    const data = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG 头

    // 手动构造 ZIP，文件名区域直接写入 GBK 原始字节（gpf bit 11 未设）
    const lfh = new Uint8Array(30);
    const lfhDv = new DataView(lfh.buffer);
    lfhDv.setUint32(0, 0x04034b50, true);
    lfhDv.setUint16(4, 20, true);
    lfhDv.setUint16(6, 0, true); // gpf = 0（未设 UTF-8）
    lfhDv.setUint16(8, 0, true);
    lfhDv.setUint32(18, data.length, true);
    lfhDv.setUint32(22, data.length, true);
    lfhDv.setUint16(26, gbkBytes.length, true);
    lfhDv.setUint16(28, 0, true);

    const cde = new Uint8Array(46);
    const cdeDv = new DataView(cde.buffer);
    cdeDv.setUint32(0, 0x02014b50, true);
    cdeDv.setUint16(4, 20, true);
    cdeDv.setUint16(6, 20, true);
    cdeDv.setUint16(8, 0, true); // gpf = 0
    cdeDv.setUint16(10, 0, true);
    cdeDv.setUint32(20, data.length, true);
    cdeDv.setUint32(24, data.length, true);
    cdeDv.setUint16(28, gbkBytes.length, true);
    cdeDv.setUint16(30, 0, true);
    cdeDv.setUint16(32, 0, true);
    cdeDv.setUint32(42, 30 + gbkBytes.length + data.length, true);

    const eocd = new Uint8Array(22);
    const eocdDv = new DataView(eocd.buffer);
    eocdDv.setUint32(0, 0x06054b50, true);
    eocdDv.setUint16(8, 1, true);
    eocdDv.setUint16(10, 1, true);
    eocdDv.setUint32(12, 46 + gbkBytes.length, true);
    eocdDv.setUint32(16, 30 + gbkBytes.length + data.length, true);
    eocdDv.setUint16(20, 0, true);

    const total = 30 + gbkBytes.length + data.length + 46 + gbkBytes.length + 22;
    const zip = new Uint8Array(total);
    let off = 0;
    zip.set(lfh, off); off += 30;
    zip.set(gbkBytes, off); off += gbkBytes.length;
    zip.set(data, off); off += data.length;
    zip.set(cde, off); off += 46;
    zip.set(gbkBytes, off); off += gbkBytes.length;
    zip.set(eocd, off);

    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    // nameBytes 是原始 GBK 字节
    expect(metas[0].nameBytes).toEqual(gbkBytes);
    // gpfUtf8 = false（gpf bit 11 未设）
    expect(metas[0].gpfUtf8).toBe(false);
    // fflateKey 是 Latin-1 解码的乱码（charCode = 字节值）
    expect(metas[0].fflateKey).toBe(
      String.fromCharCode(0xB1, 0xD6, 0xB4, 0xDC) + ".png"
    );

    // gbkDecodeEntry：gpf 未设时前端无 GBK 码表 → 降级返回 fflateKey 原值
    // （保证数据可访问、key 唯一，nameBytes 保留原始字节供调用方自行解码）
    const decoded = gbkDecodeEntry(metas[0]);
    expect(decoded.realName).toBe(metas[0].fflateKey);
    expect(decoded.fflateKey).toBe(metas[0].fflateKey);
  });
});