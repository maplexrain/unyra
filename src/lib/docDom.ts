/**
 * 文档区的 DOM 工具：ui.scroll / ui.point / ui.dom 三个沙箱 api 的宿主侧实现。
 *
 * 单独放在 lib（而不是 learn）：agent/tools 的 callApi 也要用 domOp（ui.dom 的
 * 每个操作回到宿主来执行），而 agent 层不认识 learn 层——lib 是两者共同的下层。
 *
 * 「文档区在哪」靠一个约定：LearnWorkspace 给正文容器标了 data-doc-area（见它的
 * 注释，本来是给大纲栏判焦点用的）。滚动容器是它的可滚动后代（NodeNote 自己的那层
 * overflow-y-auto），按「哪个能滚就用哪个」找，不写死组件层级。
 */

import { SKIP_SELECTOR_INTERACTIVE } from './textNodes'

/**
 * **焦点格**的根元素；没有打开的文档时为 null。
 *
 * 文档区能分割之后，同一时刻有好几格都带着 data-doc-area（大纲栏就靠它判「焦点在不在文档区里」，
 * 所以每一格都得有）。而「文档区」在这几个 api 里指的是**用户正在看的那一格**：
 * ui.scroll / ui.point / ui.dom / 导出抓图都只该落在它上面，落在别人家那一格上会滚错、点错。
 * 于是焦点格额外标一个 data-doc-area-focus（见 LearnWorkspace 的 renderGroup），这里优先认它；
 * 没有标记时退回第一个——单格时与从前完全一致。
 */
export function docAreaElement(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-doc-area-focus]') ??
    document.querySelector<HTMLElement>('[data-doc-area]')
  )
}

/**
 * 某一格的根元素；不给 id 就是焦点格。
 *
 * 格 id 由 groups 的 newId() 生成（只有字母数字与连字符），直接拼进选择器是安全的——
 * 只有本地文件页签那种「一条 Windows 路径」的 id 才需要绕开 CSS 转义（见 TabBar 里那段）。
 */
export function docAreaOf(groupId?: string): HTMLElement | null {
  if (!groupId) return docAreaElement()
  return document.querySelector<HTMLElement>('[data-doc-area="' + groupId + '"]')
}

/** 某一格里显示着的那一片正文（导出抓图要按格抓：在右格点导出，抓的该是右格那篇） */
export function docBodyOf(groupId?: string): HTMLElement | null {
  const area = docAreaOf(groupId)
  if (!area) return null
  return area.querySelector<HTMLElement>('[data-doc-pane]:not([hidden])') ?? area
}

/**
 * **显示着的那一片正文**。
 *
 * 页签常驻之后（见 learn/resident），文档区里同时躺着好几片正文，只有一片是显示的，
 * 其余带 hidden 属性（display:none）。凡是「对着眼前这份文档做的事」——找文字、滚动、
 * ui.dom、导出时抓图——都必须落在这片上：落在整个文档区上会把别的文档里的内容
 * 也扫进来（找错地方、导出张数对不上）。
 *
 * 没有常驻片时（本地文件、超级文档、试卷副本、空态）回落到文档区本身，行为与从前一致。
 */
export function visibleDocBody(): HTMLElement | null {
  return docBodyOf()
}

/** 文档区的滚动容器：doc 区自己或它下面「真的在滚」的那一层 */
export function docScrollElement(): HTMLElement | null {
  // 只在显示着的那一片里找滚动容器：常驻的隐藏页签也在这个区域里，
  // 把它们的几千个元素一起扫一遍既慢又没有意义（隐藏元素没有滚动量）
  const area = visibleDocBody()
  if (!area) return null
  if (area.scrollHeight > area.clientHeight + 1 && isScrollable(area)) return area
  let best: HTMLElement | null = null
  let bestSurplus = 0
  for (const el of area.querySelectorAll<HTMLElement>('*')) {
    const surplus = el.scrollHeight - el.clientHeight
    if (surplus > bestSurplus && isScrollable(el)) {
      best = el
      bestSurplus = surplus
    }
  }
  return best
}

const isScrollable = (el: HTMLElement): boolean => {
  const s = getComputedStyle(el)
  return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.clientHeight > 0
}

/** ui.scroll：滚到顶/底，或按像素滚动（负数往上）。找不到滚动容器返回 false */
export function scrollToDoc(req: { to?: 'top' | 'bottom'; by?: number }): boolean {
  const box = docScrollElement()
  if (!box) return false
  if (req.to === 'top') box.scrollTo({ top: 0, behavior: 'smooth' })
  else if (req.to === 'bottom') box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  else if (typeof req.by === 'number') box.scrollBy({ top: req.by, behavior: 'smooth' })
  return true
}

