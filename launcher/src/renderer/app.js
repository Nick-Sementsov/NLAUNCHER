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
  if (sel.kind === 'instance') {
    const i = (state.instances || []).find(x => x.id === sel.id);
    return i ? i.name : 'Сборка';
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
    const sel = state.settings.selectedVersion;
    const inst = sel?.kind === 'instance' ? state.instances.find(x => x.id === sel.id) : null;
    const tail = info.tail || '';
    let hint = '';
    if (inst && inst.loader !== 'vanilla' && /Unsupported class file major version|Mappings not present|Incompatible mods? found|requires .*minecraft/i.test(tail)) {
      hint = `<p><b>Похоже, загрузчик ${esc(LOADER_NAMES[inst.loader])} или моды не подходят к Minecraft ${esc(inst.mc)}.</b>
        Открой сборку → «Настройки» и поставь версию загрузчика «Рекомендуемая» или смени загрузчик на Fabric.</p>`;
    }
    modal('Игра завершилась с ошибкой',
      `${hint}<p>Код выхода: ${esc(info.code)}. Последние строки консоли:</p><pre>${esc(tail || 'нет вывода')}</pre>`,
      [{ label: 'Открыть консоль', cls: 'btn-iron', onClick: () => go('console') }, { label: 'Закрыть' }]);
  }
});

// ── Обновление лаунчера: спрашиваем окном ────────────────────────
const upd = { asked: null, choice: null };
function notesHtml(html) {
  // из описания релиза берём только пункты первого раздела, как текст
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const items = [...(doc.querySelector('ul')?.querySelectorAll('li') || [])].slice(0, 6).map(li => li.textContent.trim()).filter(Boolean);
  return items.length ? `<ul class="upd-notes">${items.map(t => `<li>${esc(t.length > 160 ? t.slice(0, 157) + '…' : t)}</li>`).join('')}</ul>` : '';
}
function askUpdate(u) {
  upd.asked = u.version;
  modal(`Вышла новая версия ${u.version}`, `
    <div class="upd-head"><svg class="upd-crest"><use href="#crest"/></svg>
    <p>У тебя версия ${esc(u.current || '')}. Обновить лаунчер сейчас? Это займёт около минуты, лаунчер сам перезапустится.</p></div>
    ${notesHtml(u.notes)}`, [
    { label: 'Позже', cls: 'btn-iron', onClick: () => { upd.choice = 'later'; showUpdateBadge(u); } },
    { label: 'Обновить', onClick: startUpdate },
  ]);
}
function startUpdate() {
  upd.choice = 'yes';
  modal('Обновляем лаунчер', `<p id="updStage">Скачиваем обновление…</p><div class="bar upd-bar"><div class="bar-fill" id="updFill" style="width:0%"></div></div>`, []);
  api(km.downloadUpdate()).catch(e => toast(e.message, 'error'));
}
async function finishUpdate(u) {
  const ok = await api(km.installUpdate()).catch(() => false);
  if (ok === false) {
    modal('Обновление скачано', `<p>Сейчас идёт игра, поэтому лаунчер не перезапускается. Версия ${esc(u.version)} поставится сама, когда закроешь лаунчер.</p>`);
  }
}
function showUpdateBadge(u) {
  const el = $('#updateBadge');
  el.classList.remove('hidden');
  el.textContent = u.state === 'ready' ? `Обновление ${u.version}: установить` : `Доступна версия ${u.version}`;
  el.onclick = () => (u.state === 'ready' ? finishUpdate(u) : askUpdate(u));
}
function onUpdate(u) {
  if (!u) return;
  if (u.state === 'available') {
    if (upd.asked === u.version) return;
    // не перебиваем первое приветствие и заставку
    const show = () => ($('#welcome') && !$('#welcome').classList.contains('hidden') ? setTimeout(show, 3000) : askUpdate(u));
    setTimeout(show, 1500);
  } else if (u.state === 'downloading') {
    if ($('#updFill')) { $('#updFill').style.width = (u.percent || 0) + '%'; $('#updStage').textContent = `Скачиваем обновление… ${u.percent || 0}%`; }
  } else if (u.state === 'ready') {
    if (upd.choice === 'yes') {
      if ($('#updStage')) { $('#updFill').style.width = '100%'; $('#updStage').textContent = 'Готово, перезапускаем…'; }
      setTimeout(() => finishUpdate(u), 700);
    } else showUpdateBadge(u);
  } else if (u.state === 'error' && upd.choice === 'yes') {
    upd.choice = null;
    modal('Не получилось обновить', `<p>${esc(u.message || 'Ошибка сети')}</p><p class="hint">Попробуй позже или скачай установщик с GitHub.</p>`, [
      { label: 'Закрыть', cls: 'btn-iron', onClick: () => showUpdateBadge({ ...u, state: 'available' }) },
      { label: 'Ещё раз', onClick: startUpdate },
    ]);
  }
}
km.on.update(onUpdate);
api(km.updateState()).then(onUpdate).catch(() => {});

