/* ==========================================================================
   Pip Manager — 前端逻辑
   ========================================================================== */

const API = {
  installations: '/api/python-installations',
  packages: (path) => `/api/packages?python_path=${encodeURIComponent(path)}`,
  install: '/api/install',
  uninstall: '/api/uninstall',
  getMirror: '/api/mirror',
  setMirror: '/api/mirror',
  presetMirrors: '/api/mirrors/preset',
  upgradePip: '/api/upgrade-pip',
};

// 状态
let state = {
  installations: [],
  selectedEnv: null,
  packages: [],
  filteredPackages: [],
  uninstallTarget: null,
};

// DOM 快捷引用
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadInstallations();
  loadMirrorInfo();
  loadPresetMirrors();
});

function bindEvents() {
  // 顶部按钮
  $('btnRefresh').addEventListener('click', loadInstallations);
  $('btnMirror').addEventListener('click', openMirrorModal);
  $('btnInstall').addEventListener('click', openInstallModal);
  $('btnUpgradePip').addEventListener('click', handleUpgradePip);

  // 搜索
  $('searchInput').addEventListener('input', (e) => filterPackages(e.target.value));

  // 模态框关闭
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // 安装确认
  $('installConfirm').addEventListener('click', handleInstall);
  $('installInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleInstall();
  });

  // 镜像确认
  $('mirrorConfirm').addEventListener('click', handleSetMirror);
  $('mirrorInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSetMirror();
  });

  // 卸载确认
  $('uninstallConfirm').addEventListener('click', handleUninstall);

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
    }
  });
}

// ---------------------------------------------------------------------------
// Python 环境
// ---------------------------------------------------------------------------

async function loadInstallations() {
  $('envList').innerHTML = `
    <div class="sidebar-empty">
      <div class="empty-icon">⌛</div>
      <p>正在扫描系统中的 Python 安装...</p>
    </div>`;
  setStatus('正在扫描 Python 环境...');

  try {
    const res = await fetch(API.installations);
    const data = await res.json();
    if (data.success) {
      state.installations = data.data;
      renderEnvList(data.data);
      setStatus(`发现 ${data.data.length} 个 Python 环境`);
    } else {
      renderEnvList([]);
      toast('扫描失败: ' + data.error, 'error');
      setStatus('扫描失败');
    }
  } catch (e) {
    renderEnvList([]);
    toast('网络错误: ' + e.message, 'error');
    setStatus('网络错误');
  }
}

function renderEnvList(installations) {
  $('envCount').textContent = installations.length;

  if (installations.length === 0) {
    $('envList').innerHTML = `
      <div class="sidebar-empty">
        <div class="empty-icon">🔍</div>
        <p>未检测到 Python 安装</p>
      </div>`;
    return;
  }

  // 按版本号排序（降序）
  const sorted = [...installations].sort((a, b) => {
    return compareVersions(b.version, a.version);
  });

  // 存储排序后的列表，供点击时按索引查找
  state._sortedInstallations = sorted;

  $('envList').innerHTML = sorted.map((inst, idx) => {
    const isActive = state.selectedEnv && state.selectedEnv.executable === inst.executable;
    const fileName = inst.executable.split(/[\\/]/).pop();
    const dir = inst.executable.replace(/[\\/][^\\/]+$/, '');

    return `
      <div class="env-item ${isActive ? 'active' : ''}" data-idx="${idx}" onclick="selectEnv(${idx})">
        <div class="env-item-top">
          <span class="env-version">Python ${escapeHtml(inst.version)}</span>
          <span class="env-source">${escapeHtml(inst.source || '')}</span>
        </div>
        <div class="env-path" title="${escapeAttr(inst.executable)}">${escapeHtml(dir)}</div>
        <div class="env-meta">
          ${inst.has_pip
            ? `<span class="meta-item">pip ${escapeHtml(inst.pip_version)}</span>`
            : `<span class="env-no-pip">无 pip</span>`
          }
          ${inst.has_pip ? '<span class="dot"></span><span class="meta-item">' + escapeHtml(fileName) + '</span>' : ''}
        </div>
      </div>`;
  }).join('');
}

