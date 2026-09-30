/**
 * 跑 scripts/agent-ops.test.ts：用 esbuild 先打包成一份 ESM（顺带处理 ?raw 导入），
 * 再以 data URL 直接 import——不落临时文件，跑完什么都不留在磁盘上。
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundleAndImport } from './lib/bundle-import.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** ?raw 导入：把文件内容当字符串默认导出（与 vite 的行为一致） */
const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: 'export default ' + JSON.stringify(await fs.promises.readFile(args.path, 'utf8')),
      loader: 'js',
    }))
  },
}

/**
 * ?url 导入：vite 会把它变成「打包后的资源地址」（开发时是 dev server 的 URL，
 * 打包后是 assets/…）。Node 探针里没有资源服务器，也没人真的去 fetch 它——
 * 探针只需要这份代码能**构建**出来，所以给一个空串，顺带避免把 500 KB 的 wasm 打进包里。
 * 目前用它的是 src/syntax/GrammarRegistry.ts（oniguruma 的 wasm）。
 */
const urlPlugin = {
  name: 'asset-url',
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'asset-url' }))
    build.onLoad({ filter: /.*/, namespace: 'asset-url' }, () => ({ contents: 'export default ""', loader: 'js' }))
  },
}

await bundleAndImport(path.join(root, 'scripts/agent-ops.test.ts'), { plugins: [rawPlugin, urlPlugin] })
