import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

export default async function globalTeardown() {
  const statePath = join(process.cwd(), 'test-results', '.e2e-server.json')
  let state: { backendUrl: string; token: string; workspace: string }
  try {
    state = JSON.parse(await readFile(statePath, 'utf8'))
  } catch {
    return
  }

  try {
    await fetch(`${state.backendUrl}/internal/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    // Playwright may already have stopped the web server process tree.
  }

  const expectedPrefix = join(process.env.TEMP ?? '', 'personal-workbench-e2e-').toLowerCase()
  if (state.workspace.toLowerCase().startsWith(expectedPrefix)) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(state.workspace, { recursive: true, force: true })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
  await rm(statePath, { force: true })
}
