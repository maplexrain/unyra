/**
 * 前缀门禁：强制「同一会话的上下文只增不改」。
 *
 * 服务端的前缀缓存（OpenAI / DeepSeek / Anthropic 都按前缀匹配）唯一的命中判据是：
 * 这次请求的消息数组与上一次实发的**逐字节相同，且只在其后追加**。任何一次中间改写
 * ——历史还原与实发结构对不上、并发轮次交错落库、工具声明中途变了——都会让缓存
 * 从改写处整段作废，之后每一跳都全价重算。这类问题曾是缓存命中率极低的元凶
 * （见 learn/agent/history 的镜像说明），靠纪律修过两次，这里用代码把它钉死：
 *
 * **例外：系统提示词每轮按提示词文件现拼，允许中途变化**。变了就换一届缓存纪元放行，
 * 不拦截本轮请求——用户改了文件顺序/启停，下一轮必须立即生效。
 *
 * 每次请求发出**之前**（runtime 的 onContext 钩子，拿到的是与实发完全一致的那一份）
 * 比对本会话的 messages 与工具声明：
 * - 上次的消息数组必须是这次的**前缀**（逐字节相同、只在其后追加）；完全相同视为重试，放行；
 * - 唯一的例外是「从最旧一头裁掉一段」的形状——toChatHistory 的 withinBudget 超预算裁剪，
 *   这次的消息与上一次的后段对得上也放行：那是设计内的丢弃，不是改写；
 * - 工具声明（描述与参数 schema）必须不变——它也参与前缀。
 * 违反就 console.error 详细差异，然后抛 PrefixGateError：runtime 把它变成对话里的错误
 * 事件，**这一次请求不会发出去**（它横竖也是一次缓存全 miss）。抛错前会把这次的上下文
 * 记为新基线——重试或下一轮从新基线上增长，放行，会话不会因此卡死。
 *
 * 「设计内的改写」不走比对，在动作点上显式 resetPrefixGate（现有四处）：上下文压缩
 * （useAgent 轮末 applyCompaction）、消息编辑、消息删除、清空最后一段对话
 * （都在 LearnWorkspace）。用户主动重写历史不该被拦一次。
 *
 * 账本只在内存（Map，按 conversationId 分键）：重启后从零记账，第一次请求无条件放行——
 * 服务端缓存本来就活不过几分钟，不值得为它持久化。
 */

import type { ChatMessage } from '../ai/types'

/** 前缀被改写时抛出；runtime 捕获后作为本轮错误呈现，请求不会发出 */
export class PrefixGateError extends Error {}

/** 工具声明里参与前缀的部分（AgentTool 与 ChatToolDef 都满足这个形状） */
export type ToolLike = { name: string; description: string; parameters: Record<string, unknown> }

/** 一次请求的指纹：每条消息的 JSON 串（逐字节比对的唯一判据）+ 工具声明串 */
interface Snapshot {
  messages: string[]
  tools: string
}

const baselines = new Map<string, Snapshot>()

function fingerprint(messages: readonly ChatMessage[], tools?: readonly ToolLike[]): Snapshot {
  return {
    messages: messages.map((m) => JSON.stringify(m)),
    tools: JSON.stringify((tools ?? []).map((t) => [t.name, t.description, t.parameters])),
  }
}

/** 违规的对外描述（给对话区的错误事件）与给控制台的完整细节 */
interface Violation {
  message: string
  detail: string
}

const preview = (s: string): string => {
  const oneLine = s.replace(/\\n/g, ' ').replace(/\n/g, ' ')
  return oneLine.length > 100 ? oneLine.slice(0, 100) + '…' : oneLine
}

