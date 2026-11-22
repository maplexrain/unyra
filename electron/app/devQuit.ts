/**
 * dev 优雅停机通道（scripts/dev.mjs ↔ 主进程），走 spawn 的 IPC 通道。
 *
 * 为什么必须有：dev 脚本停 Electron，Windows 上只有硬终止可讲（child.kill() 是
 * TerminateProcess，taskkill /T /F 更是）——主进程的 before-quit 清理与 Chromium
 * 磁盘缓存的收摊路径都没机会执行。缓存索引带着脏页收摊，下一次**首次启动**就刷出
 * net\disk_cache\blockfile 的 `Critical error found -8` / `No file for …`，启动日志
 * 常年带病，看起来像「运行环境第一次起不来」。
 *
 * 通道设计：dev 脚本 spawn 时多开一路 IPC（stdio 第 4 路 'ipc'），停机/重启时
 * child.send('dev:quit')，这里收到就 app.quit()，让窗口、缓存落盘、MCP 会话、
 * 受控进程都走正常退出路径。脚本进程干脆死了（终端被整个关掉之类）通道断开，
 * 'disconnect' 同样退出——不留一个占着单实例锁的孤儿实例。
 *
 * 为什么不用 stdin：Electron 主进程的 process.stdin **开流即 EOF**（fd 0 在启动
 * 早期就被收走，实测 boot 后 ~30ms 就 END+CLOSE，无论 detached 与否），既收不到
 * 哨兵、EOF 也当不成「脚本死了」的信号——第一版用它做孤儿守卫，结果是启动即退。
 * spawn 的 'ipc' 通道是实测可用的唯一传递（哨兵送达 + 父死断开都验证过）。
 */
import { app } from 'electron'
import { isDev } from './startup'

/** 停机哨兵：dev 脚本（stopElectron）经 IPC 通道发的这一条 */
const QUIT_SENTINEL = 'dev:quit'

/** 仅 dev 生效：挂上 IPC 通道的哨兵与断开监听。在 main() 早期调用，不依赖 app ready */
export function listenDevQuit(): void {
  if (!isDev || typeof process.send !== 'function') return
  process.on('message', (m) => {
    if (m === QUIT_SENTINEL) app.quit()
  })
  // 通道断了 = dev 脚本死了：跟下去退，别当没人管的孤儿占着单实例锁
  process.on('disconnect', () => app.quit())
}
