/**
 * 这个文件负责：「工作区里的真实文件变了」的通知铃 + 「哪些目录要盯着」的登记表。
 *
 * 两个来源、一声铃：
 * - **应用内**动作（新建 / 改名 / 拖拽在宿主那头执行，真实落盘之后调 notifyWsChanged）——
 *   挂载过的目录听见就各自重列一遍，缓存才不会说谎；
 * - **应用外**的变化（在系统文件管理器里增删改名）：每家 WsDir / WorkspaceFlat 把自己
 *   那一层登记进 watchedDirs（展开 / 挂载时登记，收起 / 卸载时注销），这份清单推给主进程
 *   按目录挂 fs.watch（见 electron/storage/ws）；目录里一有动静，主进程经 ws:changed
 *   推回来，订阅方（ExplorerSidebar）摇一次同一个铃。
 *
 * 为什么清单与推送都在这里：登记方是散在树里的几十个行组件，它们不该各自和 IPC 打交道。
 * 模块级单例：侧栏只有一份，登记随挂随拆。
 * 单独成文件是因为组件文件不能顺手导出函数（react/only-export-components，
 * 见 explorer/types.ts 顶部的说明）。
 */
import { native } from '../../../lib/native'
import { userAbsPath } from '../../../lib/storage'

const listeners = new Set<() => void>()

/** 工作区里有文件 / 目录被新建、改名（真实落盘之后调），或外部变化推回来时调 */
export function notifyWsChanged(): void {
  for (const listener of [...listeners]) listener()
}

/** 订阅那声铃；返回取消订阅的函数（WsDir 卸载时拆掉） */
export function subscribeWsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/* ---------- 「哪些工作区目录要盯着」的登记表（主进程 watcher 的清单来源） ---------- */

/** 要盯的工作区目录（相对当前用户，如 docs/微积分/workspace/项目A） */
const watchedDirs = new Set<string>()
let pushTimer: number | undefined
/** 存储位置没就绪时的重试余额（见 pushWatchList）：试到头就算了，不空转 */
let retryBudget = 20

/**
 * 登记一个要盯的工作区目录；返回注销函数（放进 effect 的清理里）。
 * 开合 / 挂载卸载频繁时先攒一拍再推（见 schedulePush），差量与去重都在主进程做。
 */
export function registerWsWatch(rel: string): () => void {
  watchedDirs.add(rel)
  schedulePush()
  return () => {
    watchedDirs.delete(rel)
    schedulePush()
  }
}

function schedulePush(delay = 60): void {
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined
    pushWatchList()
  }, delay)
}

/** 把登记表（换算成绝对路径）推给主进程；存储位置还没就绪的过一会儿再试 */
function pushWatchList(): void {
  const list: string[] = []
  let unresolved = false
  for (const rel of watchedDirs) {
    const abs = userAbsPath(rel)
    if (abs) list.push(abs)
    else unresolved = true
  }
  try {
    void native().ws.watch(list)
  } catch {
    // 纯 Web 开发态没有主进程：这个功能整体缺席，不影响其它
    return
  }
  if (!unresolved) {
    retryBudget = 20
    return
  }
  // 存储位置还没就绪（启动头几拍 / 用户还没登录）：过两秒再试一轮——「盯哪些目录」
  // 本身没变，真就绪了（重挂 / 别的推送）也还会再走一遍。试到头就算了，不空转。
  if (retryBudget > 0) {
    retryBudget -= 1
    schedulePush(2000)
  }
}
