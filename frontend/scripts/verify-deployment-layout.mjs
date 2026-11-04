import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = path.resolve(frontendRoot, '..')
const legacyPrototype = path.join(repositoryRoot, 'index.html')
const frontendEntry = path.join(frontendRoot, 'index.html')

await assert.rejects(
  access(legacyPrototype),
  (error) => error instanceof Error && 'code' in error && error.code === 'ENOENT',
  'the retired root index.html must not return alongside the supported React frontend',
)
await assert.doesNotReject(
  access(frontendEntry),
  'frontend/index.html must remain the supported Vite entry point',
)

const vercelConfig = JSON.parse(
  await readFile(path.join(repositoryRoot, 'vercel.json'), 'utf8'),
)
const architectureNote = await readFile(
  path.join(repositoryRoot, 'SmartFolio-Vault', '02 Architecture.md'),
  'utf8',
)

assert.equal(vercelConfig.installCommand, 'cd frontend && npm install')
assert.equal(vercelConfig.buildCommand, 'cd frontend && npm run build')
assert.equal(vercelConfig.outputDirectory, 'frontend/dist')
assert.deepEqual(vercelConfig.rewrites, [
  { source: '/(.*)', destination: '/index.html' },
])
assert.doesNotMatch(
  architectureNote,
  /^## Current Prototype$/m,
  'architecture docs must not present the retired static prototype as current',
)
assert.match(
  architectureNote,
  /^## Historical Prototype \(Retired\)$/m,
  'architecture docs must preserve the prototype only as retired history',
)
assert.match(
  architectureNote,
  /current Vercel deployment is a component-based \*\*Vite \+ React 18 \+/,
  'architecture docs must identify the supported React/Vite deployment',
)

console.log('Deployment layout points exclusively to the React/Vite frontend.')
