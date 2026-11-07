/**
 * useAgent 的**入口门面**：原本住在这里的巨型 hook（六单槽会话状态机 + 流式循环 +
 * 工具分发）已按职责拆进 useAgent/ 目录——
 * - hook.ts       useAgent 本体（发送 / 停止 / 工作流 / 手动与自动压缩 / ask 表单与实时账）
 * - slots.ts      会话分槽状态（streaming / running / pendingAsk / tps / liveUsage / 子代理实时槽）
 * - agentPrompt.ts 一轮的入口组装（用户消息 + 人格 / 格式 / 画像 / 技能 / MCP 补发）
 * - toolRig.ts    工具装配（沙箱基座、wf.invoke 排队、子代理、MCP、ask、交付登记……）
 * - streamLoop.ts 流式循环（runAgent 调用、token 账、缓存哨兵、流式槽更新）
 * - turnClose.ts  轮次收口（落库、清槽、工作流出队、压缩应用）
 * - freeTurn.ts   自由聊天的一轮
 * - queue.ts      等待队列（排队 / 撤回 / 立即发送 / 收口派发）
 *
 * 这几行是**入口不变的保证**：这些符号原先就从这个文件导出（路径与名字都没动），
 * 实现搬走之后在这里原样再导出一次——LearnWorkspace 与 scripts/tests 的探针照旧
 * 从 './learn/useAgent' 取，零改动。
 */

export { toChatHistory } from './agent/history'
export { loadAttachTexts } from './agent/transfer'
export { learnSandboxOps } from './agent/sandboxOps'
export type { AgentRunTarget, AgentUiDeps } from './agent/sandboxOps'
export { useAgent } from './useAgent/hook'
