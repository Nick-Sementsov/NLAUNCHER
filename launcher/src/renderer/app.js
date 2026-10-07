'use strict';
/* global km */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  info: null,
  settings: null,
  accounts: [],
  selectedAccount: null,
  versions: null,       // { versions, latest, fabric }
  builds: [],           // сборки из панели
  panelSettings: {},
  kind: 'vanilla',      // открытая вкладка арсенала
  launching: false,
  playing: false,
};

const STEVE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">' +
  '<rect width="8" height="8" fill="#6b4a2b"/><rect y="2" width="8" height="6" fill="#c69c6d"/>' +
  '<rect x="1" y="4" width="2" height="1" fill="#fff"/><rect x="2" y="4" width="1" height="1" fill="#4b3a8f"/>' +
  '<rect x="5" y="4" width="2" height="1" fill="#fff"/><rect x="5" y="4" width="1" height="1" fill="#4b3a8f"/>' +
  '<rect x="3" y="6" width="2" height="1" fill="#7a4a35"/></svg>');

// ── Утилиты ─────────────────────────────────────────────────────
async function api(promise) {
  const res = await promise;
  if (!res?.ok) throw new Error(res?.error || 'Ошибка');
  return res.data;
}

function toast(text, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 4000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function avatarUrl(acc) {
  if (!acc) return STEVE;
  if (acc.type === 'microsoft') return `https://mc-heads.net/avatar/${acc.uuid}/64`;
  return STEVE;
}

function setAvatar(img, acc) {
  img.onerror = () => { img.onerror = null; img.src = STEVE; };
  img.src = avatarUrl(acc);
}

function modal(title, html, actions = [{ label: 'Закрыть' }]) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  const box = $('#modalActions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || 'btn-gold');
    b.textContent = a.label;
    b.onclick = () => { $('#modal').classList.add('hidden'); a.onClick?.(); };
    box.appendChild(b);
  }
  $('#modal').classList.remove('hidden');
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return ''; }
}