/*
 * 这些结构里的文字不参与定位（公式排版件、代码块、图形）。
 *
 * 这一档比引文/映射那两档**多排掉按钮**——定位要落点，光标与「这一处」都不该落在按钮上。
 * 两档都收在 lib/textNodes 里：早先三处各写一份字符串，这里的注释还写着「与 lib/quoteFocus
 * 的口径一致」，与代码对不上，谁想「顺手统一一下」就会把按钮那条规则删掉。
 */
interface TextPoint {
  node: Text
  /** 该拍平字符在**原生文本节点内**的偏移：构造 Range 时用 */
  offset: number
}

/**
 * 把 root 里的可见文字拍平成一条字符串，同时记下每个字符来自哪个文本节点、节点内偏移。
 * 返回 null 表示拍平后没有可用文字（空文档）。
 */
function flattenText(root: HTMLElement): { flat: string; points: TextPoint[] } | null {
  const doc = root.ownerDocument
  if (!doc) return null
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest(SKIP_SELECTOR_INTERACTIVE)) return 2 /* FILTER_REJECT */
      return (node as Text).data.trim() ? 1 /* FILTER_ACCEPT */ : 2
    },
  })
  const points: TextPoint[] = []
  let flat = ''
  let prevSpace = false
  let n = walker.nextNode()
  while (n) {
    const t = n as Text
    const data = t.data
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]
      const isSpace = /\s/.test(ch)
      // 折叠连续空白、掐掉开头空白：源文与渲染文本都按这个口径比
      if (isSpace && (prevSpace || flat === '')) {
        prevSpace = true
        continue
      }
      points.push({ node: t, offset: i })
      flat += isSpace ? ' ' : ch
      prevSpace = isSpace
    }
    n = walker.nextNode()
  }
  return flat ? { flat, points } : null
}

/**
 * 在拍平文本里找定位文字：先试整句，再退到前缀——渲染时常会把一句话
 * 拆进不同结构（标题里带注解、表格换行），整句匹配不上不等于位置找不到。
 * 返回 null 表示找不到；命中的长度跟着前缀走，选区只能选到匹配的那一段。
 */
function findNeedle(flat: string, target: string): { at: number; len: number } | null {
  for (const len of [target.length, 40, 16]) {
    if (len < 4) break
    const probe = target.slice(0, len)
    const at = flat.indexOf(probe)
    if (at >= 0) return { at, len: probe.length }
  }
  return null
}

/**
 * 在文档区里定位一段文字：优先做**真实选区**（要求「选中字符串」时用它），
 * 滚过去并让浏览器高亮；文字找不到时按比例滚到大概位置。
 *
 * 打开页签到渲染完成有一拍延迟，所以带一个短的重试循环——立即放弃的话，
 * 「定位」在用户眼里就是没生效。
 */
export function locateNeedle(needle: string, fallbackRatio?: number): Promise<boolean> {
  const target = needle.replace(/\s+/g, ' ').trim()
  if (!target) {
    if (fallbackRatio !== undefined) scrollToRatio(fallbackRatio)
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const started = performance.now()
    const attempt = (): void => {
      const area = visibleDocBody()
      if (!area) {
        resolve(false)
        return
      }
      // 只在显示着的那一片里找：否则命中的可能是另一份文档里同样的句子
      const flat = flattenText(area)
      if (flat) {
        const hit = findNeedle(flat.flat, target)
        if (hit) {
          const first = flat.points[hit.at]
          const last = flat.points[Math.min(flat.points.length - 1, hit.at + hit.len - 1)]
          const doc = area.ownerDocument
          const sel = doc.defaultView?.getSelection()
          if (doc && first && last && sel) {
            const range = doc.createRange()
            range.setStart(first.node, first.offset)
            range.setEnd(last.node, last.offset + 1)
            sel.removeAllRanges()
            sel.addRange(range)
            const startedEl = range.startContainer.parentElement
            if (startedEl) {
              startedEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
              resolve(true)
              return
            }
          }
        }
      }
      if (performance.now() - started < 1200) {
        requestAnimationFrame(attempt)
        return
      }
      // 定位失败：兜底滚到大概位置，别一动不动
      if (fallbackRatio !== undefined) scrollToRatio(fallbackRatio)
      resolve(false)
    }
    attempt()
  })
}

function scrollToRatio(ratio: number): void {
  const box = docScrollElement()
  if (!box) return
  const clamped = Math.min(1, Math.max(0, ratio))
  box.scrollTo({ top: (box.scrollHeight - box.clientHeight) * clamped, behavior: 'smooth' })
}

/* ---------- ui.dom 的宿主操作 ---------- */

const DOM_QUERY_LIMIT = 50
const DOM_TEXT_LIMIT = 200
const DOM_HTML_LIMIT = 1600

const excerpt = (text: string, limit = DOM_TEXT_LIMIT): string =>
  text.length > limit ? text.slice(0, limit) + '…' : text

