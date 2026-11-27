/**
 * 一条回复里那串部件的**平铺规则**（纯函数：说话的是 MessageBubble 的 Parts，规则住在这里）。
 *
 * 思考、工具调用、动态提示词模块与轮开始时的提示词注入都属于「过程件」，
 * 但不再合并成一个可折叠的大组：它们与正文一样直接排在消息流里，各自管自己的
 * 展开收起。这样用户看到的是「这一轮具体做了什么」，而不是先点开一层组壳、
 * 再看到里面同样是一串折叠项。
 */
import type { AgentPart } from '../../../agent/types'

/**
 * 一条**提示词注入**在消息流里的样子（人格 / 文档格式 / 技能库 / 提示词模块）。
 *
 * 它是宿主按隐藏消息合成出来的**渲染件**，不落库、也不进 AgentPart：那些消息本身
 * 是上下文的一部分（role: user），只是不该在对话流里单独占一行——
 * 与思考、工具调用一样，它们是「这一轮它凭什么这么答」（见 agent/messageKind）。
 */
export interface InjectItem {
  type: 'inject'
  /** 原隐藏消息的 id：列表的 React key */
  id: string
  /** 那行标题（「导师人格 · ADHD 导师」），即隐藏消息的 mark */
  label: string
  /** 注入的全文：展开看 */
  text: string
}

/** 平铺后的一项：普通 AgentPart，或宿主合成的提示词注入 */
export type PartItem = AgentPart | InjectItem

/** 是不是过程件（思考 / 工具 / 联网工具 / 动态提示词模块 / 通道消息） */
export function isProcessPart(p: AgentPart): p is Extract<
  AgentPart,
  { type: 'thinking' } | { type: 'tool' } | { type: 'web' } | { type: 'prompt-module' } | { type: 'channel-message' }
> {
  return p.type === 'thinking' || p.type === 'tool' || p.type === 'web' || p.type === 'prompt-module' || p.type === 'channel-message'
}

/**
 * 把一条消息的部件序列平铺开：轮开始时的注入排在前面，hop 是跳边界标记不上屏，
 * 其余部件按原顺序逐项返回。历史消息与正在流式的那一段走同一个函数，顺序天然一致。
 *
 * 这里**不再归组**：过程件不合并成「思考、工具与提示词 · N 步」的容器，
 * 每一项直接占自己的一行（思考气泡、工具卡、提示词块各自折叠）。
 */
export function flattenParts(parts: AgentPart[], injects?: InjectItem[]): PartItem[] {
  const out: PartItem[] = []
  if (injects?.length) out.push(...injects)
  for (const p of parts) {
    if (p.type === 'hop') continue
    out.push(p)
  }
  return out
}
