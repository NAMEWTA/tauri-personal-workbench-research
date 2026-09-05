import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

const registryPath = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2'

function powershell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    windowsHide: true,
  })
}

function isElevated() {
  try {
    return (
      powershell(
        '[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent() | ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }',
      )
        .trim()
        .toLowerCase() === 'true'
    )
  } catch {
    return false
  }
}

function shouldOverride() {
  return (process.env.CI === 'true' || process.env.CI === '1') && isElevated()
}

export function prepareNativeWebViewOverrides({ application, port, userDataFolder }) {
  if (process.platform !== 'win32' || !shouldOverride()) {
    return { enabled: false, restore: async () => undefined }
  }
  const appId = basename(application)
  const escapedAppId = appId.replace(/'/g, "''")
  const state = JSON.parse(
    powershell(
      `$root='${registryPath}'; $app='${escapedAppId}'; $arguments=Get-ItemProperty -Path ($root+'\\AdditionalBrowserArguments') -Name $app -ErrorAction SilentlyContinue; $folder=Get-ItemProperty -Path ($root+'\\UserDataFolder') -Name $app -ErrorAction SilentlyContinue; [PSCustomObject]@{ ArgumentsExists=[bool]$arguments; Arguments=if($arguments){$arguments.$app}else{$null}; FolderExists=[bool]$folder; Folder=if($folder){$folder.$app}else{$null} } | ConvertTo-Json -Compress`,
    ),
  )
  const browserArguments = `--remote-debugging-port=${port} --remote-allow-origins=*`
  powershell(
    `$root='${registryPath}'; $app='${escapedAppId}'; New-Item -Path ($root+'\\AdditionalBrowserArguments') -Force | Out-Null; New-Item -Path ($root+'\\UserDataFolder') -Force | Out-Null; New-ItemProperty -Path ($root+'\\AdditionalBrowserArguments') -Name $app -PropertyType String -Value '${browserArguments}' -Force | Out-Null; New-ItemProperty -Path ($root+'\\UserDataFolder') -Name $app -PropertyType String -Value '${String(userDataFolder).replace(/'/g, "''")}' -Force | Out-Null`,
  )
  let restored = false
  return {
    enabled: true,
    restore: async () => {
      if (restored) return
      restored = true
      const restoreArguments = state.ArgumentsExists
        ? `New-ItemProperty -Path ($root+'\\AdditionalBrowserArguments') -Name $app -PropertyType String -Value '${String(state.Arguments).replace(/'/g, "''")}' -Force | Out-Null`
        : `Remove-ItemProperty -Path ($root+'\\AdditionalBrowserArguments') -Name $app -ErrorAction SilentlyContinue`
      const restoreFolder = state.FolderExists
        ? `New-ItemProperty -Path ($root+'\\UserDataFolder') -Name $app -PropertyType String -Value '${String(state.Folder).replace(/'/g, "''")}' -Force | Out-Null`
        : `Remove-ItemProperty -Path ($root+'\\UserDataFolder') -Name $app -ErrorAction SilentlyContinue`
      const restoreScript = `$root='${registryPath}'; $app='${escapedAppId}'; ${restoreArguments}; ${restoreFolder}`
      powershell(restoreScript)
    },
  }
}

export function nativeWebViewOverrideStatus() {
  return {
    ci: process.env.CI === 'true' || process.env.CI === '1',
    elevated: process.platform === 'win32' && isElevated(),
  }
}
