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
    list.innerHTML = '<p class="empty">Аккаунтов пока нет. Войди через Microsoft или добавь ник справа.</p>';
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
          <button class="btn btn-red" data-act="remove">Удалить</button>
        </div>`;
      setAvatar(el.querySelector('img'), a);
      el.querySelector('[data-act="select"]')?.addEventListener('click', async () => {
        applyAccounts(await api(km.accounts.select(a.id)));
      });
      el.querySelector('[data-act="remove"]').addEventListener('click', () => {
        modal('Удалить аккаунт?', `<p>Аккаунт <b>${esc(a.name)}</b> будет удалён из лаунчера.</p>`, [
          { label: 'Отмена', cls: 'btn-iron' },
          { label: 'Удалить', cls: 'btn-red', onClick: async () => applyAccounts(await api(km.accounts.remove(a.id))) },
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

// Вход по лицензии: одна функция для всех кнопок «Войти через Microsoft»
const LINKS = {
  xbox: 'https://www.xbox.com/ru-RU/live',
  buy: 'https://www.minecraft.net/ru-ru/store/minecraft-java-bedrock-edition-pc',
};
async function msLogin(btn) {
  document.querySelectorAll('[data-ms-login]').forEach(b => { b.disabled = true; b.classList.add('loading'); });
  toast('Открываем окно входа Microsoft…');
  try {
    const acc = await api(km.accounts.addMicrosoft());
    applyAccounts(await api(km.accounts.list()));
    closeWelcome();
    celebrate(btn);
    toast(`Добро пожаловать, ${acc.name}!`);
  } catch (e) {
    if (/закрыто/i.test(e.message)) return;
    const actions = [{ label: 'Закрыть', cls: 'btn-iron' }];
    if (/xbox/i.test(e.message)) actions.unshift({ label: 'Создать профиль Xbox', onClick: () => window.open(LINKS.xbox) });
    if (/не куплен/i.test(e.message)) actions.unshift({ label: 'Купить Minecraft', onClick: () => window.open(LINKS.buy) });
    actions.push({ label: 'Попробовать снова', onClick: () => msLogin(btn) });
    modal('Не получилось войти', `<p>${esc(e.message)}</p>`, actions);
  } finally {
    document.querySelectorAll('[data-ms-login]').forEach(b => { b.disabled = false; b.classList.remove('loading'); });
  }
}
document.querySelectorAll('[data-ms-login]').forEach(b => { b.onclick = () => msLogin(b); });

// Первый запуск: экран выбора входа
function openWelcome() { $('#welcome').classList.remove('hidden'); }
function closeWelcome() {
  const w = $('#welcome');
  if (w.classList.contains('hidden')) return;
  w.classList.add('leaving');
  setTimeout(() => { w.classList.add('hidden'); w.classList.remove('leaving'); }, 400);
}
$('#welcomeSkip').onclick = closeWelcome;
$('#welcomeOffline').onsubmit = async e => {
  e.preventDefault();
  try {
    const acc = await api(km.accounts.addOffline(e.target.nick.value));
    applyAccounts(await api(km.accounts.list()));
    closeWelcome();
    toast(`${acc.name} добавлен`);
  } catch (err) {
    toast(err.message, 'error');
  }
};

// Золотой салют из элемента
function celebrate(el) {
  const r = (el && el.getBoundingClientRect && el.getBoundingClientRect().width) ? el.getBoundingClientRect()
    : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('i');
    p.className = 'burst';
    const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 110;
    p.style.left = cx + 'px'; p.style.top = cy + 'px';
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    p.style.animationDelay = (Math.random() * .12).toFixed(2) + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

$('#offlineForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const acc = await api(km.accounts.addOffline($('#offlineName').value));
    $('#offlineName').value = '';
    applyAccounts(await api(km.accounts.list()));
    toast(`${acc.name} добавлен`);
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
  renderVersions(true);
}

function updateVersionLabels() {
  const label = versionLabel(state.settings.selectedVersion);
  $('#pbVersionName').textContent = label;
  $('#sideVersion').textContent = label;
}

function renderVersions(quiet = false) {
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
      ? 'Сборок сервера пока нет.'
      : state.versions ? 'Ничего не нашлось.' : 'Загружаем список версий…'}</p>`;
    return;
  }
  const frag = document.createDocumentFragment();
  cards.slice(0, 300).forEach((c, i) => {
    const el = document.createElement('button');
    el.style.setProperty('--i', i);
    if (quiet) el.style.animation = 'none';
    const isSel = sel && sel.kind === c.sel.kind && sel.id === c.sel.id;
    el.className = 'vcard' + (isSel ? ' selected' : '');
    el.innerHTML = `${c.badge || ''}<b>${esc(c.title)}</b><small>${esc(c.sub)}</small>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}`;
    el.onclick = () => selectVersion(c.sel);
    if (quiet && isSel) el.classList.add('pop');
    frag.appendChild(el);
  });
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
    if (!news.length) { list.innerHTML = '<p class="muted">Новостей пока нет.</p>'; return; }
    list.innerHTML = news.map(n => `
      <div class="news-item">
        <h4>${esc(n.title)}</h4>
        <div class="meta">${n.tag ? `<span class="tag">${esc(n.tag)}</span>` : ''}${esc(fmtDate(n.date))}</div>
        <p>${esc(n.body)}</p>
      </div>`).join('');
  } catch {
    list.innerHTML = '<p class="muted">Не удалось загрузить новости.</p>';
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
    st.lastElementChild.textContent = 'Сервер недоступен';
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
  $('#chkSnapshots').checked = !!s.showSnapshots;
  $('#dirHint').textContent = 'Игра хранится в ' + state.info.gameDir;
}