// ── Сборки (как в Prism) ────────────────────────────────────────
const LOADER_NAMES = { vanilla: 'Ванилла', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge' };
const KIND_TYPE = { mods: 'mod', resourcepacks: 'resourcepack', shaders: 'shader' };
const KIND_NAMES = { mods: 'моды', resourcepacks: 'ресурспаки', shaders: 'шейдеры', saves: 'миры', screenshots: 'скриншоты' };
const CRATE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">' +
  '<rect width="16" height="16" fill="#7a5230"/><rect x="1" y="1" width="14" height="14" fill="#a8763f"/>' +
  '<rect x="1" y="5" width="14" height="1" fill="#6b4524"/><rect x="1" y="10" width="14" height="1" fill="#6b4524"/>' +
  '<rect x="7" y="1" width="2" height="14" fill="#8a5c2e"/><rect x="6" y="6" width="4" height="4" fill="#d4a84b"/></svg>');

state.instances = [];
state.inst = null;       // открытая сборка
state.instTab = 'mods';
state.content = [];

function instIcon(img, url) {
  img.onerror = () => { img.onerror = null; img.src = CRATE; };
  img.src = url || CRATE;
}

function instSub(i) {
  const lv = i.loaderVersion || i.loaderResolved;
  const loader = i.loader === 'vanilla' ? '' : ` · ${LOADER_NAMES[i.loader]}${lv ? ' ' + lv : ''}`;
  return `Minecraft ${i.mc}${loader}${i.server ? ` · вход на ${i.server}` : ''}`;
}

function fmtNum(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс' : String(n);
}

async function loadInstances() {
  try { state.instances = await api(km.instances.list()); } catch (e) { toast(e.message, 'error'); }
  renderInstances();
  updateVersionLabels();
}

function renderInstances() {
  const grid = $('#instanceGrid');
  grid.innerHTML = '';
  if (!state.instances.length) {
    grid.innerHTML = `<div class="inst-empty parchment"><h3>Сборок пока нет</h3>
      <p>Нажми «Создать сборку», выбери версию и загрузчик (Fabric, Quilt или Forge), а потом добавь моды.
      Или скачай готовую сборку с Modrinth.</p></div>`;
    return;
  }
  const sel = state.settings.selectedVersion;
  state.instances.forEach((i, n) => {
    const el = document.createElement('div');
    el.className = 'icard' + (sel?.kind === 'instance' && sel.id === i.id ? ' selected' : '');
    el.style.setProperty('--i', n);
    el.innerHTML = `<img class="inst-icon" alt="">
      <div class="icard-body"><b>${esc(i.name)}</b><small>${esc(instSub(i))}</small>
      <span class="icard-meta">${i.loader === 'vanilla' ? 'Без модов' : `Модов: ${i.mods}`}${i.lastPlayed ? ' · играл ' + fmtDate(i.lastPlayed) : ''}</span></div>
      <div class="icard-btns"><button class="btn btn-gold" data-a="play">▶ Играть</button><button class="btn btn-iron" data-a="open">Настроить</button></div>`;
    instIcon(el.querySelector('img'), i.icon);
    el.querySelector('[data-a=play]').onclick = e => { e.stopPropagation(); playInstance(i.id); };
    el.querySelector('[data-a=open]').onclick = e => { e.stopPropagation(); openInstance(i.id); };
    el.onclick = () => openInstance(i.id);
    grid.appendChild(el);
  });
}

function playInstance(id) {
  selectVersion({ kind: 'instance', id });
  renderInstances();
  play(state.settings.selectedVersion);
}

