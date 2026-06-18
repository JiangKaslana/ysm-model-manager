// ===== AI 整理 =====
// 扫描模型清单，调用 OpenAI 兼容接口生成分类/重命名/标签建议。
// 所有真实文件操作都必须经过用户审阅确认。

import { bus } from "../bus.js";
import { chat, isConfigured } from "../core/ai-client.js";
import { setTags } from "../core/model-tags.js";

const MAX_FILES = 150;

const CSS = `
.aio-back{position:fixed;inset:0;z-index:var(--z-modal-backdrop);background:rgba(5,10,22,.68);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;animation:aio-fade .16s ease}
@keyframes aio-fade{from{opacity:0}to{opacity:1}}
.aio-box{width:min(980px,94vw);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid color-mix(in srgb,var(--accent) 42%,var(--bd));border-radius:14px;background:linear-gradient(180deg,color-mix(in srgb,var(--surf) 94%,var(--accent)),var(--surf));box-shadow:0 24px 80px rgba(0,0,0,.52),0 0 42px color-mix(in srgb,var(--accent) 18%,transparent)}
.aio-hd{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid color-mix(in srgb,var(--accent) 26%,var(--bd))}
.aio-title{font-size:15px;font-weight:800;color:var(--txt);letter-spacing:0}
.aio-sub{font-size:12px;color:var(--muted)}
.aio-sp{flex:1}
.aio-x{width:34px;height:34px;border:1px solid var(--bd);border-radius:9px;background:color-mix(in srgb,var(--card) 70%,transparent);color:var(--muted);cursor:pointer;font-size:18px}
.aio-x:hover{background:var(--hover);color:var(--txt);border-color:var(--accent)}
.aio-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid var(--bd);font-size:12px;color:var(--muted)}
.aio-body{overflow:auto;flex:1}
.aio-tbl{width:100%;border-collapse:collapse;font-size:12px}
.aio-tbl th{position:sticky;top:0;z-index:1;padding:9px 10px;text-align:left;background:color-mix(in srgb,var(--card) 92%,var(--accent));border-bottom:1px solid var(--bd);color:var(--muted);font-weight:700}
.aio-tbl td{padding:8px 10px;border-bottom:1px solid var(--bd);vertical-align:top;color:var(--txt)}
.aio-tbl tr:hover td{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.aio-tbl input[type=text]{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--bd);border-radius:8px;background:color-mix(in srgb,var(--bg) 84%,transparent);color:var(--txt);outline:none;font:inherit}
.aio-tbl input[type=text]:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.aio-fn{max-width:210px;word-break:break-all;color:var(--muted)}
.aio-reason{max-width:240px;color:var(--muted);font-size:11px;line-height:1.5}
.aio-btn{min-height:34px;padding:7px 14px;border:1px solid var(--bd);border-radius:10px;background:color-mix(in srgb,var(--card) 80%,transparent);color:var(--txt);font-size:12px;font-weight:700;cursor:pointer;transition:transform .14s ease,background .14s ease,border-color .14s ease,box-shadow .14s ease}
.aio-btn:hover{transform:translateY(-1px);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 14%,var(--card));box-shadow:0 8px 22px rgba(0,0,0,.22)}
.aio-btn.primary{background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 64%,#ffffff));border-color:var(--accent);color:#fff}
.aio-btn:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}
.aio-stage{padding:48px 24px;text-align:center;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:16px}
.aio-stage .big{font-size:38px;color:var(--txt)}
.aio-spin{width:30px;height:30px;border:3px solid color-mix(in srgb,var(--accent) 18%,var(--bd));border-top-color:var(--accent);border-radius:50%;animation:aio-rot .8s linear infinite;box-shadow:0 0 18px color-mix(in srgb,var(--accent) 35%,transparent)}
.aio-count-pill,.aio-warn-pill{min-height:30px;display:inline-flex;align-items:center;padding:4px 10px;border-radius:10px;border:1px solid color-mix(in srgb,var(--accent) 16%,var(--bd));background:color-mix(in srgb,var(--bg) 62%,transparent);font-weight:750}
.aio-warn-pill{color:var(--status-error);border-color:color-mix(in srgb,var(--status-error) 36%,var(--bd));background:color-mix(in srgb,var(--status-error) 10%,transparent)}
.aio-tbl tbody tr{transition:background .14s ease,box-shadow .14s ease}
.aio-tbl tbody tr:hover{box-shadow:inset 3px 0 0 var(--accent)}
.aio-tbl input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent)}
.aio-footer-note{border-bottom:none!important;border-top:1px solid color-mix(in srgb,var(--accent) 18%,var(--bd))!important;background:color-mix(in srgb,var(--bg) 56%,transparent);line-height:1.5}
@keyframes aio-rot{to{transform:rotate(360deg)}}
`;

