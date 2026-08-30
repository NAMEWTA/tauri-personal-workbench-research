import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'api', 'openapi.yaml')
const generatedDirectory = resolve(root, 'services', 'workbenchd', 'internal', 'api', 'generated')
const temporary = join(tmpdir(), `personal-workbench-openapi-${process.pid}.yaml`)
const go = process.env.GO_EXE || 'go'

function compatible(value) {
  if (Array.isArray(value)) return value.map(compatible)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compatible(child)]))
  if (Array.isArray(result.oneOf)) {
    const concrete = result.oneOf.filter((item) => item?.type !== 'null')
    const hasNull = concrete.length !== result.oneOf.length
    if (hasNull && concrete.length === 1) {
      delete result.oneOf
      Object.assign(result, concrete[0], { nullable: true })
    }
  }
  if ('const' in result) {
    result.enum = [result.const]
    delete result.const
  }
  return result
}

const document = compatible(parse(readFileSync(source, 'utf8')))
document.openapi = '3.0.3'
writeFileSync(temporary, stringify(document), 'utf8')
try {
  execFileSync(go, ['run', 'github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.5.0', '-config', 'oapi-codegen.yaml', temporary], { cwd: generatedDirectory, stdio: 'inherit' })
} finally {
  rmSync(temporary, { force: true })
}