// ── Создание сборки ──────────────────────────────────────────────
function newInstanceDialog() {
  if (!state.versions) return toast('Список версий ещё загружается', 'error');
  const releases = state.versions.versions.filter(v => v.type === 'release');
  const opts = releases.map(v => `<option value="${esc(v.id)}">${esc(v.id)}</option>`).join('');
  modal('Новая сборка', `
    <label class="lbl">Название</label>
    <input class="field" id="niName" maxlength="40" placeholder="Моя сборка">
    <label class="lbl">Версия игры</label>
    <select class="field" id="niMc">${opts}</select>
    <label class="lbl">Загрузчик модов</label>
    <div class="seg" id="niLoader">
      ${Object.entries(LOADER_NAMES).map(([k, v]) => `<button type="button" data-l="${k}" class="${k === 'fabric' ? 'on' : ''}">${v}</button>`).join('')}
    </div>
    <div id="niLvWrap"><label class="lbl">Версия загрузчика</label><select class="field" id="niLv"><option value="">Рекомендуемая</option></select></div>
    <p class="hint">Fabric: лёгкий и быстрый, много модов для новых версий. Forge: классика для больших модпаков.</p>`, [
    { label: 'Отмена', cls: 'btn-iron' },
    { label: 'Создать', onClick: createInstance },
  ]);
  state.niLoader = 'fabric';
  const loadLv = async () => {
    const loader = state.niLoader;
    const sel = $('#niLv');
    $('#niLvWrap').classList.toggle('hidden', loader === 'vanilla');
    sel.innerHTML = '<option value="">Рекомендуемая</option>';
    if (loader === 'vanilla') return;
    const mc = $('#niMc').value;
    try {
      const list = await api(km.loaders(loader, mc));
      if (loader !== state.niLoader || mc !== $('#niMc').value) return;
      if (!list.length) { sel.innerHTML = `<option value="">Нет ${LOADER_NAMES[loader]} для ${esc(mc)}</option>`; return; }
      sel.innerHTML += list.slice(0, 80).map(l => `<option value="${esc(l.id)}">${esc(l.id)}${l.stable ? '' : ' (тест)'}</option>`).join('');
    } catch { /* оставим «Рекомендуемая» */ }
  };
  $$('#niLoader button').forEach(b => b.onclick = () => {
    state.niLoader = b.dataset.l;
    $$('#niLoader button').forEach(x => x.classList.toggle('on', x === b));
    loadLv();
  });
  $('#niMc').onchange = loadLv;
  loadLv();
  setTimeout(() => $('#niName').focus(), 50);
}

async function createInstance() {
  const mc = $('#niMc').value;
  const name = $('#niName').value.trim() || `Сборка ${mc}`;
  try {
    const inst = await api(km.instances.create({ name, mc, loader: state.niLoader, loaderVersion: $('#niLv').value }));
    toast(`Сборка «${inst.name}» создана`);
    await loadInstances();
    openInstance(inst.id);
  } catch (e) { toast(e.message, 'error'); }
}

$('#btnNewInstance').onclick = newInstanceDialog;
$('#btnBrowsePacks').onclick = () => openBrowser({ type: 'modpack' });
$('#btnImportPack').onclick = async () => {
  try {
    taskStart('Импорт сборки…');
    const inst = await api(km.modpack.import());
    taskEnd();
    if (inst) {
      toast(`Сборка «${inst.name}» готова`); celebrate($('#btnImportPack')); await loadInstances(); openInstance(inst.id);
      if (inst.blocked?.length) setTimeout(() => showBlocked(inst.blocked), 600);
    }
  } catch (e) { taskEnd(); toast(e.message, 'error'); }
};

// ── Одна сборка ─────────────────────────────────────────────────
async function openInstance(id) {
  try { state.inst = await api(km.instances.get(id)); } catch (e) { return toast(e.message, 'error'); }
  const i = state.inst;
  $('#instName').textContent = i.name;
  $('#instSub').textContent = instSub(i);
  instIcon($('#instIcon'), i.icon);
  const box = $('#blockedBox');
  box.classList.toggle('hidden', !i.blocked?.length);
  if (i.blocked?.length) box.innerHTML = `<b>Нужно докачать вручную: ${i.blocked.length}</b> — авторы запретили скачивание из лаунчеров.${blockedHtml(i.blocked)}`;
  go('instance');
  $$('.banner').forEach(b => b.classList.toggle('active', b.dataset.page === 'instances'));
  setInstTab(state.instTab);
}

