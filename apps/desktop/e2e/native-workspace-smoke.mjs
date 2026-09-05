import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '../../..')
const target = process.env.TAURI_ENV_TARGET_TRIPLE?.trim()
const releaseDirectory = target
  ? join(root, 'target', target, 'release')
  : join(root, 'target', 'release')
const application = join(releaseDirectory, 'personal-workbench.exe')
const sidecar = join(releaseDirectory, 'workbenchd.exe')

if (process.platform !== 'win32') throw new Error('Native workspace smoke only supports Windows')
if (!existsSync(application) || !existsSync(sidecar)) {
  throw new Error(`Built desktop application is missing from ${releaseDirectory}`)
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

async function reserveLoopbackPort() {
  const server = net.createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  const port = address.port
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  )
  return port
}

async function waitForBrowser(port, processHandle, stderr) {
  const endpoint = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Desktop exited before WebView2 was ready (${processHandle.exitCode}): ${stderr()}`,
      )
    }
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return chromium.connectOverCDP(endpoint)
    } catch {
      // WebView2 starts after the native host and sidecar are ready.
    }
    await wait(200)
  }
  throw new Error(`WebView2 debugging endpoint did not open on ${endpoint}`)
}

async function waitForTauriPage(browser) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          if (await page.evaluate(() => '__TAURI_INTERNALS__' in window)) return page
        } catch {
          // The page can be navigating while the Tauri host initializes.
        }
      }
    }
    await wait(100)
  }
  throw new Error('Tauri WebView page was not exposed through WebView2')
}

async function backendSnapshot(page) {
  return page.evaluate(async () => {
    const connection = await window.__TAURI_INTERNALS__.invoke('backend_connection_info')
    const headers = { Authorization: `Bearer ${connection.token}` }
    const [metaResponse, preferencesResponse] = await Promise.all([
      fetch(`${connection.baseUrl}/api/v3/meta`, { headers }),
      fetch(`${connection.baseUrl}/api/v3/preferences`, { headers }),
    ])
    if (!metaResponse.ok || !preferencesResponse.ok) {
      throw new Error(
        `Native API snapshot failed: ${metaResponse.status}/${preferencesResponse.status}`,
      )
    }
    return {
      backendUrl: connection.baseUrl,
      token: connection.token,
      meta: await metaResponse.json(),
      preferences: await preferencesResponse.json(),
    }
  })
}

async function stableBackendSnapshot(page) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await backendSnapshot(page)
    } catch (error) {
      lastError = error
      await wait(150)
    }
  }
  throw lastError ?? new Error('Native backend snapshot timed out')
}

async function apiJson(snapshot, pathname, init = {}) {
  const response = await fetch(`${snapshot.backendUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${snapshot.token}`,
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} failed with ${response.status}`)
  }
  return response.json()
}

async function waitForJob(snapshot, jobId) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const job = await apiJson(snapshot, `/api/v3/jobs/${jobId}`)
    if (job.state === 'succeeded') return job
    if (job.state === 'failed' || job.state === 'cancelled') {
      throw new Error(`Background job ${jobId} ended in ${job.state}`)
    }
    await wait(150)
  }
  throw new Error(`Background job ${jobId} did not finish in time`)
}

async function waitForCompletedBackup(snapshot) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const backups = await apiJson(snapshot, '/api/v3/backups')
    const completed = backups.find((item) => item.state === 'succeeded' && item.path)
    if (completed) return completed
    await wait(150)
  }
  throw new Error('Backup history did not expose a completed path')
}

async function waitForWorkspace(page, name, previousBackendUrl) {
  await page.waitForFunction(
    async ({ expected, previous }) => {
      if (document.querySelector('.diagnostic-list dd')?.textContent?.trim() !== expected)
        return false
      try {
        const connection = await window.__TAURI_INTERNALS__.invoke('backend_connection_info')
        if (previous && connection.baseUrl === previous) return false
        const response = await fetch(`${connection.baseUrl}/api/v3/meta`, {
          headers: { Authorization: `Bearer ${connection.token}` },
        })
        if (!response.ok) return false
        return (await response.json()).workspaceName === expected
      } catch {
        return false
      }
    },
    { expected: name, previous: previousBackendUrl },
    { timeout: 30_000 },
  )
}

