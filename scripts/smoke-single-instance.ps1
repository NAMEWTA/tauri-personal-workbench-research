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
$productName = [string]$tauriConfig.productName
$fallbackInstallDirectory = Join-Path $env:LOCALAPPDATA $productName
$probe = Join-Path ([IO.Path]::GetTempPath()) "personal-workbench-single-instance-$PID"
$probeFull = [IO.Path]::GetFullPath($probe)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $probeFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe smoke workspace: $probeFull"
}
$configDirectory = Join-Path $probeFull 'config'
$workspace = Join-Path $probeFull 'workspace'
$webviewDirectory = Join-Path $probeFull 'webview2'

function Get-InstalledDirectory([string]$Fallback) {
  $uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  if (Test-Path -LiteralPath $uninstallRoot) {
    foreach ($key in Get-ChildItem -LiteralPath $uninstallRoot) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath
      if ($entry.DisplayName -eq $productName -and $entry.InstallLocation) {
        return $entry.InstallLocation.Trim('"')
      }
    }
  }
  return $Fallback
}

function Get-ProcessSidecars([int]$DesktopId) {
  @(
    Get-CimInstance Win32_Process -Filter "Name = 'workbenchd.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ParentProcessId -eq $DesktopId }
  )
}

function Start-ProbeApp([string]$ApplicationPath) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ApplicationPath
  $startInfo.UseShellExecute = $false
  $startInfo.EnvironmentVariables['WORKBENCH_DEV_APP_DATA_DIR'] = $probeFull
  $startInfo.EnvironmentVariables['WORKBENCH_DEV_CONFIG_DIR'] = $configDirectory
  $startInfo.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $webviewDirectory
  return [Diagnostics.Process]::Start($startInfo)
}

function Stop-ProbeProcess($Process) {
  if (-not $Process) { return }
  $Process.Refresh()
  if (-not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    [void]$Process.WaitForExit(5000)
  }
}

New-Item -ItemType Directory -Force -Path $configDirectory, $workspace, $webviewDirectory | Out-Null
$registry = ConvertTo-Json -InputObject @(@{
    path = [IO.Path]::GetFullPath($workspace)
    lastOpened = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  })
[IO.File]::WriteAllText(
  (Join-Path $configDirectory 'workspaces.json'),
  $registry,
  (New-Object System.Text.UTF8Encoding($false))
)

$first = $null
$second = $null
$trackedSidecarIds = [System.Collections.Generic.HashSet[int]]::new()
$installedByProbe = $false
$installDirectory = $fallbackInstallDirectory
try {
  $install = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw "NSIS installation failed with exit code $($install.ExitCode)" }
  $installedByProbe = $true
  $installDirectory = Get-InstalledDirectory -Fallback $fallbackInstallDirectory
  $application = Join-Path $installDirectory 'personal-workbench.exe'
  if (-not (Test-Path -LiteralPath $application)) {
    throw "NSIS installation did not produce $application"
  }

  $first = Start-ProbeApp -ApplicationPath $application
  $database = Join-Path $workspace 'workbench.sqlite3'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $first.Refresh()
    $sidecars = @(Get-ProcessSidecars -DesktopId $first.Id)
    foreach ($sidecarProcess in $sidecars) { [void]$trackedSidecarIds.Add([int]$sidecarProcess.ProcessId) }
  } while (-not $first.HasExited -and ($sidecars.Count -eq 0 -or -not (Test-Path -LiteralPath $database)) -and [DateTime]::UtcNow -lt $deadline)
  if ($first.HasExited -or $sidecars.Count -ne 1 -or -not (Test-Path -LiteralPath $database)) {
    throw "first instance was not ready (exited=$($first.HasExited), sidecars=$($sidecars.Count), database=$(Test-Path -LiteralPath $database))"
  }

  $initialSidecarId = [int]$sidecars[0].ProcessId
  Stop-Process -Id $initialSidecarId -Force
  $recoveryDeadline = [DateTime]::UtcNow.AddSeconds(30)
  $recoveredSidecarId = 0
  do {
    Start-Sleep -Milliseconds 250
    $first.Refresh()
    $recoveredSidecars = @(Get-ProcessSidecars -DesktopId $first.Id)
    foreach ($sidecarProcess in $recoveredSidecars) { [void]$trackedSidecarIds.Add([int]$sidecarProcess.ProcessId) }
    if ($recoveredSidecars.Count -eq 1 -and [int]$recoveredSidecars[0].ProcessId -ne $initialSidecarId) {
      $recoveredSidecarId = [int]$recoveredSidecars[0].ProcessId
    }
  } while (-not $first.HasExited -and $recoveredSidecarId -eq 0 -and [DateTime]::UtcNow -lt $recoveryDeadline)
  if ($first.HasExited) { throw 'first instance exited while recovering its sidecar' }
  if ($recoveredSidecarId -eq 0) {
    throw "sidecar did not recover (initialPid=$initialSidecarId, current=$($recoveredSidecars.Count))"
  }
  Write-Output "Sidecar crash recovery passed (initialPid=$initialSidecarId recoveredPid=$recoveredSidecarId)"

  $second = Start-ProbeApp -ApplicationPath $application
  $secondExited = $second.WaitForExit(15000)
  $second.Refresh()
  $first.Refresh()
  $sidecars = @(Get-ProcessSidecars -DesktopId $first.Id)
  foreach ($sidecarProcess in $sidecars) { [void]$trackedSidecarIds.Add([int]$sidecarProcess.ProcessId) }
  Write-Output ("firstPid={0} firstAlive={1} secondPid={2} secondExited={3} secondExitCode={4} sidecars={5}" -f $first.Id, (-not $first.HasExited), $second.Id, $secondExited, $(if ($second.HasExited) { $second.ExitCode } else { 'running' }), $sidecars.Count)
  if (-not $secondExited -or -not $second.HasExited) { throw 'second instance remained running' }
  if ($first.HasExited) { throw 'first instance exited after duplicate launch' }
  if ($sidecars.Count -ne 1) { throw "duplicate launch changed sidecar count to $($sidecars.Count)" }
  Write-Output 'Single-instance native smoke passed'
} finally {
  Stop-ProbeProcess -Process $second
  foreach ($sidecarId in $trackedSidecarIds) {
    Stop-Process -Id $sidecarId -Force -ErrorAction SilentlyContinue
  }
  Stop-ProbeProcess -Process $first
  $uninstaller = Join-Path $installDirectory 'uninstall.exe'
  if ($installedByProbe -and (Test-Path -LiteralPath $uninstaller)) {
    $remove = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
    if ($remove.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($remove.ExitCode)" }
  }
  if (Test-Path -LiteralPath $probeFull) {
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
      try {
        Remove-Item -LiteralPath $probeFull -Recurse -Force
        break
      } catch {
        if ([DateTime]::UtcNow -ge $cleanupDeadline) { throw }
        Start-Sleep -Milliseconds 250
      }
    } while (Test-Path -LiteralPath $probeFull)
  }
}