function compareVersions(a, b) {
  const pa = (a || '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = (b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function selectEnv(idx) {
  const list = state._sortedInstallations || state.installations;
  const inst = list[idx];
  if (!inst) return;

  state.selectedEnv = inst;

  // 更新侧边栏高亮
  $('envList').querySelectorAll('.env-item').forEach(item => {
    item.classList.toggle('active', item.dataset.idx === String(idx));
  });

  // 更新工具栏
  $('envInfo').innerHTML = `
    <span class="env-info-tag">Python ${escapeHtml(inst.version)}</span>
    <span class="env-info-path" title="${escapeAttr(inst.executable)}">${escapeHtml(inst.executable)}</span>
  `;

  // 启用操作按钮
  $('btnInstall').disabled = !inst.has_pip;
  $('btnUpgradePip').disabled = !inst.has_pip;
  $('searchInput').disabled = !inst.has_pip;
  $('searchInput').value = '';

  // 加载包
  if (inst.has_pip) {
    loadPackages(inst.executable);
  } else {
    state.packages = [];
    renderPackages();
    $('emptyState').style.display = 'flex';
    $('emptyState').querySelector('h3').textContent = '该环境未安装 pip';
    $('emptyState').querySelector('p').textContent = '请先为该 Python 环境安装 pip';
  }
}

// ---------------------------------------------------------------------------
// 包列表
// ---------------------------------------------------------------------------

async function loadPackages(path) {
  $('loadingState').style.display = 'flex';
  $('pkgTable').style.display = 'none';
  $('emptyState').style.display = 'none';
  setStatus('正在加载包列表...');

  try {
    const res = await fetch(API.packages(path));
    const data = await res.json();
    state.packages = data.data || [];
    state.filteredPackages = state.packages;
    renderPackages();
    setStatus(`共 ${state.packages.length} 个包`);
  } catch (e) {
    toast('加载包列表失败: ' + e.message, 'error');
    setStatus('加载失败');
  } finally {
    $('loadingState').style.display = 'none';
  }
}

function renderPackages() {
  const body = $('pkgBody');
  const pkgs = state.filteredPackages;

  if (pkgs.length === 0) {
    body.innerHTML = '';
    if (state.packages.length === 0 && state.selectedEnv) {
      $('emptyState').style.display = 'flex';
      $('pkgTable').style.display = 'none';
    } else {
      $('emptyState').style.display = 'none';
      $('pkgTable').style.display = 'table';
      $('emptyState').querySelector('h3').textContent = '未找到匹配的包';
      $('emptyState').querySelector('p').textContent = '尝试修改搜索关键词';
      if (state.filteredPackages.length === 0 && $('searchInput').value) {
        $('emptyState').style.display = 'flex';
        $('pkgTable').style.display = 'none';
      }
    }
    return;
  }

  $('emptyState').style.display = 'none';
  $('pkgTable').style.display = 'table';

  body.innerHTML = pkgs.map(pkg => `
    <tr>
      <td><span class="pkg-name">${escapeHtml(pkg.name)}</span></td>
      <td><span class="pkg-version">${escapeHtml(pkg.version)}</span></td>
      <td><span class="pkg-location" title="${escapeAttr(pkg.location || '')}">${escapeHtml(pkg.location || '—')}</span></td>
      <td class="col-actions">
        <button class="icon-btn" onclick="openUninstallModal('${escapeAttr(pkg.name)}')" title="卸载 ${escapeAttr(pkg.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function filterPackages(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    state.filteredPackages = state.packages;
  } else {
    state.filteredPackages = state.packages.filter(p =>
      p.name.toLowerCase().includes(q)
    );
  }
  renderPackages();
  setStatus(`显示 ${state.filteredPackages.length} / ${state.packages.length} 个包`);
}

// ---------------------------------------------------------------------------
// 安装包
// ---------------------------------------------------------------------------

function openInstallModal() {
  if (!state.selectedEnv) return;
  $('installInput').value = '';
  $('installOutput').style.display = 'none';
  $('installOutput').textContent = '';
  $('installConfirm').disabled = false;
  openModal('installModal');
  setTimeout(() => $('installInput').focus(), 100);
}

async function handleInstall() {
  const pkg = $('installInput').value.trim();
  if (!pkg || !state.selectedEnv) return;

  const output = $('installOutput');
  output.style.display = 'block';
  output.textContent = `正在安装 ${pkg}...\n`;
  output.classList.remove('error');
  $('installConfirm').disabled = true;

  try {
    const res = await fetch(API.install, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        python_path: state.selectedEnv.executable,
        package: pkg,
      }),
    });
    const data = await res.json();

    output.textContent = data.output || data.error || '';

    if (data.success) {
      output.classList.remove('error');
      toast(`成功安装 ${pkg}`, 'success');
      // 刷新包列表
      loadPackages(state.selectedEnv.executable);
      setTimeout(() => closeModal('installModal'), 1500);
    } else {
      output.classList.add('error');
      toast(`安装失败: ${pkg}`, 'error');
    }
  } catch (e) {
    output.classList.add('error');
    output.textContent = '网络错误: ' + e.message;
    toast('网络错误', 'error');
  } finally {
    $('installConfirm').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 卸载包
// ---------------------------------------------------------------------------

function openUninstallModal(pkgName) {
  state.uninstallTarget = pkgName;
  $('uninstallPkgName').textContent = pkgName;
  $('uninstallOutput').style.display = 'none';
  $('uninstallOutput').textContent = '';
  $('uninstallConfirm').disabled = false;
  openModal('uninstallModal');
}

async function handleUninstall() {
  const pkg = state.uninstallTarget;
  if (!pkg || !state.selectedEnv) return;

  const output = $('uninstallOutput');
  output.style.display = 'block';
  output.textContent = `正在卸载 ${pkg}...\n`;
  output.classList.remove('error');
  $('uninstallConfirm').disabled = true;

  try {
    const res = await fetch(API.uninstall, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        python_path: state.selectedEnv.executable,
        package: pkg,
      }),
    });
    const data = await res.json();

    output.textContent = data.output || data.error || '';

    if (data.success) {
      toast(`已卸载 ${pkg}`, 'success');
      loadPackages(state.selectedEnv.executable);
      setTimeout(() => closeModal('uninstallModal'), 1000);
    } else {
      output.classList.add('error');
      toast(`卸载失败: ${pkg}`, 'error');
    }
  } catch (e) {
    output.classList.add('error');
    output.textContent = '网络错误: ' + e.message;
    toast('网络错误', 'error');
  } finally {
    $('uninstallConfirm').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 升级 pip
// ---------------------------------------------------------------------------

async function handleUpgradePip() {
  if (!state.selectedEnv) return;
  toast('正在升级 pip...', 'info');
  setStatus('正在升级 pip...');

  try {
    const res = await fetch(API.upgradePip, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ python_path: state.selectedEnv.executable }),
    });
    const data = await res.json();
    if (data.success) {
      toast('pip 升级完成', 'success');
      loadInstallations();
    } else {
      toast('pip 升级失败', 'error');
    }
  } catch (e) {
    toast('网络错误: ' + e.message, 'error');
  }
  setStatus('就绪');
}

// ---------------------------------------------------------------------------
// 镜像源
// ---------------------------------------------------------------------------

async function loadMirrorInfo() {
  try {
    const res = await fetch(API.getMirror);
    const data = await res.json();
    if (data.success) {
      updateMirrorBadge(data.data.index_url);
    }
  } catch (e) {
    // 静默失败
  }
}

function updateMirrorBadge(url) {
  const badge = $('mirrorBadge');
  if (!url || url.includes('pypi.org')) {
    badge.textContent = '官方';
    badge.className = 'mirror-badge official';
  } else {
    // 提取域名
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch (e) {}
    // 简化显示
    const map = {
      'pypi.tuna.tsinghua.edu.cn': '清华',
      'mirrors.aliyun.com': '阿里云',
      'pypi.mirrors.ustc.edu.cn': '中科大',
      'pypi.douban.com': '豆瓣',
      'mirrors.huaweicloud.com': '华为云',
      'mirrors.cloud.tencent.com': '腾讯云',
    };
    badge.textContent = map[host] || '自定义';
    badge.className = 'mirror-badge custom';
  }
}

async function loadPresetMirrors() {
  try {
    const res = await fetch(API.presetMirrors);
    const data = await res.json();
    if (data.success) {
      const html = data.data.map(m => `
        <span class="preset-chip" data-url="${escapeAttr(m.url)}">${escapeHtml(m.name)}</span>
      `).join('');
      $('presetList').innerHTML = html;
      $('presetList').querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          $('mirrorInput').value = chip.dataset.url;
        });
      });
    }
  } catch (e) {
    // 静默
  }
}

function openMirrorModal() {
  $('mirrorInput').value = '';
  $('mirrorOutput').style.display = 'none';
  $('mirrorOutput').textContent = '';
  // 加载当前源
  fetch(API.getMirror)
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        $('currentMirrorUrl').textContent = data.data.index_url;
        $('mirrorInput').value = data.data.index_url;
      }
    });
  openModal('mirrorModal');
  setTimeout(() => $('mirrorInput').focus(), 100);
}

async function handleSetMirror() {
  const url = $('mirrorInput').value.trim();
  if (!url) return;

  const output = $('mirrorOutput');
  output.style.display = 'block';
  output.textContent = '正在设置镜像源...\n';
  output.classList.remove('error');
  $('mirrorConfirm').disabled = true;

  try {
    const res = await fetch(API.setMirror, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index_url: url }),
    });
    const data = await res.json();

    if (data.success) {
      output.textContent = `已设置镜像源: ${data.data.index_url}\n配置文件: ${data.data.config_path}`;
      output.classList.remove('error');
      updateMirrorBadge(data.data.index_url);
      toast('镜像源已更新', 'success');
      setTimeout(() => closeModal('mirrorModal'), 1200);
    } else {
      output.textContent = data.error || '设置失败';
      output.classList.add('error');
      toast('设置失败', 'error');
    }
  } catch (e) {
    output.classList.add('error');
    output.textContent = '网络错误: ' + e.message;
    toast('网络错误', 'error');
  } finally {
    $('mirrorConfirm').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function openModal(id) {
  $(id).classList.add('show');
}

function closeModal(id) {
  $(id).classList.remove('show');
}

function setStatus(text) {
  $('statusText').textContent = text;
}

function toast(message, type = 'info') {
  const container = $('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = 'all 0.25s ease';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  if (str == null) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 暴露给内联 onclick
window.openUninstallModal = openUninstallModal;
window.selectEnv = selectEnv;