function ensureStyle() {
  if (document.getElementById("aio-style")) return;
  const style = document.createElement("style");
  style.id = "aio-style";
  style.textContent = CSS;
  document.head.appendChild(style);
}

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const norm = (path) => (path || "").replace(/\\/g, "/").replace(/\/+$/, "");

function extractJSON(text) {
  if (!text) return null;
  let value = String(text).trim();
  value = value.replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const parse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  let parsed = parse(value);
  if (parsed) return parsed;
  const arrStart = value.indexOf("[");
  const arrEnd = value.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    parsed = parse(value.slice(arrStart, arrEnd + 1));
    if (parsed) return parsed;
  }
  const objStart = value.indexOf("{");
  const objEnd = value.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    parsed = parse(value.slice(objStart, objEnd + 1));
    if (parsed) return parsed;
  }
  return null;
}

function normalizeSuggestions(parsed) {
  let arr = parsed;
  if (!Array.isArray(arr)) {
    arr = parsed?.suggestions || parsed?.items || parsed?.result || parsed?.data;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => ({
      path: norm(item.path || item.file || item.rel || ""),
      folder: String(item.folder || item.suggestedFolder || item.category || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, ""),
      rename: String(item.rename || item.newName || item.suggestedName || "").trim(),
      tags: Array.isArray(item.tags)
        ? item.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : [],
      reason: String(item.reason || item.note || "").trim(),
    }))
    .filter((item) => item.path);
}

function buildPrompt(files) {
  const list = files.map((file) => ({
    path: file.rel,
    name: file.name,
    sizeKB: Math.round((file.size || 0) / 1024),
  }));
  return [
    {
      role: "system",
      content:
        "你是 Minecraft YSM 模型库整理助手。用户会给出模型文件清单 JSON。请基于文件名推断角色、作者、作品和类型，为每个文件给出整理建议。严格只输出 JSON 数组，不要额外文字。数组元素格式为 {\"path\":\"原相对路径\",\"folder\":\"建议相对文件夹\",\"rename\":\"建议新文件名含扩展名\",\"tags\":[\"标签\"],\"reason\":\"一句话理由\"}。保持扩展名不变，文件夹和文件名不要包含 ..、盘符或非法字符。",
    },
    {
      role: "user",
      content: `请整理以下 ${list.length} 个文件：\n${JSON.stringify(list)}`,
    },
  ];
}

async function loadFiles(App, rootDir, entries) {
  const root = norm(rootDir);
  if (entries?.length) return entries;
  const raw = (await App.ScanModelEntries(root)) || [];
  return raw
    .filter((entry) => entry?.Name && entry?.Path)
    .map((entry) => {
      const abs = norm(entry.Path);
      let rel = abs;
      if (root && abs.startsWith(root)) rel = abs.slice(root.length).replace(/^\/+/, "");
      return {
        name: entry.Name,
        abs: entry.Path,
        rel,
        size: entry.Size,
      };
    });
}