async function waitForBackendReady(page) {
  await page.waitForFunction(
    async () => {
      try {
        const connection = await window.__TAURI_INTERNALS__.invoke('backend_connection_info')
        const response = await fetch(`${connection.baseUrl}/api/v3/meta`, {
          headers: { Authorization: `Bearer ${connection.token}` },
        })
        return response.ok
      } catch {
        return false
      }
    },
    undefined,
    { timeout: 30_000 },
  )
}

async function switchWorkspace(page, name) {
  const previousBackendUrl = await page.evaluate(async () => {
    const connection = await window.__TAURI_INTERNALS__.invoke('backend_connection_info')
    return connection.baseUrl
  })
  const button = page
    .locator('.recent-workspaces > button')
    .filter({ has: page.getByText(name, { exact: true }) })
  await button.waitFor({ state: 'visible' })
  assert.equal(await button.isEnabled(), true, `${name} workspace button should be enabled`)
  await button.click()
  await waitForWorkspace(page, name, previousBackendUrl)
  await waitForBackendReady(page)
}

async function createTask(page, title) {
  await page.locator('.sidebar').getByRole('link', { name: '今日', exact: true }).click()
  await page.getByLabel('任务标题').fill(title)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v3/tasks') && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '添加' }).click(),
  ])
  await page.getByRole('heading', { name: title }).waitFor()
  await page.getByRole('button', { name: '关闭任务详情' }).click()
}

async function gracefulClose(processHandle) {
  if (processHandle.exitCode !== null) return

  const exitPromise = new Promise((resolveExit) =>
    processHandle.once('exit', () => resolveExit(true)),
  )
  const closeCommand = [
    `$targetProcess = Get-Process -Id ${processHandle.pid} -ErrorAction Stop`,
    'if (-not $targetProcess.CloseMainWindow()) { exit 2 }',
  ].join('; ')
  const closeResult = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', closeCommand],
    { encoding: 'utf8', windowsHide: true },
  )
  if (closeResult.status !== 0 && processHandle.exitCode === null) {
    throw new Error(
      `Could not request native window close (${closeResult.status}): ${closeResult.stderr.trim()}`,
    )
  }

  const exited = await Promise.race([exitPromise, wait(30_000).then(() => false)])
  if (!exited && processHandle.exitCode === null) {
    throw new Error('Desktop did not exit after the native close request')
  }
}

async function removeProbe(directory) {
  const deadline = Date.now() + 10_000
  while (true) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await wait(200)
    }
  }
}

const probe = await mkdtemp(join(tmpdir(), 'personal-workbench-native-workspace-'))
const workspaceA = join(probe, 'workspace-a')
const workspaceB = join(probe, 'workspace-b')
const configDirectory = join(probe, 'config')
const appDataDirectory = join(probe, 'app-data')
const webviewDirectory = join(probe, 'webview2')
const registryPath = join(configDirectory, 'workspaces.json')
const backupDirectory = join(probe, 'backup-files')
const restoredWorkspace = join(probe, 'restored-workspace')
const taskA = `native-a-${Date.now()}`
const taskB = `native-b-${Date.now()}`
const apiHosts = new Set()
let browser
let page
let processHandle
let stderr = ''