// ── Темы и анимации ─────────────────────────────────────────────
const THEMES = [
  { id: 'royal', name: 'Королевство', colors: ['#23407e', '#8f1d1d', '#d4a84b'] },
  { id: 'forest', name: 'Тёмный лес', colors: ['#2b6a3c', '#7a3b12', '#d4a84b'] },
  { id: 'dragon', name: 'Пламя дракона', colors: ['#8f1d1d', '#e07a2e', '#f2b84b'] },
  { id: 'ice', name: 'Ледяная крепость', colors: ['#3c78a8', '#2c5d80', '#dfe8f2'] },
  { id: 'purple', name: 'Королевский пурпур', colors: ['#55309a', '#8f1d4a', '#d4a84b'] },
  { id: 'night', name: 'Тёмная ночь', colors: ['#3a3f4f', '#5a2a2a', '#b8b8c8'] },
];

function applyLook() {
  const s = state.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme || 'royal';
  root.classList.toggle('no-anim', s.animations === false);
  root.classList.toggle('no-intro', s.intro === false);
  weather.set(s.theme || 'royal');
  weather.enable(s.animations !== false);
  try { localStorage.setItem('km-look', JSON.stringify({ theme: s.theme, animations: s.animations, intro: s.intro })); } catch {}
  const list = $('#themeList');
  list.innerHTML = '';
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.className = 'theme' + (t.id === (s.theme || 'royal') ? ' active' : '');
    b.innerHTML = `<span class="sw">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${esc(t.name)}</b>`;
    b.onclick = () => {
      saveSetting({ theme: t.id });
      document.body.classList.add('theme-switch');
      setTimeout(() => document.body.classList.remove('theme-switch'), 600);
      applyLook();
      celebrate(b);
    };
    list.appendChild(b);
  }
  $('#chkAnim').checked = s.animations !== false;
  $('#chkIntro').checked = s.intro !== false;
}
$('#chkAnim').onchange = e => { saveSetting({ animations: e.target.checked }); applyLook(); };
$('#chkIntro').onchange = e => { saveSetting({ intro: e.target.checked }); applyLook(); };

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
$('#btnCopyLog').onclick = () => { navigator.clipboard.writeText(consoleEl.textContent); toast('Скопировано'); };
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
  btn.querySelector('span').textContent = label || (busy ? 'Запуск…' : 'Играть');
}

