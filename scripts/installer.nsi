Unicode true
!include "MUI2.nsh"
!ifndef APPDIR
!define APPDIR "../release/吃个糖Agent-win32-x64"
!endif
!ifndef OUTPUT
!define OUTPUT "../release/吃个糖Agent-v1.2.9-Setup.exe"
!endif
Name "吃个糖Agent 1.2.9 候选版"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\吃个糖Agent"
InstallDirRegKey HKCU "Software\ChigetangAgent" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\吃个糖Agent.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Function .onInit
  FindWindow $0 "Chrome_WidgetWin_1" "吃个糖Agent"
  StrCmp $0 0 done
  MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出吃个糖Agent，再安装更新。"
  Abort
  done:
FunctionEnd
Section "安装程序"
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\吃个糖Agent"
  CreateShortcut "$SMPROGRAMS\吃个糖Agent\吃个糖Agent.lnk" "$INSTDIR\吃个糖Agent.exe"
  CreateShortcut "$DESKTOP\吃个糖Agent.lnk" "$INSTDIR\吃个糖Agent.exe"
  WriteRegStr HKCU "Software\ChigetangAgent" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent" "DisplayName" "吃个糖Agent 1.2.9 候选版"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent" "DisplayVersion" "1.2.9"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent" "Publisher" "吃个糖Agent"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent" "NoRepair" 1
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\吃个糖Agent.lnk"
  Delete "$SMPROGRAMS\吃个糖Agent\吃个糖Agent.lnk"
  RMDir "$SMPROGRAMS\吃个糖Agent"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChigetangAgent"
  DeleteRegKey HKCU "Software\ChigetangAgent"
  ; 仅删除明确打包的程序文件，永不递归删除用户选择的目录或用户数据。
  !include "installer-delete-files.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
