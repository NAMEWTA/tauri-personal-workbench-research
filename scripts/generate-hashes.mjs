import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const artifacts = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(import.meta.dirname, '..', 'artifacts')
const names = readdirSync(artifacts)
  .filter((name) => name !== 'SHA256SUMS.txt')
  .sort((first, second) => first.localeCompare(second, 'en'))

const lines = []
for (const name of names) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(join(artifacts, name))) hash.update(chunk)
  lines.push(`${hash.digest('hex')}  ${basename(name)}`)
}
writeFileSync(join(artifacts, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, { mode: 0o600 })
console.log(`Wrote SHA256SUMS.txt for ${lines.length} artifacts`)
