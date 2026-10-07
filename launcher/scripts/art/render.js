// Рисует картинки установщика и иконку из art.html: npx electron scripts/art/render.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'build');
const JOBS = [['icon', 512, 512], ['sidebar', 164, 314], ['unsidebar', 164, 314], ['header', 150, 57]];

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const [name, width, height] of JOBS) {
    const win = new BrowserWindow({ width, height, show: false, transparent: true, frame: false, useContentSize: true,
      webPreferences: { offscreen: true } });
    await win.loadFile(path.join(__dirname, 'art.html'), { query: { art: name } });
    await new Promise(r => setTimeout(r, 600));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    fs.writeFileSync(path.join(OUT, `art-${name}.png`), img.toPNG());
    win.destroy();
  }
  app.exit(0);
});
