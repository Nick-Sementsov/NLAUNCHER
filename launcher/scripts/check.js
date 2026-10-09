'use strict';
// Быстрая проверка синтаксиса всех исходников: npm run check
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) files.push(full);
  }
})(path.join(__dirname, '..', 'src'));

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`OK: ${files.length} файлов`);
