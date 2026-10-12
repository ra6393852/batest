!include "LogicLib.nsh"

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\baccarat-analyzer" "" "URL:Baccarat Live Analyzer"
  WriteRegStr SHCTX "Software\Classes\baccarat-analyzer" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\baccarat-analyzer\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\baccarat-analyzer\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\baccarat-analyzer\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
    DeleteRegKey SHCTX "Software\Classes\baccarat-analyzer"
  ${EndIf}
!macroend