function setInstTab(tab) {
  state.instTab = tab;
  $$('#instTabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const settings = tab === 'settings';
  $('#instContentPane').classList.toggle('hidden', settings);
  $('#instSettingsPane').classList.toggle('hidden', !settings);
  if (settings) return renderInstSettings();
  const noAdd = tab === 'saves' || tab === 'screenshots';
  $('#btnAddModrinth').classList.toggle('hidden', noAdd);
  $('#btnAddFile').classList.toggle('hidden', noAdd);
  $('#btnUpdates').classList.toggle('hidden', tab !== 'mods' || state.inst.loader === 'vanilla');
  $('#contentSearch').value = '';
  loadContent();
}

async function loadContent() {
  const list = $('#contentList');
  list.innerHTML = '<p class="empty">Загружаем…</p>';
  try { state.content = await api(km.instances.content(state.inst.id, state.instTab)); }
  catch (e) { state.content = []; toast(e.message, 'error'); }
  renderContent();
}

function renderContent() {
  const list = $('#contentList');
  const q = $('#contentSearch').value.trim().toLowerCase();
  const tab = state.instTab;
  const items = state.content.filter(c => !q || c.name.toLowerCase().includes(q) || c.file.toLowerCase().includes(q));
  list.innerHTML = '';
  if (!items.length) {
    const vanillaMods = tab === 'mods' && state.inst.loader === 'vanilla';
    list.innerHTML = `<p class="empty">${q ? 'Ничего не нашлось.' : vanillaMods
      ? 'Это ванильная сборка: моды работают только с Fabric, Quilt или Forge. Создай новую сборку с загрузчиком.'
      : tab === 'saves' ? 'Миров пока нет. Они появятся после игры.'
      : tab === 'screenshots' ? 'Скриншотов пока нет. В игре нажми F2, и снимок появится здесь.' : `Здесь пока пусто. Нажми «Добавить с Modrinth», чтобы найти ${KIND_NAMES[tab]}.`}</p>`;
    return;
  }
  if (tab === 'screenshots') return renderShots(items);
  items.forEach((c, n) => {
    const row = document.createElement('div');
    row.className = 'crow' + (c.enabled ? '' : ' off');
    row.style.setProperty('--i', n);
    row.innerHTML = `<img class="inst-icon small" alt="">
      <div class="crow-body"><b>${esc(c.name)}</b><small>${esc(c.version ? c.version + ' · ' : '')}${esc(c.file)}</small></div>
      ${tab === 'saves' ? '<button class="btn btn-iron mini-btn" data-backup title="Сохранить копию мира в папку backups сборки">Копия</button>' : `<label class="switch" title="${c.enabled ? 'Выключить' : 'Включить'}"><input type="checkbox" ${c.enabled ? 'checked' : ''}><i></i></label>`}
      <button class="icon-btn" title="Удалить">✕</button>`;
    instIcon(row.querySelector('img'), c.icon);
    const bk = row.querySelector('[data-backup]');
    if (bk) bk.onclick = async () => {
      bk.disabled = true;
      try {
        const r = await api(km.instances.backupWorld(state.inst.id, c.file));
        toast(`Копия мира сохранена (${fmtSize(r.size)})`);
        api(km.showFile(r.file)).catch(() => {});
      } catch (e) { toast(e.message, 'error'); }
      bk.disabled = false;
    };
    const sw = row.querySelector('.switch input');
    if (sw) sw.onchange = async () => {
      try { await api(km.instances.toggle(state.inst.id, tab, c.file)); } catch (e) { toast(e.message, 'error'); }
      loadContent();
    };
    row.querySelector('.icon-btn').onclick = () => modal('Удалить?', `<p>«${esc(c.name)}» будет удалён из сборки.</p>`, [
      { label: 'Отмена', cls: 'btn-iron' },
      { label: 'Удалить', cls: 'btn-red', onClick: async () => {
        row.classList.add('leaving');
        try { await api(km.instances.removeFile(state.inst.id, tab, c.file)); } catch (e) { toast(e.message, 'error'); }
        setTimeout(loadContent, 250);
      } },
    ]);
    list.appendChild(row);
  });
}

function fmtSize(b) {
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(b / 1024))} КБ`;
}

function renderShots(items) {
  const list = $('#contentList');
  const grid = document.createElement('div');
  grid.className = 'shot-grid';
  items.forEach((c, n) => {
    const el = document.createElement('div');
    el.className = 'shot';
    el.style.setProperty('--i', n);
    el.title = 'Открыть';
    el.innerHTML = `<img loading="lazy" alt=""><small>${esc(new Date(c.mtime).toLocaleString('ru-RU'))}</small><button class="icon-btn" title="Удалить">✕</button>`;
    el.querySelector('img').src = `kmshot://shot/${encodeURIComponent(state.inst.id)}/${encodeURIComponent(c.file)}`;
    el.onclick = () => api(km.openFile(c.path)).catch(e => toast(e.message, 'error'));
    el.querySelector('.icon-btn').onclick = e => {
      e.stopPropagation();
      modal('Удалить скриншот?', `<p>${esc(c.file)}</p>`, [
        { label: 'Отмена', cls: 'btn-iron' },
        { label: 'Удалить', cls: 'btn-red', onClick: async () => {
          el.classList.add('leaving');
          try { await api(km.instances.removeFile(state.inst.id, 'screenshots', c.file)); } catch (err) { toast(err.message, 'error'); }
          setTimeout(loadContent, 250);
        } },
      ]);
    };
    grid.appendChild(el);
  });
  list.appendChild(grid);
}

