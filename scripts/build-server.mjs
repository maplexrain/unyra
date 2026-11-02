/**
 * 编译独立 Web 服务端：把 server/index.ts 打包到 dist-server/index.cjs
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanDist } from './electron-compile.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const outdir = join(ROOT, 'dist-server')

export async function buildServer() {
  const esbuild = await import('esbuild')
  cleanDist(outdir)
  await esbuild.build({
    entryPoints: [join(ROOT, 'server/index.ts')],
    outfile: join(outdir, 'index.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'sherpa-onnx-node', 'onnxruntime-node'],
    sourcemap: true,
    logLevel: 'info',
  })
  return outdir
}

if (process.argv[1] && process.argv[1].endsWith('build-server.mjs')) {
  console.log('[build-server] 编译 Web 服务端 → dist-server/index.cjs')
  await buildServer()
  console.log('[build-server] 完成。用 npm run server 运行 Web 服务。')
}
