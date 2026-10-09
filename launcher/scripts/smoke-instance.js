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

// режим можно передать и как имя задачи CI: instance-mods → mods
const [rawMode = 'mods', wanted = '1.20.1'] = process.argv.slice(2);
const mode = rawMode.replace(/^instance-/, '');
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
  if (mode === 'cf-pack') {
    // Сборка с CurseForge: ищем Fabulously Optimized и ставим её целиком
    const cf = require('../src/core/curseforge');
    console.log(`CurseForge через ${cf.usesMirror ? 'зеркало api.curse.tools' : 'официальный API'}`);
    const res = await cf.search({ query: 'Fabulously Optimized', type: 'modpack', index: 'downloads', limit: 5 });
    const hit = res.hits.find(h => h.slug === 'fabulously-optimized') || res.hits[0];
    if (!hit) throw new Error('CurseForge ничего не нашёл');
    console.log(`Нашли сборку ${hit.title} (${hit.id})`);
    const inst = await instances.installCfPack({ projectId: hit.id }, onProgress);
    const mods = instances.content(inst.id, 'mods');
    console.log(`Сборка «${inst.name}» (${inst.mc} ${inst.loader} ${inst.loaderVersion}), модов: ${mods.length}, вручную: ${inst.blocked.length}`);
    for (const b of inst.blocked) console.log(`  вручную: ${b.title} (${b.fileName})`);
    if (!mods.length) throw new Error('в сборке не оказалось модов');
    return inst;
  }
  if (mode === 'cf-mods') {
    // Моды с CurseForge в сборку Forge: JEI и его зависимости
    const cf = require('../src/core/curseforge');
    const inst = instances.create({ name: `Смоук CurseForge ${wanted}`, mc: wanted, loader: 'forge' });
    for (const q of ['Just Enough Items', 'Mouse Tweaks']) {
      const res = await cf.search({ query: q, type: 'mod', mc: wanted, loader: 'forge', index: 'downloads', limit: 5 });
      const hit = res.hits[0];
      if (!hit) throw new Error(`CurseForge не нашёл ${q}`);
      const r = await instances.installProject(inst.id, hit.id, 'mod', onProgress, 'curseforge');
      console.log(`+ ${r.title}`);
    }
    const mods = instances.content(inst.id, 'mods');
    if (mods.length < 2) throw new Error(`модов установлено ${mods.length}, ожидалось 2`);
    return inst;
  }
  if (mode === 'update') {
    // Обновление модов, экспорт в .mrpack, импорт обратно и автовход на сервер
    const modrinth = require('../src/core/modrinth');
    const { download } = require('../src/core/net');
    const inst = instances.create({ name: `Смоук обновлений ${wanted}`, mc: wanted, loader: 'fabric' });
    await instances.installProject(inst.id, 'fabric-api', 'mod', onProgress);
    const vs = await modrinth.versions('sodium', { mc: wanted, loader: 'fabric', type: 'mod' });
    const old = vs[vs.length - 1];
    const f = modrinth.primaryFile(old);
    await download(f.url, path.join(instances.dir(inst.id), 'mods', f.filename));
    console.log(`Поставили старый Sodium ${old.version_number} (свежий: ${vs[0].version_number})`);
    const ups = await instances.checkUpdates(inst.id);
    for (const u of ups) console.log(`  обновление: ${u.name} ${u.from} → ${u.to}`);
    if (!ups.some(u => u.projectId === old.project_id)) throw new Error('обновление Sodium не нашлось');
    const r = await instances.applyUpdates(inst.id, ups, onProgress);
    if (r.failed.length) throw new Error('не обновилось: ' + r.failed.join('; '));
    const left = await instances.checkUpdates(inst.id);
    if (left.length) throw new Error('после обновления ещё остались обновления: ' + left.map(u => u.name).join(', '));
    console.log(`Обновлено модов: ${r.updated}`);
    // перед установкой лаунчер показывает зависимости: у Iris обязательный Sodium, он уже стоит
    const plan = await instances.planInstall(inst.id, 'iris', 'mod');
    for (const d of plan.deps) console.log(`  зависимость Iris: ${d.title} (${d.required ? 'обязательно' : 'по желанию'}${d.installed ? ', уже стоит' : ''})`);
    if (!plan.deps.some(d => d.required && /sodium/i.test(d.title) && d.installed)) throw new Error('у Iris не нашёлся обязательный Sodium');
    const before = instances.content(inst.id, 'mods').length;
    await instances.installProject(inst.id, 'iris', 'mod', onProgress, 'modrinth', new Set(), []);
    if (instances.content(inst.id, 'mods').length !== before + 1) throw new Error('с пустым выбором зависимостей поставилось не ровно 1 мод');
    console.log('Iris поставлен без лишних зависимостей');
    const out = path.join(os.tmpdir(), 'km-smoke.mrpack');
    const ex = await instances.exportMrpack(inst.id, out, onProgress);
    console.log(`Экспорт: ссылками ${ex.linked}, внутри ${ex.inside}, ${ex.size} байт`);
    if (ex.linked < 2) throw new Error('моды с Modrinth не попали в экспорт ссылками');
    const copy = await instances.importPack(out, onProgress);
    const a = instances.content(inst.id, 'mods').map(m => m.file).sort().join();
    const b = instances.content(copy.id, 'mods').map(m => m.file).sort().join();
    if (a !== b) throw new Error(`после импорта другие моды: ${b} вместо ${a}`);
    console.log('Импорт экспортированной сборки совпал с оригиналом');
    // автовход: сервера нет, но игра должна стартовать с аргументом входа
    instances.update(copy.id, { server: '127.0.0.1:25565' });
    return instances.get(copy.id);
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
        if (mode === 'update' && !/--quickPlayMultiplayer 127\.0\.0\.1:25565/.test(output)) fail('игра запущена без автовхода на сервер');
        console.log(`\n✓ сборка ${mode}: игра запустилась с модами`);
        clearTimeout(timeout);
        setTimeout(() => process.exit(0), 500);
      }
    },
    onExit: info => ok || fail(`игра вышла с кодом ${info.code} до старта`),
  });
})().catch(e => fail(e.stack || e.message));
