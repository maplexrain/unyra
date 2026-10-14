/**
 * 把 perf-lab/tab-switch-lab.src.jsx 打成一个**单文件 HTML**。
 *
 * 为什么要单文件：这台机器是拿来反复开关、对比数字的，让使用者先跑一次构建、
 * 再开一个 dev server、再挑地址，成本太高。打成一个自包含的 .html，双击就能用，
 * 也方便发给别人复现。
 *
 * 用 esbuild（vite 已经带了它，不必新增依赖）：
 *   bundle                  把 react / react-dom 一起收进来
 *   jsx: automatic          与项目一致的 JSX 运行时
 *   NODE_ENV=development    与应用现场一致（那份日志就是开发构建录的）
 *
 * 用法：node scripts/build-perf-lab.mjs [--prod]
 *   --prod 换成生产版 React——想量「DEV 构建本身有多贵」时用它对比。
 */

import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 构建一次，返回产出文件的绝对路径。
 * 导出成函数是为了让 check-perf-lab.mjs 直接调用——本机沙箱里从 node 里再
 * spawn 一个 node 会 EBUSY，所以自检脚本不能靠子进程去跑构建。
 */
export async function buildPerfLab({ prod = false } = {}) {
  const result = await build({
    entryPoints: [join(root, 'perf-lab/tab-switch-lab.src.jsx')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    minify: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': prod ? '"production"' : '"development"' },
    logLevel: 'warning',
  })

  const js = result.outputFiles[0].text
  const shell = readFileSync(join(root, 'perf-lab/shell.html'), 'utf8')
  const out = shell.replace('/*BUNDLE*/', () => js.replace(/<\/script>/gi, '<\\/script>'))

  const target = join(root, prod ? 'perf-lab/tab-switch-lab.prod.html' : 'perf-lab/tab-switch-lab.html')
  writeFileSync(target, out)
  return { target, size: out.length, prod }
}

/** 直接被 `node scripts/build-perf-lab.mjs` 调用时（而不是被 import）才执行 */
function invokedDirectly() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  const { target, size, prod } = await buildPerfLab({ prod: process.argv.includes('--prod') })
  console.log(
    `已生成 ${resolve(target).replace(root, '.')}  (${(size / 1024).toFixed(0)} KB, React ${prod ? 'production' : 'development'})`,
  )
}
