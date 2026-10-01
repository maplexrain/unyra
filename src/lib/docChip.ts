/**
 * 引用 chip 的**接线层**：谁要打开一份 chip 引用、输入框在哪、消息列表怎么挂 hydrate，
 * 都在这里对齐——chipSyntax 只管语法与外观，这一层管「谁在谁登记」。
 *
 * 三个登记表：
 * - **opener**（LearnWorkspace 挂载时登记）：点击 chip → 打开对应页签 / 弹考试窗口。
 *   消息列表、输入框、正文的 hydrate 都只认它，不认识 store。
 * - **落点 target**（输入框挂载时登记）：页签/资源管理器的条目拖到输入卡片上变成一枚 chip。
 *   指针拖拽（页签自己那套）与 HTML5 拖放（资源管理器那套）殊途同归：
 *   前者经 docChipDrop 命中，后者经 docChipReceive 转交。
 * - **hydrate**（消息列表正文）：把 markdown 渲染出来的 `#[{…}]` 文本换成 chip 元素，
 *   点击走 opener（一次委托挂在正文根上）。
 */

import {
  buildChipHtml,
  chipJson,
  parseChipJson,
  splitChips,
  type ChipPayload,
} from './chipSyntax'

export type { ChipPayload } from './chipSyntax'

/* ---------- opener：点击打开 ---------- */

let opener: ((p: ChipPayload) => void) | null = null

/** 宿主（LearnWorkspace）挂载时登记；传 null 注销 */
export function setChipOpener(fn: ((p: ChipPayload) => void) | null): void {
  opener = fn
}

/** 打开一份 chip 引用（页签 / 考试窗口）；没人登记或打不开就静默 */
export function openChipRef(p: ChipPayload): void {
  opener?.(p)
}

/* ---------- 落点：拖进输入框 ---------- */

interface DocChipTarget {
  /** 命中判定用的元素（输入卡片） */
  el: HTMLElement
  /** 悬停高亮开关（值不变时调用方的 setState 自然 bail，指针压着也不会每帧重渲染） */
  hover: (on: boolean) => void
  /** 松手收下：把这份东西变成输入框里的一枚 chip */
  receive: (p: ChipPayload) => void
}

let target: DocChipTarget | null = null

/** 输入框挂载时登记；传 null 注销（子会话模式下不登记——那里的输入框只读） */
export function registerDocChipTarget(t: DocChipTarget | null): void {
  if (target && target !== t) target.hover(false)
  target = t
}

/** 拖动中：指针压没压在输入框上（顺带维护悬停高亮）。x<0 表示强制熄灭 */
export function docChipHover(x: number, y: number): void {
  if (!target) return
  target.hover(x >= 0 && hits(x, y))
}

/** 松手（指针拖拽那一路）：落点在输入框上就交给它，返回是否接住了 */
export function docChipDrop(x: number, y: number, p: ChipPayload): boolean {
  if (!target || !hits(x, y)) return false
  target.hover(false)
  target.receive(p)
  return true
}

/** HTML5 拖放那一路（资源管理器/外部拖进来，drop 事件里调）：有人接返回 true */
export function docChipReceive(p: ChipPayload): boolean {
  if (!target) return false
  target.hover(false)
  target.receive(p)
  return true
}

function hits(x: number, y: number): boolean {
  const r = target!.el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

/* ---------- hydrate：消息正文里的 #[{…}] → chip ---------- */

/**
 * 扫 root 下的文本节点，把解析得开的 `#[{…}]` 换成 chip 元素；返回撤销函数。
 *
 * 点击用**委托**挂在 root 上：chip 是现造的元素，逐个挂监听会在每次 hydrate 时漏，
 * 挂根上一次就够（与 staticView 的 data-static-ref 同一条纪律）。
 * React 重写正文（html 变了）之后整个子树是新的，重新扫一遍即可，旧元素自然随子树消失。
 */
export function hydrateChipTokens(root: HTMLElement): () => void {
  const onClick = (e: Event): void => {
    const t = e.target
    if (!(t instanceof Element)) return
    const el = t.closest('[data-moji-doc-chip]')
    if (!el || !root.contains(el)) return
    e.preventDefault()
    const payload = parseChipJson(el.getAttribute('data-chip') ?? '')
    if (payload) opener?.(payload)
  }
  root.addEventListener('click', onClick)

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.includes('#[')) hits.push(node as Text)
  }
  for (const node of hits) {
    const segments = splitChips(node.nodeValue ?? '')
    if (!segments.some((s) => s.kind === 'chip')) continue
    const frag = document.createDocumentFragment()
    for (const seg of segments) {
      if (seg.kind === 'text') {
        frag.appendChild(document.createTextNode(seg.text))
        continue
      }
      const holder = document.createElement('template')
      holder.innerHTML = buildChipHtml(seg.payload)
      frag.appendChild(holder.content)
    }
    node.replaceWith(frag)
  }

  return () => root.removeEventListener('click', onClick)
}

/** data-chip 属性 → payload（点击处理共用这一条解析路） */
export function payloadOfChipAttr(raw: string | null): ChipPayload | null {
  return raw ? parseChipJson(raw) : null
}

/** 给 dataTransfer / 日志用的稳定 JSON（chipJson 的转出） */
export { chipJson }
