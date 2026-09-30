/**
 * 开发运行：起 Vite dev server → 编译主进程/preload → 拉起 Electron 指向该地址。
 *
 * 钉在 127.0.0.1 而不是 localhost：localhost 在部分环境解析为 ::1，
 * 会出现「Vite 只绑 IPv6、Electron 按 IPv4 连」→ ERR_CONNECTION_REFUSED → 白屏。
 * 两侧用同一个字面地址就不会分歧。
 *
 * 主进程/watch 改动后自动重启：监听 electron/ 目录，**先重建、成功了再重启**。
 * 这样写坏一个语法时，当前窗口照旧能用，只在终端上看到编译错误。
 *
 * 重启的坑（都踩过）：
 * 1. 旧进程是异步退出的，「杀掉」不等于「已退出」。不等它退出就拉起新进程，
 *    新进程会因为拿不到单实例锁而立刻自杀（见 electron/main.ts 的
 *    requestSingleInstanceLock），dev 脚本又会把这次自杀当成「用户关了窗口」→
 *    关掉 dev server 整个退出。所以必须 await 旧进程的 exit 事件。
 * 2. 旧进程的 close 回调是延迟触发的，用共享的布尔标志去忽略它一定会撞上竞态。
 *    这里改成给每次启动编号，close 回调只认自己那一代。
 * 3. 文件监听出错（编辑器原子保存留下的临时目录会引发 EBUSY）会把整个 dev 进程
 *    带走，见下面的 uncaughtException 兜底与 vite.config.ts 的 server.watch.ignored。
 */

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { buildElectron } from './electron-compile.mjs'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const HOST = '127.0.0.1'

/* ---------- 兜底：文件监听错误不带走开发进程 ---------- */

/**
 * 编辑器原子保存时会在源码旁边短暂建出 `.settings.ts.19720.<uuid>.tmpdir/settings.ts.tmp`
 * 这类临时目录再改名替换。目录只存在几毫秒，chokidar 若正好在这时去 watch，
 * Windows 会返回 EBUSY；Vite 把它抛成 FSWatcher 的 'error' 事件，没人接就是一次
 * uncaughtException——整个 dev 进程连同 Vite 一起没了，而这跟「运行」毫无关系。
 *
 * 这类错误只意味着「某个文件这一次没看上」，忽略掉并说一声就好；其余异常照旧
 * 报错退出，不掩盖真问题。（源头另有忽略规则，见 vite.config.ts 的 server.watch.ignored）
 */
const WATCH_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'ENOENT', 'EACCES', 'EINVAL', 'UNKNOWN'])

const isWatchError = (err) =>
  Boolean(err) && typeof err === 'object' && err.syscall === 'watch' && WATCH_ERROR_CODES.has(err.code)

process.on('uncaughtException', (err) => {
  if (isWatchError(err)) {
    console.warn(`[dev] 忽略一次文件监听错误（${err.code}）：${err.path ?? ''}`)
    return
  }
  console.error('[dev] 未捕获异常：', err)
  process.exit(1)
})

let server = null
let electronProcess = null
/** 每次启动递增；close 回调据此判断自己是不是「已被取代的那一代」 */
let generation = 0
/** 串行化重启：连续保存时不让两次重启交叉执行 */
let queue = Promise.resolve()
let debounce = null
let quitting = false

async function startElectron(devServerUrl) {
  // 二进制没装好时给出可操作的提示，而不是一个难懂的 require 报错
  let electronPath
  try {
    electronPath = require('electron')
  } catch (err) {
    console.error('\n[dev] 找不到 Electron 可执行文件。')
    console.error('[dev] 若刚执行过 npm install，请补跑一次二进制下载：')
    console.error('[dev]   node node_modules/electron/install.js')
    console.error('[dev] 国内网络可先设置镜像：')
    console.error('[dev]   $env:ELECTRON_MIRROR="https://cdn.npmmirror.com/binaries/electron/"')
    console.error(`[dev] 原始错误：${err.message}\n`)
    process.exit(1)
  }

  const gen = ++generation
  const child = spawn(electronPath, ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  electronProcess = child

  child.on('close', (code) => {
    // 这一代已经被下一次启动取代：它的退出是重启的一部分，不是「运行中断」
    if (gen !== generation || quitting) return
    console.log(`[dev] Electron 退出（code ${code}），关闭开发服务器`)
    void server?.close().then(() => process.exit(code ?? 0))
  })

  return child
}

/** 停掉当前 Electron 并**等它真的退出**：单实例锁是在进程退出那一刻才放开的 */
async function stopElectron() {
  const child = electronProcess
  electronProcess = null
  // 先作废这一代，它的 close 回调才不会把「我们主动杀掉」当成用户关了窗口
  generation++
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  await new Promise((resolve) => {
    let timer = null
    const done = () => {
      if (timer) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(() => {
      // 兜底：主进程赖着不走就整棵进程树强杀（Windows 上 Electron 还有一堆子进程）
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', done)
      } else {
        try {
          child.kill('SIGKILL')
        } catch {
          // 已经退出了
        }
        done()
      }
    }, 3000)
    child.once('exit', done)
    try {
      child.kill()
    } catch {
      done()
    }
  })
}

async function restartElectron(devServerUrl) {
  try {
    await buildElectron()
  } catch (err) {
    // 编译失败就保持现状：让还在跑的窗口继续可用，只把错误留在终端
    console.error('[dev] 主进程编译失败，保留当前实例：', err?.message ?? err)
    return
  }
  await stopElectron()
  console.log('[dev] 主进程已重建，重启 Electron')
  await startElectron(devServerUrl)
}

async function main() {
  console.log('[dev] 编译主进程…')
  await buildElectron()

  console.log('[dev] 启动 Vite…')
  server = await createServer({ server: { host: HOST } })
  await server.listen()
  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address ? address.port : 5174
  const devServerUrl = `http://${HOST}:${port}`
  console.log(`[dev] Vite 就绪：${devServerUrl}`)

  await startElectron(devServerUrl)

  // 主进程/preload 改动即重建重启；渲染层由 Vite HMR 负责，不需要动 Electron
  watch(new URL('../electron', import.meta.url), { recursive: true }, () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      queue = queue.then(() => restartElectron(devServerUrl)).catch((err) => {
        console.error('[dev] 重启失败：', err)
      })
    }, 200)
  })
  console.log('[dev] 监听 electron/ 变更（改动主进程会自动重启）')

  // Ctrl+C 时把 Electron 一并带走，否则窗口会留在那儿连着一个已经没了的 Vite
  const shutdown = () => {
    if (quitting) return
    quitting = true
    void stopElectron().finally(() => {
      void server?.close().then(() => process.exit(0))
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[dev] 启动失败：', err)
  process.exit(1)
})
