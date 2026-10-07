'use strict';
// Применяем тему до отрисовки, чтобы не мигало оформление по умолчанию
try {
  const look = JSON.parse(localStorage.getItem('km-look') || '{}');
  const root = document.documentElement;
  root.dataset.theme = look.theme || 'royal';
  if (look.animations === false) root.classList.add('no-anim');
  if (look.intro === false) root.classList.add('no-intro');
} catch { /* нет сохранённой темы */ }
