/**
 * 定位条浮层的消息预览，以及「思考过程」收起时那一行尾巴。
 *
 * 两支都是纯函数：一个把消息折成一行字，一个从长正文里取最后一行。
 * 从 AgentPanel 搬出来时原样保留——尤其 lastLineOf 里的取舍（为什么不用
 * split、为什么要限窗口），那些「为什么」比代码本身重要。
 */

import type { ConversationMessage } from '../../../agent/types'
import { t } from '../../../i18n'

export { lastLineOf } from '../../../lib/lastLine'

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
