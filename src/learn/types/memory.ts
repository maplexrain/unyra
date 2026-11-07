/**
 * 记忆域类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 记忆类型（MemoryType）、一条记忆（MemoryItem）与记忆库（MemoryStore）。
 * 本文件不依赖其他 types/ 子模块。
 */

/**
 * 记忆的类型（见 learn/memory）。
 *
 * - `work`（工作 / 短期记忆）：**目标级**，记录这个目标里「发生了什么 / 要做什么 /
 *   怎么做 / 过程怎么样 / 结果怎么样」。只有这个目标的会话读得到；agent 觉得它是
 *   信息负担时可以随手删掉。
 * - `long`（长期记忆）：**跨目标**，记聊天中对用户的印象、作息、重要约定。
 *   任何目标都读得到，也因此**不能随手删**（删除要显式确认，见 memory.delete）。
 */
export type MemoryType = 'work' | 'long'

/**
 * 一条记忆（见 learn/memory）。
 *
 * 与 tmp 的分界：tmp 服务于一次编排里的中间结果（按节点、会过期）；
 * 记忆是跨对话有效的东西（不过期）。关键边界：记忆**不会**被拼进系统提示词或任何
 * 消息——agent 需要时必须主动 api.memory.list / get，这是需求明确的约束
 * （自动注入会让上下文逐轮漂移，前缀缓存跟着遭殃；更重要的是，记忆该由 agent
 * 自己决定何时取用）。
 */
export interface MemoryItem {
  /** 唯一标识：api.memory.update / delete 都按它认条目 */
  uuid: string
  /** 关键词：检索与展示用（一条记忆可以挂多个） */
  keys: string[]
  /** 标题：一行说清这条记忆是什么 */
  title: string
  /** 详细内容（Markdown 纯文本，给人与模型读） */
  content: string
  /** 创建时间（毫秒） */
  createAt: number
  /** 最后更新时间（毫秒） */
  updateAt: number
  type: MemoryType
}

/**
 * 记忆库。
 *
 * 两种类型分两处放，因为它们的**作用域不同**：
 * - `long` 跨目标，跟着用户走 → state.json（不属于任何一个目标的目录）；
 * - `work` 按目标归档 → `docs/{目标}/mind.json`（与 chat.json 同层，目标删了它跟着没）。
 *
 * 文件名沿用 `mind.json`：那是上一版「长期记忆」的落点，换个名字等于把老用户的记忆
 * 扔在磁盘上读不回来（读侧按老形状兼容，见 learn/files/parse）。
 */
export interface MemoryStore {
  long: MemoryItem[]
  work: Record<string, MemoryItem[]>
}