/** 第 i 个匹配元素；i 省略取第一个；越界返回 null */
function pick(root: Element, selector: string, i?: number): Element | null {
  const list = root.querySelectorAll(selector)
  if (!list.length) return null
  const idx = Math.min(Math.max(0, i ?? 0), list.length - 1)
  return list[idx] ?? null
}

/**
 * ui.dom 的一个操作。只开放选择器级别的读与点击：
 * 文档区是渲染层托管的 React 树，暴露写入（改 DOM）只会和渲染打架；
 * 「交互」到 click 为止（注解菜单、折叠面板这些都能点开）。
 */
export function domOp(root: Element, op: string, args: unknown[]): unknown {
  const sel = typeof args[0] === 'string' ? args[0] : ''
  const nth = typeof args[1] === 'number' ? args[1] : undefined
  switch (op) {
    case 'exists':
      return !!pick(root, sel)
    case 'count':
      return root.querySelectorAll(sel).length
    case 'query': {
      const list = [...root.querySelectorAll(sel)].slice(0, DOM_QUERY_LIMIT)
      return {
        count: root.querySelectorAll(sel).length,
        truncated: root.querySelectorAll(sel).length > DOM_QUERY_LIMIT,
        items: list.map((el, i) => ({
          i,
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          class: typeof el.className === 'string' ? excerpt(el.className, 80) : undefined,
          text: excerpt((el.textContent ?? '').replace(/\s+/g, ' ').trim()),
        })),
      }
    }
    case 'text': {
      const el = pick(root, sel, nth)
      return el ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : null
    }
    case 'attr': {
      // 约定参数序 [sel, i, name]（i 省略按第一个匹配算），见两个门面的转换
      const name = typeof args[2] === 'string' ? args[2] : ''
      const el = pick(root, sel, typeof args[1] === 'number' ? args[1] : undefined)
      return el ? el.getAttribute(name) : null
    }
    case 'html': {
      const el = pick(root, sel, nth)
      return el ? excerpt(el.outerHTML, DOM_HTML_LIMIT) : null
    }
    case 'rect': {
      const el = pick(root, sel, nth)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    }
    case 'click': {
      const el = pick(root, sel, nth)
      if (!el) return { clicked: false }
      el.scrollIntoView({ block: 'center' })
      ;(el as HTMLElement).click()
      return { clicked: true }
    }
    default:
      throw new Error('ui.dom 没有这个操作：' + op + '。可用的：exists / count / query / text / attr / html / rect / click')
  }
}
/* ---------- 行号 → 定位文字（ui.point 与文档跳转语法共用） ---------- */

/**
 * 源文的一行 → 渲染结果里找得到的纯文字。
 *
 * 渲染会把 Markdown 标记吃掉、把空白折叠，所以拿原始源文行去搜渲染结果基本搜不到
 * （除了纯散文行）。剥掉链接语法与标题井号之后，命中的概率才高。
 */
export function plainLineOf(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~$]/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface DocJumpTarget {
  /** 1 起算的行号 */
  line?: number
  /** 行区间的末行（含）；缺省就是单行 */
  endLine?: number
  /** 直接给定要选中的文字（优先于按行号算出来的） */
  select?: string
}

/**
 * 把「跳到某一块」翻成 locateNeedle 要的两样东西：定位文字 + 找不到时的比例兜底。
 *
 * 为什么需要比例兜底：行号定位靠的是「那一行的文字在渲染结果里出现」，
 * 而表格、代码块、公式行拍平之后往往对不上（见 findNeedle 的前缀退让）。
 * 这时候按行号在全文里的相对位置滚过去——定位不到**精确那一行**，但至少落在附近，
 * 比原地不动有用得多。
 */
export function needleForDoc(content: string, jump: DocJumpTarget): { needle?: string; fallbackRatio?: number } {
  const lines = content.split('\n')
  const total = Math.max(1, lines.length)
  const line = Number.isFinite(jump.line) ? Math.max(1, Math.round(jump.line as number)) : undefined
  const endLine =
    line !== undefined && Number.isFinite(jump.endLine)
      ? Math.min(lines.length, Math.max(line, Math.round(jump.endLine as number)))
      : undefined

  const select = (jump.select ?? '').replace(/\s+/g, ' ').trim()
  // 明确给了要选中的文字就用它：写文档的人给的原话，比按行号猜准
  if (select) return { needle: select.slice(0, 200) }

  if (line === undefined) return {}
  const picked = (endLine ? lines.slice(line - 1, endLine) : [lines[line - 1] ?? ''])
    .map(plainLineOf)
    .filter(Boolean)
    .join(' ')
  // 太短的定位文字会命中文档开头同名的地方（与 ui.point 同一条经验）
  const fallbackRatio = line / total
  return picked.length >= 4 ? { needle: picked.slice(0, 300), fallbackRatio } : { fallbackRatio }
}
