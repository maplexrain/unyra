import type {
  ChatMessage,
  ReasoningEffort,
  StreamChatOptions,
  StreamChatResult,
  StreamFn,
} from '../ai/types'
import { streamChatWith, type ResolvedProvider } from '../ai/client'
import { estimateUsage } from '../ai/types'
import { imagePart, textPart } from '../ai/content'
import {
  MAX_TOOL_IMAGES,
  TOOL_IMAGE_NOTE,
  type AgentContext,
  type AgentEvent,
  type AgentTool,
  type AgentToolResult,
  type MessageImage,
} from './types'
import type { ContextSnapshot } from './contextFilter'
import { t } from '../i18n'

/**
 * Agent 运行时：一次「思考 → 工具 → 观察 → 再思考」的循环。
 *
 * 保持框架无关：只依赖 ai/client 的流式补全与一份工具数组，
 * 通过 onEvent 把过程增量抛给调用方渲染。工具集与提示词全部外部注入，
 * 因此换场景 / 加工具都不需要动这里；换 AI 提供商同样不需要——
 * 提供商信息整体从 AgentRunOptions.provider 传入，这里不认识任何具体服务商。
 *
 * 关于「异常终止」：模型侧有多条路径会让一次生成提前结束，早先版本一律
 * 静默地发 done 收场，用户看到的就是「答到一半没了」。这里逐个兜住：
 * 1. finish_reason 不是 stop / tool_calls（length、content_filter、
 *    insufficient_system_resource 等）——本轮输出是不完整的；
 * 2. 流中途断掉——由 ai/client 的空闲超时兜住，这里收到错误。
 * 两种情况都会发 notice 事件，让界面能明确告诉用户「为什么停了、怎么继续」。
 *
 * 循环没有轮次上限，单轮输出也不设上限：长任务（写大纲 → 逐个展开 → 出题）
 * 由模型自己决定何时收尾，需要中断时由用户点「停止」。
 */

export interface AgentRunOptions {
  /** 当前提供商（含 baseUrl / Key / quirks），由 ai/settings 解析后注入 */
  provider: ResolvedProvider
  model: string
  system: string
  /** 对话历史（不含 system），最后一条应是本轮用户输入 */
  messages: ChatMessage[]
  /**
   * 本次可用的工具。现在通常只有一个 execute（模型写 JS 编排），
   * 但运行时并不假设这一点——给多少就声明多少，调用哪个就执行哪个。
   */
  tools: AgentTool[]
  ctx: AgentContext
  onEvent: (e: AgentEvent) => void
  signal?: AbortSignal
  temperature?: number
  /** 思考等级（low / high / max）；不传就不发该字段，由模型自选 */
  reasoningEffort?: ReasoningEffort
  /**
   * 把工具附带的图片（Agent 用 res.read 看了一张图）读成 base64。
   *
   * 运行时本身不碰文件系统：给什么读什么（与用户消息里的图片同一条路，
   * 见 learn/images 的 loadImagesById）。不注入就退化成「挂不上图」，
   * 模型会拿到文字回执却看不到图——因此生产路径必须注入。
   */
  loadImages?: (images: MessageImage[]) => Promise<Map<string, { mime: string; data: string }>>
  /** 流式补全实现；默认用真实的 client，测试时可注入替身 */
  stream?: StreamFn
  /**
   * 上下文过滤器钩子：**每一次**把上下文发往 API 之前调用（此时 system、messages、
   * 工具声明都已拼装完成，拿到的是与实发完全一致的那一份）。调试器据此记录快照、
   * 比对两轮之间上下文差异出现在哪个部位（见 agent/contextFilter）。
   * 不注入就没有任何开销。
   */
  onContext?: (snapshot: ContextSnapshot) => void
  /**
   * 介入通道（子代理并发模型的钩子，导师不注入）：在「当前这条消息已经完整」的边界
   * （工具结果之后、或无工具调用的消息完结之后）拉一次；返回要插入的指令文本，没有就
   * null。指令以一条 user 消息进历史——调用方负责把「半场落库 + 指令入账」同步进自己的
   * 会话账本（镜像纪律）。绝不打断半截输出：流式还在进行时，插入只会发生在消息完整之后。
   */
  injections?: () => Promise<string | null>
}