try {
  await Promise.all(
    [workspaceA, workspaceB, configDirectory, appDataDirectory, webviewDirectory].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  await writeFile(
    registryPath,
    `${JSON.stringify(
      [
        { path: workspaceA, lastOpened: Math.floor(Date.now() / 1_000) },
        { path: workspaceB, lastOpened: Math.floor(Date.now() / 1_000) - 1 },
      ],
      null,
      2,
    )}\n`,
    'utf8',
  )

  const port = await reserveLoopbackPort()
  processHandle = spawn(application, [], {
    cwd: releaseDirectory,
    env: {
      ...process.env,
      WORKBENCH_DEV_APP_DATA_DIR: appDataDirectory,
      WORKBENCH_DEV_CONFIG_DIR: configDirectory,
      WEBVIEW2_USER_DATA_FOLDER: webviewDirectory,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} --remote-allow-origins=*`,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  processHandle.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_192)
  })

  browser = await waitForBrowser(port, processHandle, () => stderr.trim())
  page = await waitForTauriPage(browser)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) apiHosts.add(url.hostname)
  })
  await page.getByRole('heading', { name: '今日' }).waitFor({ timeout: 30_000 })

  const initial = await backendSnapshot(page)
  assert.equal(new URL(initial.backendUrl).hostname, '127.0.0.1')
  assert.equal(initial.meta.workspaceName, basename(workspaceA))
  assert.equal(initial.preferences.theme, 'system')
  await createTask(page, taskA)

  await mkdir(backupDirectory, { recursive: true })
  await apiJson(initial, '/api/v3/backup-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backupDirectory }),
  })
  const backupJob = await apiJson(initial, '/api/v3/backups', { method: 'POST' })
  await waitForJob(initial, backupJob.id)
  const completedBackup = await waitForCompletedBackup(initial)
  const restoreReport = await apiJson(initial, '/api/v3/restores/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: completedBackup.path }),
  })
  assert.equal(restoreReport.workspaceName, basename(workspaceA))
  const restoreJob = await apiJson(initial, '/api/v3/restores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: completedBackup.path, destination: restoredWorkspace }),
  })
  await waitForJob(initial, restoreJob.id)
  assert(existsSync(join(restoredWorkspace, 'workbench.sqlite3')))

  await page.evaluate(async (path) => {
    await window.__TAURI_INTERNALS__.invoke('open_workspace', { path })
  }, restoredWorkspace)
  await page.reload()
  await page.locator('.sidebar').getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '设置' }).waitFor({ timeout: 30_000 })
  await waitForWorkspace(page, basename(restoredWorkspace), initial.backendUrl)
  await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
  await page.getByText(taskA, { exact: true }).waitFor()

  await page.locator('.sidebar').getByRole('link', { name: '设置', exact: true }).click()
  await waitForWorkspace(page, basename(restoredWorkspace))
  await switchWorkspace(page, basename(workspaceA))
  const restoredA = await stableBackendSnapshot(page)
  assert.equal(restoredA.meta.workspaceName, basename(workspaceA))
  assert.equal(restoredA.preferences.theme, 'system')
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v3/preferences') && response.request().method() === 'PATCH',
    ),
    page.getByRole('button', { name: '深色' }).click(),
  ])
  await switchWorkspace(page, basename(workspaceB))

  const openedB = await stableBackendSnapshot(page)
  assert.equal(new URL(openedB.backendUrl).hostname, '127.0.0.1')
  assert.equal(openedB.meta.workspaceName, basename(workspaceB))
  assert.equal(openedB.preferences.theme, 'system')
  await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
  assert.equal(await page.getByText(taskA, { exact: true }).count(), 0)
  await createTask(page, taskB)

  await page.locator('.sidebar').getByRole('link', { name: '设置', exact: true }).click()
  await switchWorkspace(page, basename(workspaceA))
  const reopenedA = await stableBackendSnapshot(page)
  assert.equal(reopenedA.meta.workspaceName, basename(workspaceA))
  assert.equal(reopenedA.preferences.theme, 'dark')
  await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
  await page.getByText(taskA, { exact: true }).waitFor()
  assert.equal(await page.getByText(taskB, { exact: true }).count(), 0)
  assert.deepEqual([...apiHosts], ['127.0.0.1'])

  await gracefulClose(processHandle)
  const [databaseA, databaseB, registry] = await Promise.all([
    stat(join(workspaceA, 'workbench.sqlite3')),
    stat(join(workspaceB, 'workbench.sqlite3')),
    readFile(registryPath, 'utf8').then(JSON.parse),
  ])
  assert(databaseA.size > 0 && databaseB.size > 0)
  assert.equal(registry[0].path.toLowerCase(), workspaceA.toLowerCase())
  assert.deepEqual(Object.keys(registry[0]).sort(), ['lastOpened', 'path'])
  console.log('Native Tauri workspace switch, isolation, and persistence smoke passed')
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (processHandle?.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  }
  await removeProbe(probe)
}
