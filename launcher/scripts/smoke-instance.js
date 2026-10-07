'use strict';
// Смоук-тест сборок: создание сборки, установка модов с Modrinth, скачивание готовой сборки, запуск.
// Запуск: node scripts/smoke-instance.js <mods|modpack|forge> [версия]
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'km-inst-'));
const store = require('../src/core/store');
const auth = require('../src/core/auth');
const launcher = require('../src/core/launch');
const instances = require('../src/core/instances');

const [mode = 'mods', wanted = '1.20.1'] = process.argv.slice(2);
const acc = auth.addOffline('KMSmoke');
store.update({ selectedAccount: acc.id, memoryMb: 2048 });

const MARKERS = [
  /Setting user: KMSmoke/,
  // «Loading Minecraft … with Quilt/Fabric Loader» не годится: эта строка печатается
  // ещё до того, как загрузчик прочитал игру, и сборка может упасть сразу после неё
  /ModLauncher running/,
  /Pixel format not accelerated/,
  /GLFW error 65542/,
  /LWJGL Version: /,
  /Backend library: LWJGL/,
];
let timeout = setTimeout(() => fail('таймаут 20 минут'), 20 * 60 * 1000);
let lastStage = '';
let output = '';
let ok = false;

function fail(msg) {
  console.error('\n✗ ' + msg);
  console.error(output.slice(-4000));
  process.exit(1);
}

const onProgress = p => {
  if (p.stage !== lastStage) { lastStage = p.stage; console.log(`[${p.percent ?? ''}%] ${p.stage}`); }
};

async function build() {
  if (mode === 'modpack') {
    // Fabulously Optimized — популярная сборка на Fabric
    const inst = await instances.installMrpack({ projectId: 'fabulously-optimized' }, onProgress);
    const mods = instances.content(inst.id, 'mods');
    console.log(`Сборка «${inst.name}» (${inst.mc} ${inst.loader}), модов: ${mods.length}`);
    if (!mods.length) throw new Error('в сборке не оказалось модов');
    return inst;
  }
  const loader = mode === 'forge' ? 'forge' : mode === 'quilt' ? 'quilt' : 'fabric';
  // 'latest' — самая свежая релизная версия из манифеста Mojang
  const mc = wanted === 'latest' ? (await require('../src/core/versions').list(false)).latest.release : wanted;
  const inst = instances.create({ name: `Смоук ${loader} ${mc}`, mc, loader });
  if (loader === 'quilt') {
    // Quilt умеет запускать моды Fabric: проверяем вместе с Fabric API
    const r = await instances.installProject(inst.id, 'fabric-api', 'mod', onProgress);
    console.log(`+ ${r.title}`);
  }
  if (loader === 'fabric') {
    for (const id of ['fabric-api', 'sodium', 'lithium']) {
      const r = await instances.installProject(inst.id, id, 'mod', onProgress);
      console.log(`+ ${r.title}`);
    }
    const mods = instances.content(inst.id, 'mods');
    if (mods.length < 3) throw new Error(`модов установлено ${mods.length}, ожидалось 3`);
    // выключение и включение мода
    instances.toggle(inst.id, 'mods', mods[0].file);
    if (instances.content(inst.id, 'mods').find(m => m.name === mods[0].name).enabled) throw new Error('мод не выключился');
    instances.toggle(inst.id, 'mods', mods[0].file + '.disabled');
    if (!instances.content(inst.id, 'mods').find(m => m.name === mods[0].name).enabled) throw new Error('мод не включился');
    console.log('Выключение и включение мода работает');
  }
  return inst;
}

(async () => {
  const inst = await build();
  console.log(`Запускаем сборку ${inst.id}`);
  await launcher.launch({ kind: 'instance', id: inst.id }, {
    onProgress,
    onLog: line => {
      output += line;
      if (!ok && MARKERS.some(m => m.test(output))) {
        ok = true;
        console.log(`\n✓ сборка ${mode}: игра запустилась с модами`);
        clearTimeout(timeout);
        setTimeout(() => process.exit(0), 500);
      }
    },
    onExit: info => ok || fail(`игра вышла с кодом ${info.code} до старта`),
  });
})().catch(e => fail(e.stack || e.message));
