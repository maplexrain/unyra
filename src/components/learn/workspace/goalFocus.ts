/**
 * 每个目标「最近被看过哪个节点」：agent 页签是目标级的，发送目标却是节点——
 * 用户在文档区看过哪个节点，导师那一轮就冲着哪个节点去（没看过的目标回落到它的总目标）。
 *
 * 走**模块级槽**而不是 ref：agentView 在渲染期读它，而渲染期读 ref 会犯 react-compiler
 * 的 refs 线（与 OutlineHandle 的槽同一套解法）。它是「最后落点」的缓存，不进页签、
 * 不持久化，重启后回落各目标的总节点；写入只发生在 retargetNode（事件路径）。
 */
export const goalFocusByGoal = new Map<string, string>()

/**
 * 每个目标「最近一次激活展示的会话 id」：当一个目标在 agentTabs 里存在多段对话
 * （ga:<goalId>:<convId>），切换去另一个目标或后台固定对照栏渲染非全局激活目标时，
 * 用它记住该目标上一次选中的会话，避免退回第一段旧会话。
 */
export const goalConvByGoal = new Map<string, string>()
