import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePMX } from "./mmd-pmx-parser.worker.ts";
import { PmxReader as BabylonPmxReader } from "C:/Users/zhujieling11/babylon-mmd/esm/Loader/Parser/pmxReader.js";

const REAL_PMX = "D:/YSM管理器测试文件夹/mmd/EntityPlayer/[vup]子言-水手服(纯黑水手服-地雷系-墨绿发)[VUP曼云]1.2/[vup]子言-水手服-馬尾版(纯黑水手服-地雷系-墨绿发)[VUP曼云]1.2.pmx";

describe("法线/UV ground truth 对比", () => {
  it("前 10 顶点法线与 UV 逐项对比", async () => {
    const buf = readFileSync(REAL_PMX);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const pmx = await BabylonPmxReader.ParseAsync(ab);
    const out = parsePMX(ab);
    expect(out.ok).toBe(true);
    const n = out.vertices!.normals;
    const u = out.vertices!.uvs;
    let nDiff = 0, uDiff = 0;
    for (let i = 0; i < 30; i++) {
      const bn = pmx.vertices[i].normal;
      const bu = pmx.vertices[i].uv;
      if (Math.abs(bn[0] - n[i*3]) > 1e-4 || Math.abs(bn[1] - n[i*3+1]) > 1e-4 || Math.abs(bn[2] - n[i*3+2]) > 1e-4) nDiff++;
      if (Math.abs(bu[0] - u[i*2]) > 1e-4 || Math.abs(bu[1] - u[i*2+1]) > 1e-4) uDiff++;
    }
    console.log("前30 法线不一致:", nDiff, "UV 不一致:", uDiff);
    console.log("babylon v0 normal:", pmx.vertices[0].normal, "mine:", n[0], n[1], n[2]);
    console.log("babylon v0 uv:", pmx.vertices[0].uv, "mine:", u[0], u[1]);
  });
});
