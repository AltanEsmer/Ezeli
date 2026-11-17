// The size cap: the app's source (src/) may not grow past this many lines.
// Only the owners raise it (spec, issue 1). Run as: pnpm check:size
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LIMIT = 4000

function lines(dir: string): number {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += lines(path)
    else total += readFileSync(path, 'utf8').split('\n').length - 1
  }
  return total
}

const count = lines('src')
console.log(`src/ is ${count} of ${LIMIT} lines`)
if (count > LIMIT) {
  console.error('src/ is over the size cap. Delete code, or ask the owners to raise the cap.')
  process.exit(1)
}
