/**
 * 这个文件负责什么：划词菜单的「接线」——什么时候弹（划完松开鼠标）、什么时候收（点别处、
 * 滚动、Esc）、摆在视口哪儿、询问态谁拿焦点、数字键怎么点中屏幕上那一项。
 *
 * 菜单长什么样在 note/selectionMenu，点下去做什么在上层那一个 switch 里（见 NodeNote）：
 * 这里只管进出与定位，因此不认识任何业务动作，也就不会把菜单和知识树绑在一起。
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { occurrenceAt, selectionTerm } from '../../../lib/annotation'
import { usePresence } from '../../../lib/presence'
import { mapRangeToSource } from '../../../lib/sourceMap'
import type { SelectionMenu } from './selectionMenu'

/** 划词要看的：正文根节点，以及由它渲染出当前 DOM 的那两份源文 */
interface Opts {
  bodyRef: RefObject<HTMLDivElement | null>
  /** 当前文档的正文（映射回源文偏移要用它） */
  content: string
  /** 正文的渲染结果：它一变，正文 DOM 也就换了，回调要重新登记 */
  html: string
}

/**
 * 划词菜单的状态与全部接线。返回的名字与原 NodeNote 里的局部变量一一对应，
 * 上层照旧写 setMenu / setMenuOpen / dismiss 那些即可。
 */
export function useSelectionMenu({ bodyRef, content, html }: Opts) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [menu, setMenu] = useState<SelectionMenu | null>(null)
  /**
   * 选中菜单是否展开，交给 usePresence 管：收起时只把 open 置 false、留着数据，
   * 退场动画期间还要照着 menu 渲染。直接 setMenu(null) 的话，
   * 退场那一帧就会去读 null.text 而崩掉；动画播完的卸载由钩子负责。
   */
  const {
    setOpen: setMenuOpen,
    mounted: menuMounted,
    closing: menuClosing,
  } = usePresence()
  // 询问态：菜单换成输入框
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState('')

  // 选中文字 → 弹出菜单。绑定在 document 上：从文档内拖拽、在文档之外松开鼠标时，
  // mouseup 落在 window 上而不是文档节点上，绑在节点上就收不到、菜单不弹。
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (asking) return
      window.setTimeout(() => {
        const body = bodyRef.current
        if (!body) return
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          setMenuOpen(false)
          return
        }
        const range = sel.getRangeAt(0)
        if (!body.contains(range.commonAncestorContainer)) {
          setMenuOpen(false)
          return
        }
        const text = sel.toString().replace(/\s+/g, ' ').trim()
        if (!text) {
          setMenuOpen(false)
          return
        }
        // 短词条给「学习/了解」；长选区（整段、含句读）只给「询问」
        const concept = text.length <= 40 && !/[\n。！？；]/.test(text)
        // 立刻在渲染 DOM 上把选区映射回源文偏移（公式/跨行也能正确定位）
        const loc = mapRangeToSource(body, range, content)
        // 注解词条另取一份：跨元素选择时 text 不能用来当词条（见 SelectionMenu.term）
        const term = selectionTerm(range)
        // 以及「这是第几次出现」：同一个词在正文里出现好几回时，
        // 只凭词条没法知道用户划的是哪一处，存下来就会标到第一次出现的那处
        const occurrence = occurrenceAt(body, term, range)
        const rect = range.getBoundingClientRect()
        setMenu({
          x: rect.left + rect.width / 2,
          anchorTop: rect.top,
          anchorBottom: rect.bottom,
          text,
          term,
          occurrence,
          concept,
          loc,
        })
        setMenuOpen(true)
        setQuestion('')
        setAsking(false)
      }, 0)
    }
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
    // content 与 html 同源（html 由它渲染而来），映射需要拿到源文
  }, [html, asking, content, setMenuOpen, bodyRef])

  // 点击别处 / 滚动 / Esc 收起
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setAsking(false)
      setMenuOpen(false)
    }
    const onScroll = (e: Event) => {
      /*
       * 别把自己关掉：询问的输入框里字一多，内容就长过框宽，浏览器会**滚它自己**
       * 并派发一个 scroll —— 而这条监听挂在 window 的捕获阶段，连这一个都收得到。
       * 「输入一长输入框就消失」的真相就是这个：不是有长度限制，是自己把自己关了。
       * 菜单里面的滚动（tip、列表）同理，一律不算「视图动了」。
       */
      if (menuRef.current?.contains(e.target as Node)) return
      setAsking(false)
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAsking(false)
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
    // setMenuOpen 是 usePresence 里 useCallback 出来的稳定引用，不会反复重挂
  }, [setMenuOpen])

  // 菜单用 fixed 定位并夹取到视口内：放在滚动容器里做 absolute，
  // 选区靠近容器边缘时会被 overflow 裁掉、flex 内容还会被压窄。
  // menuMounted 进依赖：进场动画那一帧才真正挂上节点，得再量一次尺寸。
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !menu) return
    const half = el.offsetWidth / 2
    const left = Math.min(Math.max(menu.x, half + 8), window.innerWidth - half - 8)
    const below = menu.anchorBottom + 8
    const above = menu.anchorTop - el.offsetHeight - 8
    const top = below + el.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, above)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [menu, asking, menuMounted])

  useEffect(() => {
    // preventScroll：聚焦若触发滚动，会被「滚动即收起」的逻辑立刻关掉菜单
    if (asking) inputRef.current?.focus({ preventScroll: true })
  }, [asking])

  /*
   * 数字键触发菜单项：菜单开着时按 1..n 就是点第 1..n 项。
   *
   * 按的是**那颗按钮自己的 click**（按 data-hotkey 找到它），而不是另存一份动作表：
   * 屏幕上第几项就按第几个数字，两条路不会各说各话；disabled 的项浏览器本来就不派发 click，
   * 「什么时候不能点」也只有一份判断。
   *
   * 三个「不抢」：不在询问的输入状态（那时数字是打字）、焦点在任何输入框里、
   * 带修饰键（那是别的快捷键的活）。
   */
  useEffect(() => {
    if (!menu || asking) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1) return
      const btn = menuRef.current?.querySelector<HTMLButtonElement>('[data-hotkey="' + n + '"]')
      if (!btn || btn.disabled) return
      e.preventDefault()
      btn.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menu, asking])

  const dismiss = () => {
    setAsking(false)
    setQuestion('')
    setMenuOpen(false)
    window.getSelection()?.removeAllRanges()
  }

  return {
    menu,
    menuRef,
    inputRef,
    asking,
    setAsking,
    question,
    setQuestion,
    menuMounted,
    menuClosing,
    setMenuOpen,
    dismiss,
  }
}
