/** 这个文件负责：节锚与学习日——标题怎么归一化成锚、记录里的节怎么被认领、一个时间戳算哪一天。 */

import { pad2 } from '../../lib/time'
import { DAY_START_HOUR } from './constants'
import type { SectionRead } from './types'

/**
 * 文档在记录里的键：教学文档 / 笔记「名字」 / 超级文档「名字」（见 NodeReading.docs）。
 *
 * 名字就是身份：笔记改名 = 换了一份文档，所以改名时要把记录**搬过去**
 * （见 moveDocReading），删掉一份笔记则要把记录一并清掉（见 pruneDocReading）。
 */
export function readingDocKey(kind: 'teaching' | 'note' | 'sdoc', name?: string): string {
  return kind === 'teaching' ? 'teaching' : kind + ':' + (name ?? '')
}

/** 学习日：凌晨 dayStartHour 点之前算前一天 */
export function studyDayOf(ts: number, hour = DAY_START_HOUR): string {
  const d = new Date(ts - hour * 3_600_000)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 学习日的起点时刻（毫秒） */
export function dayStartOf(ts: number, hour = DAY_START_HOUR): number {
  const d = new Date(ts - hour * 3_600_000)
  d.setHours(0, 0, 0, 0)
  return d.getTime() + hour * 3_600_000
}

/**
 * 标题 → 锚（**保留编号**）。
 *
 * 去掉的是 Markdown 记号、空白与末尾标点——渲染后的标题本来就不带 `##`，
 * 但文档源文、agent 手写的字符串里会带，两边归一化完才比得动。
 *
 * 为什么编号要留着：它是最便宜的去重手段。「1. 引入」与「2. 引入」在去掉编号后
 * 会撞成同一个锚，两节就会被并成一节（时长、覆盖全乱）。编号的差异交给
 * looseSectionKey 那一路去做**候选匹配**，而不是把信息提前丢掉。
 */
export function sectionKey(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, '')
    .replace(/[。．.,，:：;；!！?？]+$/, '')
    .toLowerCase()
}

/**
 * 去编号的锚：只在「精确认不出」时当候选。
 *
 * 「## 2. 三次方根」被 agent 改写成「## 三次方根」是常态（它写文档时爱重排编号），
 * 这一路就是为它准备的；但它不能当主键（见 sectionKey 的说明）。
 */
export function looseSectionKey(text: string): string {
  return sectionKey(
    text.replace(/^\s*(?:\d+(?:[.、)]\d*)*[.、)]?\s*|[一二三四五六七八九十]+[、.]\s*|[(（]\d+[)）]\s*)/, ''),
  )
}

/** 供 tracker 在打开文档时播种：一份文档的全部节（reach/ms 都是 0） */
export function seedSections(outline: Array<{ level: number; text: string }>, now: number): SectionRead[] {
  return outline.map((h, index) => ({
    key: sectionKey(h.text),
    text: h.text,
    index,
    level: h.level,
    ms: 0,
    reach: 0,
    marks: [],
    firstAt: 0,
    lastAt: now,
  }))
}

/**
 * 把「文档现在的节」与「记录里的节」对齐，返回逐节认领结果。
 *
 * 三档匹配（宁可模糊认领，也别把记录丢了）：
 * 1. key 精确相同；
 * 2. 去掉编号后相同（sectionKey 已经做了，这里兜底原文相等）；
 * 3. 位置 + 层级都相同 —— 标 fuzzy，计划侧据此知道标题被改写过。
 */
export function matchSections(
  recorded: SectionRead[],
  current: Array<{ level: number; text: string; index?: number }>,
): Array<{ current: (typeof current)[number]; prev?: SectionRead; fuzzy: boolean }> {
  const used = new Set<string>()
  const textOf = (s: SectionRead) => (s.text || s.key)
  return current.map((c, index) => {
    const at = c.index ?? index
    let prev = recorded.find((s) => !used.has(s.key) && s.key === sectionKey(c.text))
    let fuzzy = false
    if (!prev) {
      const loose = looseSectionKey(c.text)
      prev = recorded.find((s) => !used.has(s.key) && looseSectionKey(textOf(s)) === loose)
      if (prev) fuzzy = true
    }
    /*
     * 最后一档：同层级里「位置最接近、且还没被认领」的那一节。
     * 为什么不要求位置完全相同：中间插一节、删一节都会让后面整体错位，
     * 而记录本身是按旧文档的序号存的——错位是常态，不是异常。
     */
    if (!prev) {
      const candidates = recorded.filter((s) => !used.has(s.key) && s.level === c.level)
      if (candidates.length) {
        prev = candidates.reduce((best, s) => (Math.abs(s.index - at) < Math.abs(best.index - at) ? s : best))
        fuzzy = true
      }
    }
    if (prev) used.add(prev.key)
    return { current: c, prev, fuzzy }
  })
}
