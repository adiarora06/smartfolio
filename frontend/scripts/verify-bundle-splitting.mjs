import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = path.join(frontendRoot, 'dist')
const manifest = JSON.parse(
  await readFile(path.join(distRoot, '.vite', 'manifest.json'), 'utf8'),
)

const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
assert.ok(entry, 'Vite manifest must contain an application entry')

const expectedSurfaces = [
  'src/components/landing/LandingPage.tsx',
  'src/components/setup/SetupFlow.tsx',
  'src/components/app/IonicApplication.tsx',
]
assert.deepEqual(
  [...(entry.dynamicImports ?? [])].sort(),
  [...expectedSurfaces].sort(),
  'landing, setup, and the Ionic workspace must remain separate lazy surfaces',
)

const ionicApplication = manifest['src/components/app/IonicApplication.tsx']
assert.ok(ionicApplication?.isDynamicEntry, 'the Ionic workspace must remain a dynamic entry')

const expectedScreens = [
  'src/components/app/screens/OverviewScreen.tsx',
  'src/components/app/screens/PortfolioScreen.tsx',
  'src/components/app/screens/AnalyzeStockScreen.tsx',
  'src/components/app/screens/ScenariosScreen.tsx',
  'src/components/app/screens/ConnectionsScreen.tsx',
  'src/components/app/screens/OpenSourceScreen.tsx',
  'src/components/app/MoreScreen.tsx',
]
assert.deepEqual(
  [...(ionicApplication.dynamicImports ?? [])].sort(),
  [...expectedScreens].sort(),
  'each workspace route must remain independently loadable',
)

const staticFiles = new Set()
function collectStaticChunk(chunk) {
  if (!chunk || staticFiles.has(chunk.file)) return
  staticFiles.add(chunk.file)
  for (const dependency of chunk.imports ?? []) collectStaticChunk(manifest[dependency])
}
collectStaticChunk(entry)

const initialJavaScriptBytes = (
  await Promise.all(
    [...staticFiles]
      .filter((file) => file.endsWith('.js'))
      .map(async (file) => (await stat(path.join(distRoot, file))).size),
  )
).reduce((total, size) => total + size, 0)

const assetNames = await readdir(path.join(distRoot, 'assets'))
const javascriptAssets = await Promise.all(
  assetNames
    .filter((file) => file.endsWith('.js'))
    .map(async (file) => ({
      file,
      bytes: (await stat(path.join(distRoot, 'assets', file))).size,
    })),
)
const largestChunk = javascriptAssets.reduce((largest, asset) =>
  asset.bytes > largest.bytes ? asset : largest,
)

assert.ok(
  initialJavaScriptBytes <= 250_000,
  `initial static JavaScript is ${initialJavaScriptBytes} bytes; expected at most 250000`,
)
assert.ok(
  largestChunk.bytes <= 400_000,
  `largest JavaScript chunk is ${largestChunk.file} at ${largestChunk.bytes} bytes; expected at most 400000`,
)

console.log(
  `Bundle contract passed: ${Math.round(initialJavaScriptBytes / 1000)} kB initial static JS; ` +
    `${Math.round(largestChunk.bytes / 1000)} kB largest chunk; ` +
    `${expectedScreens.length} lazy workspace routes.`,
)
