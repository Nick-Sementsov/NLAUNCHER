'use strict';
// Аккаунты: лицензия (Microsoft) и офлайн по нику
const crypto = require('crypto');
const { Auth } = require('msmc');
const store = require('./store');

const ERRORS = {
  'error.gui.closed': 'Окно входа закрыто',
  'error.auth.microsoft': 'Не удалось войти в аккаунт Microsoft',
  'error.auth.xboxLive': 'Не удалось войти в Xbox Live',
  'error.auth.xsts.userNotFound': 'У этого аккаунта Microsoft нет профиля Xbox. Зайди на xbox.com и создай его',
  'error.auth.xsts.bannedCountry': 'Xbox Live недоступен в стране аккаунта',
  'error.auth.xsts.child': 'Детский аккаунт: его нужно добавить в семейную группу Microsoft',
  'error.auth.minecraft.login': 'Mojang отклонил вход через этот аккаунт',
  'error.auth.minecraft.profile': 'На этом аккаунте не куплен Minecraft Java Edition',
  'error.auth.minecraft.entitlements': 'Не удалось проверить покупку игры',
};

function humanError(e) {
  const code = typeof e === 'string' ? e : e?.ts || e?.message || String(e);
  for (let c = code; c; c = c.includes('.') ? c.slice(0, c.lastIndexOf('.')) : '') {
    if (ERRORS[c]) return ERRORS[c];
  }
  return typeof e === 'string' ? `Ошибка входа (${e})` : (e?.message || 'Неизвестная ошибка входа');
}

// Тот же UUID, что сервер с online-mode=false выдаст игроку: UUID.nameUUIDFromBytes("OfflinePlayer:" + ник)
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

// electron подключаем лениво, чтобы модуль работал и в обычном Node (смоук-тест)
const safeStorage = () => require('electron').safeStorage;

function encrypt(text) {
  if (safeStorage().isEncryptionAvailable()) return 'enc:' + safeStorage().encryptString(text).toString('base64');
  return 'raw:' + Buffer.from(text).toString('base64');
}

function decrypt(text) {
  if (!text) return null;
  if (text.startsWith('enc:')) return safeStorage().decryptString(Buffer.from(text.slice(4), 'base64'));
  if (text.startsWith('raw:')) return Buffer.from(text.slice(4), 'base64').toString();
  return null;
}

function publicAccount(a) {
  return { id: a.id, type: a.type, name: a.name, uuid: a.uuid };
}

function list() {
  const s = store.get();
  return { accounts: s.accounts.map(publicAccount), selected: s.selectedAccount };
}

function upsert(account) {
  const s = store.get();
  const accounts = s.accounts.filter(a => a.id !== account.id);
  accounts.push(account);
  store.update({ accounts, selectedAccount: account.id });
  return publicAccount(account);
}

function addOffline(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('Ник: от 3 до 16 символов, только латиница, цифры и _');
  }
  const uuid = offlineUuid(name);
  return upsert({ id: 'offline:' + uuid, type: 'offline', name, uuid });
}

async function addMicrosoft() {
  const auth = new Auth('select_account');
  try {
    const xbox = await auth.launch('electron', {
      width: 520, height: 680, resizable: false, title: 'Вход в Microsoft — KM Launcher',
      backgroundColor: '#1b1410', autoHideMenuBar: true,
    });
    const mc = await xbox.getMinecraft();
    if (!mc.profile) throw 'error.auth.minecraft.profile';
    return upsert({
      id: 'msa:' + mc.profile.id,
      type: 'microsoft',
      name: mc.profile.name,
      uuid: mc.profile.id,
      refreshToken: encrypt(xbox.save()),
    });
  } catch (e) {
    throw new Error(humanError(e));
  }
}

function remove(id) {
  const s = store.get();
  const accounts = s.accounts.filter(a => a.id !== id);
  const selectedAccount = s.selectedAccount === id ? (accounts[0]?.id || null) : s.selectedAccount;
  store.update({ accounts, selectedAccount });
  return list();
}

function select(id) {
  store.update({ selectedAccount: id });
  return list();
}

// Готовый объект авторизации для запуска игры
async function authorization(id) {
  const account = store.get().accounts.find(a => a.id === id);
  if (!account) throw new Error('Выбери аккаунт');
  if (account.type === 'offline') {
    return {
      access_token: account.uuid,
      client_token: account.uuid,
      uuid: account.uuid,
      name: account.name,
      user_properties: '{}',
      meta: { type: 'legacy', demo: false },
    };
  }
  const refresh = decrypt(account.refreshToken);
  if (!refresh) throw new Error('Сессия Microsoft устарела, войди заново');
  try {
    const xbox = await new Auth('select_account').refresh(refresh);
    const mc = await xbox.getMinecraft();
    account.refreshToken = encrypt(xbox.save());
    account.name = mc.profile?.name || account.name;
    store.save();
    return { ...mc.mclc(), user_properties: '{}' };
  } catch (e) {
    throw new Error('Не удалось обновить вход Microsoft: ' + humanError(e) + '. Попробуй удалить аккаунт и войти снова');
  }
}

module.exports = { list, addOffline, addMicrosoft, remove, select, authorization, offlineUuid };