async function checkModUpdates() {
  const btn = $('#btnUpdates');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '⟳ Ищем обновления…';
  let list = [];
  try { list = await api(km.instances.checkUpdates(state.inst.id)); }
  catch (e) { toast(e.message, 'error'); return; }
  finally { btn.disabled = false; btn.textContent = old; }
  if (!list.length) return toast('Все моды уже самые свежие');
  const rows = list.map((u, n) => `<label class="upd-row"><input type="checkbox" data-n="${n}" checked>
    <span><b>${esc(u.name)}</b><small>${esc(u.from || u.file)} → <em>${esc(u.to)}</em></small></span></label>`).join('');
  modal(`Есть обновления: ${list.length}`, `<p class="hint">Отметь, что обновить. Старые файлы заменятся новыми, выключенные моды останутся выключенными.</p><div class="upd-list">${rows}</div>`, [
    { label: 'Не сейчас', cls: 'btn-iron' },
    { label: 'Обновить', onClick: async () => {
      const chosen = list.filter((u, n) => $(`#modalBody input[data-n="${n}"]`)?.checked);
      if (!chosen.length) return;
      taskStart('Обновляем моды…');
      try {
        const r = await api(km.instances.applyUpdates(state.inst.id, chosen));
        taskEnd();
        if (r.failed.length) modal('Обновлено не всё', `<p>Обновлено: ${r.updated}. Не получилось:</p><ul>${r.failed.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`);
        else toast(`Обновлено модов: ${r.updated}`);
      } catch (e) { taskEnd(); toast(e.message, 'error'); }
      loadContent();
    } },
  ]);
}

async function exportInstance() {
  taskStart('Сохраняем сборку…');
  try {
    const r = await api(km.instances.exportPack(state.inst.id));
    taskEnd();
    if (!r) return;
    toast(`Сборка сохранена (${fmtSize(r.size)})`);
    api(km.showFile(r.file)).catch(() => {});
  } catch (e) { taskEnd(); toast(e.message, 'error'); }
}

function renderInstSettings() {
  const i = state.inst;
  $('#instEditName').value = i.name;
  $('#instEditServer').value = i.server || '';
  const total = state.info?.totalMemMb || 8192;
  const opts = [0, 2048, 3072, 4096, 6144, 8192, 12288, 16384].filter(m => m < total);
  $('#instEditMem').innerHTML = opts.map(m => `<option value="${m}" ${m === (i.memoryMb || 0) ? 'selected' : ''}>${m ? fmtMem(m) : 'Как в общих настройках'}</option>`).join('');
  $('#instLoaderInfo').textContent = `${instSub(i)}${i.source ? ` · из Modrinth: ${i.source.title} ${i.source.version || ''}` : ''}`;
  state.editLoader = i.loader;
  $$('#instEditLoader button').forEach(b => b.classList.toggle('on', b.dataset.l === i.loader));
  loadEditLoaderVersions(i.loaderVersion);
}

async function loadEditLoaderVersions(current = '') {
  const loader = state.editLoader;
  const mc = state.inst.mc;
  const sel = $('#instEditLv');
  $('#instEditLvWrap').classList.toggle('hidden', loader === 'vanilla');
  sel.innerHTML = '<option value="">Рекомендуемая (самая свежая)</option>';
  if (current) sel.innerHTML += `<option value="${esc(current)}">${esc(current)}</option>`;
  sel.value = current;
  if (loader === 'vanilla') return;
  try {
    const list = await api(km.loaders(loader, mc));
    if (loader !== state.editLoader) return;
    sel.innerHTML = '<option value="">Рекомендуемая (самая свежая)</option>' +
      list.slice(0, 80).map(l => `<option value="${esc(l.id)}">${esc(l.id)}${l.stable ? '' : ' (тест)'}</option>`).join('');
    sel.value = list.some(l => l.id === current) ? current : '';
  } catch { /* оставим что есть */ }
}

