/**
 * 这个文件负责：「工作区里的真实文件变了」的通知铃。
 *
 * 新建 / 改名在宿主（LearnWorkspace 的 wsActions）那头执行，而列着目录的是
 * WorkspaceRow 里一棵棵 WsDir——两边只共享这一声铃：展开过的目录听见就各自重列一遍，
 * 缓存才不会说谎。模块级单例：侧栏只有一份，监听随挂随拆。
 * 单独成文件是因为组件文件不能顺手导出函数（react/only-export-components，
 * 见 explorer/types.ts 顶部的说明）。
 */

const listeners = new Set<() => void>()

/** 工作区里有文件 / 目录被新建、改名（真实落盘之后调） */
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