function fmtMem(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0)} ГБ` : `${mb} МБ`;
}

// ── Навигация ───────────────────────────────────────────────────
function go(page) {
  $$('.banner').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
}
$$('.banner').forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
$('#pbAccount').onclick = () => go('accounts');
$('#pbVersion').onclick = () => go('versions');
$('#btnMin').onclick = () => km.minimize();
$('#btnClose').onclick = () => km.close();
$$('[data-open]').forEach(b => b.addEventListener('click', () =>
  api(km.openFolder(b.dataset.open)).catch(e => toast(e.message, 'error'))));

// ── Аккаунты ────────────────────────────────────────────────────
function currentAccount() {
  return state.accounts.find(a => a.id === state.selectedAccount) || null;
}

function renderAccounts() {
  const list = $('#accountList');
  if (!state.accounts.length) {
    list.innerHTML = '<p class="empty">В рыцарском ордене пока никого. Войди через Microsoft или добавь ник справа.</p>';
  } else {
    list.innerHTML = '';
    for (const a of state.accounts) {
      const el = document.createElement('div');
      el.className = 'acc' + (a.id === state.selectedAccount ? ' selected' : '');
      el.innerHTML = `
        <img alt="">
        <div><div class="name">${esc(a.name)}</div>
          <div class="type ${a.type === 'microsoft' ? 'msa' : ''}">${a.type === 'microsoft' ? 'Лицензия' : 'Офлайн'}</div></div>
        <div class="acc-actions">
          ${a.id === state.selectedAccount ? '' : '<button class="btn btn-gold" data-act="select">Выбрать</button>'}
          <button class="btn btn-red" data-act="remove">Изгнать</button>
        </div>`;
      setAvatar(el.querySelector('img'), a);
      el.querySelector('[data-act="select"]')?.addEventListener('click', async () => {
        applyAccounts(await api(km.accounts.select(a.id)));
      });
      el.querySelector('[data-act="remove"]').addEventListener('click', () => {
        modal('Изгнать рыцаря из ордена?', `<p>Аккаунт <b>${esc(a.name)}</b> будет удалён из лаунчера.</p>`, [
          { label: 'Отмена', cls: 'btn-iron' },
          { label: 'Изгнать', cls: 'btn-red', onClick: async () => applyAccounts(await api(km.accounts.remove(a.id))) },
        ]);
      });
      list.appendChild(el);
    }
  }
  const cur = currentAccount();
  $('#pbName').textContent = cur ? cur.name : 'Нет аккаунта';
  $('#sideAccount').textContent = cur ? `${cur.name} (${cur.type === 'microsoft' ? 'лицензия' : 'офлайн'})` : '—';
  setAvatar($('#pbAvatar'), cur);
}

function applyAccounts(data) {
  state.accounts = data.accounts;
  state.selectedAccount = data.selected;
  renderAccounts();
}

$('#btnAddMs').onclick = async () => {
  const btn = $('#btnAddMs');
  btn.disabled = true;
  try {
    const acc = await api(km.accounts.addMicrosoft());
    applyAccounts(await api(km.accounts.list()));
    toast(`Добро пожаловать, ${acc.name}!`);
  } catch (e) {
    if (!/закрыто/i.test(e.message)) toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
};

$('#offlineForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const acc = await api(km.accounts.addOffline($('#offlineName').value));
    $('#offlineName').value = '';
    applyAccounts(await api(km.accounts.list()));
    toast(`${acc.name} посвящён в рыцари`);
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ── Версии ──────────────────────────────────────────────────────
function versionLabel(sel) {
  if (!sel) return '—';
  if (sel.kind === 'server') {
    const b = state.builds.find(x => x.id === sel.id);
    return b ? b.name : 'Сборка сервера';
  }
  return sel.kind === 'fabric' ? `Fabric ${sel.id}` : sel.id;
}

function selectVersion(sel) {
  state.settings.selectedVersion = sel;
  api(km.settings.update({ selectedVersion: sel })).catch(() => {});
  updateVersionLabels();
  renderVersions();
}

function updateVersionLabels() {
  const label = versionLabel(state.settings.selectedVersion);
  $('#pbVersionName').textContent = label;
  $('#sideVersion').textContent = label;
}

function renderVersions() {
  const grid = $('#versionGrid');
  const q = $('#versionSearch').value.trim().toLowerCase();
  const sel = state.settings.selectedVersion;
  grid.innerHTML = '';
  $('#chkSnapshots').closest('label').classList.toggle('hidden', state.kind === 'server');

  let cards = [];
  if (state.kind === 'server') {
    cards = state.builds.map(b => ({
      sel: { kind: 'server', id: b.id },
      title: b.name,
      sub: `Minecraft ${b.version}${b.type && b.type !== 'vanilla' ? ' · ' + b.type : ''}`,
      desc: `${b.description || ''}${b.modCount ? ` Модов: ${b.modCount}.` : ''}`,
      badge: '<span class="badge srv">Сервер</span>',
    }));
  } else if (state.versions) {
    const fabric = new Set(state.versions.fabric);
    cards = state.versions.versions
      .filter(v => state.kind === 'vanilla' || fabric.has(v.id))
      .map(v => ({
        sel: { kind: state.kind, id: v.id },
        title: v.id,
        sub: fmtDate(v.releaseTime),
        badge: v.type === 'snapshot' ? '<span class="badge snap">Снапшот</span>'
          : v.id === state.versions.latest?.release ? '<span class="badge">Новейшая</span>' : '',
      }));
  }
  if (q) cards = cards.filter(c => c.title.toLowerCase().includes(q));

  if (!cards.length) {
    grid.innerHTML = `<p class="empty">${state.kind === 'server'
      ? 'Панель сервера не прислала сборок. Проверь адрес панели в Кузнице.'
      : state.versions ? 'Ничего не нашлось.' : 'Свитки с версиями ещё не доставлены…'}</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const c of cards.slice(0, 300)) {
    const el = document.createElement('button');
    const isSel = sel && sel.kind === c.sel.kind && sel.id === c.sel.id;
    el.className = 'vcard' + (isSel ? ' selected' : '');
    el.innerHTML = `${c.badge || ''}<b>${esc(c.title)}</b><small>${esc(c.sub)}</small>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}`;
    el.onclick = () => selectVersion(c.sel);
    frag.appendChild(el);
  }
  grid.appendChild(frag);
}

