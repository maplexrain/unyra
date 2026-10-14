/**
 * 把控制权还给主线程，稍后再接着跑。
 *
 * 用途：把一段「总时长几十毫秒的纯计算」切成几片，片与片之间让浏览器有机会处理输入、
 * 画下一帧。**总工作量不变**，但用户点下去那一下不必等整段跑完——一次 99ms 的硬卡
 * 与十六次 6ms 的让步，对「点下去有没有反应」是两回事。
 *
 * 三条路，按代价从低到高挑：
 * 1. `scheduler.yield()`（Chromium 129+）：把续体插回**当前优先级队列**，不排到定时器
 *    队尾，因此没有最小延迟，也不会被后面的定时器插队；
 * 2. `MessageChannel`：一次宏任务，绕开 `setTimeout` 那道最小延迟（嵌套五层之后涨到 4ms）；
 * 3. `setTimeout(0)`：兜底。
 *
 * 每次调用新建一个 MessageChannel 而不是共用一个：共用要维护「谁在等」的队列，
 * 而这里的调用密度（一次保存十几回）远够不上为它做池化。
 */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof s?.yield === 'function') return s.yield()

  if (typeof MessageChannel !== 'undefined') {
    return new Promise<void>((resolve) => {
      const ch = new MessageChannel()
      ch.port1.onmessage = () => {
        ch.port1.close()
        ch.port2.close()
        resolve()
      }
      ch.port2.postMessage(null)
    })
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}
