/**
 * 跑 scripts/update.test.ts。
 *
 * 这份**落一个临时文件**再 import（不走其他探针的 data: URL 套路），
 * 原因是它要读 electron-builder.yml，得用 yaml 那个包——它是 CJS，内部有
 * require('process') 这类动态 require，esbuild 转成 ESM 之后跑不起来
 * （Dynamic require of "process" is not supported）。落成真实文件加 external，
 * 交给 Node 自己解析依赖就没事了；顺带栈里也是真路径，出问题好查。
 *
 * 放在 node_modules/.tmp/ 下（本来就存在，且已被 .gitignore 覆盖），跑完不删：
 * 断言失败时那张栈就指着它。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleAndImport } from './lib/bundle-import.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
// 测试要按 cwd 找 electron-builder.yml / package.json / release/（data: URL 里
// import.meta.url 指不回仓库，因此测试里统一用 cwd）
process.chdir(root)

const outDir = path.join(root, 'node_modules/.tmp')
const outFile = path.join(outDir, 'moji-update-test.mjs')
await bundleAndImport(path.join(root, 'scripts/update.test.ts'), { external: ['yaml'], file: outFile })
