import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const application = resolve(process.argv[2] ?? '')
const evidenceRoot = process.argv[3] ? resolve(process.argv[3]) : null
const root = resolve(import.meta.dirname, '../../..')
const fixtureTool = join(root, 'scripts', 'create-schema-fixture.go')
const expectedVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const tokenPattern =
  /原工作区的数据格式不受当前版本支持，已为你打开新工作区。原目录和数据已保留，未进行迁移。/

if (process.platform !== 'win32') throw new Error('Installed startup smoke only supports Windows')
if (!application || !existsSync(application))
  throw new Error(`Installed application is missing: ${application}`)
if (evidenceRoot) await mkdir(evidenceRoot, { recursive: true })

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
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null)
      throw new Error(
        `Desktop exited before WebView2 was ready (${processHandle.exitCode}): ${stderr()}`,
      )
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) return chromium.connectOverCDP(endpoint)
    } catch {
      // The installed host starts WebView2 after the Rust host and sidecar.
    }
    await wait(200)
  }
  throw new Error(`WebView2 debugging endpoint did not open on ${endpoint}`)
}

async function waitForTauriPage(browser) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          if (await page.evaluate(() => '__TAURI_INTERNALS__' in window)) return page
        } catch {
          // Navigation is still in progress.
        }
      }
    }
    await wait(100)
  }
  throw new Error('Tauri WebView page was not exposed through WebView2')
}

async function waitForBackend(page) {
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

async function snapshot(page) {
  return page.evaluate(async () => {
    const connection = await window.__TAURI_INTERNALS__.invoke('backend_connection_info')
    const response = await fetch(`${connection.baseUrl}/api/v3/meta`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    })
    if (!response.ok) throw new Error(`meta failed: ${response.status}`)
    return { connection, meta: await response.json() }
  })
}

async function createTask(page, title) {
  await page.getByRole('heading', { name: '今日' }).waitFor()
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
  if (!processHandle || processHandle.exitCode !== null) return
  const exitPromise = new Promise((resolveExit) =>
    processHandle.once('exit', () => resolveExit(true)),
  )
  const closeCommand = `$targetProcess = Get-Process -Id ${processHandle.pid} -ErrorAction Stop; if (-not $targetProcess.CloseMainWindow()) { exit 2 }`
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', closeCommand],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0 && processHandle.exitCode === null)
    throw new Error(
      `Could not request native window close (${result.status}): ${result.stderr.trim()}`,
    )
  if (
    !(await Promise.race([exitPromise, wait(30_000).then(() => false)])) &&
    processHandle.exitCode === null
  )
    throw new Error('Desktop did not exit after native close request')
}

