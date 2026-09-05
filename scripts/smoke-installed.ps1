param(
  [string]$TargetTriple = '',
  [switch]$SkipUninstall,
  [string]$EvidenceDirectory = '',
  [string]$InstallerPath = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bundleDirectory = if ($TargetTriple) {
  Join-Path $root "target/$TargetTriple/release/bundle/nsis"
} else {
  Join-Path $root 'target/release/bundle/nsis'
}
$installer = if ($InstallerPath) {
  Get-Item -LiteralPath $InstallerPath
} else {
  Get-ChildItem -LiteralPath $bundleDirectory -Filter '*.exe' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}
if (-not $installer) { throw 'NSIS installer was not produced' }

$tauriConfig = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $root 'apps/desktop/src-tauri/tauri.conf.json') | ConvertFrom-Json
$workspace = Join-Path ([IO.Path]::GetTempPath()) "personal-workbench-installed-smoke-$PID"
$workspaceFull = [IO.Path]::GetFullPath($workspace)
$installDirectory = Join-Path $workspaceFull 'installed'
$application = Join-Path $installDirectory 'personal-workbench.exe'
$sidecar = Join-Path $installDirectory 'workbenchd.exe'
$configDirectory = Join-Path $workspaceFull 'app-data'
$webviewDirectory = Join-Path $workspaceFull 'webview2'
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

function Get-InstalledDirectory([string]$Fallback) {
  $uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (Test-Path -LiteralPath $uninstallRoot) {
    foreach ($key in Get-ChildItem -LiteralPath $uninstallRoot) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath
      if ($entry.DisplayName -eq $tauriConfig.productName -and $entry.InstallLocation) {
        return $entry.InstallLocation.Trim('"')
      }
    }
  }
  return $Fallback
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
  Write-Output "$Label close requested (pid=$($Desktop.Id), window=$($Desktop.MainWindowHandle), exited=$($Desktop.HasExited))"
  if (-not $Desktop.CloseMainWindow()) { throw "$Label did not accept a close request" }
  # 关闭超时必须使验收失败；强制清理只在 finally 中进行。
  if (-not $Desktop.WaitForExit(30000)) {
    throw "$Label did not exit after a native close request"
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    $sidecars = @(Get-DesktopSidecars -DesktopId $Desktop.Id)
  } while ($sidecars.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
  if ($sidecars.Count -gt 0) { throw "$Label left its sidecar running" }
}

function Start-TestDesktop(
  [string]$ApplicationPath,
  [string]$AppDataDirectory = '',
  [string]$ConfigDirectory = ''
) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ApplicationPath
  $startInfo.UseShellExecute = $false
  if ($AppDataDirectory) {
    $startInfo.EnvironmentVariables['WORKBENCH_DEV_APP_DATA_DIR'] = $AppDataDirectory
  }
  if ($ConfigDirectory) {
    $startInfo.EnvironmentVariables['WORKBENCH_DEV_CONFIG_DIR'] = $ConfigDirectory
  }
  $startInfo.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $webviewDirectory
  [Diagnostics.Process]::Start($startInfo)
}

New-Item -ItemType Directory -Force -Path $workspaceFull | Out-Null
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $webviewDirectory | Out-Null
$registry = ConvertTo-Json -InputObject @(@{ path = $workspaceFull; name = 'Installed Smoke'; lastOpened = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() })
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $configDirectory 'workspaces.json'), $registry, $utf8WithoutBom)
$installedBySmoke = $false

