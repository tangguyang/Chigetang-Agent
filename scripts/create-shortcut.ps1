$ErrorActionPreference = "Stop"
$programRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $programRoot "吃个糖Agent.exe"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "吃个糖Agent.lnk"))
$link.TargetPath = $exe
$link.WorkingDirectory = $programRoot
$link.IconLocation = "$exe,0"
$link.Save()
