; Оформление установщика KM Launcher: тёмный фон, золото, логотип. Слова простые, без «замков» и «рыцарей».
; customWelcomePage вставляется electron-builder'ом ДО остальных страниц,
; поэтому цвета MUI задаём здесь — они действуют на все страницы.

!macro customWelcomePage
  !define MUI_BGCOLOR "1B1E2A"
  !define MUI_TEXTCOLOR "F2D27C"
  !define MUI_INSTFILESPAGE_COLORS "F2D27C 1B1E2A"
  !define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
  !define MUI_WELCOMEPAGE_TITLE "Установка KM Launcher"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Сейчас на компьютер установится KM Launcher, лаунчер для Minecraft.$\r$\n$\r$\nОн сам скачает Java и нужные версии игры. Играть можно с лицензией Microsoft или просто с ником.$\r$\n$\r$\nНажми «Далее», чтобы продолжить."
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

  !define MUI_FINISHPAGE_TITLE "Готово!"
  !define MUI_FINISHPAGE_TEXT "KM Launcher установлен. Можно играть!"
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Запустить KM Launcher"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnWelcomePage
  !define MUI_BGCOLOR "1B1E2A"
  !define MUI_TEXTCOLOR "F2D27C"
  !define MUI_INSTFILESPAGE_COLORS "F2D27C 1B1E2A"
  !define MUI_INSTFILESPAGE_PROGRESSBAR "colored"
  !define MUI_WELCOMEPAGE_TITLE "Удаление KM Launcher"
  !define MUI_WELCOMEPAGE_TEXT "KM Launcher будет удалён с компьютера.$\r$\n$\r$\nТвои миры, моды и настройки не удалятся, они останутся в папке %APPDATA%\.kmlauncher."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
