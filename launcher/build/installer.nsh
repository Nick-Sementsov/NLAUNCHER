; Оформление установщика KM Launcher: тёмный камень, золото, герб.
; customWelcomePage вставляется electron-builder'ом ДО остальных страниц,
; поэтому цвета MUI задаём здесь — они действуют на все страницы.

!macro customWelcomePage
  !define MUI_BGCOLOR "1B1E2A"
  !define MUI_TEXTCOLOR "F2D27C"
  !define MUI_INSTFILESPAGE_COLORS "F2D27C 1B1E2A"
  !define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
  !define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в королевство KM"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Сей мастер возведёт замок KM Launcher на твоей земле.$\r$\n$\r$\nЛаунчер сам призовёт Java, скачает нужные версии Minecraft и примет как лицензию Microsoft, так и офлайн-ник.$\r$\n$\r$\nНажми «Далее», чтобы опустить подъёмный мост."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "Замок возведён!"
  !define MUI_FINISHPAGE_TEXT "KM Launcher установлен. Врата открыты, рыцарь, — в поход!"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Открыть врата (запустить KM Launcher)"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_BGCOLOR "1B1E2A"
  !define MUI_TEXTCOLOR "F2D27C"
  !define MUI_INSTFILESPAGE_COLORS "F2D27C 1B1E2A"
  !define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
  !define MUI_WELCOMEPAGE_TITLE "Покинуть королевство KM?"
  !define MUI_WELCOMEPAGE_TEXT "Мастер разберёт замок KM Launcher.$\r$\n$\r$\nТвои миры, моды и настройки в %APPDATA%\.kmlauncher останутся нетронутыми."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
