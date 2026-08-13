// @vitest-environment node
// ===== 解码统计纯逻辑单测（收敛自 web-spike，ADR-049 Phase 0）=====
// 镜像 web 预览 summarizeDecoded/findBones 统计口径：骨骼数、立方体数、纹理数。
import { describe, expect, it } from "vitest";
import { findBones, summarizeDecoded } from "./summarize.ts";
import type { YsmDecodedFile } from "../../wasm/ysm-parser.ts";

function file(path: string, content: string | Uint8Array): YsmDecodedFile {
  const data =
    content instanceof Uint8Array ? content : new TextEncoder().encode(content);
  return { path, data };
}

describe("findBones", () => {
  it("直接命中 bone 数组 key 返回其长度", () => {
    expect(findBones({ model: { bones: ["a", "b", "c"] } })).toBe(3);
  });

  it("bone_name / boneNames key 大小写不敏感均命中", () => {
    expect(findBones({ model: { bone_name: ["x", "y"] } })).toBe(2);
    expect(findBones({ model: { boneNames: ["x", "y", "z", "w"] } })).toBe(4);
  });

  it("无 bone key 时下探嵌套对象数组的首元素", () => {
    expect(findBones({ children: [{ boneNames: ["a", "b"] }] })).toBe(2);
  });

  it("非对象输入返回 0", () => {
    expect(findBones(null)).toBe(0);
    expect(findBones("nope")).toBe(0);
    expect(findBones(42)).toBe(0);
    expect(findBones([1, 2, 3])).toBe(0);
  });

  it("6 层深度内可找到，超过 6 层返回 0", () => {
    let reachable: unknown = { boneNames: ["a"] };
    for (let i = 0; i < 6; i++) reachable = { wrap: reachable };
    expect(findBones(reachable)).toBe(1);

    let tooDeep: unknown = { boneNames: ["a"] };
    for (let i = 0; i < 8; i++) tooDeep = { wrap: tooDeep };
    expect(findBones(tooDeep)).toBe(0);
  });
});

describe("summarizeDecoded", () => {
  it("统计 model/main.json 的骨骼/立方体数与纹理文件数", () => {
    const files: YsmDecodedFile[] = [
      file(
        "model/main.json",
        JSON.stringify({
          name: "test",
          model: {
            bones: [
              { name: "root", cubes: [{ from: [0, 0, 0], to: [1, 1, 1] }] },
              { name: "arm", cubes: [{}, {}] },
            ],
          },
        }),
      ),
      file("textures/face.png", new Uint8Array([1, 2, 3])),
      file("textures/body.png", new Uint8Array([4, 5, 6])),
    ];
    expect(summarizeDecoded(files)).toEqual({ bones: 2, cubes: 2, texCount: 2 });
  });

  it("空文件列表返回全 0", () => {
    expect(summarizeDecoded([])).toEqual({ bones: 0, cubes: 0, texCount: 0 });
  });

  it("非 main/model 的 json 跳过（不计骨骼/立方体）", () => {
    const files: YsmDecodedFile[] = [
      file("animation.json", JSON.stringify({ bones: ["a"], cubes: [] })),
      file("model/readme.txt", "hello"),
    ];
    expect(summarizeDecoded(files)).toEqual({ bones: 0, cubes: 0, texCount: 0 });
  });

  it("损坏的 model json 被跳过而非抛错", () => {
    const files: YsmDecodedFile[] = [file("model/main.json", "{ not valid json !!")];
    expect(summarizeDecoded(files)).toEqual({ bones: 0, cubes: 0, texCount: 0 });
  });

  it("纹理按路径匹配（texture(s)/ 或 .png，大小写不敏感）", () => {
    const files: YsmDecodedFile[] = [
      file("textures/face.png", new Uint8Array([1])),
      file("texture/body.png", new Uint8Array([2])),
      file("TEXTURES/hair.JPG", new Uint8Array([3])),
      file("model.png", new Uint8Array([4])),
      file("sound/click.mp3", new Uint8Array([5])),
    ];
    expect(summarizeDecoded(files)).toEqual({ bones: 0, cubes: 0, texCount: 4 });
  });

  it("多个 model json 时取最后一份统计（与原 main.ts 循环行为一致）", () => {
    const files: YsmDecodedFile[] = [
      file("model/a.json", JSON.stringify({ bones: ["a"] })),
      file("model/main.json", JSON.stringify({ bones: ["x", "y", "z"] })),
    ];
    expect(summarizeDecoded(files)).toEqual({ bones: 3, cubes: 0, texCount: 0 });
  });

  it("立方体统计为 JSON 字符串中 \"cubes\": [ 的出现次数", () => {
    const files: YsmDecodedFile[] = [
      file(
        "model/main.json",
        JSON.stringify({
          a: { cubes: [] },
          b: { cubes: [] },
          c: { cubes: [] },
        }),
      ),
    ];
    expect(summarizeDecoded(files).cubes).toBe(3);
  });
});
