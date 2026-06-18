// ===== 设置页初始化（为 _initSettings 减负） =====
import { bus } from "../../bus.js";
import { initVersionUpdater } from "../../features/version-updater.js";
import { applyTheme, applyUIPrefs } from "../../core/theme.js";
import { friendlyError } from "../../utils/errors.js";
import {
  ACCENT_PRESETS,
  currentColor,
  resetCustomColors,
  setColor,
} from "../../core/custom-colors.js";
import { getAIConfig, setAIConfig, testConnection } from "../../core/ai-client.js";

/**
 * 初始化设置页所有事件绑定
 * @param {ShadowRoot} root - 组件 shadow root
 */
export async function initSettings(root) {
  const {
    LoadAppConfig,
    SaveAppConfig,
    SelectDirectory,
    GetMinecraftPaths,
    SetLinkMode,
    SelectRpDirectory,
  } = await import("../../../wailsjs/go/main/App.js");
  const cfg = await LoadAppConfig();
  const mcPath = cfg.mcRoot || "";
  const repoPath = cfg.repoRoot || "";
  const rpPath = cfg.resourcepackRoot || "";
  const linkMode = cfg.linkMode || "copy";

  const currentTheme = () =>
    localStorage.getItem("theme") || cfg.theme || cfg.Theme || "system";
  const saveMainConfig = (patch = {}) => {
    const next = {
      repoRoot: patch.repoRoot ?? cfg.repoRoot ?? "",
      resourcepackRoot:
        patch.resourcepackRoot ?? cfg.resourcepackRoot ?? "",
      mcRoot: patch.mcRoot ?? cfg.mcRoot ?? "",
      linkMode: patch.linkMode ?? cfg.linkMode ?? "copy",
      theme: patch.theme ?? currentTheme(),
    };
    return SaveAppConfig(
      next.repoRoot,
      next.resourcepackRoot,
      next.mcRoot,
      next.linkMode,
      next.theme,
    );
  };

  // 所有路径卡片的刷新函数列表
  const _cardRefreshers = [];

  // 工具：绑定路径卡片点击
  // elId: 元素 ID, getPath: 获取当前路径的函数, onSelect: 选择目录后的保存回调
  function bindPathClick(elId, getPath, onSelect) {
    const el = root.getElementById(elId);
    if (!el) return;
    const refresh = () => {
      const p = getPath();
      el.textContent = p || "📂 选择目录";
      el.style.color = p ? "" : "var(--accent)";
    };
    _cardRefreshers.push(refresh);
    el.addEventListener("click", async () => {
      const dir = await SelectDirectory();
      if (!dir) return;
      await onSelect(dir);
      refresh();
      bus.emit("config:updated");
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: "✅ 路径已更新",
        duration: 2000,
        type: "success",
      });
    });
    refresh();
  }

  // 绑定所有路径卡片
  bindPathClick(
    "set-mc-path",
    () => cfg.mcRoot || "",
    async (dir) => {
      await saveMainConfig({ mcRoot: dir });
      cfg.mcRoot = dir;
    },
  );

  bindPathClick(
    "set-repo-path",
    () =>
      cfg.repoRoot ||
      (cfg.mcRoot
        ? cfg.mcRoot.replace(/\//g, "\\") + "\\config\\yes_steve_model\\custom"
        : ""),
    async (dir) => {
      const mc = cfg.mcRoot || "";
      if (mc && dir.toLowerCase().startsWith(mc.toLowerCase())) {
        bus.emit("toast:show", {
          msg: '⚠️ "YSM 模型路径"不应在游戏目录内。请选择一个独立的模型存储目录。',
          duration: 6000,
          type: "warn",
        });
      }
      await saveMainConfig({ repoRoot: dir });
      cfg.repoRoot = dir;
    },
  );

  // ↩️ 默认按钮：恢复 YSM 模型路径为 mcRoot 下的默认位置
  root
    .getElementById("set-repo-default")
    ?.addEventListener("click", async function () {
      var mcRoot = cfg.mcRoot || "";
      if (!mcRoot) {
        bus.emit("toast:show", {
          msg: "请先设置游戏根目录",
          duration: 3000,
          type: "warn",
        });
        return;
      }
      var defaultPath =
        mcRoot.replace(/\//g, "\\") + "\\config\\yes_steve_model\\custom";
      await saveMainConfig({ repoRoot: defaultPath, mcRoot });
      cfg.repoRoot = defaultPath;
      _cardRefreshers.forEach(function (fn) {
        fn();
      });
      bus.emit("config:updated");
      bus.emit("toast:show", {
        msg: "↩️ 已恢复默认路径: " + defaultPath,
        duration: 3000,
        type: "success",
      });
    });

  bindPathClick(
    "set-rp-path",
    () =>
      cfg.resourcepackRoot ||
      (cfg.mcRoot ? cfg.mcRoot.replace(/\//g, "\\") + "\\resourcepacks" : ""),
    async (dir) => {
      await saveMainConfig({ resourcepackRoot: dir });
      cfg.resourcepackRoot = dir;
    },
  );

  // 纯展示路径（由 mcRoot 派生，不可独立设置）
  // 可点击的派生路径（选目录后用 SetResourceRoot 持久化）
  const rtypeKeyMap = {
    resourcepack: "resourcepackRoot",
    shaderpack: "shaderpackRoot",
    "create-blueprint": "schematicRoot",
    "mmd-skin": "mmdRoot",
    "vrchat-avatar": "vrcRoot",
  };
  function bindDerived(elId, rtype) {
    const el = root.getElementById(elId);
    if (!el) return;
    const key = rtypeKeyMap[rtype];
    const refresh = () => {
      const p = cfg[key] || (cfg.mcRoot ? mcDerivedPath(rtype) : "") || "";
      el.textContent = p ? p.replace(/\//g, "\\") : "待设置 MC 根目录";
      el.title = p.replace(/\//g, "\\") || "";
    };
    // 重置按钮
    const resetBtn = document.createElement("button");
    resetBtn.className = "btn";
    resetBtn.textContent = "↩️ 默认";
    resetBtn.style.cssText =
      "font-size:var(--fs-btn-tool);padding:var(--pad-btn-tool) 8px;margin-left:6px";
    resetBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const { ResetResourceRoot } =
          await import("../../../wailsjs/go/main/App.js");
        await ResetResourceRoot(rtype);
        cfg[key] = "";
        refresh();
        bus.emit("config:updated");
        bus.emit("toast:show", {
          msg: "✅ 已恢复默认",
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e.message || e, "重置失败"),
          duration: 4000,
          type: "error",
        });
      }
    });
    // 重置按钮 → 放入卡片标题栏右侧
    const card = el.closest(".stg-card");
    if (card) {
      const hdr = card.querySelector(".stg-card-hdr");
      if (hdr) {
        hdr.style.display = "flex";
        hdr.style.alignItems = "center";
        hdr.style.justifyContent = "space-between";
        hdr.appendChild(resetBtn);
      }
    }

    el.classList.add("derived");
    el.addEventListener("click", async () => {
      const dir = await SelectDirectory();
      if (!dir) return;
      try {
        const { SetResourceRoot } =
          await import("../../../wailsjs/go/main/App.js");
        await SetResourceRoot(rtype, dir);
        cfg[key] = dir;
        refresh();
        bus.emit("config:updated");
        bus.emit("toast:show", {
          msg: "✅ 路径已设置",
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e.message || e, "保存失败"),
          duration: 4000,
          type: "error",
        });
      }
    });
    _cardRefreshers.push(refresh);
    refresh();
  }
  const mcDerivedPath = (rtype) => {
    const map = {
      resourcepack: "resourcepacks",
      shaderpack: "shaderpacks",
      "create-blueprint": "schematics",
      "mmd-skin": "3d-skin\\EntityPlayer",
      "vrchat-avatar": "vrchat-avatars",
    };
    return cfg.mcRoot
      ? cfg.mcRoot.replace(/\\/g, "\\") + "\\" + map[rtype]
      : "";
  };
  bindDerived("set-rp-path", "resourcepack");
  bindDerived("set-sp-path", "shaderpack");
  bindDerived("set-schem-path", "create-blueprint");
  bindDerived("set-mmd-path", "mmd-skin");
  bindDerived("set-vrc-path", "vrchat-avatar");

  // 游戏路径 - 自动搜索
  const detectBtn = root.getElementById("set-mc-detect");
  detectBtn?.addEventListener("click", async () => {
    const paths = await GetMinecraftPaths();
    if (!paths?.length) {
      bus.emit("toast:show", {
        msg: "未找到已存在的游戏目录，请手动选择",
        duration: 3000,
        type: "warn",
      });
      return;
    }
    // 只有一个直接使用，多个让用户选
    var selected = paths[0];
    if (paths.length > 1) {
      selected = await showPathPicker(root, paths);
      if (!selected) return; // 用户取消
    }
    await saveMainConfig({ mcRoot: selected });
    cfg.mcRoot = selected;
    _cardRefreshers.forEach(function (fn) {
      fn();
    });
    bus.emit("config:updated");
    bus.emit("stats:refresh");
    bus.emit("toast:show", {
      msg: "✅ 已设置: " + selected,
      duration: 3000,
      type: "success",
    });
  });

  function showPathPicker(root, paths) {
    return new Promise(function (resolve) {
      var overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;z-index:var(--z-modal);inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center";
      var box = document.createElement("div");
      box.style.cssText =
        "background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:12px;padding:16px;max-width:500px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)";
      var listHtml = "";
      for (var i = 0; i < paths.length; i++) {
        listHtml +=
          "<div class='mc-pick-item' data-idx='" +
          i +
          "' style='padding:8px 10px;border-radius:6px;cursor:pointer;font-size:var(--fs-sm,11px);color:var(--txt,#cdd6f4);display:flex;align-items:center;gap:8px;transition:background .12s' onmouseenter='this.style.background=\"var(--hover,#3a3a4a)\"' onmouseleave='this.style.background=\"\"'>" +
          "<span style='color:var(--accent,#89b4fa);flex-shrink:0'>📁</span>" +
          escHtml(paths[i]) +
          "</div>";
      }
      box.innerHTML =
        "<div style='font-weight:600;font-size:13px;margin-bottom:8px'>🔍 选择游戏目录</div>" +
        "<div style='font-size:10px;color:var(--muted,#888);margin-bottom:12px'>扫描到多个游戏目录，请选择要使用的：</div>" +
        listHtml +
        "<div style='margin-top:12px;text-align:right'>" +
        "<button class='mc-pick-cancel' style='padding:4px 12px;border-radius:4px;border:1px solid var(--bd,#444);background:transparent;color:var(--txt,#cdd6f4);cursor:pointer;font-size:var(--fs-sm,11px);font-family:inherit'>取消</button>" +
        "</div>";
      overlay.appendChild(box);
      (root.getRootNode() === document
        ? document.body
        : root.host?.parentElement || document.body
      ).appendChild(overlay);

      box.querySelectorAll(".mc-pick-item").forEach(function (el) {
        el.addEventListener("click", function () {
          var idx = parseInt(el.dataset.idx, 10);
          overlay.remove();
          resolve(paths[idx]);
        });
      });
      box
        .querySelector(".mc-pick-cancel")
        .addEventListener("click", function () {
          overlay.remove();
          resolve(null);
        });
    });
  }
  // hover 时预加载并显示扫描到的所有路径 + 搜索范围
  let _scanTooltip = null;
  let _scanPaths = null;
  detectBtn?.addEventListener("mouseenter", async () => {
    if (_scanTooltip) return;
    if (!_scanPaths) _scanPaths = await GetMinecraftPaths();
    _scanTooltip = showScanTooltip(root, detectBtn, _scanPaths || []);
  });
  detectBtn?.addEventListener("mouseleave", () => {
    if (_scanTooltip) {
      _scanTooltip.remove();
      _scanTooltip = null;
    }
  });

  function showScanTooltip(root, anchor, paths) {
    const rect = anchor.getBoundingClientRect();
    const tip = document.createElement("div");
    tip.id = "mc-scan-tooltip";
    tip.style.cssText =
      "position:fixed;z-index:var(--z-toast);background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:8px;padding:10px 14px;font-size:var(--fs-sm,11px);color:var(--txt,#cdd6f4);box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:420px;max-height:350px;overflow-y:auto;pointer-events:none;line-height:1.6";
    tip.style.left = Math.max(4, rect.left) + "px";
    tip.style.top = rect.bottom + 4 + "px";

    // 搜索范围
    var html =
      "<div style='font-weight:600;margin-bottom:4px'>🔍 扫描范围</div>" +
      "<div style='font-size:10px;color:var(--muted,#888);margin-bottom:8px;padding-left:4px'>" +
      "C 盘 ~ Z 盘 · 根目录 .minecraft / 各启动器目录<br>" +
      "ProgramFiles · Games · %APPDATA% · EXE 同目录" +
      "</div>" +
      "<div style='border-top:1px solid var(--bd,#444);margin:6px 0'></div>";

    // 搜索结果
    if (!paths.length) {
      html +=
        "<div style='color:var(--muted,#888);padding:4px 0'>未找到已存在的游戏目录</div>" +
        "<div style='font-size:10px;color:var(--muted,#888);padding-top:2px'>💡 如果装了启动器但没扫到，可能是非常规路径，请手动选择</div>";
    } else {
      html +=
        "<div style='font-weight:600;margin-bottom:4px'>✅ 找到 " +
        paths.length +
        " 个</div>";
      for (var i = 0; i < paths.length; i++) {
        html +=
          "<div style='padding:1px 0;display:flex;align-items:center;gap:6px;font-size:10px'>" +
          "<span style='color:var(--accent,#89b4fa);flex-shrink:0'>📁</span>" +
          escHtml(paths[i]) +
          "</div>";
      }
    }

    tip.innerHTML = html;
    (root.getRootNode() === document
      ? document.body
      : root.host?.parentElement || document.body
    ).appendChild(tip);
    return tip;
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 主题
  let savedTheme = cfg.theme || cfg.Theme || "";
  if (!savedTheme) savedTheme = localStorage.getItem("theme") || "system";
  localStorage.setItem("theme", savedTheme);
  applyTheme(savedTheme);
  const themeSelect = root.getElementById("set-theme");
  if (themeSelect) themeSelect.value = savedTheme;

  // 镜像源
  const savedMirror = cfg.mirror || "";
  const mirrorSelect = root.getElementById("set-mirror");
  if (mirrorSelect) {
    const mirrorKeys = [
      "direct",
      "jsdelivr",
      "githubapi",
      "custom-proxy",
      "custom-github",
    ];
    const mirrorBase = root.getElementById("set-mirror-base");
    const mirrorTemplate = root.getElementById("set-mirror-template");
    const mirrorFields = root.getElementById("mirror-custom-fields");
    const mirrorSave = root.getElementById("set-mirror-save");
    if (mirrorBase) {
      mirrorBase.value = cfg.mirrorCustomBase || "https://all.hlmirror.com";
    }
    if (mirrorTemplate) {
      mirrorTemplate.value =
        cfg.mirrorCustomUrl ||
        "https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}";
    }
    const mirrorLabel = (val) =>
      ({
        jsdelivr: "jsDelivr CDN",
        githubapi: "GitHub API",
        "custom-proxy": "自定义 HTTPS 代理",
        "custom-github": "自定义 GitHub 模板",
      })[val] || "直连";
    const refreshMirrorUI = (val) => {
      const key = val || "direct";
      mirrorKeys.forEach((m) => {
        const el = root.getElementById("mirror-hint-" + m);
        if (el) el.style.display = m === key ? "block" : "none";
      });
      if (mirrorFields) {
        mirrorFields.style.display = key.startsWith("custom-") ? "flex" : "none";
      }
      if (mirrorBase) {
        mirrorBase.style.display = key === "custom-proxy" ? "" : "none";
      }
      if (mirrorTemplate) {
        mirrorTemplate.style.display = key === "custom-github" ? "" : "none";
      }
    };
    const saveMirror = async (val = mirrorSelect.value) => {
      const { SetDownloadMirrorConfig } =
        await import("../../../wailsjs/go/main/App.js");
      await SetDownloadMirrorConfig(
        val,
        mirrorBase?.value?.trim() || "",
        mirrorTemplate?.value?.trim() || "",
      );
      cfg.mirror = val;
      cfg.mirrorCustomBase = mirrorBase?.value?.trim() || "";
      cfg.mirrorCustomUrl = mirrorTemplate?.value?.trim() || "";
    };

    mirrorSelect.value = savedMirror;
    refreshMirrorUI(savedMirror);
    mirrorSelect.addEventListener("change", async () => {
      const val = mirrorSelect.value;
      await saveMirror(val);
      refreshMirrorUI(val);
      bus.emit("toast:show", {
        msg: "✅ 下载源已切换为 " + mirrorLabel(val),
        duration: 2000,
        type: "success",
      });
    });
    mirrorSave?.addEventListener("click", async () => {
      await saveMirror();
      bus.emit("toast:show", {
        msg: "✅ 自定义镜像配置已保存",
        duration: 2000,
        type: "success",
      });
    });
  }

  // ===== 以下代码保持原样（链接模式/主题切换/关于等） =====
  // 链接模式提示切换
  const updateLinkHint = (mode) => {
    ["copy", "hardlink", "symlink"].forEach((m) => {
      const el = root.getElementById("lm-hint-" + m);
      if (el) el.style.display = m === mode ? "block" : "none";
    });
  };
  updateLinkHint(linkMode);

  // 链接模式变更（下拉菜单）+ 重新应用按钮
  const doRelink = async () => {
    try {
      const {
        LoadAppConfig,
        ListVersionInstances,
        RelinkAllInstanceResources,
      } = await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (!mcRoot) return;
      const instances = await ListVersionInstances(mcRoot);
      let total = 0;
      for (const ins of instances) {
        if (!ins.Exists) continue;
        try {
          const n = await RelinkAllInstanceResources(ins.Name);
          total += n;
        } catch {}
      }
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: `🔄 已重新链接 ${total} 个文件`,
        duration: 3000,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: 5000,
        type: "error",
      });
    }
  };

  const linkSelect = root.getElementById("set-link-mode");
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      await saveMainConfig({ linkMode: val });
      cfg.linkMode = val;
      await SetLinkMode(val);
      bus.emit("toast:show", {
        msg: `✅ 链接模式已切换至: ${val}`,
        duration: 2000,
        type: "success",
      });
      // 自动重新链接
      await doRelink();
    });
  }

  const relinkBtn = root.getElementById("set-relink");
  if (relinkBtn) {
    relinkBtn.addEventListener("click", doRelink);
  }

  // 主题切换
  root.getElementById("set-theme")?.addEventListener("change", async (e) => {
    const mode = e.target.value;
    applyTheme(mode);
    localStorage.setItem("theme", mode);
    try {
      const theme2 = localStorage.getItem("theme") || mode;
      await saveMainConfig({ theme: theme2 });
      cfg.theme = theme2;
    } catch {}
    const label =
      {
        cyber: "赛博霓虹",
        warm: "温暖木纹",
        pro: "极简深邃",
        system: "跟随系统",
      }[mode] || mode;
    bus.emit("toast:show", {
      msg: `✅ 主题已切换为: ${label}`,
      duration: 2000,
      type: "success",
    });
  });

  initCustomColors(root);
  initAISettings(root);

  // 显示版本号
  const showVersion = async () => {
    try {
      const { CurrentVersion } =
        await import("../../../wailsjs/go/main/App.js");
      const ver = await CurrentVersion();
      const el = root.getElementById("set-version");
      if (el) el.textContent = ver;
    } catch {}
  };
  showVersion();

  // 检查更新
  initVersionUpdater(root);

  // 打开发布页
  root.getElementById("set-releases")?.addEventListener("click", () => {
    import("../../../wailsjs/go/main/App.js").then(({ OpenInBrowser }) =>
      OpenInBrowser("https://github.com/eghrhegpe/ysm-model-manager/releases"),
    );
  });

  // ===== 界面与体验设置 =====

  const applyUIPref = () => applyUIPrefs({ afterApply: updateSizePreview });

  /**
   * 解析 CSS 变量的计算像素值（getComputedStyle 对 calc() 返回原始表达式，
   * 需要间接通过真实 CSS 属性读取）
   */
  const resolvePx = (varName) => {
    const d = document.body;
    const orig = d.style.paddingTop;
    d.style.paddingTop = "var(" + varName + ")";
    const val = getComputedStyle(d).paddingTop;
    d.style.paddingTop = orig;
    return val;
  };

  /**
   * 读取当前 --fs-* 和 --space-* 的计算值并显示
   */
  const updateSizePreview = () => {
    const base = resolvePx("--fs-base");
    const spaceMd = resolvePx("--space-md");
    const spaceSm = resolvePx("--space-sm");
    const fsSm = resolvePx("--fs-sm");

    // 按钮高示例：secondary 按钮 = padding-v(space-sm) * 2 + font-size * 1.4
    const basePx = parseFloat(base);
    const mdPx = parseFloat(spaceMd);
    const smPx = parseFloat(spaceSm);
    const smFontPx = parseFloat(fsSm);
    const btnH = Math.round(smPx * 2 + smFontPx * 1.4) + "px";

    const szBase = root.querySelector("#sz-base");
    const szSpace = root.querySelector("#sz-space");
    const szBtn = root.querySelector("#sz-btn-h");
    if (szBase) szBase.textContent = basePx ? Math.round(basePx) + "px" : base;
    if (szSpace) szSpace.textContent = mdPx ? Math.round(mdPx) + "px" : spaceMd;
    if (szBtn) szBtn.textContent = btnH;
  };

  // 初始化 UI 控件值
  root.getElementById("set-font-size") &&
    (root.getElementById("set-font-size").value =
      localStorage.getItem("ui-font-size") || "normal");
  root.getElementById("set-display-font") &&
    (root.getElementById("set-display-font").value =
      localStorage.getItem("ui-display-font") || "kaiti");
  root.getElementById("set-card-density") &&
    (root.getElementById("set-card-density").value =
      localStorage.getItem("ui-card-density") || "compact");
  root.getElementById("set-animations") &&
    (root.getElementById("set-animations").checked =
      localStorage.getItem("ui-animations") !== "off");
  root.getElementById("set-default-page") &&
    (root.getElementById("set-default-page").value =
      localStorage.getItem("ui-default-page") || "instances");

  applyUIPref();

  // 基准字号变更
  root.getElementById("set-font-size")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-font-size", e.target.value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字号已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 创作者字体变更
  root.getElementById("set-display-font")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-display-font", e.target.value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 字体已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 卡片密度变更
  root.getElementById("set-card-density")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-card-density", e.target.value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: "✅ 卡片密度已更新",
      duration: 1500,
      type: "success",
    });
  });

  // 动画开关
  root.getElementById("set-animations")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-animations", e.target.checked ? "on" : "off");
    applyUIPref();
    bus.emit("toast:show", {
      msg: e.target.checked ? "✅ 动画已开启" : "✅ 动画已关闭",
      duration: 1500,
      type: "success",
    });
  });

  // 默认页面变更
  root.getElementById("set-default-page")?.addEventListener("change", (e) => {
    localStorage.setItem("ui-default-page", e.target.value);
    bus.emit("toast:show", {
      msg: "✅ 默认页面已保存",
      duration: 1500,
      type: "success",
    });
  });
}

