param(
  [string]$TargetTriple = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bundleDirectory = if ($TargetTriple) {
  Join-Path $root "target/$TargetTriple/release/bundle/nsis"
} else {
  Join-Path $root 'target/release/bundle/nsis'
}
$installer = Get-ChildItem -LiteralPath $bundleDirectory -Filter '*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $installer) { throw 'NSIS installer was not produced' }

$tauriConfig = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $root 'apps/desktop/src-tauri/tauri.conf.json') | ConvertFrom-Json
$installDirectory = Join-Path $env:LOCALAPPDATA $tauriConfig.productName
$application = Join-Path $installDirectory 'personal-workbench.exe'
$sidecar = Join-Path $installDirectory 'workbenchd.exe'
$workspace = Join-Path ([IO.Path]::GetTempPath()) "personal-workbench-installed-smoke-$PID"
$workspaceFull = [IO.Path]::GetFullPath($workspace)
$configDirectory = Join-Path $workspaceFull 'app-data'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $workspaceFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe smoke workspace: $workspaceFull"
}

function Get-DesktopSidecars([int]$DesktopId) {
  @(
    Get-CimInstance Win32_Process -Filter "Name = 'workbenchd.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ParentProcessId -eq $DesktopId }
  )
}

function Wait-ForDesktopReady($Desktop, [string]$DatabasePath) {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 250
    $Desktop.Refresh()
    $sidecars = @(Get-DesktopSidecars -DesktopId $Desktop.Id)
    $databaseReady = -not $DatabasePath -or (Test-Path -LiteralPath $DatabasePath)
  } while ((-not $Desktop.HasExited) -and ($Desktop.MainWindowHandle -eq 0 -or $sidecars.Count -eq 0 -or -not $databaseReady) -and [DateTime]::UtcNow -lt $deadline)

  if ($Desktop.HasExited -or $Desktop.MainWindowHandle -eq 0 -or $sidecars.Count -eq 0 -or -not $databaseReady) {
    throw "Installed application was not ready (exited=$($Desktop.HasExited), window=$($Desktop.MainWindowHandle), sidecars=$($sidecars.Count), database=$databaseReady)"
  }
}

function Close-TestDesktop($Desktop, [string]$Label) {
  $Desktop.Refresh()
  if (-not $Desktop.CloseMainWindow()) { throw "$Label did not accept a close request" }
  if (-not $Desktop.WaitForExit(10000)) { throw "$Label did not exit gracefully" }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    $sidecars = @(Get-DesktopSidecars -DesktopId $Desktop.Id)
  } while ($sidecars.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
  if ($sidecars.Count -gt 0) { throw "$Label left its sidecar running" }
}

function Start-TestDesktop([string]$ApplicationPath, [string]$AppDataDirectory) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ApplicationPath
  $startInfo.UseShellExecute = $false
  $startInfo.EnvironmentVariables['WORKBENCH_DEV_APP_DATA_DIR'] = $AppDataDirectory
  [Diagnostics.Process]::Start($startInfo)
}

New-Item -ItemType Directory -Force -Path $workspaceFull | Out-Null
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$registry = ConvertTo-Json -InputObject @(@{ path = $workspaceFull; name = 'Installed Smoke'; lastOpened = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() })
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $configDirectory 'workspaces.json'), $registry, $utf8WithoutBom)

try {
  $install = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  if ($install.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $application) -or -not (Test-Path -LiteralPath $sidecar)) {
    throw "NSIS installation failed with exit code $($install.ExitCode)"
  }
  $installedVersion = (& $sidecar --version | Select-Object -First 1).Trim()
  $expectedVersion = (Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
  if ($installedVersion -ne $expectedVersion) {
    throw "Installed sidecar version $installedVersion does not match $expectedVersion"
  }

  $desktop = Start-TestDesktop -ApplicationPath $application -AppDataDirectory $configDirectory
  Wait-ForDesktopReady -Desktop $desktop -DatabasePath (Join-Path $workspaceFull 'workbench.sqlite3')
  Close-TestDesktop -Desktop $desktop -Label 'Installed application'

  $marker = Join-Path $workspaceFull 'upgrade-preservation.marker'
  Set-Content -LiteralPath $marker -Value 'preserve' -Encoding ascii
  $upgrade = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  if ($upgrade.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $marker)) {
    throw 'Overlay upgrade did not preserve the workspace'
  }
  $desktop = Start-TestDesktop -ApplicationPath $application -AppDataDirectory $configDirectory
  Wait-ForDesktopReady -Desktop $desktop -DatabasePath (Join-Path $workspaceFull 'workbench.sqlite3')
  Close-TestDesktop -Desktop $desktop -Label 'Upgraded application'

  $uninstaller = Join-Path $installDirectory 'uninstall.exe'
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'NSIS uninstaller was not installed' }
  $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)" }
  if (-not (Test-Path -LiteralPath (Join-Path $workspaceFull 'workbench.sqlite3'))) {
    throw 'Uninstall removed the user workspace'
  }
} finally {
  if ($desktop) {
    $desktop.Refresh()
    if (-not $desktop.HasExited) {
      [void]$desktop.CloseMainWindow()
      if (-not $desktop.WaitForExit(5000)) {
        Stop-Process -Id $desktop.Id -Force -ErrorAction SilentlyContinue
        [void]$desktop.WaitForExit(5000)
      }
    }
    foreach ($child in @(Get-DesktopSidecars -DesktopId $desktop.Id)) {
      Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path -LiteralPath $workspaceFull) {
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
      try {
        Remove-Item -LiteralPath $workspaceFull -Recurse -Force
        break
      } catch {
        if ([DateTime]::UtcNow -ge $cleanupDeadline) { throw }
        Start-Sleep -Milliseconds 250
      }
    } while (Test-Path -LiteralPath $workspaceFull)
  }
}
