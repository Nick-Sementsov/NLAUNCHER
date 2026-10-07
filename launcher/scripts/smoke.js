'use strict';
// Смоук-тест полного цикла без интерфейса: Java → файлы игры → запуск.
// Запуск: node scripts/smoke.js <vanilla|fabric> <версия>
// Успех — игра дошла до собственного лога (в CI без видеокарты она потом падает на OpenGL, это нормально).
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'km-smoke-'));
const store = require('../src/core/store');
const auth = require('../src/core/auth');
const launcher = require('../src/core/launch');

const [kind = 'vanilla', wanted = '1.20.1'] = process.argv.slice(2);
const acc = auth.addOffline('KMSmoke');
store.update({ selectedAccount: acc.id, memoryMb: 2048 });

// Игра дошла до своего кода: вход выполнен или уже создаётся окно.
// В CI нет видеокарты, поэтому старые версии падают на OpenGL — это тоже значит, что запуск собран правильно.
const MARKERS = [
  /Setting user: KMSmoke/,
  /Loading Minecraft .* with Fabric Loader/,
  /Pixel format not accelerated/,
  /GLFW error 65542/,
  /LWJGL Version: /,
  /Backend library: LWJGL/,
];
const timeout = setTimeout(() => fail('таймаут 15 минут'), 15 * 60 * 1000);
let lastStage = '';
let output = '';
let ok = false;

function fail(msg) {
  console.error('\n✗ ' + msg);
  console.error(output.slice(-4000));
  process.exit(1);
}

(async () => {
  // 'latest' — самая свежая релизная версия из манифеста Mojang
  const id = wanted === 'latest' ? (await require('../src/core/versions').list(false)).latest.release : wanted;
  console.log(`Проверяем ${kind} ${id}`);
  await launcher.launch({ kind, id }, {
    onProgress: p => {
      if (p.stage !== lastStage) { lastStage = p.stage; console.log(`[${p.percent ?? ''}%] ${p.stage}`); }
    },
    onLog: line => {
      output += line;
      if (!ok && MARKERS.some(m => m.test(output))) {
        ok = true;
        console.log(`\n✓ ${kind} ${id}: игра запустилась`);
        clearTimeout(timeout);
        setTimeout(() => process.exit(0), 500);
      }
    },
    onExit: info => ok || fail(`игра вышла с кодом ${info.code} до старта`),
  });
})().catch(e => fail(e.stack || e.message));
