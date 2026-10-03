/**
 * Electron 侧的 esbuild 编译：主进程与 preload 打包成 CJS，输出到 dist-electron/。
 *
 * 为什么用 esbuild 而不是 tsc：主进程代码要跑在 Electron 的 Node 运行时里，
 * 需要打成 CJS 单文件；tsc 只做类型检查（见 npm run typecheck）。
 *
 * 同时导出 findTsFiles / cleanDist，供 dev.mjs 复用。
 */

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 递归收集目录下的 .ts 文件 */
export function findTsFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findTsFiles(full))
    else if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

/** 清掉产物目录：防止已删除模块的旧编译结果残留 */
export function cleanDist(dir) {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * 发布构建（MOJI_RELEASE=1）：压缩、不带 sourcemap。
 *
 * 为什么默认不这样：主进程的栈要看得懂（这个仓库把渲染层 console 转发到终端、
 * 注释里写满「为什么」，就是为了出问题能当场查）。只有发给买家的那一份需要
 * 「读起来费劲」，而且它本来也不该带着源码映射满世界跑——见 scripts/build-release.mjs。
 */
const isReleaseBuild = () => process.env.MOJI_RELEASE === '1'

/** esbuild 的公共配置：Node 平台、CJS、electron 保持 external */
export function baseBuildOptions(entryPoints, outdir) {
  const release = isReleaseBuild()
  return {
    entryPoints,
    outdir,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // 产物必须是 .cjs：package.json 里 "type": "module"，
    // 若输出 .js，Node/Electron 会把它当 ESM 加载，CJS 的 module.exports 直接失效。
    outExtension: { '.js': '.cjs' },
    // electron 由运行时提供，不能打进来
    external: ['electron'],
    minify: release,
    sourcemap: !release,
    logLevel: 'info',
  }
}

/**
 * 编译主进程与 preload 到 dist-electron/。
 *
 * proxy.ts 单独留一个产物：它是 llm-proxy 协议的全部实现，
 * 独立成文件既便于按需引用，也让「协议转发」这件事可以被单独验证。
 * storage.ts 不在这里单列——它只有 main.ts 一个使用者，再列一份会把
 * 依赖（yaml）多打包一遍，白白多出几百 KB 的重复产物。
 */
export async function buildElectron(outdir = join(ROOT, 'dist-electron')) {
  const esbuild = await import('esbuild')
  cleanDist(outdir)
  await esbuild.build(
    baseBuildOptions(
      [
        join(ROOT, 'electron/main.ts'),
        join(ROOT, 'electron/preload.ts'),
        join(ROOT, 'electron/guestPreload.ts'),
        join(ROOT, 'electron/proxy.ts'),
      ],
      outdir,
    ),
  )
  return outdir
}