/** 服务端资源不足属于瞬时故障，允许对「空结果」自动重试的次数 */
const MAX_RESOURCE_RETRIES = 2

/** 实时输出速度的滚动窗口宽度（毫秒）：只看最近这几秒的吞吐（见 ticker 的说明） */
const PACE_WINDOW_MS = 3000

/** 非正常结束的原因说明；stop / tool_calls / null 表示正常 */
const ABNORMAL_REASON: Record<string, string> = {
  length: '模型输出达到长度上限被截断',
  content_filter: '内容触发安全策略被截断',
  insufficient_system_resource: '服务端资源不足，输出被中断',
}

function describeReason(reason: string | null): string | null {
  if (!reason || reason === 'stop' || reason === 'tool_calls') return null
  const known = ABNORMAL_REASON[reason]
  return known ? t(known) : t('生成提前结束（finish_reason={0}）', reason)
}

/**
 * 一次工具调用：参数解析与工具异常都在这里兜住，绝不抛出到运行时循环。
 * 未声明的工具名（模型凭印象编的）同样只回报错误，不中断本轮。
 */
async function runTool(
  tools: AgentTool[],
  name: string,
  argsJson: string,
  ctx: AgentContext,
): Promise<AgentToolResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { ok: false, content: '未知工具：' + name }
  let args: Record<string, unknown> = {}
  const raw = argsJson?.trim()
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
    } catch {
      return { ok: false, content: '工具参数不是合法 JSON，请重新调用并给出合法参数' }
    }
  }
  try {
    return await tool.run(args, ctx)
  } catch (err) {
    return { ok: false, content: err instanceof Error ? err.message : '工具执行失败' }
  }
}

