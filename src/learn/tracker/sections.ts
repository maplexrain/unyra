/**
 * 这个文件负责什么：阅读采集里「节段」那一层——把渲染后的正文量成一个个节段（范围与字数），
 * 并把每一节的读数清点成相对上一次结算的增量（哪些发过、哪些还没发）。
 *
 * 从 useReadingTracker.ts 原样搬出来（只把 this.xxx 换成入参），行为与拆分前一致。
 */
import { headingText, headingsOf } from '../../lib/outline'
import { sectionKey, type SectionRead } from '../reading'

export interface Layout {
  key: string
  /** 相对正文顶部的偏移与高度（像素） */
  top: number
  height: number
  /** 这一节的正文长度（估算 pace 用） */
  chars: number
}

export interface SectionState extends SectionRead {
  /** 已经结算出去的量：结算时只发差量 */
  sentMs: number
  sentMarks: number
  /** 有没有把这一节介绍给记录（新章节要在下一次结算时登记，否则它不存在） */
  announced: boolean
}

/** 两个标题之间的正文（估算这一节的字数） */
function textBetween(from: HTMLElement, to: HTMLElement): string {
  let out = ''
  let node: Node | null = from.nextSibling
  while (node && node !== to) {
    out += node.textContent ?? ''
    node = node.nextSibling
  }
  return out.replace(/\s+/g, '')
}

/**
 * 量一次几何：每个节的范围与字数。
 *
 * 用「渲染后的 DOM」而不是源文：只有它说了算（围栏里的 # 不是标题、
 * 公式被 KaTeX 换过形状）。与大纲栏同一条口径（都走 lib/outline）。
 */
export function measureSections(
  body: HTMLElement,
  scroll: HTMLElement,
  words: number,
  sections: Map<string, SectionState>,
): Layout[] {
  const boxTop = scroll.getBoundingClientRect().top - scroll.scrollTop
  const bodyTop = body.getBoundingClientRect().top - boxTop
  const bodyEnd = bodyTop + body.scrollHeight
  const heads = headingsOf(body)
  const cuts: Array<{ el: HTMLElement | null; top: number; level: number; text: string }> = []
  const firstTop = heads.length ? heads[0].getBoundingClientRect().top - boxTop : bodyEnd
  // 第一个标题之前还有正文：给它一个「开头」节，否则那段时间没有归属
  if (firstTop - bodyTop > 8) cuts.push({ el: null, top: bodyTop, level: 1, text: '开头' })
  for (const h of heads) {
    cuts.push({
      el: h,
      top: h.getBoundingClientRect().top - boxTop,
      level: Number(h.tagName.slice(1)) || 2,
      text: headingText(h) || '未命名标题',
    })
  }
  const next: Layout[] = []
  cuts.forEach((cut, i) => {
    const after = cuts[i + 1]
    const height = Math.max(1, (after ? after.top : bodyEnd) - cut.top)
    const key = sectionKey(cut.text)
    const text = cut.el && after?.el ? textBetween(cut.el, after.el) : ''
    const chars = text.length || Math.max(1, Math.round((height / Math.max(1, body.scrollHeight)) * words))
    const state = sections.get(key)
    if (state) {
      state.index = i
      state.level = cut.level
      state.text = cut.text
    } else {
      sections.set(key, {
        key,
        text: cut.text,
        index: i,
        level: cut.level,
        ms: 0,
        reach: 0,
        marks: [],
        firstAt: 0,
        lastAt: 0,
        sentMs: 0,
        sentMarks: 0,
        announced: false,
      })
    }
    next.push({ key, top: cut.top - bodyTop, height, chars })
  })
  return next
}

/**
 * 还没结算的那些节（相对上一次结算的增量）。
 *
 * 只读不写：结算和旁路都要用它，但只有结算会推进「已发到哪」的账
 * （sentMs / sentMarks / announced）。旁路要的正是**没推进过**的那一份。
 */
export function liveSections(order: string[], sections: Map<string, SectionState>): SectionRead[] {
  const out: SectionRead[] = []
  for (const key of order) {
    const s = sections.get(key)
    if (!s) continue
    const ms = s.ms - s.sentMs
    const marks = s.marks.slice(s.sentMarks)
    if (ms <= 0 && !marks.length && s.announced) continue
    out.push({
      key: s.key,
      text: s.text,
      index: s.index,
      level: s.level,
      ms,
      reach: s.reach,
      marks,
      firstAt: s.firstAt,
      lastAt: s.lastAt,
    })
  }
  return out
}

/** 把发出去的那几节记成「已发」：ms 推到当前、marks 推到当前、不再重复介绍 */
export function advanceSent(sent: SectionRead[], sections: Map<string, SectionState>): void {
  for (const s of sent) {
    const state = sections.get(s.key)
    if (!state) continue
    state.sentMs = state.ms
    state.sentMarks = state.marks.length
    state.announced = true
  }
}