function initCustomColors(root) {
  const presetWrap = root.getElementById("cc-presets");
  const accentInput = root.getElementById("set-accent");
  const accentHex = root.getElementById("cc-accent-hex");
  if (!accentInput) return;

  const markActive = (hex) => {
    const lc = (hex || "").toLowerCase();
    presetWrap?.querySelectorAll(".cc-swatch").forEach((swatch) => {
      swatch.classList.toggle(
        "active",
        (swatch.dataset.color || "").toLowerCase() === lc,
      );
    });
  };

  const syncAccentUI = () => {
    const cur = currentColor("accent");
    accentInput.value = cur;
    if (accentHex) accentHex.textContent = cur;
    markActive(cur);
  };

  if (presetWrap && !presetWrap.dataset.ready) {
    presetWrap.dataset.ready = "1";
    ACCENT_PRESETS.forEach((hex) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cc-swatch";
      btn.dataset.color = hex;
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener("click", () => {
        setColor("accent", hex);
        syncAccentUI();
        bus.emit("toast:show", {
          msg: "🎨 主色已更新",
          duration: 1200,
          type: "success",
        });
      });
      presetWrap.appendChild(btn);
    });
  }

  accentInput.addEventListener("input", () => {
    setColor("accent", accentInput.value);
    if (accentHex) accentHex.textContent = accentInput.value;
    markActive(accentInput.value);
  });

  [
    ["set-bg", "bg"],
    ["set-surf", "surf"],
    ["set-card", "card"],
  ].forEach(([id, key]) => {
    const el = root.getElementById(id);
    if (!el) return;
    el.value = currentColor(key);
    el.addEventListener("input", () => setColor(key, el.value));
  });

  root.getElementById("cc-reset")?.addEventListener("click", () => {
    resetCustomColors();
    syncAccentUI();
    [
      ["set-bg", "bg"],
      ["set-surf", "surf"],
      ["set-card", "card"],
    ].forEach(([id, key]) => {
      const el = root.getElementById(id);
      if (el) el.value = currentColor(key);
    });
    bus.emit("toast:show", {
      msg: "↩️ 配色已重置",
      duration: 1500,
      type: "success",
    });
  });

  syncAccentUI();
}