try {
  $install = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru
  if ($install.ExitCode -ne 0) {
    throw "NSIS installation failed with exit code $($install.ExitCode)"
  }
  $installedBySmoke = $true
  $reportedDirectory = [IO.Path]::GetFullPath((Get-InstalledDirectory -Fallback $installDirectory))
  if ($reportedDirectory.TrimEnd('\') -ne $installDirectory.TrimEnd('\')) {
    throw 'Installer did not use the isolated smoke installation directory'
  }
  $application = Join-Path $installDirectory 'personal-workbench.exe'
  $sidecar = Join-Path $installDirectory 'workbenchd.exe'
  if (-not (Test-Path -LiteralPath $application) -or -not (Test-Path -LiteralPath $sidecar)) {
    throw "NSIS installation did not produce application files in $installDirectory"
  }
  $installedVersion = (& $sidecar --version | Select-Object -First 1).Trim()
  $expectedVersion = (Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
  if ($installedVersion -ne $expectedVersion) {
    throw "Installed sidecar version $installedVersion does not match $expectedVersion"
  }

  $defaultWorkspace = Join-Path $installDirectory 'workspace'
  $isolatedConfig = Join-Path $workspaceFull 'default-config'
  New-Item -ItemType Directory -Force -Path $isolatedConfig | Out-Null
  $desktop = Start-TestDesktop -ApplicationPath $application -ConfigDirectory $isolatedConfig
  Wait-ForDesktopReady -Desktop $desktop -DatabasePath (Join-Path $defaultWorkspace 'workbench.sqlite3')
  Close-TestDesktop -Desktop $desktop -Label 'Default installed application'
  $defaultMarker = Join-Path $defaultWorkspace 'install-directory.marker'
  Set-Content -LiteralPath $defaultMarker -Value 'preserve' -Encoding ascii

  $desktop = Start-TestDesktop -ApplicationPath $application -AppDataDirectory $configDirectory
  Wait-ForDesktopReady -Desktop $desktop -DatabasePath (Join-Path $workspaceFull 'workbench.sqlite3')
  Close-TestDesktop -Desktop $desktop -Label 'Installed application'

  $marker = Join-Path $workspaceFull 'upgrade-preservation.marker'
  Set-Content -LiteralPath $marker -Value 'preserve' -Encoding ascii
  $upgrade = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDirectory") -Wait -PassThru
  if ($upgrade.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $marker)) {
    throw 'Overlay upgrade did not preserve the workspace'
  }
  if (-not (Test-Path -LiteralPath $defaultMarker)) {
    throw 'Overlay upgrade removed the install-directory workspace'
  }
  $upgradedVersion = (& $sidecar --version | Select-Object -First 1).Trim()
  if ($upgradedVersion -ne $expectedVersion) {
    throw "Overlay upgrade installed sidecar version $upgradedVersion instead of $expectedVersion"
  }

  # 用真实安装的 WebView2 验证页面和用户操作，窗口/进程存在不能代表可用。
  & node (Join-Path $root 'apps/desktop/e2e/native-startup-smoke.mjs') $application $EvidenceDirectory
  if ($LASTEXITCODE -ne 0) { throw 'Installed WebView2 startup acceptance failed' }
  $previousNativeApplication = $env:WORKBENCH_NATIVE_APPLICATION
  try {
    $env:WORKBENCH_NATIVE_APPLICATION = $application
    & node (Join-Path $root 'apps/desktop/e2e/native-workspace-smoke.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed WebView2 workspace acceptance failed' }
  } finally {
    $env:WORKBENCH_NATIVE_APPLICATION = $previousNativeApplication
  }

  if (-not $SkipUninstall) {
    $uninstaller = Join-Path $installDirectory 'uninstall.exe'
    if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'NSIS uninstaller was not installed' }
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)" }
    $installedBySmoke = $false
    if (-not (Test-Path -LiteralPath (Join-Path $workspaceFull 'workbench.sqlite3'))) {
      throw 'Uninstall removed the user workspace'
    }
    if (-not (Test-Path -LiteralPath $defaultMarker)) {
      throw 'Uninstall removed the install-directory workspace'
    }
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
  if ($installedBySmoke -and -not $SkipUninstall) {
    $uninstaller = Join-Path $installDirectory 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
      try {
        $cleanupUninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
        if ($cleanupUninstall.ExitCode -ne 0) {
          Write-Warning "Smoke cleanup uninstall exited with code $($cleanupUninstall.ExitCode)"
        }
      } catch {
        Write-Warning "Smoke cleanup uninstall failed: $($_.Exception.Message)"
      }
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
