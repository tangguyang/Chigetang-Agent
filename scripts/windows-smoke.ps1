param([string]$AppDirectory = (Join-Path $PSScriptRoot ".."))
$ErrorActionPreference = "Stop"
$exe = Join-Path $AppDirectory "吃个糖Agent.exe"
if (-not (Test-Path $exe)) { throw "吃个糖Agent.exe not found. Pass -AppDirectory pointing to the extracted portable folder." }
@("resources/app/dist/main.cjs", "resources/app/dist/preload.cjs", "resources/app/dist/renderer/index.html") | ForEach-Object {
  if (-not (Test-Path (Join-Path $AppDirectory $_))) { throw "Missing runtime file: $_" }
}
$process = Start-Process -FilePath $exe -WorkingDirectory $AppDirectory -PassThru
Start-Sleep -Seconds 8
$process.Refresh()
if ($process.HasExited) { throw "Application exited during startup: $($process.ExitCode). Inspect logs." }
Write-Host "Process is running. Complete the UI/DPAPI/media checks in docs/ACCEPTANCE.md. No API tasks were created by this script."
