/**
 * 从一条 mind 消息判断「这次 execute 是否启动了 work」。
 *
 * 现在唯一的执行工具是 `execute`（旧会话里可能是 `rexecute`）：真正的派发发生在
 * 代码体的 `api.work.create` / `api.work.send`，以及等价的 `api.chat.send({ channel: "work" })`。
 * 这里只做**界面观察点**判断，不解析投递结果，也不改写消息；误判的代价只是多插一块
 * 只读列表，不会影响上下文。
 */
import type { ConversationMessage } from '../../../agent/types'

function bodyOf(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args)
    if (parsed && typeof parsed === 'object' && typeof (parsed as { body?: unknown }).body === 'string') {
      return (parsed as { body: string }).body
    }
  } catch {
    // 流式过程里参数可能还不完整：按原文扫，扫不到就算了
  }
  return args
}

/** 这段执行代码是否在派 work（create / send，或 chat.send 到 work 通道） */
export function isWorkDispatchCode(args: string): boolean {
  const body = bodyOf(args)
  if (/\bapi\.work\.(create|send)\s*\(/.test(body)) return true
  // chat.send 到 work 通道：channel 与 work 可能隔着别的字段，只要求同一段调用里同时出现
  return /\bapi\.chat\.send\s*\(/.test(body) && /channel\s*:\s*(['"])work\1/.test(body)
}

/** 这条消息是否包含一次启动 work 的 execute 调用（用来在它后面插观察列表） */
export function isWorkDispatchMessage(m: ConversationMessage): boolean {
  return m.parts.some(
    (p) => p.type === 'tool' && (p.name === 'execute' || p.name === 'rexecute') && isWorkDispatchCode(p.args),
  )
}
