import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearnStore } from './types'
import { emptyLearnStore, flushLearnStore, loadLearnStore, saveLearnStore } from './store'
import { flushCommitsSync } from '../lib/storage'

/**
 * 学习数据的 React 状态容器：单一 state、500ms 防抖落盘、卸载/关闭页签前兜底保存。
 *
 * 数据在启动时就已经读进内存（见 lib/boot.ts），所以这里的初始值仍是同步取的，
 * 界面不必等一个「载入中」。写盘是异步的，防抖窗口内的最后一次改动由
 * beforeunload 里的同步落盘兜住。
 *
 * 只暴露「读取 + 通用更新 + 立即保存」，具体的图操作与 AI 流程留在
 * LearnWorkspace 里编排，保持这里足够薄。
 */
export function useLearnStore() {
  const [store, setStore] = useState<LearnStore>(() => loadLearnStore() ?? emptyLearnStore())
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(() => Date.now())

  // ref 只在 set 里同步更新（不在 render 期赋值）：异步流程 await 之后能拿到最新快照
  const storeRef = useRef(store)
  const firstRender = useRef(true)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setDirty(true)
    const t = window.setTimeout(() => {
      saveLearnStore(storeRef.current)
      setDirty(false)
      setLastSavedAt(Date.now())
    }, 500)
    return () => window.clearTimeout(t)
  }, [store])

  useEffect(() => {
    // 关窗前：先把当前状态排进队列，再同步落盘。
    // 异步写在这一刻已经排不上队了，所以必须走同步的那条路（见 lib/storage）。
    const flush = () => {
      saveLearnStore(storeRef.current)
      flushCommitsSync()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  /**
   * 直接写入新 store。图操作会生成 UUID / 时间戳，属于非纯逻辑；
   * 不能放进 setState 的 updater（StrictMode 会重复调用），
   * 因此调用方先在最新快照上算好结果，再整体替换。
   */
  /** 上一次渲染用的那份快照：set 靠它判断调用方「动没动过」旁路写入的字段 */
  const renderedRef = useRef(store)
  useEffect(() => {
    renderedRef.current = store
  }, [store])

  /**
   * 直接写入新 store。图操作会生成 UUID / 时间戳，属于非纯逻辑；
   * 不能放进 setState 的 updater（StrictMode 会重复调用），
   * 因此调用方先在最新快照上算好结果，再整体替换。
   *
   * **旁路字段要护一下**：阅读记录是 patchQuiet 写的（只改 ref、不重渲染），
   * 所以「渲染期那份快照」里它可能是旧的。谁拿那份快照算出 next 再交回来
   * （界面里大量 `set(updateNode(store, …))` 就是这种写法），就会把这两次渲染之间
   * 读进去的那几十秒悄悄抹掉——对象身份是唯一能分辨「他没动过这个字段」的线索：
   * 交回来的还是渲染期那个对象，就说明他没动，以 ref 上的最新一份为准。
   */
  const set = useCallback((next: LearnStore) => {
    const latest = storeRef.current
    const rendered = renderedRef.current
    const merged: LearnStore = {
      ...next,
      reading: next.reading === rendered.reading ? latest.reading : next.reading,
    }
    storeRef.current = merged
    setStore(merged)
  }, [])

  /** 读取最新已提交的 store，供 await 之后的异步流程取基准 */
  const getLatest = useCallback(() => storeRef.current, [])

  /**
   * 安静地改一次 store：只更新 ref 并排队落盘，**不触发 React 重渲染**。
   *
   * 阅读记录是秒级累加、每 30 秒结算一次的数据：走 set() 就是每半分钟把整个学习区
   * 重渲染一遍，而落盘只需要 store 对象是最新的。能用它的前提也在这里——**这个字段
   * 不参与渲染**。以后若有界面要实时显示阅读时长，就得改回 set() 或另开一条订阅。
   */
  const patchQuiet = useCallback((fn: (s: LearnStore) => LearnStore) => {
    storeRef.current = fn(storeRef.current)
    saveLearnStore(storeRef.current)
  }, [])

  /** 立即落盘（Ctrl+S）；等真的写完再让调用方提示「已保存」 */
  const flush = useCallback(async () => {
    saveLearnStore(storeRef.current)
    await flushLearnStore()
    setDirty(false)
    setLastSavedAt(Date.now())
  }, [])

  return { store, set, getLatest, patchQuiet, flush, dirty, lastSavedAt }
}
