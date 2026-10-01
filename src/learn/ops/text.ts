/**
 * 纯文本小工具：读取上限、给模型看的截断，以及「此刻在看哪个节点」那段上下文。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：它们只读 store，与具体某一组 api
 * 无关，单独放一处之后，用一次 clipText 不必再 import 整个宿主实现。
 */

import { MASTERY_LABEL, superDocsOf, type LearnStore } from '../types'
import { nodeById, parentIds, prereqIds } from '../graph'
import { docPathOf, docsInfoOf, nodePathOf } from '../paths'
import { learningLine } from '../learning'

/** res.read 一次默认回多少字：整篇塞进去只会把上下文顶掉 */
export const READ_LIMIT = 12_000

/** 描述进消息时截断：它是给模型定位用的，不需要整篇 */
export function clipText(text: string, limit: number): string {
  const t = text.trim()
  return t.length > limit ? t.slice(0, limit) + '…' : t
}

/**
 * 「此刻在看哪个节点」——每一轮都写进用户消息里。
 *
 * 会话改成目标级之后，系统提示词只能描述**目标**（否则切一次节点就整段前缀作废），
 * 于是「当前节点是哪一个」这件事必须跟着每条消息走。顺带把描述与文档字数一并给出，
 * 模型因此不必为了知道「这个节点写过什么」而先读一遍。
 *
 * 紧跟其后的还有一条【写入目标】：省略 path 的文档写入到底落在哪一份，每轮明说——
 * 教学文档的编写因此从轮次的第一条消息起就有明确的对象，而不是模型凭
 * 「界面上碰巧开着哪个」去猜（那正是它写错文档的来路）。
 */
export function currentNodeBlock(store: LearnStore, goalId: string, nodeId: string): string {
  const node = nodeById(store, nodeId)
  if (!node) return '【当前节点】已不存在（可能刚被删除）。'
  const isGoal = store.goals.some((g) => g.rootNodeId === node.id)
  const lines = [
    '【当前节点】「' + node.title + '」（路径 ' + nodePathOf(store, goalId, node.id) + '，id #' + node.id + '）',
    /*
     * 写入目标一条说死：省略 path 的文档写入落在哪里，不再让模型拿「当前节点」
     * 与系统提示词里那句括注自己对暗号——它从这一轮的第一条消息起就该明确
     * 自己要编写的是哪一份文档（用户点名的规矩）。措辞是「写的就是这份」而不是
     * 「默认是这份」：动别的文档必须显式写 path，没有含糊的余地。
     */
    '【写入目标】这一轮 doc.write / doc.append / doc.replace 省略 path 时，写的就是这份教学文档：「' +
      docPathOf(store, goalId, node.id, 'teaching') +
      '」；要写其他节点的文档或任何笔记，必须写明 path。',
    '它的描述：' + (node.description.trim() ? clipText(node.description, 400) : '（还没写）'),
    '它的文档：' + docsInfoOf(node).map((d) => d.label + ' ' + d.chars + ' 字').join('、'),
    '它的状态：' + MASTERY_LABEL[node.status],
  ]
  // 超级文档不常备，有才提一句：模型需要知道「这里已经有什么交互件」
  const sdocs = superDocsOf(node)
  if (sdocs.length) lines.push('它的超级文档：' + sdocs.map((d) => '「' + d.name + '」' + d.html.length + ' 字').join('、'))
  /*
   * 学习状态跟着每条消息走（与「当前节点」同理：系统提示词固定在目标一级，
   * 任何会变的字段都不能进那里，否则切一次节点整段前缀缓存作废）。
   * 只在真有时才多写这一行——绝大多数节点还没评估过，多一行「（无）」只是噪声。
   */
  const learning = learningLine(node)
  if (learning) lines.push('它的学习状态：' + learning + '（详见 api.state.read()）')
  const prereqs = prereqIds(store, node.id)
    .map((id) => nodeById(store, id)?.title)
    .filter((t): t is string => !!t)
  const parents = parentIds(store, node.id)
    .map((id) => nodeById(store, id)?.title)
    .filter((t): t is string => !!t)
  if (parents.length) lines.push('上级节点：' + parents.join('、'))
  if (prereqs.length) lines.push('它的下级节点：' + prereqs.join('、'))
  if (isGoal) lines.push('这是学习目标本身（根节点）：教学文档按系统性大纲组织。')
  return lines.join('\n')
}