export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const { provider, model, system, ctx, onEvent, signal } = opts
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...opts.messages]
  const toolSchema = opts.tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
  // 默认走真实客户端；测试可注入替身，从而在不联网的情况下驱动整个循环
  const call = (o: StreamChatOptions): Promise<StreamChatResult> =>
    opts.stream ? opts.stream(o) : streamChatWith(provider, model, o)
  let resourceRetries = 0

  /**
   * 上报一次请求的用量；服务端没回就按字符估算，并标记出来。
   *
   * tps 的两口口径各有一条**合理性门槛**（现实里的流式远没有「五千万 tok/s」，
   * 那种数字只会来自「网关把整段缓存、最后一锤子砸下来」——所有 chunk 几乎同时到，
   * 首末间隔缩到 1ms）：
   * - 首末间隔 < 500ms：计时两端几乎重合，这个「平均速度」没有意义，不上报；
   * - 算出来 > 1000 tok/s：没有模型真的这么快，超了按缓冲假象处理，同样不上报。
   * 界面上的实时速度由滚动窗口供给（见下面的 ticker），这里的精确值只在可信时替换它。
   */
  const reportUsage = (result: StreamChatResult, pace: { first: number; last: number }): void => {
    const usage = result.usage ?? estimateUsage(messages, toolSchema, result.content)
    const elapsedMs = pace.last - pace.first
    const raw = elapsedMs >= 500 ? Math.round(usage.output / (elapsedMs / 1000)) : undefined
    const tps = raw !== undefined && raw <= 1000 ? raw : undefined
    onEvent({ type: 'usage', usage: tps ? { ...usage, tps } : usage })
  }

  // 不设轮次上限：循环只在「模型自己停下」或「出错/取消」时结束。
  // 曾经的 maxSteps 会在长任务（先写大纲、再逐个展开、再出题）中途硬停，
  // 用户看到的就是「答到一半没了」。真正的兜底交给取消按钮与下面的错误处理。
  try {
    for (;;) {
      if (signal?.aborted) {
        onEvent({ type: 'done' })
        return
      }
      // 上下文过滤器：此刻的 system / messages 就是即将发出去的那一份
      opts.onContext?.({ system, messages, tools: opts.tools })
      /** 首末正文 chunk 的时刻：结束时算「这一跳的平均速度」用（门槛见 reportUsage） */
      const pace = { first: 0, last: 0 }
      /**
       * 实时速度：**最近 3 秒的滚动窗口**。每个正文 chunk 记下 (时刻, 估算 token)，
       * 每秒重算一次「窗口内的 token ÷ 窗口实际跨度」。
       *
       * 为什么不用「首 chunk 以来的累计平均」：那在两种真实场景下都会失真——
       * 开头的密集 chunk 会把平均值顶上天（后来慢了它还赖着不降），
       * 而思考停顿期间累计时长照涨、平均被拖向 0。滚动窗口只看最近几秒，
       * 快慢变化立刻反映，突发的一坨也会在 3 秒后自然滑出窗口。
       */
      const samples: Array<{ at: number; tokens: number }> = []
      const ticker = setInterval(() => {
        const now = Date.now()
        while (samples.length && samples[0].at < now - PACE_WINDOW_MS) samples.shift()
        if (!samples.length) return
        const spanMs = now - samples[0].at
        // 窗口还不足 1 秒不发：一整块内容瞬间砸下来时的「速度」只是噪声
        if (spanMs < 1000) return
        const sum = samples.reduce((n, s) => n + s.tokens, 0)
        // 兜顶与 reportUsage 同一条线：现实里没有 >1000 tok/s 的流式
        const tps = Math.min(1000, Math.round(sum / (spanMs / 1000)))
        if (tps > 0) onEvent({ type: 'pace', tps })
      }, 1000)
      let result: StreamChatResult
      try {
        result = await call({
          messages,
          tools: toolSchema,
          temperature: opts.temperature ?? 0.5,
          /**
           * 常规情况不传 maxTokens：把单轮输出长度交给模型/服务端的默认值，
           * 避免我们这边的上限先于模型自己的收尾把输出截断。
           *
           * 但提供商若声明了硬上限（如 Command Code 网关的 64000，超了会被拒），
           * 或用户在设置里显式填了值，就必须带上——provider.maxTokens 已在
           * ai/settings 的 resolveProvider 里把这两种来源合并好。
           */
          maxTokens: provider.maxTokens,
          signal,
          reasoningEffort: opts.reasoningEffort,
          onDelta: (d) => {
            if (d.reasoning) onEvent({ type: 'thinking', delta: d.reasoning })
            if (d.content) {
              const now = Date.now()
              // 掐表从第一个正文 chunk 起算（思考 chunk 不算——它不是给用户看的输出）
              if (!pace.first) pace.first = now
              pace.last = now
              // 这个 chunk 的 token 估算：与 estimateUsage 同口径（CJK 1 字 1 token、其余约 4 字符 1）
              let cjk = 0
              for (const ch of d.content) if ((ch.codePointAt(0) ?? 0) > 0x2e7f) cjk++
              samples.push({ at: now, tokens: Math.ceil(cjk + (d.content.length - cjk) / 4) })
              onEvent({ type: 'text', delta: d.content })
            }
          },
        })
      } finally {
        clearInterval(ticker)
      }

      reportUsage(result, pace)
      const abnormal = describeReason(result.finishReason)
      if (abnormal) {
        // 输出在语义上是不完整的：工具参数可能被截成非法 JSON，绝不能拿去执行
        const nothingUseful = !result.content && result.toolCalls.length === 0
        if (
          result.finishReason === 'insufficient_system_resource' &&
          nothingUseful &&
          resourceRetries < MAX_RESOURCE_RETRIES
        ) {
          resourceRetries++
          onEvent({
            type: 'notice',
            level: 'info',
            message: t('{0}，正在自动重试（第 {1} 次）…', abnormal, resourceRetries),
          })
          continue
        }
        onEvent({
          type: 'notice',
          level: 'warn',
          message: t(
            '{0}。本轮内容可能不完整{1}，可回复「继续」让我接着完成。',
            abnormal,
            result.toolCalls.length ? t('（未执行的工具调用已丢弃）') : '',
          ),
        })
        onEvent({ type: 'done' })
        return
      }

      if (result.toolCalls.length) {
        /*
         * 回填历史前先把参数消毒成合法 JSON（见 sanitizeArgs）。工具卡片事件里
         * 存的也必须是同一份：它就是下一轮历史还原的来源——两边差一个字符，
         * 服务端的前缀缓存就从那条消息起整段作废。
         */
        const toolCalls = result.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: sanitizeArgs(tc.arguments),
        }))
        // 把 assistant 的这次回复（含工具调用）写回历史，再逐条执行工具
        messages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        })
        /** 本次执行里工具附带回的图片（去重后），见下面的挂图说明 */
        const attached: MessageImage[] = []
        const seen = new Set<string>()
        for (const tc of toolCalls) {
          onEvent({ type: 'tool-call', id: tc.id, name: tc.name, args: tc.arguments })
          const r = await runTool(opts.tools, tc.name, tc.arguments, ctx)
          onEvent({
            type: 'tool-result',
            id: tc.id,
            name: tc.name,
            result: r.content,
            ok: r.ok,
            ...(r.images?.length ? { images: r.images } : {}),
          })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: r.content })
          for (const img of r.images ?? []) {
            if (seen.has(img.id) || attached.length >= MAX_TOOL_IMAGES) continue
            seen.add(img.id)
            attached.push(img)
          }
        }
        /**
         * 图片走**单独一条 user 消息**，排在本次全部 tool 结果之后。
         *
         * 为什么不塞进 tool 消息里：四家协议的 tool 结果都只走纯文本
         * （见 ai/types 的类型说明与各适配器里的 plainText 调用），塞进去会被静默丢掉，
         * 模型拿到的是一句「图已附上」却什么也看不见。
         * 顺序也不能改：tool 消息必须紧跟 assistant.tool_calls，图片只能排在它们后面。
         */
        if (attached.length && opts.loadImages) {
          const table = await opts.loadImages(attached)
          const parts = attached
            .map((img) => {
              const data = table.get(img.id)
              return data ? imagePart(data.mime, data.data) : null
            })
            .filter((p): p is ReturnType<typeof imagePart> => p !== null)
          if (parts.length) {
            messages.push({ role: 'user', content: [textPart(TOOL_IMAGE_NOTE), ...parts] })
          }
        }
        resourceRetries = 0
        // ask / wait 这类 api 会一直等到用户动作；用户此刻点了「停止」就直接收场，
        // 不再把 abort 之后的几跳继续跑完
        if (signal?.aborted) {
          onEvent({ type: 'done' })
          return
        }
        /*
         * 介入通道：当前这条消息（连同工具结果）已经完整。有指令就作为一条 user
         * 消息插进历史——模型下一跳先看到它再继续；没有就照常进下一跳。
         */
        if (opts.injections) {
          const injected = await opts.injections()
          if (injected !== null) messages.push({ role: 'user', content: injected })
        }
        /*
         * 跳边界：这一跳到此为止，下面开始的是下一跳。它只服务于历史还原——
         * parts 是扁平的事件流，「同一跳的两次调用」与「相邻两跳」长得一样，
         * 只有这里分得清（见 agent/types 的 hop 说明）。
         * 只在真要进入下一跳时发：insufficient_system_resource 的重试不 push 任何消息，
         * 发了就会凭空多出一段空的跳。
         */
        onEvent({ type: 'hop' })
        continue
      }

      /*
       * 没有工具调用本该收场；但介入通道里还挂着指令时，把它当成新的一轮：
       * 这条最终消息此刻才补进历史（正常收场时不进——循环要继续就必须进，镜像才对得上），
       * 指令作为 user 消息跟在后面，模型据此调整方向接着干。
       */
      if (opts.injections) {
        const injected = await opts.injections()
        if (injected !== null) {
          if (result.content) messages.push({ role: 'assistant', content: result.content })
          messages.push({ role: 'user', content: injected })
          onEvent({ type: 'hop' })
          continue
        }
      }
      // 没有工具调用即本轮任务收敛，正常收场
      onEvent({ type: 'done' })
      return
    }
  } catch (err) {
    if (signal?.aborted) {
      onEvent({ type: 'done' })
      return
    }
    onEvent({ type: 'error', message: err instanceof Error ? err.message : t('AI 请求失败') })
  }
}

/**
 * 回填给 API 的工具参数必须是合法 JSON 字符串，否则下一次请求会被服务端拒绝。
 * 正常的参数原样回填；被截断等异常情况下退回空对象，让工具照常报「参数不是合法 JSON」。
 */
function sanitizeArgs(raw: string): string {
  try {
    JSON.parse(raw)
    return raw
  } catch {
    return '{}'
  }
}
