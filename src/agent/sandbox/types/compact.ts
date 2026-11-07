/**
 * 这个文件负责什么：沙箱类型契约的**compact（上下文压缩）**组的宿主实现 CompactOps
 * （把对话压成交接摘要，见 learn/compact）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/**
 * compact：把这段对话压成一份**交接摘要**（见 learn/compact）。
 *
 * 摘要**不立刻生效**：先写进会话，等本轮 loop 结束后由宿主把旧消息标成失活
 * （把上下文从正在跑的循环底下抽走是不行的——见 useAgent 的 finally）。回执里会说明这一点，
 * 模型才不会以为「已经清空了」而重复调用。
 */
export interface CompactOps {
  /** { summary, tasks? } → 摘要成形并写入会话（等本轮结束后应用） */
  write: (input: Record<string, unknown>) => unknown
}