$$('#instEditLoader button').forEach(b => b.onclick = () => {
  state.editLoader = b.dataset.l;
  $$('#instEditLoader button').forEach(x => x.classList.toggle('on', x === b));
  loadEditLoaderVersions('');
});

$$('#instTabs .tab').forEach(t => t.addEventListener('click', () => setInstTab(t.dataset.tab)));
$('#instBack').onclick = () => { go('instances'); loadInstances(); };
$('#instPlay').onclick = () => playInstance(state.inst.id);
$('#contentSearch').oninput = renderContent;
$('#btnAddFile').onclick = async () => {
  try {
    const n = await api(km.instances.addFiles(state.inst.id, state.instTab));
    if (n) { toast(`Добавлено файлов: ${n}`); loadContent(); }
  } catch (e) { toast(e.message, 'error'); }
};
$('#btnUpdates').onclick = checkModUpdates;
$('#instExport').onclick = exportInstance;
$('#btnOpenKind').onclick = () => api(km.openFolder(`instance:${state.inst.id}/${state.instTab}`)).catch(e => toast(e.message, 'error'));
$('[data-inst-folder]').onclick = () => api(km.openFolder(`instance:${state.inst.id}`)).catch(e => toast(e.message, 'error'));
$('#btnAddModrinth').onclick = () => openBrowser({ type: KIND_TYPE[state.instTab], inst: state.inst });
$('#instSave').onclick = async () => {
  try {
    state.inst = await api(km.instances.update(state.inst.id, {
      name: $('#instEditName').value, memoryMb: +$('#instEditMem').value,
      loader: state.editLoader, loaderVersion: state.editLoader === 'vanilla' ? '' : $('#instEditLv').value,
      server: $('#instEditServer').value,
    }));
    $('#instName').textContent = state.inst.name;
    $('#instSub').textContent = instSub(state.inst);
    renderInstSettings();
    toast('Сохранено');
    loadInstances();
  } catch (e) { toast(e.message, 'error'); }
};
$('#instDuplicate').onclick = async () => {
  try {
    taskStart('Копируем сборку…');
    const copy = await api(km.instances.duplicate(state.inst.id));
    taskEnd();
    toast(`Готово: «${copy.name}»`);
    await loadInstances();
    openInstance(copy.id);
  } catch (e) { taskEnd(); toast(e.message, 'error'); }
};
$('#instDelete').onclick = () => modal('Удалить сборку?', `<p>Сборка «${esc(state.inst.name)}» будет удалена вместе с модами и мирами. Это нельзя отменить.</p>`, [
  { label: 'Отмена', cls: 'btn-iron' },
  { label: 'Удалить навсегда', cls: 'btn-red', onClick: async () => {
    try {
      await api(km.instances.remove(state.inst.id));
      const sel = state.settings.selectedVersion;
      if (sel?.kind === 'instance' && sel.id === state.inst.id && state.versions?.latest?.release) selectVersion({ kind: 'vanilla', id: state.versions.latest.release });
      toast('Сборка удалена');
      go('instances');
      loadInstances();
    } catch (e) { toast(e.message, 'error'); }
  } },
]);

// ── Каталог Modrinth ─────────────────────────────────────────────
const browser = { type: 'mod', inst: null, source: 'modrinth', offset: 0, total: 0, seq: 0, installed: new Set() };
const SOURCE_NAMES = { modrinth: 'Modrinth', curseforge: 'CurseForge' };
const TYPE_TITLES = { mod: 'Моды', resourcepack: 'Ресурспаки', shader: 'Шейдеры', modpack: 'Готовые сборки' };

function openBrowser({ type, inst = null }) {
  browser.type = type;
  browser.inst = inst;
  browser.installed = new Set(inst ? state.content.map(c => c.projectId).filter(Boolean) : []);
  setBrowserSource(browser.source, true);
  $('#browserFor').textContent = inst
    ? `Для сборки «${inst.name}»: ${instSub(inst)}. Показаны только подходящие.`
    : 'Нажми «Скачать»: лаунчер сам создаст сборку со всеми модами.';
  $('#browserSearch').value = '';
  $('#browserSort').value = type === 'modpack' ? 'downloads' : 'relevance';
  $('#browser').classList.remove('hidden');
  searchBrowser(true);
  setTimeout(() => $('#browserSearch').focus(), 50);
}