async function removeProbe(directory) {
  const deadline = Date.now() + 15_000
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

function createSchemaFixture(database) {
  const result = spawnSync('go', ['run', fixtureTool, database, '2'], {
    cwd: join(root, 'services', 'workbenchd'),
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0)
    throw new Error(`schema fixture failed: ${result.stderr || result.stdout}`)
}

async function sha256(path) {
  const value = await readFile(path)
  return createHash('sha256').update(value).digest('hex')
}

async function runScenario(name, withRecent, defaultIncompatible = true) {
  const probe = await mkdtemp(join(tmpdir(), `personal-workbench-native-startup-${name}-`))
  const appData = join(probe, 'app-data')
  const config = join(probe, 'config')
  const webview = join(probe, 'webview2')
  const defaultWorkspace = join(appData, 'workspace')
  const recentWorkspace = join(probe, 'recent-workspace')
  const registryPath = join(config, 'workspaces.json')
  const occupied = join(appData, 'workspace-current-1')
  const evidence = evidenceRoot ? join(evidenceRoot, name) : null
  let browser
  let processHandle
  let page
  let stderr = ''
  const taskTitle = `startup-${name}-${Date.now()}`
  const sidecar = join(dirname(application), 'workbenchd.exe')
  const applicationHash = await sha256(application)
  const sidecarHash = existsSync(sidecar) ? await sha256(sidecar) : null
  const sidecarVersionResult = existsSync(sidecar)
    ? spawnSync(sidecar, ['--version'], { encoding: 'utf8', windowsHide: true })
    : null
  const sidecarVersion =
    sidecarVersionResult?.status === 0 ? sidecarVersionResult.stdout.trim() : null
  try {
    if (evidence) await mkdir(evidence, { recursive: true })
    if (sidecarVersion !== expectedVersion)
      throw new Error(
        `sidecar version ${sidecarVersion} does not match package version ${expectedVersion}`,
      )
    await Promise.all(
      [appData, config, webview, defaultWorkspace, recentWorkspace].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    )
    if (defaultIncompatible) createSchemaFixture(join(defaultWorkspace, 'workbench.sqlite3'))
    createSchemaFixture(join(recentWorkspace, 'workbench.sqlite3'))
    await writeFile(occupied, 'occupied workspace-current-1\n', 'utf8')
    if (withRecent) {
      await writeFile(
        registryPath,
        `${JSON.stringify([{ path: recentWorkspace, lastOpened: Math.floor(Date.now() / 1000) }], null, 2)}\n`,
        'utf8',
      )
    }
    const originalDatabases = [
      ...(defaultIncompatible
        ? [{ path: join(defaultWorkspace, 'workbench.sqlite3'), name: 'default' }]
        : []),
      ...(withRecent ? [{ path: join(recentWorkspace, 'workbench.sqlite3'), name: 'recent' }] : []),
    ]
    const originalHashes = Object.fromEntries(
      await Promise.all(
        originalDatabases.map(async (item) => [item.name, await sha256(item.path)]),
      ),
    )
    const port = await reserveLoopbackPort()
    processHandle = spawn(application, [], {
      cwd: dirname(application),
      env: {
        ...process.env,
        WORKBENCH_DEV_APP_DATA_DIR: appData,
        WORKBENCH_DEV_CONFIG_DIR: config,
        WEBVIEW2_USER_DATA_FOLDER: webview,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    processHandle.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_192)
    })
    browser = await waitForBrowser(port, processHandle, () => stderr.trim())
    page = await waitForTauriPage(browser)
    await page.getByRole('heading', { name: '今日' }).waitFor({ timeout: 30_000 })
    const first = await snapshot(page)
    assert.equal(first.meta.workspaceName, 'workspace-current-2')
    assert.equal(first.meta.serviceVersion, expectedVersion)
    const notice = await page.evaluate(() =>
      window.__TAURI_INTERNALS__.invoke('get_startup_notice'),
    )
    assert.equal(typeof notice, 'string')
    assert.match(notice, tokenPattern)
    await page.getByRole('status').filter({ hasText: '原工作区的数据格式' }).waitFor()
    await page.screenshot({
      path: evidence ? join(evidence, 'recovery-first.png') : join(probe, 'recovery-first.png'),
      fullPage: true,
    })
    await createTask(page, taskTitle)
    await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
    await page.getByText(taskTitle, { exact: true }).waitFor()
    const currentPath = await page.evaluate(
      async () =>
        (await window.__TAURI_INTERNALS__.invoke('list_recent_workspaces')).find(
          (item) => item.lastOpened,
        )?.path,
    )
    assert(currentPath && currentPath.toLowerCase().endsWith('workspace-current-2'))
    const freshDatabase = join(currentPath, 'workbench.sqlite3')
    const originalPath = withRecent ? recentWorkspace : defaultWorkspace
    await gracefulClose(processHandle)
    processHandle = undefined
    await browser.close()
    browser = undefined
    const restartPort = await reserveLoopbackPort()
    processHandle = spawn(application, [], {
      cwd: dirname(application),
      env: {
        ...process.env,
        WORKBENCH_DEV_APP_DATA_DIR: appData,
        WORKBENCH_DEV_CONFIG_DIR: config,
        WEBVIEW2_USER_DATA_FOLDER: join(probe, 'webview2-restart'),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${restartPort} --remote-allow-origins=*`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    processHandle.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8_192)
    })
    browser = await waitForBrowser(restartPort, processHandle, () => stderr.trim())
    page = await waitForTauriPage(browser)
    await page.getByRole('heading', { name: '今日' }).waitFor({ timeout: 30_000 })
    await waitForBackend(page)
    const restarted = await snapshot(page)
    assert.equal(restarted.meta.workspaceName, 'workspace-current-2')
    assert.equal(restarted.meta.serviceVersion, expectedVersion)
    assert.equal(
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_startup_notice')),
      null,
    )
    await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
    await page.getByText(taskTitle, { exact: true }).waitFor()
    const openOld = await page.evaluate(async (path) => {
      try {
        await window.__TAURI_INTERNALS__.invoke('open_workspace', { path })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    }, originalPath)
    assert.equal(openOld.ok, false)
    await waitForBackend(page)
    const afterReject = await snapshot(page)
    assert.equal(afterReject.meta.workspaceName, 'workspace-current-2')
    for (const item of originalDatabases)
      assert.equal(
        await sha256(item.path),
        originalHashes[item.name],
        `${item.name} database changed`,
      )
    if (evidence) {
      await page.screenshot({ path: join(evidence, 'restart-persisted.png'), fullPage: true })
      await writeFile(
        join(evidence, 'result.json'),
        `${JSON.stringify({ scenario: name, withRecent, defaultIncompatible, expectedVersion, application, applicationHash, sidecar, sidecarHash, sidecarVersion, originalPath, originalHashes, freshWorkspace: currentPath, freshDatabase, taskTitle, restartWorkspace: restarted.meta.workspaceName, startupNoticeAfterRestart: null, recordedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8',
      )
    }
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    assert.equal(registry[0].path.toLowerCase(), currentPath.toLowerCase())
    assert.equal(await stat(freshDatabase).then(() => true), true)
    return { name, originalPath, freshWorkspace: currentPath, taskTitle }
  } catch (error) {
    if (evidence && page)
      await page
        .screenshot({ path: join(evidence, 'failure.png'), fullPage: true })
        .catch(() => undefined)
    throw error
  } finally {
    if (browser) await browser.close().catch(() => undefined)
    let closeError
    if (processHandle?.exitCode === null) {
      try {
        await gracefulClose(processHandle)
      } catch (error) {
        closeError = error
        spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      }
    }
    await removeProbe(probe)
    if (closeError) throw closeError
  }
}

const results = []
try {
  results.push(await runScenario('default-schema2', false, true))
  results.push(await runScenario('recent-schema2-default-valid', true, false))
  results.push(await runScenario('recent-and-default-schema2', true, true))
  console.log(JSON.stringify({ installedStartupRecovery: 'passed', scenarios: results }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
