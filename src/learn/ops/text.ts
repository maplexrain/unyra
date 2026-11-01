/**
 * 纯文本小工具：读取上限与给模型看的截断。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：它们只读数据，与具体某一组 api
 * 无关，单独放一处之后，用一次 clipText 不必再 import 整个宿主实现。
 */

/** res.read 一次默认回多少字：整篇塞进去只会把上下文顶掉 */
export const READ_LIMIT = 12_000

/** 描述进消息时截断：它是给模型定位用的，不需要整篇 */
export function clipText(text: string, limit: number): string {
  const t = text.trim()
  return t.length > limit ? t.slice(0, limit) + '…' : t
}

/**
 * 【节点上下文不再存在】（2026-10-23 的架构决定）：
 *
 * 从前的 currentNodeBlock 把「当前学习目标 / 目标规划 / 当前节点 / 写入目标」每轮拼进
 * 用户消息——它随节点与进度每轮都在变，既不是固定的提示词也不是当次的指令，还把
 * 新对话的第一条指令盖在了下面。现在这一块整体删除：目标 / 节点 / 规划状态由 agent
 * 自己查（api.node.list / 节点对象 content），沙箱的「当前节点」语义
 * （省略 path 的写入落点）由宿主的 scope 解析兜着，模型不需要这块背景也能写对地方。
 * clipText 留在这里继续给别处用。
 */
