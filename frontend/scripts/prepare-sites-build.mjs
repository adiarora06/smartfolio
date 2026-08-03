import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectDir, 'dist')
const clientStage = path.join(projectDir, '.sites-client-stage')

await rm(clientStage, { recursive: true, force: true })
await mkdir(clientStage, { recursive: true })

for (const entry of await readdir(distDir)) {
  await rename(path.join(distDir, entry), path.join(clientStage, entry))
}

const clientDir = path.join(distDir, 'client')
const serverDir = path.join(distDir, 'server')
await mkdir(clientDir, { recursive: true })
await mkdir(serverDir, { recursive: true })

for (const entry of await readdir(clientStage)) {
  await rename(path.join(clientStage, entry), path.join(clientDir, entry))
}

await rm(clientStage, { recursive: true, force: true })

const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)
    if (response.status !== 404 || request.method !== 'GET') return response

    const url = new URL(request.url)
    if (url.pathname.includes('.')) return response

    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
  },
}\n`

await writeFile(path.join(serverDir, 'index.js'), worker)