async function searchBrowser(reset) {
  const seq = ++browser.seq;
  if (reset) { browser.offset = 0; $('#browserList').innerHTML = '<p class="empty">Ищем…</p>'; }
  const inst = browser.inst;
  try {
    const res = await api(km[browser.source].search({
      query: $('#browserSearch').value.trim(), type: browser.type, index: $('#browserSort').value,
      mc: inst?.mc, loader: inst?.loader, offset: browser.offset, limit: 20,
    }));
    if (seq !== browser.seq) return;
    if (reset) $('#browserList').innerHTML = '';
    browser.total = res.total;
    if (!res.hits.length && reset) $('#browserList').innerHTML = '<p class="empty">Ничего не нашлось.</p>';
    res.hits.forEach((h, n) => $('#browserList').appendChild(browserRow(h, n)));
    browser.offset += res.hits.length;
    $('#browserMore').classList.toggle('hidden', browser.offset >= browser.total);
  } catch (e) {
    if (seq !== browser.seq) return;
    $('#browserList').innerHTML = `<p class="empty">Modrinth не отвечает: ${esc(e.message)}</p>`;
  }
}

function browserRow(h, n) {
  const row = document.createElement('div');
  row.className = 'mrow';
  row.dataset.id = h.id;
  row.style.setProperty('--i', n);
  const have = browser.installed.has(h.id);
  row.innerHTML = `<img class="inst-icon" alt="">
    <div class="mrow-body"><b>${esc(h.title)}</b> <small>от ${esc(h.author)} · ⬇ ${fmtNum(h.downloads)}</small><p>${esc(h.description)}</p></div>
    <button class="btn ${have ? 'btn-iron' : 'btn-gold'}" ${have ? 'disabled' : ''}>${have ? 'Установлено' : browser.type === 'modpack' ? 'Скачать' : 'Установить'}</button>`;
  instIcon(row.querySelector('img'), h.icon);
  const btn = row.querySelector('button');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Качаем…';
    row.classList.add('working');
    try {
      if (browser.type === 'modpack') {
        taskStart(`Скачиваем ${h.title}…`);
        const inst = await api(km.modpack.install({ projectId: h.id, source: browser.source }));
        taskEnd();
        toast(`Сборка «${inst.name}» готова к игре!`);
        if (inst.blocked?.length) setTimeout(() => showBlocked(inst.blocked), 600);
        celebrate(btn);
        $('#browser').classList.add('hidden');
        await loadInstances();
        openInstance(inst.id);
        return;
      }
      // сначала показываем, что ещё нужно моду, и спрашиваем
      let chosen = null;
      if (browser.type === 'mod') {
        btn.textContent = 'Смотрим…';
        const plan = await api(km.instances.plan(browser.inst.id, h.id, browser.type, browser.source));
        if (plan.deps.some(d => !d.installed)) {
          chosen = await askDeps(plan);
          if (!chosen) { btn.disabled = false; btn.textContent = 'Установить'; return; }
        }
      }
      btn.textContent = 'Качаем…';
      taskStart(`Ставим ${h.title}…`);
      await api(km.instances.install(browser.inst.id, h.id, browser.type, browser.source, chosen));
      taskEnd();
      browser.installed.add(h.id);
      (chosen || []).forEach(d => browser.installed.add(d));
      if (chosen?.length) refreshBrowserButtons();
      btn.textContent = 'Установлено';
      btn.className = 'btn btn-iron';
      celebrate(btn);
      toast(`${h.title}: установлено`);
      loadContent();
    } catch (e) {
      taskEnd();
      btn.disabled = false;
      btn.textContent = 'Повторить';
      showError(e.message);
    } finally { row.classList.remove('working'); }
  };
  return row;
}

