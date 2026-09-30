/**
 * 沙箱 api 的宿主实现：把「文档 / 节点 / 描述」这些动作落到学习 store 上。
 *
 * 单独成一个模块（而不是留在 useAgent 里）有两个原因：
 * 1. 它是一段纯粹的 store 逻辑，与 React 无关——抽出来才能被直接用 Node 跑通的测试覆盖
 *    （见 scripts/agent-ops.test.ts 那种探针）；
 * 2. useAgent 已经很长了，把「一轮对话怎么跑」和「每个 api 怎么落到数据上」分开更好读。
 *
 * 所有读取都**现取** deps.getLatest()：一轮编排里模型可能连着调好几次 api，
 * 每次都必须看到上一次的结果，拿到旧快照就会出现「写了个寂寞」。
 *
 * 实现已按职责拆到 learn/ops/ 下（见 docs/refactor-plan.md 3.5）：这个文件现在只是 barrel，
 * 把原来的公开符号原样转出去，调用方的 import 一行都不用改。
 */
export { clipText, currentNodeBlock } from './ops/text'
export type { AgentOpsDeps, AgentOps, ResourceIo, UserInfoIo, WorkspaceIo } from './ops/deps'
export { makeExamTool } from './ops/exam'
export { createAgentOps } from './ops/assemble'
