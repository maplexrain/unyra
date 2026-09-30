/**
 * 这个文件负责什么：把真实事件翻译成采集器的动作——1 秒心跳，以及「这次交互算不算阅读证据」
 * （窗口失焦 / 回到前台、页签可见性、文档区里的滚动・点击・按键・选中、折叠块展开）。
 *
 * 从 useReadingTracker.ts 的挂载 effect 里原样搬出来（只把 effect 里的闭包收成入参），
 * 绑的事件、捕获 / 被动标志、解绑顺序都与拆分前一致。
 */
import { clearReadingPulse, onSettleRequest } from '../../lib/readingPulse'
import { BEAT_MS } from '../reading'
import type { ReadingTracker } from './ReadingTracker'

/** 焦点在一个能打字的地方（输入框 / 文本域 / contenteditable） */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
}

/** 心跳只用到调用方的一样东西：当前的滚动容器——判定「这次交互发生在文档区里」要用它 */
interface LiveOpts {
  current: { scroll: () => HTMLElement | null }
}

/** 把采集器接到窗口与文档的事件上；返回解绑函数（按原顺序解绑，最后补一次结算） */
export function bindHeartbeat(t: ReadingTracker, live: LiveOpts): () => void {
  const onBlur = () => t.suspend('blur')
  // 回到前台不等于要读：先结束失焦那一段中断，然后等一次文档区交互（见 wake）
  const onFocus = () => t.wake()
  const onVisibility = () => (document.visibilityState === 'hidden' ? t.suspend('hidden') : t.wake())
  /*
   * 交互：**发生在文档区里的**才算阅读证据（滚动、点正文、按键、选中），
   * 发生在别处的（在对话栏打字、点侧栏、滚对话栏）立刻停表。
   *
   * 都绑在 document 上（文档区的 ref 此刻多半还是 null），用包含关系分开——
   * 这样「在右侧对话栏里打字」不会替这份文档把时间挣过去，而「读了半天没碰鼠标」
   * 也不会被误判成走开（那种情况由 60 秒静默闸管）。
   */
  const inDoc = (target: EventTarget | null): boolean => {
    const box = live.current.scroll()
    if (!box || !target) return false
    return target instanceof Node && box.contains(target)
  }
  const onInput = (e: Event) => {
    if (inDoc(e.target)) {
      t.docActive()
      return
    }
    /*
     * 键盘单挑「能打字的地方」：在输入框里敲字显然是「在跟导师说话」；
     * 而 Esc / Ctrl+S / F 键这类全局键（焦点在 body 上）不该算成「你走开了」——
     * 它们常常正是阅读中的动作。
     */
    if (e.type === 'keydown' && !isEditable(e.target)) return
    t.aside()
  }
  const onSelection = () => {
    const sel = document.getSelection()
    if (sel && !sel.isCollapsed && inDoc(sel.anchorNode)) t.docActive()
  }
  // toggle 不冒泡，但捕获阶段会经过祖先：折叠块被展开因此能被记下来
  const onToggle = () => t.mark('details')
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('toggle', onToggle, { capture: true })
  document.addEventListener('wheel', onInput, { capture: true, passive: true })
  document.addEventListener('pointerdown', onInput, { capture: true })
  document.addEventListener('keydown', onInput, { capture: true })
  document.addEventListener('touchstart', onInput, { capture: true, passive: true })
  document.addEventListener('selectionchange', onSelection)
  const timer = window.setInterval(() => t.beat(), BEAT_MS)
  // 打卡这类「现在就要一个准数」的动作，先让采集器把这一场结掉（见 lib/readingPulse）
  const offSettle = onSettleRequest(() => t.settle(Date.now(), true))
  return () => {
    offSettle()
    t.settle(Date.now(), true)
    // 这一场到此为止：进度条不该留着上一份文档的读数
    clearReadingPulse()
    window.clearInterval(timer)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('toggle', onToggle, { capture: true })
    document.removeEventListener('wheel', onInput, { capture: true })
    document.removeEventListener('pointerdown', onInput, { capture: true })
    document.removeEventListener('keydown', onInput, { capture: true })
    document.removeEventListener('touchstart', onInput, { capture: true })
    document.removeEventListener('selectionchange', onSelection)
  }
}
