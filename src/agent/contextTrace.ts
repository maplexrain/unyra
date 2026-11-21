/**
 * 上下文轨迹：**从对话原数据即时派生**「模型实际看到了什么、花了多少」。
 *
 * 这里没有记录器——对话数据本身就是完整的账本：隐藏指令（工作流指令）、提示词注入
 * （人格 / 格式 / 技能 / 模块）、每条消息携带的节点上下文、回复里的思考 / 工具调用原文、
 * 每条回复的 token 账，全都随 chat.json 落盘。轨迹窗口（components/agent/TraceWindow，
 * 独立的 Electron 窗口）拿着 Conversation 调 deriveTraceNodes 就能随时打开看，
 * 不依赖任何开关、不需要预先记录。
 *
 * **不分组**：一条消息就是一个轨迹节点，按对话的原始顺序平铺，每个节点标明它的
 * `role` 字段值——看轨迹的人在核对「发出去的字节」，分组只会把字节藏起来。
 */
import type { AgentPart, Conversation, ConversationMessage } from './types'

/** 轨迹里的一段原文：窗口里染成 <pre> 纯文本（不渲染成元素） */
export interface TraceItem {
  /** 条目类型决定染色与措辞 */
  kind: 'instruction' | 'prompt' | 'context' | 'text' | 'thinking' | 'tool' | 'notice' | 'module'
  /** 条目名（如「工作流指令」「节点上下文」「工具调用 files.write」） */
  title: string
  /** 原文全文 */
  text: string
  /** 字符数（条目头的体量标注） */
  chars: number
  /** 工具调用是否成功（仅 kind === 'tool'；失败要让人一眼看见） */
  ok?: boolean
}

/** 一个轨迹节点 = 一条消息：role / 标记 / 全部原文 / token 账 */
export interface TraceNode {
  id: string
  /** 消息的 `role` 字段值，节点标题原样标明 */
  role: 'user' | 'assistant'
  /**
   * 消息的类别标注：`instruction` = 工作流 / 隐藏指令（inject: 'instruction'），
   * `prompt` = 提示词注入（inject: 'prompt'），`chat` = 普通消息。
   */
  kind: 'chat' | 'instruction' | 'prompt'
  /** 工作流 / 隐藏指令名（mark），没有就没有 */
  mark?: string
  ts: number
  items: TraceItem[]
  /** assistant 回复的 token 账；user 消息与旧数据没有 */
  usage?: ConversationMessage['usage']
}

const partText = (p: AgentPart): string =>
  p.type === 'tool'
    ? p.name + '\n〔参数〕\n' + (p.args ?? '') + '\n〔结果〕\n' + (p.result ?? '')
    : p.type === 'notice'
      ? '[' + (p.level === 'warn' ? '警告' : '提示') + '] ' + p.text
      : p.type === 'prompt-module'
        ? '〔提示词模块 ' + p.key + '〕\n' + p.text
        : p.type === 'team-delivery'
          ? '〔委托交付 ' + p.delegationId + '〕\n' + p.text
          : (p as { text?: string }).text ?? ''

/** 一条消息拆成原文段：context（节点上下文）在前、parts 在后 */
function itemsOfMessage(m: ConversationMessage): TraceItem[] {
  const out: TraceItem[] = []
  if (m.context?.trim()) {
    out.push({ kind: 'context', title: '节点上下文（随消息注入）', text: m.context, chars: m.context.length })
  }
  for (const p of m.parts) {
    if (p.type === 'hop') continue // 跳边界只服务于历史还原，没有内容可看
    const text = partText(p)
    out.push({
      kind: p.type === 'prompt-module' || p.type === 'team-delivery' ? 'module' : (p.type as TraceItem['kind']),
      title:
        p.type === 'tool'
          ? '工具调用 ' + p.name + (p.status === 'error' ? '（失败）' : p.soft ? '（部分未生效）' : '')
          : p.type === 'prompt-module'
            ? '提示词模块 ' + p.key
            : p.type === 'team-delivery'
              ? '委托交付 ' + p.delegationId
              : p.type === 'thinking'
                ? '思考过程'
                : p.type === 'notice'
                  ? '运行时提示'
                  : '正文',
      text,
      chars: text.length,
      ...(p.type === 'tool' ? { ok: p.status !== 'error' && !p.soft } : {}),
    })
  }
  return out
}

/** 对话 → 平铺的轨迹节点（即算即用，不落任何中间数据） */
export function deriveTraceNodes(conv: Conversation): TraceNode[] {
  const nodes: TraceNode[] = []
  for (const m of conv.messages) {
    const kind = m.hidden && m.inject === 'instruction' ? 'instruction' : m.inject === 'prompt' ? 'prompt' : 'chat'
    nodes.push({
      id: m.id,
      role: m.role,
      kind,
      ...(m.mark ? { mark: m.mark } : {}),
      ts: m.ts,
      items: itemsOfMessage(m),
      ...(m.role === 'assistant' && m.usage ? { usage: m.usage } : {}),
    })
  }
  return nodes
}
