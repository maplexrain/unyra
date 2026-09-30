/**
 * 这个文件负责启动阶段的两件事：开发服务器地址的判定，与单实例闸门。
 * 启动耗时打点的实现仍在 electron/startup.ts，这里把它转出来——app/ 下的模块只认这一个入口。
 */
import { app } from 'electron'
export { flushStartupTrace, initStartupTrace, lap, setRendererMarks, startupTraced } from '../startup'

/** Vite 开发服务器地址；由 scripts/dev.mjs 注入。没有它即视为打包运行 */
export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
export const isDev = Boolean(DEV_SERVER_URL)

/**
 * 单实例闸门。
 *
 * 拿到锁的那一份继续启动（start 是装配入口，也就是 main.ts 的 main）；
 * 没拿到的那一份在这里直接退出——不能再往下走，否则两份进程会同时写同一份数据目录。
 */
export function bootSingleInstance(start: () => void): void {
  // 双开会并发写同一份数据目录（设置、教学文档），必须挡住
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    start()
  }
}