$$('#versionTabs .tab').forEach(t => t.addEventListener('click', () => {
  $$('#versionTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  state.kind = t.dataset.kind;
  renderVersions();
}));
$('#versionSearch').oninput = renderVersions;
$('#chkSnapshots').onchange = async e => {
  state.settings.showSnapshots = e.target.checked;
  await api(km.settings.update({ showSnapshots: e.target.checked }));
  loadVersions();
};

async function loadVersions() {
  try {
    state.versions = await api(km.versions(state.settings.showSnapshots));
    if (!state.settings.selectedVersion && state.versions.latest?.release) {
      selectVersion({ kind: 'vanilla', id: state.versions.latest.release });
    }
  } catch (e) {
    toast('Не удалось получить список версий: ' + e.message, 'error');
  }
  renderVersions();
}

// ── Панель сервера: новости, сборки, статус ─────────────────────
async function loadPanel() {
  try {
    const cfg = await api(km.panel.config());
    state.builds = cfg.builds || [];
    state.panelSettings = cfg.settings || {};
  } catch {
    state.builds = [];
    state.panelSettings = {};
  }
  updateVersionLabels();
  renderVersions();
  pingServer();

  const list = $('#newsList');
  try {
    const news = await api(km.panel.news());
    if (!news.length) { list.innerHTML = '<p class="muted">Глашатай молчит: новостей нет.</p>'; return; }
    list.innerHTML = news.map(n => `
      <div class="news-item">
        <h4>${esc(n.title)}</h4>
        <div class="meta">${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ''}${esc(fmtDate(n.date))}</div>
        <p>${esc(n.body)}</p>
      </div>`).join('');
  } catch {
    list.innerHTML = '<p class="muted">Гонец не добрался до замка: новости недоступны.</p>';
  }
}

async function pingServer() {
  const ip = state.panelSettings.serverIp;
  const st = $('#srvStatus');
  const btn = $('#btnJoinServer');
  if (!ip) {
    st.className = 'srv-status';
    st.lastElementChild.textContent = 'Адрес сервера не задан';
    $('#srvMotd').textContent = '';
    btn.disabled = true;
    return;
  }
  try {
    const r = await api(km.ping(ip));
    st.className = 'srv-status online';
    st.lastElementChild.textContent = `В сети: ${r.players} / ${r.max} · ${r.latency} мс`;
    $('#srvMotd').textContent = r.motd || ip;
    btn.disabled = false;
  } catch {
    st.className = 'srv-status offline';
    st.lastElementChild.textContent = 'Сервер спит';
    $('#srvMotd').textContent = ip;
    btn.disabled = false;
  }
}

$('#btnJoinServer').onclick = () => {
  const build = state.builds.find(b => b.id === state.panelSettings.defaultBuild) || state.builds[0];
  if (build) play({ kind: 'server', id: build.id });
  else {
    const v = state.settings.selectedVersion;
    if (!v) return toast('Сначала выбери версию', 'error');
    play({ ...v, joinServer: state.panelSettings.serverIp });
  }
};

// ── Настройки ───────────────────────────────────────────────────
function renderSettings() {
  const s = state.settings;
  const max = Math.max(2048, Math.floor((state.info.totalMemMb * 0.8) / 512) * 512);
  const slider = $('#ramSlider');
  slider.max = max;
  slider.value = Math.min(s.memoryMb, max);
  $('#ramValue').textContent = fmtMem(+slider.value);
  $('#ramHint').textContent = `В компьютере ${fmtMem(state.info.totalMemMb)}. Для ванильной игры хватит 2–4 ГБ, для сборок с модами 4–8 ГБ.`;
  $('#sideMemory').textContent = fmtMem(+slider.value);
  $('#resW').value = s.resolution.width;
  $('#resH').value = s.resolution.height;
  $('#chkFullscreen').checked = !!s.resolution.fullscreen;
  $('#chkClose').checked = !!s.closeOnLaunch;
  $('#jvmArgs').value = s.jvmArgs || '';
  $('#panelUrl').value = s.panelUrl || '';
  $('#chkSnapshots').checked = !!s.showSnapshots;
  $('#dirHint').textContent = 'Игра хранится в ' + state.info.gameDir;
}

function saveSetting(patch) {
  Object.assign(state.settings, patch);
  api(km.settings.update(patch)).catch(e => toast(e.message, 'error'));
}

$('#ramSlider').oninput = e => {
  $('#ramValue').textContent = fmtMem(+e.target.value);
  $('#sideMemory').textContent = fmtMem(+e.target.value);
};
$('#ramSlider').onchange = e => saveSetting({ memoryMb: +e.target.value });
const saveRes = () => saveSetting({ resolution: {
  width: Math.max(640, +$('#resW').value || 1280),
  height: Math.max(480, +$('#resH').value || 720),
  fullscreen: $('#chkFullscreen').checked,
} });
$('#resW').onchange = saveRes;
$('#resH').onchange = saveRes;
$('#chkFullscreen').onchange = saveRes;
$('#chkClose').onchange = e => saveSetting({ closeOnLaunch: e.target.checked });
$('#jvmArgs').onchange = e => saveSetting({ jvmArgs: e.target.value.trim() });
$('#panelUrl').onchange = e => { saveSetting({ panelUrl: e.target.value.trim() }); loadPanel(); };

// ── Консоль ─────────────────────────────────────────────────────
const consoleEl = $('#console');
let logBuffer = '';
let logFlush = null;
function appendLog(text) {
  logBuffer += text;
  if (logFlush) return;
  logFlush = requestAnimationFrame(() => {
    const atBottom = consoleEl.scrollTop + consoleEl.clientHeight >= consoleEl.scrollHeight - 30;
    consoleEl.textContent = (consoleEl.textContent + logBuffer).slice(-200000);
    logBuffer = '';
    logFlush = null;
    if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
  });
}
$('#btnCopyLog').onclick = () => { navigator.clipboard.writeText(consoleEl.textContent); toast('Хроники скопированы'); };
$('#btnClearLog').onclick = () => { consoleEl.textContent = ''; };

// ── Запуск ──────────────────────────────────────────────────────
function setProgress(stage, percent) {
  $('#progressStage').textContent = stage;
  $('#progressFill').style.width = (percent ?? 0) + '%';
}

function setBusy(busy, label) {
  const btn = $('#btnPlay');
  btn.disabled = busy;
  btn.classList.toggle('busy', busy);
  btn.querySelector('span').textContent = label || (busy ? 'В пути…' : 'Играть');
}

async function play(target) {
  if (state.launching || state.playing) return;
  if (!currentAccount()) { go('accounts'); return toast('Сначала посвяти рыцаря в орден', 'error'); }
  if (!target) { go('versions'); return toast('Выбери версию в арсенале', 'error'); }
  state.launching = true;
  setBusy(true);
  setProgress('Готовимся к походу…', 0);
  appendLog(`\n=== Запуск ${versionLabel(target)} (${new Date().toLocaleTimeString('ru-RU')}) ===\n`);
  try {
    await api(km.launch(target));
  } catch (e) {
    state.launching = false;
    setBusy(false);
    setProgress('Поход сорвался', 0);
    modal('Не удалось запустить', `<p>${esc(e.message)}</p>`);
  }
}

$('#btnPlay').onclick = () => play(state.settings.selectedVersion);

km.on.progress(p => {
  setProgress(p.stage, p.percent);
  if (p.started) {
    state.launching = false;
    state.playing = true;
    setBusy(true, 'В игре');
  }
});
km.on.log(appendLog);
km.on.exit(info => {
  state.launching = false;
  state.playing = false;
  setBusy(false);
  setProgress(info.crashed ? 'Игра пала в бою' : 'Готов к турниру', info.crashed ? 0 : 100);
  if (info.crashed) {
    modal('Игра завершилась с ошибкой',
      `<p>Код выхода: ${esc(info.code)}. Последние строки хроник:</p><pre>${esc(info.tail || 'нет вывода')}</pre>`,
      [{ label: 'Открыть хроники', cls: 'btn-iron', onClick: () => go('console') }, { label: 'Закрыть' }]);
  }
});

km.on.update(u => {
  const el = $('#updateBadge');
  el.classList.remove('hidden');
  if (u.state === 'ready') {
    el.textContent = `Обновление ${u.version}: установить`;
    el.onclick = () => km.installUpdate();
  } else {
    el.textContent = `Скачиваем обновление ${u.version}…`;
  }
});

// ── Заставка: врата открываются, клик пропускает ─────────────────
(() => {
  const intro = $('#intro');
  if (!intro) return;
  const done = () => intro.remove();
  intro.addEventListener('click', () => { intro.classList.add('skip'); setTimeout(done, 320); });
  setTimeout(done, 3100);
})();

// ── Старт ───────────────────────────────────────────────────────
(async function init() {
  state.info = await api(km.info());
  state.settings = await api(km.settings.get());
  $('#appVersion').textContent = 'KM Launcher v' + state.info.version;
  applyAccounts(await api(km.accounts.list()));
  renderSettings();
  updateVersionLabels();
  loadVersions();
  loadPanel();
  setInterval(pingServer, 60000);
})().catch(e => toast(e.message, 'error'));
