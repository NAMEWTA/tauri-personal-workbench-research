import { spawnSync } from 'node:child_process'

const executable = process.env.GO_EXE || 'go'
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit', env: process.env })
if (result.error) throw result.error
process.exit(result.status ?? 1)
