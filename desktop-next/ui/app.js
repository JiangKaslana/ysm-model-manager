(() => {
  'use strict';

  const ROW_HEIGHT = 52;
  const OVERSCAN = 8;
  const state = {
    entries: [],
    filtered: [],
    filter: 'all',
    query: '',
    sort: 'name',
    showDisabled: false,
    selectedPath: '',
    hashingPath: '',
    revision: 0,
    root: '',
    scanning: false,
  };

  const ids = [
    'filterNav', 'libraryRoot', 'scanButton', 'refreshButton', 'searchInput', 'sortSelect',
    'disabledToggle', 'summaryCount', 'visibleCount', 'summarySize', 'revisionValue',
    'summaryMessage', 'modelScroll', 'modelSpacer', 'modelLayer', 'emptyState', 'statusText',
    'errorText', 'runtimeDot', 'runtimeLabel', 'detailEmpty', 'detailContent', 'detailType',
    'detailName', 'detailAuthor', 'detailSize', 'detailModified', 'detailSubdir', 'detailStatus',
    'detailHash', 'hashButton', 'detailPath', 'count-all', 'count-ysm', 'count-mmd',
    'count-blueprint', 'count-vrm', 'count-archive',
  ];
  const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  const invoke = window.__TAURI__?.core?.invoke;
  const listen = window.__TAURI__?.event?.listen;
  const isTauri = typeof invoke === 'function';

  function resourceKind(entry) {
    const ext = String(entry.ext || '').toLowerCase();
    if (ext === '.ysm' || (ext === '.json' && String(entry.name).toLowerCase().includes('ysm'))) return 'ysm';
    if (['.pmx', '.pmd', '.vmd', '.vpd'].includes(ext)) return 'mmd';
    if (['.nbt', '.schematic', '.litematic'].includes(ext)) return 'blueprint';
    if (['.vrm', '.vrca'].includes(ext)) return 'vrm';
    if (['.zip', '.7z'].includes(ext)) return 'archive';
    return 'other';
  }

  function fileLabel(entry) {
    const ext = String(entry.ext || '').replace('.', '').toUpperCase();
    return ext.slice(0, 4) || 'FILE';
  }

  function authorFromName(name) {
    const match = /^\[([^\]]+)\]/.exec(String(name));
    return match ? match[1] : '未标注';
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
  }

  function formatDate(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    const rows = state.entries.filter((entry) => {
      if (!state.showDisabled && entry.disabled) return false;
      if (state.filter !== 'all' && resourceKind(entry) !== state.filter) return false;
      if (!q) return true;
      return `${entry.name}\n${entry.path}\n${entry.subdir}`.toLowerCase().includes(q);
    });

    rows.sort((a, b) => {
      if (state.sort === 'size') return b.size - a.size || a.name.localeCompare(b.name, 'zh-CN');
      if (state.sort === 'modified') return b.modTimeMs - a.modTimeMs || a.name.localeCompare(b.name, 'zh-CN');
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    state.filtered = rows;
    el.modelSpacer.style.height = `${rows.length * ROW_HEIGHT}px`;
    el.visibleCount.textContent = rows.length.toLocaleString();
    el.emptyState.hidden = rows.length !== 0;
    renderVirtualRows();
    syncSelection();
  }

  function renderVirtualRows() {
    const rows = state.filtered;
    const viewportHeight = el.modelScroll.clientHeight || 400;
    const scrollTop = el.modelScroll.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
    const end = Math.min(rows.length, start + count);

    let html = '';
    for (let i = start; i < end; i += 1) {
      const entry = rows[i];
      const selected = entry.path === state.selectedPath ? ' is-selected' : '';
      const disabled = entry.disabled ? ' disabled' : '';
      html += `
        <div class="model-row${selected}" role="button" tabindex="-1" data-path="${escapeHtml(entry.path)}" style="top:${i * ROW_HEIGHT}px">
          <div class="name-cell">
            <span class="file-glyph">${escapeHtml(fileLabel(entry))}</span>
            <span class="name-stack">
              <strong title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong>
              <span title="${escapeHtml(entry.path)}">${escapeHtml(entry.subdir || authorFromName(entry.name))}</span>
            </span>
          </div>
          <span class="cell-muted">${escapeHtml(String(entry.ext).toUpperCase())}</span>
          <span class="cell-muted">${formatBytes(entry.size)}</span>
          <span class="cell-muted">${formatDate(entry.modTimeMs)}</span>
          <span class="status-chip${disabled}">${entry.disabled ? '已禁用' : '启用'}</span>
        </div>`;
    }
    el.modelLayer.innerHTML = html;
  }

  function updateCounts() {
    const counts = { all: state.entries.length, ysm: 0, mmd: 0, blueprint: 0, vrm: 0, archive: 0 };
    let totalSize = 0;
    for (const entry of state.entries) {
      totalSize += Math.max(0, Number(entry.size) || 0);
      const kind = resourceKind(entry);
      if (Object.hasOwn(counts, kind)) counts[kind] += 1;
    }
    for (const key of Object.keys(counts)) {
      const target = el[`count-${key}`];
      if (target) target.textContent = counts[key].toLocaleString();
    }
    el.summaryCount.textContent = state.entries.length.toLocaleString();
    el.summarySize.textContent = formatBytes(totalSize);
    el.revisionValue.textContent = state.revision.toLocaleString();
  }

  function setSnapshot(snapshot, delta = null) {
    state.entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
    state.revision = Number(snapshot.revision) || 0;
    state.root = snapshot.root || state.root;
    if (state.root) el.libraryRoot.value = state.root;
    updateCounts();
    applyFilters();

    const errorCount = Array.isArray(snapshot.errors) ? snapshot.errors.length : 0;
    el.summaryMessage.textContent = delta
      ? `+${delta.added}  更新 ${delta.updated}  移除 ${delta.removed}`
      : `索引已载入 · ${state.entries.length} 项`;
    el.errorText.textContent = errorCount ? `${errorCount} 个扫描错误` : '';
  }

  function applyDelta(delta, source = 'watch') {
    const byPath = new Map(state.entries.map((entry) => [entry.path, entry]));
    for (const path of delta.removed || []) byPath.delete(path);
    for (const entry of delta.updated || []) byPath.set(entry.path, entry);
    for (const entry of delta.added || []) byPath.set(entry.path, entry);

    state.entries = Array.from(byPath.values());
    state.revision = Number(delta.revision) || state.revision;
    if (source === 'hash') state.hashingPath = '';
    updateCounts();
    applyFilters();

    const added = delta.added?.length || 0;
    const updated = delta.updated?.length || 0;
    const removed = delta.removed?.length || 0;
    const errors = delta.errors?.length || 0;
    if (source === 'hash') {
      el.summaryMessage.textContent = updated ? `SHA-256 已缓存 · ${updated} 项` : 'SHA-256 未写入';
      el.statusText.textContent = updated ? '后台 SHA-256 计算完成' : 'SHA-256 计算未产生可用结果';
      el.errorText.textContent = errors ? `${errors} 个哈希错误` : '';
    } else {
      el.summaryMessage.textContent = `自动同步 · +${added}  更新 ${updated}  移除 ${removed}`;
      el.errorText.textContent = errors ? `${errors} 个监听/扫描错误` : '';
      el.statusText.textContent = `文件监听已同步 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    }
  }

  function selectEntry(path) {
    state.selectedPath = path;
    renderVirtualRows();
    syncSelection();
  }

  function syncSelection() {
    const entry = state.entries.find((item) => item.path === state.selectedPath);
    if (!entry) {
      state.selectedPath = '';
      state.hashingPath = '';
      el.detailEmpty.hidden = false;
      el.detailContent.hidden = true;
      return;
    }
    el.detailEmpty.hidden = true;
    el.detailContent.hidden = false;
    el.detailType.textContent = resourceKind(entry).toUpperCase();
    el.detailName.textContent = entry.name;
    el.detailAuthor.textContent = authorFromName(entry.name);
    el.detailSize.textContent = formatBytes(entry.size);
    el.detailModified.textContent = formatDate(entry.modTimeMs);
    el.detailSubdir.textContent = entry.subdir || '根目录';
    el.detailStatus.textContent = entry.disabled ? '已禁用' : '启用';
    el.detailHash.textContent = entry.hash || '未计算';
    el.detailPath.textContent = entry.path;

    const hashing = state.hashingPath === entry.path;
    el.hashButton.disabled = Boolean(entry.hash) || hashing;
    el.hashButton.textContent = entry.hash ? 'SHA-256 已缓存' : hashing ? '计算中…' : '计算 SHA-256';
  }

  function setScanning(active, label = '') {
    state.scanning = active;
    el.scanButton.disabled = active;
    el.refreshButton.disabled = active;
    el.scanButton.textContent = active ? '扫描中…' : '扫描';
    el.statusText.textContent = label || (active ? '正在扫描模型库' : '就绪');
  }

  async function scanRoot(root) {
    if (!isTauri) {
      setBrowserPreview();
      return;
    }
    setScanning(true, '快速扫描：发现文件与元数据');
    el.errorText.textContent = '';
    const started = performance.now();
    try {
      const payload = await invoke('scan_library', { root });
      setSnapshot(payload.snapshot, payload.delta);
      el.statusText.textContent = `扫描完成并开始监听 · ${Math.round(performance.now() - started)} ms`;
    } catch (error) {
      el.errorText.textContent = String(error);
      el.statusText.textContent = '扫描失败';
    } finally {
      setScanning(false, el.statusText.textContent);
    }
  }

  async function refreshRoot() {
    if (!isTauri) {
      setBrowserPreview();
      return;
    }
    setScanning(true, '手动校验完整索引');
    const started = performance.now();
    try {
      const payload = await invoke('refresh_library');
      setSnapshot(payload.snapshot, payload.delta);
      el.statusText.textContent = `完整校验完成 · ${Math.round(performance.now() - started)} ms`;
    } catch (error) {
      el.errorText.textContent = String(error);
      el.statusText.textContent = '刷新失败';
    } finally {
      setScanning(false, el.statusText.textContent);
    }
  }

  async function hydrateSelectedHash() {
    const entry = state.entries.find((item) => item.path === state.selectedPath);
    if (!entry || entry.hash || state.hashingPath === entry.path) return;

    state.hashingPath = entry.path;
    syncSelection();
    el.errorText.textContent = '';
    el.statusText.textContent = 'SHA-256 已转入后台线程计算';

    if (!isTauri) {
      const bytes = new TextEncoder().encode(entry.path);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      entry.hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
      state.hashingPath = '';
      syncSelection();
      el.statusText.textContent = '浏览器预览：模拟 SHA-256 完成';
      return;
    }

    try {
      const count = await invoke('hydrate_hashes', { paths: [entry.path] });
      if (!count) {
        state.hashingPath = '';
        syncSelection();
        el.statusText.textContent = '该资源无需计算 SHA-256，或已有缓存';
      }
    } catch (error) {
      state.hashingPath = '';
      syncSelection();
      el.errorText.textContent = String(error);
      el.statusText.textContent = 'SHA-256 任务启动失败';
    }
  }

  function setBrowserPreview() {
    state.root = '浏览器预览（未连接 Rust）';
    el.libraryRoot.value = state.root;
    const now = Date.now();
    const entries = Array.from({ length: 240 }, (_, i) => {
      const kinds = [
        ['.ysm', `[Kaslana] Kiana_${String(i + 1).padStart(3, '0')}.ysm`],
        ['.pmx', `[MMD] Character_${String(i + 1).padStart(3, '0')}.pmx`],
        ['.litematic', `Factory_${String(i + 1).padStart(3, '0')}.litematic`],
        ['.vrm', `Avatar_${String(i + 1).padStart(3, '0')}.vrm`],
      ];
      const [ext, name] = kinds[i % kinds.length];
      return {
        name,
        ext,
        size: 120000 + i * 73123,
        path: `D:\\ModelLibrary\\Preview\\${name}`,
        hash: '',
        modTimeMs: now - i * 8600000,
        subdir: i % 4 === 1 ? 'EntityPlayer' : '',
        disabled: i % 17 === 0,
      };
    });
    setSnapshot({ revision: 1, root: state.root, entries, errors: [] }, { added: 240, updated: 0, removed: 0 });
    el.statusText.textContent = '浏览器预览模式';
  }

  el.filterNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
    el.modelScroll.scrollTop = 0;
    applyFilters();
  });

  el.searchInput.addEventListener('input', () => {
    state.query = el.searchInput.value;
    el.modelScroll.scrollTop = 0;
    applyFilters();
  });

  el.sortSelect.addEventListener('change', () => {
    state.sort = el.sortSelect.value;
    applyFilters();
  });

  el.disabledToggle.addEventListener('click', () => {
    state.showDisabled = !state.showDisabled;
    el.disabledToggle.setAttribute('aria-pressed', String(state.showDisabled));
    applyFilters();
  });

  el.modelScroll.addEventListener('scroll', renderVirtualRows, { passive: true });
  window.addEventListener('resize', renderVirtualRows, { passive: true });
  el.modelLayer.addEventListener('click', (event) => {
    const row = event.target.closest('.model-row');
    if (row) selectEntry(row.dataset.path);
  });

  el.scanButton.addEventListener('click', () => scanRoot(el.libraryRoot.value));
  el.refreshButton.addEventListener('click', refreshRoot);
  el.hashButton.addEventListener('click', hydrateSelectedHash);
  el.libraryRoot.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !state.scanning) scanRoot(el.libraryRoot.value);
  });

  if (isTauri) {
    el.runtimeDot.classList.add('online');
    el.runtimeLabel.textContent = 'Tauri / Rust · watcher';
    invoke('library_snapshot')
      .then((snapshot) => setSnapshot(snapshot))
      .catch(() => {});

    if (typeof listen === 'function') {
      listen('library-delta', (event) => applyDelta(event.payload, 'watch')).catch(() => {});
      listen('hash-hydrated', (event) => applyDelta(event.payload, 'hash')).catch(() => {});
      listen('library-watch-error', (event) => {
        el.errorText.textContent = String(event.payload || '文件监听失败');
        el.statusText.textContent = '文件监听异常';
      }).catch(() => {});
    }
  } else {
    el.runtimeLabel.textContent = 'Browser preview';
    setBrowserPreview();
  }
})();