async function play(target) {
  if (state.launching || state.playing) return;
  if (!currentAccount()) { openWelcome(); return; }
  if (!target) { go('versions'); return toast('Выбери версию', 'error'); }
  state.launching = true;
  celebrate($('#btnPlay'));
  setBusy(true);
  setProgress('Подготовка…', 0);
  appendLog(`\n=== Запуск ${versionLabel(target)} (${new Date().toLocaleTimeString('ru-RU')}) ===\n`);
  try {
    await api(km.launch(target));
  } catch (e) {
    state.launching = false;
    setBusy(false);
    setProgress('Запуск не удался', 0);
    modal('Не удалось запустить', `<p>${esc(e.message)}</p>`);
  }
}

$('#btnPlay').onclick = () => {
  if (!state.playing) return play(state.settings.selectedVersion);
  modal('Закрыть игру?', '<p>Игра будет принудительно закрыта. Несохранённый прогресс может пропасть.</p>', [
    { label: 'Отмена', cls: 'btn-iron' },
    { label: 'Закрыть игру', cls: 'btn-red', onClick: () => api(km.stop()).catch(e => toast(e.message, 'error')) },
  ]);
};

km.on.progress(p => {
  setProgress(p.stage, p.percent);
  if (p.started) {
    state.launching = false;
    state.playing = true;
    celebrate($('#btnPlay'));
    toast('Игра запущена! Удачи в походе');
    setBusy(true, 'Закрыть игру');
    $('#btnPlay').disabled = false;
    $('#btnPlay').classList.add('playing');
  }
});
km.on.log(appendLog);
km.on.exit(info => {
  state.launching = false;
  state.playing = false;
  $('#btnPlay').classList.remove('playing');
  setBusy(false);
  setProgress(info.crashed ? 'Игра вылетела' : 'Готов к игре', info.crashed ? 0 : 100);
  if (info.crashed) {
    modal('Игра завершилась с ошибкой',
      `<p>Код выхода: ${esc(info.code)}. Последние строки консоли:</p><pre>${esc(info.tail || 'нет вывода')}</pre>`,
      [{ label: 'Открыть консоль', cls: 'btn-iron', onClick: () => go('console') }, { label: 'Закрыть' }]);
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
  if (document.documentElement.classList.contains('no-intro')) return intro.remove();
  const done = () => intro.remove();
  intro.addEventListener('click', () => { intro.classList.add('skip'); setTimeout(done, 320); });
  setTimeout(done, 3100);
})();

// ── Погода: свои частицы у каждой темы ─────────────────────────
const weather = (() => {
  const cv = $('#weather');
  const ctx = cv.getContext('2d');
  const KINDS = {
    royal:  { n: 40, make: () => ({ r: 1 + Math.random() * 1.6, vx: (Math.random() - .5) * .15, vy: -.12 - Math.random() * .2, c: '242,210,124', tw: true }) },
    forest: { n: 34, make: () => Math.random() < .55
      ? ({ leaf: true, r: 4 + Math.random() * 3, vx: .2 + Math.random() * .5, vy: .5 + Math.random() * .6, rot: Math.random() * 6, vr: (Math.random() - .5) * .05, c: ['122,150,60', '170,110,40', '140,70,30'][Math.random() * 3 | 0] })
      : ({ r: 1.4 + Math.random(), vx: (Math.random() - .5) * .3, vy: (Math.random() - .5) * .3, c: '216,255,106', tw: true, glow: true }) },
    dragon: { n: 55, make: () => ({ r: .8 + Math.random() * 1.8, vx: (Math.random() - .5) * .4, vy: -.5 - Math.random() * .9, c: Math.random() < .7 ? '255,140,40' : '255,210,120', glow: true, life: true }) },
    ice:    { n: 90, make: () => ({ r: 1 + Math.random() * 2.4, vx: -.2 + Math.random() * .4, vy: .4 + Math.random() * .9, c: '240,248,255', sway: Math.random() * 6 }) },
    purple: { n: 45, make: () => ({ r: .8 + Math.random() * 1.6, vx: (Math.random() - .5) * .25, vy: -.1 - Math.random() * .25, c: Math.random() < .5 ? '195,139,255' : '125,255,200', tw: true, glow: true }) },
    night:  { n: 110, make: () => ({ rain: true, r: 10 + Math.random() * 10, vx: -1.2, vy: 9 + Math.random() * 5, c: '170,185,220' }) },
  };
  let parts = [], kind = 'royal', run = true, t = 0;
  function size() { cv.width = innerWidth; cv.height = innerHeight; }
  function spawn(p, anywhere) {
    const k = KINDS[kind];
    Object.assign(p, k.make());
    p.x = Math.random() * cv.width;
    p.y = anywhere ? Math.random() * cv.height : (p.vy > 0 ? -20 : cv.height + 20);
    p.a = p.life ? 1 : .35 + Math.random() * .5;
    p.ph = Math.random() * 6;
    return p;
  }
  function set(k) {
    kind = KINDS[k] ? k : 'royal';
    parts = Array.from({ length: KINDS[kind].n }, () => spawn({}, true));
  }
  function frame() {
    t += 1;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (run) for (const p of parts) {
      p.x += p.vx + (p.sway ? Math.sin((t + p.sway * 50) / 40) * .4 : 0);
      p.y += p.vy;
      if (p.rot !== undefined) p.rot += p.vr;
      if (p.life) p.a -= .004;
      if (p.y < -30 || p.y > cv.height + 30 || p.x < -30 || p.x > cv.width + 30 || p.a <= 0) spawn(p);
      let a = p.a;
      if (p.tw) a *= .55 + .45 * Math.sin(t / 25 + p.ph);
      ctx.globalAlpha = Math.max(0, a);
      if (p.rain) {
        ctx.strokeStyle = `rgba(${p.c},.5)`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.vx * 2, p.y + p.r); ctx.stroke();
      } else if (p.leaf) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = `rgb(${p.c})`;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r / 2.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        if (p.glow) { ctx.shadowBlur = 8; ctx.shadowColor = `rgb(${p.c})`; }
        ctx.fillStyle = `rgb(${p.c})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  addEventListener('resize', size);
  size(); set(document.documentElement.dataset.theme); frame();
  return { set, enable: on => { run = on; cv.style.display = on ? '' : 'none'; } };
})();

// ── Искры над нижней панелью ─────────────────────────────────────
(() => {
  const bar = $('.playbar');
  for (let i = 0; i < 7; i++) {
    const sp = document.createElement('i');
    sp.className = 'spark';
    sp.style.left = (8 + Math.random() * 84) + '%';
    sp.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
    sp.style.animationDuration = (3 + Math.random() * 2.5).toFixed(2) + 's';
    bar.appendChild(sp);
  }
})();

// ── Старт ───────────────────────────────────────────────────────
(async function init() {
  state.info = await api(km.info());
  state.settings = await api(km.settings.get());
  $('#appVersion').textContent = 'KM Launcher v' + state.info.version;
  applyAccounts(await api(km.accounts.list()));
  applyLook();
  if (!state.accounts.length) setTimeout(openWelcome, document.documentElement.classList.contains('no-intro') ? 300 : 2600);
  renderSettings();
  updateVersionLabels();
  loadVersions();
  loadPanel();
  setInterval(pingServer, 60000);
})().catch(e => toast(e.message, 'error'));
