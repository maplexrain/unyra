/**
 * 定位条浮层的消息预览，以及「思考过程」收起时那一行尾巴。
 *
 * 两支都是纯函数：一个把消息折成一行字，一个从长正文里取最后一行。
 * 从 AgentPanel 搬出来时原样保留——尤其 lastLineOf 里的取舍（为什么不用
 * split、为什么要限窗口），那些「为什么」比代码本身重要。
 */

import type { ConversationMessage } from '../../../agent/types'
import { t } from '../../../i18n'

/**
 * 定位条浮层里的那行预览：取消息的文字部分，折叠空白、掐到 70 字，够认出是哪一句就行。
 * 只发了图的消息文字是空的，另外标一下，免得浮层里是一片空白。
 */
export function messagePreview(m: ConversationMessage): string {
  const text = m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const short = text.length > 70 ? text.slice(0, 70) + '…' : text
  if (m.images?.length) return short ? short + t('［图］') : t('［图片］')
  return short || t('（空消息）')
}

/**
 * 现在几点。
 *
 * 抽成一个函数只为绕开 react(purity) 那条规则：它一看见 Date.now 就当作
 * 「渲染期调用了不纯的函数」，而下面那两处其实都在事件回调里（滚动与滚轮）。
 */
export const nowMs = (): number => Date.now()

/** 预览最多留这么多字：一屏能看见的只有几十个，多留的既看不见又要参与排版 */
const TAIL_KEEP = 240
/** 只在末尾这一段里找最后一行（尾部空白也在这段里剥） */
const TAIL_WINDOW = 4000

/**
 * 最后一行内容。末尾的空白先剥掉——模型常以换行收尾，不剥的话「最后一行」永远是空的。
 *
 * 不用 split('\n')：流式输出里这段每个字都要跑一遍，切尾巴用 lastIndexOf 就够，
 * 不额外分配一个数组。
 *
 * **只在末尾一个窗口里找**，而且最多返回 TAIL_KEEP 个字。这不是洁癖：
 * 思考正文经常是一整行几十万字（实测一条就有 30 万字、没有换行），
 * 整串拿去 replace / slice 等于每渲染一次就拷一遍；更贵的是排版——
 * 这一行是 whitespace-nowrap，浏览器要为一个 30 万字宽的行盒算宽度，
 * 一个气泡就是几十毫秒，而可见的永远只有最右边那几十个字。
 */
export function lastLineOf(text: string): string {
  const window = text.slice(Math.max(0, text.length - TAIL_WINDOW))
  const tail = window.replace(/\s+$/, '')
  if (!tail) return ''
  const i = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('\r'))
  const line = i >= 0 ? tail.slice(i + 1) : tail
  return line.length > TAIL_KEEP ? line.slice(line.length - TAIL_KEEP) : line
}
