$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$artifacts = Join-Path $root 'artifacts'
$staging = Join-Path $artifacts 'personal-workbench-portable'
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'target/release/personal-workbench.exe') -Destination $staging
Copy-Item -LiteralPath (Join-Path $root 'target/release/workbenchd.exe') -Destination $staging
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath (Join-Path $artifacts 'personal-workbench-portable-windows-x64.zip') -Force
Remove-Item -LiteralPath $staging -Recurse -Force
$installer = Get-ChildItem -LiteralPath (Join-Path $root 'target/release/bundle/nsis') -Filter '*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) { throw 'NSIS installer was not produced' }
Get-ChildItem -LiteralPath $artifacts -Filter '*_x64-setup.exe' | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force
}
Copy-Item -LiteralPath $installer.FullName -Destination $artifacts