function initAISettings(root) {
  const baseEl = root.getElementById("set-ai-base");
  const keyEl = root.getElementById("set-ai-key");
  const modelEl = root.getElementById("set-ai-model");
  if (!baseEl || !keyEl || !modelEl) return;

  const cfg = getAIConfig();
  baseEl.value = cfg.baseUrl;
  keyEl.value = cfg.apiKey;
  modelEl.value = cfg.model;

  const save = () =>
    setAIConfig({
      baseUrl: baseEl.value,
      apiKey: keyEl.value,
      model: modelEl.value,
    });

  baseEl.addEventListener("change", save);
  keyEl.addEventListener("change", save);
  modelEl.addEventListener("change", save);

  const testBtn = root.getElementById("set-ai-test");
  testBtn?.addEventListener("click", async () => {
    save();
    if (!baseEl.value.trim() || !modelEl.value.trim()) {
      bus.emit("toast:show", {
        msg: "请先填写接口地址和模型名",
        duration: 2500,
        type: "warn",
      });
      return;
    }
    const oldText = testBtn.textContent;
    testBtn.textContent = "测试中...";
    testBtn.disabled = true;
    try {
      const reply = await testConnection();
      bus.emit("toast:show", {
        msg: "✅ 连接成功: " + String(reply).slice(0, 30),
        duration: 3000,
        type: "success",
      });
    } catch (err) {
      bus.emit("toast:show", {
        msg: "❌ " + (err?.message || err),
        duration: 6000,
        type: "error",
      });
    } finally {
      testBtn.textContent = oldText;
      testBtn.disabled = false;
    }
  });
}
