// ===== spec-builder 契约测试（镜像 internal/app/app_model_test.go）=====
// 纯 TS 移植（ADR-049 P2-2 闭环）：buildSpecFromGeometryJSON ↔ Go
// Build3DSpecFromGeometryJSON。任一侧口径漂移都会使其中一套测试失败，双边锁定。
import { describe, it, expect } from "vitest";
import { buildSpecFromGeometryJSON } from "./spec-builder.ts";

/** Go app_model_test.go 同款 geometry fixture */
const GEO = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 32 },
    "bones": [{ "name": "bone1", "pivot": [0, 0, 0], "cubes": [{ "origin": [-4, 0, -4], "size": [8, 8, 8] }] }]
  }]
}`;

/** 无 texture 字段的 cube：Go `Texture int` 缺省 0，spec 恒含 texIdx:0 */
const GEO_NO_TEX = `{
  "format_version": "1.12.0",
  "minecraft:geometry": [{
    "description": { "identifier": "geometry.test", "texture_width": 64, "texture_height": 64 },
    "bones": [{ "name": "b", "pivot": [0, 0, 0], "cubes": [{ "origin": [0, 0, 0], "size": [4, 4, 4] }] }]
  }]
}`;

/** 便捷构造 bedrock geometry JSON（镜像 Go fixture 形状：identifier + bones 数组体） */
function geo(identifier: string, bones: string): string {
  return `{
    "format_version": "1.12.0",
    "minecraft:geometry": [{
      "description": { "identifier": "${identifier}", "texture_width": 64, "texture_height": 64 },
      "bones": [${bones}]
    }]
  }`;
}

describe("buildSpecFromGeometryJSON 契约（对齐 Go TestBuild3DSpecFromGeometryJSON）", () => {
  it("空输入 → {}", () => {
    expect(buildSpecFromGeometryJSON("")).toBe("{}");
  });

  it("非法 JSON → {}", () => {
    expect(buildSpecFromGeometryJSON("not json")).toBe("{}");
  });

  it("无 minecraft:geometry → {}", () => {
    expect(buildSpecFromGeometryJSON('{"geometry":"x"}')).toBe("{}");
  });

  it("合法 geometry → 非 {}，models 与 meshGroups 非空（cube 已生成顶点）", () => {
    const got = buildSpecFromGeometryJSON(GEO);
    expect(got).not.toBe("{}");
    const spec = JSON.parse(got) as { models: { meshGroups: unknown[] }[] };
    expect(spec.models.length).toBe(1);
    expect(spec.models[0].meshGroups.length).toBeGreaterThan(0);
  });

  it("8×8×8 cube → 72 positions / 36 indices（6 面 × 4 顶点）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(GEO)) as {
      models: { meshGroups: { positions: number[]; indices: number[]; texIdx: number }[] }[];
    };
    const mesh = spec.models[0].meshGroups[0];
    expect(mesh.positions).toHaveLength(72);
    expect(mesh.indices).toHaveLength(36);
  });

  it("cube 未声明 texture → texIdx 0（对齐 Go `Texture int` 缺省，不丢键）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(GEO_NO_TEX)) as {
      models: { meshGroups: { texIdx: number }[] }[];
    };
    expect(spec.models[0].meshGroups[0].texIdx).toBe(0);
  });

  // ===== 镜像 go/threejs/spec_test.go =====

  // 镜像 Go TestBuildDuplicateBoneMerge（spec_test.go:107）
  // 同名骨骼 overwrite：第一条 b1 无 parent，第二条 b1 有 parent "p1" →
  // overwrite 语义保留带 parent 版本的 cube（cubeB 替换 cubeA），meshGroups 仅 1 条。
  it("同名骨骼 merge → meshGroups=1（overwrite 整体替换旧 cube）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.dup",
      '{ "name": "b1", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }, ' +
      '{ "name": "b1", "parent": "p1", "pivot": [10,0,0], "cubes": [{ "origin": [10,0,0], "size": [2,2,2], "pivot": [11,0,0], "uv": [0,0] }] }, ' +
      '{ "name": "p1", "pivot": [0,0,0], "cubes": [] }'))) as {
      models: { bones: { name: string; parentId: string | null }[]; meshGroups: unknown[] }[];
    };
    // b1 在 bones 列表只出现一次（同名 merge）
    const b1Count = spec.models[0].bones.filter((b) => b.name === "b1").length;
    expect(b1Count).toBe(1);
    // overwrite 后只保留 cubeB → meshGroups=1
    expect(spec.models[0].meshGroups.length).toBe(1);
  });

  // 镜像 Go TestEulerToQuaternionIdentity（spec_test.go:187）
  // 骨骼 rotation=[0,0,0] → hasBoneRotation=false → localRotation=[0,0,0,1]（单位四元数）
  it("骨骼无旋转 → localRotation=[0,0,0,1]（单位四元数）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    expect(spec.models[0].bones[0].localRotation).toEqual([0, 0, 0, 1]);
  });

  // 镜像 Go TestEulerToQuaternion90X（spec_test.go:199）
  // 骨骼 rotation=[90,0,0] → localRot=eulerToQuaternion(-90,0,0) → qx≈-0.7071, qw≈0.7071, qy=qz=0
  it("骨骼 X 轴 90° 旋转 → 四元数 qx≈-0.7071 qw≈0.7071", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [90,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation; // [x,y,z,w]
    expect(Math.abs(q[0] - (-0.70710678))).toBeLessThan(1e-4);
    expect(Math.abs(q[3] - 0.70710678)).toBeLessThan(1e-4);
    expect(Math.abs(q[1])).toBeLessThan(1e-9);
    expect(Math.abs(q[2])).toBeLessThan(1e-9);
  });

  // 镜像 Go TestEulerToQuaternion_90Y（spec_extra_test.go:205）
  // 骨骼 rotation=[0,90,0] → localRot=eulerToQuaternion(0,-90,0) → qy≈-0.7071, qw≈0.7071
  it("骨骼 Y 轴 90° 旋转 → 四元数 qy≈-0.7071 qw≈0.7071", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,90,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(Math.abs(q[1] - (-0.70710678))).toBeLessThan(1e-4);
    expect(Math.abs(q[3] - 0.70710678)).toBeLessThan(1e-4);
  });

  // 镜像 Go TestEulerToQuaternion_90Z（spec_extra_test.go:216）
  // 骨骼 rotation=[0,0,90] → localRot=eulerToQuaternion(0,0,90) → qz≈0.7071, qw≈0.7071
  // （Z 轴不取反：eulerToQuaternion(-0,-0,90)）
  it("骨骼 Z 轴 90° 旋转 → 四元数 qz≈0.7071 qw≈0.7071", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [0,0,90], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(Math.abs(q[2] - 0.70710678)).toBeLessThan(1e-4);
    expect(Math.abs(q[3] - 0.70710678)).toBeLessThan(1e-4);
  });

  // 镜像 Go TestEulerToQuaternion_180X（spec_extra_test.go:227）
  // 骨骼 rotation=[180,0,0] → localRot=eulerToQuaternion(-180,0,0) → qx≈1, qw≈0
  it("骨骼 X 轴 180° 旋转 → 四元数 qx≈1 qw≈0", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [180,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    const q = spec.models[0].bones[0].localRotation;
    expect(Math.abs(q[0] - 1)).toBeLessThan(1e-4);
    expect(Math.abs(q[3])).toBeLessThan(1e-4);
  });

  // 镜像 Go TestHasBoneRotation 360° 整圈用例（spec_extra_test.go:135）
  // 骨骼 rotation=[360,0,0] → hasBoneRotation=false（整圈四元数=单位四元数）
  // → localRotation=[0,0,0,1]（与无旋转一致）
  it("骨骼 360° 整圈旋转 → 视为无旋转 localRotation=[0,0,0,1]", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.id",
      '{ "name": "b", "pivot": [0,0,0], "rotation": [360,0,0], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localRotation: number[] }[] }[];
    };
    expect(spec.models[0].bones[0].localRotation).toEqual([0, 0, 0, 1]);
  });

  // 镜像 Go TestMeshIDMultiCube（spec_test.go:213）
  // 单骨骼 12 cube → meshGroups=12，cubeIdx 10 的 meshID="b1_10"（十进制，无 ':' 等异常字符）
  it("12 cube 单骨骼 → meshGroups=12，meshID b1_10 存在", () => {
    const cubes: string[] = [];
    for (let i = 0; i < 12; i++) {
      cubes.push(`{ "origin": [${i * 3},0,0], "size": [1,1,1], "pivot": [${i * 3 + 1},0,0], "uv": [0,0] }`);
    }
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.multi",
      `{ "name": "b1", "pivot": [0,0,0], "cubes": [${cubes.join(",")}] }`))) as {
      models: { meshGroups: { id: string }[] }[];
    };
    expect(spec.models[0].meshGroups.length).toBe(12);
    expect(spec.models[0].meshGroups.some((m) => m.id === "b1_10")).toBe(true);
    for (const m of spec.models[0].meshGroups) {
      expect(m.id).not.toContain(":");
    }
  });

  // 镜像 Go TestParseFaceUV_AllFaces（spec_extra_test.go:161）
  // cube uv 为 faceUV JSON 字符串，east={uv:[0,0],uv_size:[8,8]}，texW=texH=64
  // → east face u0=0/64=0, u1=8/64=0.125（uvs[0]=0, uvs[2]=0.125）
  it("cube faceUV 字符串（east uv_size 8×8）→ uvs[0]=0 uvs[2]=0.125", () => {
    const faceUV = `{"east":{"uv":[0,0],"uv_size":[8,8]},"west":{"uv":[8,0],"uv_size":[8,8]},"up":{"uv":[16,0],"uv_size":[8,8]},"down":{"uv":[24,0],"uv_size":[8,8]},"south":{"uv":[32,0],"uv_size":[8,8]},"north":{"uv":[40,0],"uv_size":[8,8]}}`;
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.faceuv",
      `{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [8,8,8], "uv": ${JSON.stringify(faceUV)} }] }`))) as {
      models: { meshGroups: { uvs: number[] }[] }[];
    };
    const uvs = spec.models[0].meshGroups[0].uvs;
    // East face = uvs[0..7]，u0=uvs[0]=0，u1=uvs[2]=0.125
    expect(uvs[0]).toBe(0);
    expect(uvs[2]).toBeCloseTo(0.125, 6);
  });

  // 镜像 Go TestParseFaceUV_PartialFaces（spec_extra_test.go:184）
  // 只提供 east face → east 有 UV 值，west face 保持零值
  it("cube faceUV 仅 east 面 → east 有 UV，west 保持零", () => {
    const faceUV = `{"east":{"uv":[0,0],"uv_size":[8,8]}}`;
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.partial",
      `{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [8,8,8], "uv": ${JSON.stringify(faceUV)} }] }`))) as {
      models: { meshGroups: { uvs: number[] }[] }[];
    };
    const uvs = spec.models[0].meshGroups[0].uvs;
    // East face uvs[0..7] 有值
    expect(uvs[2]).toBeCloseTo(0.125, 6);
    // West face uvs[8..15] 保持零（未提供）
    expect(uvs[8]).toBe(0);
    expect(uvs[10]).toBe(0);
  });

  // 镜像 Go TestBuildCubeMeshData_ZeroSize（spec_extra_test.go:240）
  // cube size=[0,0,0] → 三轴被 thicknessEpsilon 修正，保留非空 mesh
  // → meshGroups=1，positions=72，indices=36（6 面 × 4 顶点）
  it("零尺寸 cube → 保留 mesh（72 positions / 36 indices）", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.zero",
      '{ "name": "b", "pivot": [0,0,0], "cubes": [{ "origin": [0,0,0], "size": [0,0,0], "uv": [0,0] }] }'))) as {
      models: { meshGroups: { positions: number[]; indices: number[] }[] }[];
    };
    expect(spec.models[0].meshGroups.length).toBe(1);
    const mesh = spec.models[0].meshGroups[0];
    expect(mesh.positions.length).toBe(72);
    expect(mesh.indices.length).toBe(36);
  });

  // 镜像 Go TestBuildBoneLocalPosition_XFlip（spec_test.go:262）
  // 骨骼 pivot=[5,2,-3] 无 parent → localPosition=[-5,2,-3]（X 翻转对齐 C# ConvertBones）
  it("骨骼无 parent → localPosition X 翻转 [-5,2,-3]", () => {
    const spec = JSON.parse(buildSpecFromGeometryJSON(geo("geometry.xflip",
      '{ "name": "b1", "pivot": [5,2,-3], "cubes": [{ "origin": [0,0,0], "size": [2,2,2], "uv": [0,0] }] }'))) as {
      models: { bones: { localPosition: number[] }[] }[];
    };
    expect(spec.models[0].bones[0].localPosition).toEqual([-5, 2, -3]);
  });
});