export async function openAIOrganize({ rootDir, entries, onApplied } = {}) {
  ensureStyle();
  if (!isConfigured()) {
    bus.emit("toast:show", {
      msg: "请先在设置页配置 AI 接口地址和模型名",
      duration: 4000,
      type: "warn",
    });
    bus.emit("nav:change", { page: "settings" });
    return;
  }

  const App = await import("../../wailsjs/go/main/App.js");
  let root = norm(rootDir);
  if (!root) {
    const cfg = await App.LoadAppConfig();
    root = norm(cfg.repoRoot || "");
  }
  if (!root) {
    bus.emit("toast:show", { msg: "请先设置仓库目录", duration: 3000, type: "warn" });
    return;
  }

  let files;
  try {
    files = await loadFiles(App, root, entries);
  } catch (err) {
    bus.emit("toast:show", {
      msg: "读取目录失败: " + (err?.message || err),
      duration: 4000,
      type: "error",
    });
    return;
  }
  files = files.filter((file) => file?.name && file?.abs);
  if (!files.length) {
    bus.emit("toast:show", { msg: "当前目录没有可整理的模型", duration: 3000, type: "warn" });
    return;
  }

  const truncated = files.length > MAX_FILES;
  const sendFiles = files.slice(0, MAX_FILES);
  const back = document.createElement("div");
  back.className = "aio-back";
  back.innerHTML = `
<div class="aio-box">
  <div class="aio-hd"><div><div class="aio-title">AI 整理模型库</div><div class="aio-sub">先分析，再审阅，最后由你确认执行</div></div><span class="aio-sp"></span><button class="aio-x" title="关闭">×</button></div>
  <div class="aio-stage" id="aio-stage"><div class="aio-spin"></div><div>正在分析 ${sendFiles.length} 个文件...</div></div>
</div>`;
  document.body.appendChild(back);
  const box = back.querySelector(".aio-box");
  const close = () => back.remove();
  back.querySelector(".aio-x").onclick = close;
  back.addEventListener("mousedown", (event) => {
    if (event.target === back) close();
  });

  let suggestions;
  try {
    const reply = await chat({ messages: buildPrompt(sendFiles), temperature: 0.2 });
    suggestions = normalizeSuggestions(extractJSON(reply));
    if (!suggestions.length) throw new Error("AI 回复中没有可解析的整理建议");
  } catch (err) {
    box.querySelector("#aio-stage").innerHTML =
      `<div class="big">!</div><div style="max-width:560px;line-height:1.6">${esc(err?.message || err)}</div><button class="aio-btn" id="aio-close">关闭</button>`;
    box.querySelector("#aio-close").onclick = close;
    return;
  }

  const byRel = new Map(files.map((file) => [norm(file.rel), file]));
  const rows = suggestions
    .map((suggestion) => {
      const file =
        byRel.get(norm(suggestion.path)) ||
        files.find((item) => item.name === suggestion.path.split("/").pop());
      if (!file) return null;
      const currentDir = norm(file.abs).slice(0, norm(file.abs).lastIndexOf("/"));
      const targetDir = suggestion.folder ? norm(root + "/" + suggestion.folder) : currentDir;
      return {
        file,
        folder: suggestion.folder,
        rename: suggestion.rename || file.name,
        tags: suggestion.tags,
        reason: suggestion.reason,
        changed: targetDir !== currentDir || (suggestion.rename && suggestion.rename !== file.name),
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    box.querySelector("#aio-stage").innerHTML =
      `<div class="big">?</div><div>AI 没有给出能匹配当前文件的建议</div><button class="aio-btn" id="aio-close">关闭</button>`;
    box.querySelector("#aio-close").onclick = close;
    return;
  }

  renderReview(box, {
    App,
    close,
    onApplied,
    root,
    rows,
    total: files.length,
    truncated,
  });
}

function renderReview(box, ctx) {
  const { App, close, onApplied, root, rows, total, truncated } = ctx;
  const bodyRows = rows
    .map(
      (row, index) => `<tr data-i="${index}">
<td><input type="checkbox" class="aio-ck" ${row.changed ? "checked" : ""}></td>
<td class="aio-fn" title="${esc(row.file.rel)}">${esc(row.file.name)}</td>
<td><input type="text" class="aio-folder" value="${esc(row.folder)}" placeholder="不移动"></td>
<td><input type="text" class="aio-rename" value="${esc(row.rename)}"></td>
<td><input type="text" class="aio-tags" value="${esc(row.tags.join(", "))}" placeholder="标签, 逗号分隔"></td>
<td class="aio-reason">${esc(row.reason)}</td>
</tr>`,
    )
    .join("");

  box.innerHTML = `
<div class="aio-hd"><div><div class="aio-title">AI 整理建议</div><div class="aio-sub">可以直接编辑建议，再执行所选项</div></div><span class="aio-sp"></span><button class="aio-x" title="关闭">×</button></div>
<div class="aio-bar">
  <button class="aio-btn" id="aio-all">全选</button>
  <button class="aio-btn" id="aio-none">全不选</button>
  <span class="aio-count-pill" id="aio-count"></span>
  <span class="aio-sp"></span>
  ${truncated ? `<span class="aio-warn-pill">文件较多，仅分析 ${rows.length}/${total} 个</span>` : ""}
  <button class="aio-btn primary" id="aio-apply">执行所选</button>
</div>
<div class="aio-body">
  <table class="aio-tbl">
    <thead><tr><th style="width:34px"></th><th>文件</th><th style="width:190px">归类文件夹</th><th style="width:190px">重命名</th><th style="width:160px">标签</th><th>理由</th></tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</div>
<div class="aio-bar aio-footer-note" style="border-bottom:none;border-top:1px solid var(--bd)">真实移动/重命名前会以表格内容为准；留空文件夹表示不移动。</div>`;

  box.querySelector(".aio-x").onclick = close;
  const checkboxes = () => [...box.querySelectorAll(".aio-ck")];
  const updateCount = () => {
    const selected = checkboxes().filter((checkbox) => checkbox.checked).length;
    box.querySelector("#aio-count").textContent = `已选 ${selected} / ${rows.length}`;
  };
  box.querySelector("#aio-all").onclick = () => {
    checkboxes().forEach((checkbox) => (checkbox.checked = true));
    updateCount();
  };
  box.querySelector("#aio-none").onclick = () => {
    checkboxes().forEach((checkbox) => (checkbox.checked = false));
    updateCount();
  };
  box.querySelector(".aio-body").addEventListener("change", (event) => {
    if (event.target.classList.contains("aio-ck")) updateCount();
  });
  updateCount();

  box.querySelector("#aio-apply").onclick = async () => {
    const applyBtn = box.querySelector("#aio-apply");
    applyBtn.disabled = true;
    applyBtn.textContent = "执行中...";
    let ok = 0;
    let fail = 0;
    let skip = 0;

    for (const tr of box.querySelectorAll("tbody tr")) {
      if (!tr.querySelector(".aio-ck").checked) {
        skip++;
        continue;
      }
      const row = rows[Number(tr.dataset.i)];
      const folder = tr
        .querySelector(".aio-folder")
        .value.trim()
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      const rename = tr.querySelector(".aio-rename").value.trim();
      const tags = tr
        .querySelector(".aio-tags")
        .value.split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean);

      if (/\.\./.test(folder) || /^[a-zA-Z]:/.test(folder) || /[<>:"|?*]/.test(rename)) {
        fail++;
        tr.style.outline = "1px solid var(--status-error)";
        continue;
      }

      try {
        let currentAbs = norm(row.file.abs);
        const currentName = row.file.name;
        const currentDir = currentAbs.slice(0, currentAbs.lastIndexOf("/"));
        if (folder) {
          const targetDir = norm(root + "/" + folder);
          if (targetDir !== currentDir) {
            await App.MoveModelFile(currentAbs, targetDir);
            currentAbs = targetDir + "/" + currentName;
          }
        }
        if (rename && rename !== currentName) {
          await App.RenameFile(currentAbs, rename);
          currentAbs = currentAbs.slice(0, currentAbs.lastIndexOf("/") + 1) + rename;
        }
        if (tags.length) setTags(currentAbs, tags);
        ok++;
        tr.style.opacity = ".48";
      } catch (err) {
        fail++;
        tr.style.outline = "1px solid var(--status-error)";
        tr.title = err?.message || String(err);
        console.error("[ai-organize] apply failed:", row.file.abs, err);
      }
    }

    bus.emit("toast:show", {
      msg: `整理完成：成功 ${ok}，失败 ${fail}，跳过 ${skip}`,
      duration: 4200,
      type: fail ? "warn" : "success",
    });
    bus.emit("tree:reload");
    bus.emit("stats:refresh");
    onApplied?.();
    applyBtn.textContent = "完成";
    setTimeout(close, 700);
  };
}
