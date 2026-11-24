/**
 * 一条回复里那串部件的**归组规则**（纯函数：说话的是 MessageBubble 的 Parts，规则住在这里）。
 *
 * 抽出来的理由与 panel/toolLabel 同一条：这是一条会变的规矩（谁进组、谁切断组），
 * 写在 render 里只有真跑一轮对话才验证得了，而它出错的形态是「界面看着有点乱」——
 * 不报错、不崩，只有用例钉得住。
 */
import type { AgentPart } from '../../../agent/types'

/**
 * 一条**提示词注入**在过程组里的样子（人格 / 文档格式 / 技能库 / 提示词模块）。
 *
 * 它是宿主按隐藏消息合成出来的**渲染件**，不落库、也不进 AgentPart：那些消息本身
 * 是上下文的一部分（role: user），只是不该在对话流里单独占一行——
 * 与思考、工具调用一样，它们是「这一轮它凭什么这么答」（见 agent/messageKind）。
 */
export interface InjectItem {
  type: 'inject'
  /** 原隐藏消息的 id：组内列表的 React key */
  id: string
  /** 那行标题（「导师人格 · ADHD 导师」），即隐藏消息的 mark */
  label: string
  /** 注入的全文：展开看 */
  text: string
}

/**
 * 「过程件」：思考、工具调用、动态注入的提示词模块。
 *
 * 三种是同一层的东西——**轮次进行中的一个片段**：模型自己看得见的上下文（思考与工具结果）
 * 与系统悄悄补进去的上下文（提示词模块）一起构成「这一轮它是怎么走过来的」。
 * 提示词模块另画一块独立的气泡只会把同一件事拆成两截（它还偏偏就发生在两次工具调用之间）。
 *
 * 另有第四种：InjectItem（轮开始时的提示词注入，见上）——同样是「凭什么这么答」。
 */
export type ProcessPart =
  | Extract<AgentPart, { type: 'thinking' } | { type: 'tool' } | { type: 'prompt-module' } | { type: 'channel-message' }>
  | InjectItem

/** 是不是过程件（组内可收拢的那几种；InjectItem 由调用方按 type 单独认） */
export function isProcessPart(p: AgentPart): p is Exclude<ProcessPart, InjectItem> {
  return p.type === 'thinking' || p.type === 'tool' || p.type === 'prompt-module' || p.type === 'channel-message'
}

/** 归组结果：一组过程件（渲染成可折叠的消息组），或一件独立成条的东西 */
export type PartGroup = { kind: 'group'; items: ProcessPart[] } | { kind: 'single'; part: AgentPart }

/**
 * 把一条消息的部件序列归组：**相邻的过程件**连成一个候选组，其余各自成条。
 *
 * 调用方对「只有一个成员的组」按单条渲染（孤零零一件没有可收拢的东西，
 * 硬套组壳等于多一次点击）——所以这里不为它特判，两种情况都照原样交出去。
 *
 * 切组的规则：**正文一出，组就闭合**。hop 是跳边界标记（界面上不画），不切断组
 * ——一轮循环跨了几跳，都是同一段过程；notice 是异常提示，藏进默认折叠的组里
 * 等于藏起警告，所以它也留在组外（并切断组）。历史消息与正在流式的那一段走的是
 * 同一个函数，归组行为天然一致。
 *
 * `injects` 是这一轮开始前注入的那几条提示词（见 InjectItem）：它们发生在第一个
 * 思考/工具之前，所以排在最前面、与后面的过程件同属一组——用户看到的是**一条**
 * 「思考、工具与提示词 · N 步」，而不是两行各自折叠的标题。
 *
 * chat 与 mind 共用这一套归组规则；mind 的差别只在消息行头部（渠道 / 发信人 /
 * 上下文账，见 MindMessageRow），不是把过程件重新铺开。
 */
export function groupParts(parts: AgentPart[], injects?: InjectItem[]): PartGroup[] {
  const groups: PartGroup[] = []
  if (injects?.length) groups.push({ kind: 'group', items: [...injects] })
  for (const p of parts) {
    if (p.type === 'hop') continue
    if (isProcessPart(p)) {
      const last = groups[groups.length - 1]
      if (last && last.kind === 'group') last.items.push(p)
      else groups.push({ kind: 'group', items: [p] })
    } else {
      groups.push({ kind: 'single', part: p })
    }
  }
  return groups
}
