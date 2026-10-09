# KM Launcher: для разработчиков

## Структура репозитория

| Путь | Что это |
|------|---------|
| `launcher/` | Сам лаунчер (Electron). |
| `server.js`, `public/` | Панель управления: сборки, моды, новости, игроки. Работает на Railway и отдаёт лаунчеру `/api/launcher/*`. |
| `.github/workflows/launcher.yml` | Проверка запуска игры на Windows и сборка установщика. |

## Разработка

```bash
cd launcher
npm install
npm start            # запустить лаунчер
npm run check        # проверка синтаксиса
node scripts/smoke.js vanilla 1.20.1   # полный цикл: Java → файлы игры → запуск
npm run dist:win     # собрать установщик (на Windows или Linux с wine)
```

Выпуск новой версии: поднять `version` в `launcher/package.json` и запушить тег `vX.Y.Z` (или коммит с `[release]` в сообщении).
GitHub Actions соберёт установщик и выложит его в Releases, а установленные лаунчеры обновятся сами.

## Вход через Microsoft

Используется библиотека [msmc](https://github.com/Hanro50/MSMC) со стандартным публичным клиентом Microsoft
для Minecraft, поэтому вход работает без регистрации своего приложения. Для собственного приложения в Azure
нужна заявка Mojang на доступ к Minecraft API; после одобрения client id меняется в `launcher/src/core/auth.js`.