function findViolation(prev: Snapshot, curr: Snapshot, onTrim?: () => void): Violation | null {
  if (prev.tools !== curr.tools) {
    return {
      message: '工具声明在两次请求之间变了，前缀缓存将从第一跳起整段作废',
      detail: `上次 tools=${prev.tools.slice(0, 200)}\n这次 tools=${curr.tools.slice(0, 200)}`,
    }
  }
  const p = prev.messages
  const c = curr.messages
  if (!p.length || !c.length) return null
  // 系统提示词每轮都按提示词文件现拼，顺序/启停变化会让第 0 位变化：
  // 这是用户主动改配置的预期结果，放行并换一届缓存纪元（忽略前缀缓存失效），
  // 不拦截本轮请求；但历史部分仍按原纪律比对，避免系统词变化掩护历史改写。
  if (p[0] !== c[0]) onTrim?.()
  // 第 0 位（system）单独处理：相同则自然同前缀，变化则已放行换纪元；剩下的历史从 1 开始
  const start = 1
  if (p.length <= start || c.length <= start) return null
  const n = Math.min(p.length, c.length)
  let diverged = -1
  for (let i = start; i < n; i++) {
    if (p[i] !== c[i]) {
      diverged = i
      break
    }
  }
  if (diverged < 0) {
    // 共同部分全同：这次更长（追加，正常）或更短（从尾部缩了）。
    // 更短意味着上次发过的消息这次没了——会话内不该出现（工具调用与返回总是成对落库），
    // 出现即是「历史被改写」，拦下来看。
    return p.length <= c.length ? null : { message: '上下文比上一次请求变短了（尾部消息被删）', detail: `上次 ${p.length} 条，这次 ${c.length} 条` }
  }
  // 从分叉点起找「从最旧一头裁掉一段」的形状：c 的 start 位对上 p 的第 s 位、整段后移对齐
  for (let s = start; s < p.length; s++) {
    if (p[s] !== c[start]) continue
    const overlap = Math.min(c.length - start, p.length - s)
    let ok = true
    for (let j = 0; j < overlap; j++) {
      if (p[s + j] !== c[start + j]) {
        ok = false
        break
      }
    }
    if (ok) {
      // 设计内的前缀搬家（超预算从最旧一头裁掉一段）：门禁放行，但服务商缓存从
      // 搬家点起真丢了——换一届纪元，哨兵这次不与旧读数比较。
      onTrim?.()
      return null
    }
  }
  return {
    message: `上下文前缀被改写（第 ${diverged + 1} 条消息与上一次实发不一致），本次请求已拦截`,
    detail:
      `上次 ${p.length} 条 / 这次 ${c.length} 条，分叉在第 ${diverged + 1} 条（下标 ${diverged}）：\n` +
      `  上次：${preview(p[diverged])}\n  这次：${preview(c[diverged])}\n` +
      `常见原因：历史还原与实发结构不一致（learn/agent/history 的镜像被破坏）、` +
      `同一会话并发跑了两轮、或有人在轮次中途改写了会话。`,
  }
}

/**
 * 请求发出前对账：违反前缀纪律就抛 PrefixGateError（调用方在 runtime 的 onContext 里调，
 * 抛错发生在请求分发之前）。无论放行与否都把这次的上下文记为新基线——
 * 拦截一次之后对话还能继续，不会无限拦下去。
 */
export function assertPrefixStable(key: string, messages: readonly ChatMessage[], tools?: readonly ToolLike[]): void {
  const curr = fingerprint(messages, tools)
  const prev = baselines.get(key)
  baselines.set(key, curr)
  if (!prev) return
  const violation = findViolation(prev, curr, () => bumpEpoch(key))
  if (!violation) return
  console.error('[prefix-gate] ' + violation.message + '\n' + violation.detail)
  throw new PrefixGateError(violation.message)
}

/** 设计内的历史改写（压缩 / 编辑 / 删除 / 清空）之后调用：这一会话的账重新开始记 */
export function resetPrefixGate(key: string): void {
  baselines.delete(key)
  bumpEpoch(key)
  cacheReads.delete(key)
}

/** 测试隔离用：清空全部账本 */
export function clearPrefixGatesForTests(): void {
  baselines.clear()
  cacheEpochs.clear()
  cacheReads.clear()
}

/* ---------- 缓存哨兵的账本（与门禁同生命周期） ---------- */

/*
 * 服务商的缓存命中只认「与上次实发的前缀逐字节相同」。门禁保证我方载荷只增不改，
 * 但**设计内的前缀搬家**——超预算裁剪（这次开头对上上次中段，门禁放行）与压缩/
 * 编辑后的重置——服务商那边就是真丢：新前缀从搬家点起没被缓存过，命中数自然骤跌。
 * 这不是分叉，哨兵不该喊。所以命中读数带**纪元**：前缀搬家一次纪元换一届，
 * 跨纪元的读数不比较（本届第一次读数自己锚底）。
 */
const cacheEpochs = new Map<string, number>()
const cacheReads = new Map<string, { epoch: number; read: number }>()

function bumpEpoch(key: string): void {
  cacheEpochs.set(key, (cacheEpochs.get(key) ?? 0) + 1)
}

/** 哨兵在每次 usage 事件时记账（带当前纪元） */
export function noteCacheRead(key: string, read: number): void {
  cacheReads.set(key, { epoch: cacheEpochs.get(key) ?? 0, read })
}

/** 哨兵比对的上一笔读数；跨了纪元（或刚重置）就比不得 */
export function lastCacheRead(key: string): { epoch: number; read: number } | undefined {
  return cacheReads.get(key)
}

/** 当前纪元（哨兵比对用：读数的纪元对不上当前的，就当没读过） */
export function currentEpoch(key: string): number {
  return cacheEpochs.get(key) ?? 0
}