// Окно «Этому моду нужны ещё…»: обязательные отмечены, необязательные по желанию
function askDeps(plan) {
  return new Promise(resolve => {
    const need = plan.deps.filter(d => !d.installed);
    const have = plan.deps.filter(d => d.installed);
    const rows = need.map((d, n) => `<label class="dep-row${d.required ? ' req' : ''}" style="--i:${n}">
        <input type="checkbox" data-dep="${esc(d.id)}" ${d.required ? 'checked' : ''}>
        <img class="inst-icon small" alt="" data-icon="${esc(d.icon)}">
        <span><b>${esc(d.title)}</b> <em>${d.required ? 'обязательно' : 'по желанию'}</em><small>${esc(d.description)}</small></span>
      </label>`).join('');
    const req = need.filter(d => d.required).length;
    modal(`«${plan.title}» просит ещё ${need.length === 1 ? 'один мод' : 'моды'}`, `
      <p class="hint">${req ? 'Без обязательных мод не запустится, они уже отмечены. ' : ''}${need.length - req ? 'Необязательные добавляют возможности, отметь, если хочешь.' : ''}</p>
      <div class="dep-list">${rows}</div>
      ${have.length ? `<p class="hint">Уже стоит: ${have.map(d => esc(d.title)).join(', ')}</p>` : ''}
      <p class="hint dep-warn hidden">Без обязательных модов игра может вылететь.</p>`, [
      { label: 'Отмена', cls: 'btn-iron', onClick: () => resolve(null) },
      { label: 'Скачать', onClick: () => resolve([...$$('#modalBody [data-dep]')].filter(c => c.checked).map(c => c.dataset.dep)) },
    ]);
    $$('#modalBody img[data-icon]').forEach(img => instIcon(img, img.dataset.icon));
    $$('#modalBody .dep-row.req input').forEach(c => c.onchange = () =>
      $('#modalBody .dep-warn').classList.toggle('hidden', [...$$('#modalBody .dep-row.req input')].every(x => x.checked)));
    // кнопки «Скачать» с числом выбранного
    const go = $('#modalActions .btn-gold');
    const count = () => { const n = $$('#modalBody [data-dep]:checked').length; go.textContent = n ? `Скачать мод и ещё ${n}` : 'Скачать только мод'; };
    $$('#modalBody [data-dep]').forEach(c => c.addEventListener('change', count));
    count();
  });
}

function refreshBrowserButtons() {
  const have = new Set([...browser.installed].map(String));
  $$('#browserList .mrow').forEach(r => {
    const b = r.querySelector('button');
    if (have.has(r.dataset.id) && !b.disabled) { b.disabled = true; b.textContent = 'Установлено'; b.className = 'btn btn-iron'; }
  });
}

function setBrowserSource(src, quiet) {
  browser.source = src;
  $$('#browserSource .tab').forEach(t => t.classList.toggle('active', t.dataset.src === src));
  $('#browserTitle').textContent = `${TYPE_TITLES[browser.type]} с ${SOURCE_NAMES[src]}`;
  if (!quiet) searchBrowser(true);
}
$$('#browserSource .tab').forEach(t => t.addEventListener('click', () => setBrowserSource(t.dataset.src)));

// Ссылки в тексте ошибки делаем кликабельными (моды CurseForge, которые нельзя качать из лаунчеров)
function linkify(text) {
  return esc(text).replace(/https:\/\/[^\s<]+[^\s<.,)]/g, u => `<a href="${u}" target="_blank">${u}</a>`);
}
function showError(msg) {
  if (/https:\/\//.test(msg)) modal('Не получилось скачать', `<p>${linkify(msg)}</p>`);
  else toast(msg, 'error');
}
function blockedHtml(list) {
  return `<ul class="blocked-list">${list.map(b => `<li><a href="${esc(b.url)}" target="_blank">${esc(b.title)}</a> <small>${esc(b.fileName)} → папка ${esc(b.folder)}</small></li>`).join('')}</ul>`;
}
function showBlocked(list) {
  modal('Часть файлов нужно скачать вручную',
    `<p>Авторы этих модов запретили скачивать их из лаунчеров. Открой каждую ссылку, скачай указанный файл и положи его в папку сборки (кнопка «Папка» или «Добавить файл»).</p>${blockedHtml(list)}`);
}

let browserTimer = null;
$('#browserSearch').oninput = () => { clearTimeout(browserTimer); browserTimer = setTimeout(() => searchBrowser(true), 350); };
$('#browserSort').onchange = () => searchBrowser(true);
$('#browserMore').onclick = () => searchBrowser(false);
$('#browserClose').onclick = () => $('#browser').classList.add('hidden');
$('#browser').addEventListener('click', e => { if (e.target.id === 'browser') $('#browser').classList.add('hidden'); });

// ── Полоска фоновой загрузки ─────────────────────────────────────
let taskCount = 0;
function taskStart(stage) {
  taskCount++;
  $('#taskStage').textContent = stage;
  $('#taskFill').style.width = '0%';
  $('#task').classList.remove('hidden');
}
function taskEnd() {
  taskCount = Math.max(0, taskCount - 1);
  if (!taskCount) $('#task').classList.add('hidden');
}
km.on.content(p => {
  $('#taskStage').textContent = p.stage;
  $('#taskFill').style.width = (p.percent || 0) + '%';
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
  loadInstances();
  loadPanel();
  setInterval(pingServer, 60000);
})().catch(e => toast(e.message, 'error'));
