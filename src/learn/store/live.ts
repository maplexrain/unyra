/**
 * 当前这一份 LearnStore 的模块级入口。
 *
 * 为什么需要它：有些很深的展示组件（消息气泡里的交付账）没有拿到 store，却要按
 * 实体 id 反查名字与宿主（如超级文档 uuid → 标题 / 挂在哪份文档下）。把整份 store
 * 一层层当 prop 传下去，会把「消息层不认识 store」这条边界打穿；而 `loadLearnStore()`
 * 只在启动时读一次盘，新写的超级文档还没落盘，反查会落空。
 *
 * 于是 useLearnStore 在每次提交（set / patchQuiet）时把最新快照登记到这里，读的一方
 * 只读、不订阅——它只在点击 / 渲染标题这种低频时机取一次，不需要跟着 store 重渲染。
 */
import type { LearnStore } from '../types'
import { loadLearnStore } from './persist'

let live: LearnStore | null = null

/** useLearnStore 每次提交新 store 时调用（卸载传 null 注销） */
export function setLiveLearnStore(store: LearnStore | null): void {
  live = store
}

/**
 * 最新一份 store。React 容器还没挂载时退回启动时读进来的那份（老会话的交付账
 * 在首帧就能显示标题，不必等 provider 的 effect）。
 */
export function liveLearnStore(): LearnStore | null {
  return live ?? loadLearnStore()
}
