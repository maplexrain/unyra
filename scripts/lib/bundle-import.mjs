/**
 * 这个模块为什么存在：scripts 下的探针都要「先用 esbuild 把 TS 入口打成一个 ESM，
 * 再 import 进来跑」，这段引导（那一份 build 配置 + data URL 那一行）原先被抄了好几份，
 * 抽在这里。
 *
 * 各家的配置并不完全一样，所以差异一律从 options 传进来，不拿某一家的当通用默认值：
 * - alias / plugins / external：谁有谁传（agent-ops 的 ?raw / ?url 插件、
 *   update 那份要让 yaml 保持 external）；
 * - logLevel：默认 'warning'，仍可传——它是最容易被单家调的一格；
 * - tag：把 tag 作为一行注释缀在源码尾巴上，URL 不同即模块实例不同；
 * - file：落成真实文件再按文件 URL import（update 那份要读 yaml 这个 CJS 包，
 *   data URL 里跑不起来）。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

/**
 * 打包一个入口，返回产出的那份 ESM 源码。
 *
 * entry 是入口文件的**绝对路径**（各脚本按仓库根自己拼好传进来）。
 * 公共部分只有 bundle / write:false / format:'esm' / platform:'node' / target:'node20'
 * 这几项——那是五家都一样的；其余一项都不预置。
 */
export async function bundleEntry(entry, { alias, plugins, external, logLevel = 'warning' } = {}) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    ...(alias ? { alias } : {}),
    ...(plugins ? { plugins } : {}),
    ...(external ? { external } : {}),
    logLevel,
  })
  return result.outputFiles[0].text
}

/**
 * 把打包产出的源码 import 进来。
 * 默认走 data URL：不落临时文件，跑完什么都不留在磁盘上；
 * 传了 file 则先落盘再按文件 URL import（需要 Node 自己解析依赖时用）。
 */
export function importBundled(code, { tag, file } = {}) {
  if (file) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, code, 'utf-8')
    return import(pathToFileURL(file).href)
  }
  const withTag = tag ? code + '\n//' + tag : code
  return import('data:text/javascript;base64,' + Buffer.from(withTag).toString('base64'))
}

/** 打包并立刻 import：一次性跑完、不需要同一份 bundle 跑两遍的脚本走这条 */
export async function bundleAndImport(entry, options = {}) {
  const code = await bundleEntry(entry, options)
  return importBundled(code, options)
}
