/**
 * 导师侧的子代理工具：agent_define（登记自定义子代理）/ agent_run（派活并等交付）/
 * agent_list（看有哪些会话）。
 *
 * 「父等子」就落在 agent_run 的形状上：它是一个普通工具，导师的循环在工具返回前
 * 不会前进——交付文本作为工具结果回填进导师上下文，中间过程一概不带出来。
 * 同一轮派多个 agent_run 会按序执行，全部完成后导师才继续。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import type { AgentEvent, AgentTool } from '../types'
import { resetPrefixGate } from '../prefixGate'
import { clip } from '../sandbox/api'
import { createExecuteTool } from '../sandbox/execute'
import type { SandboxOptions } from '../sandbox/types'
import { asText } from '../sandbox/refs'
import { apiBriefForGroups, BUILTIN_SUBAGENTS, findBuiltinSubAgent, SUBAGENT_ALLOWED_GROUPS } from './builtin'
import { createSession, sessionOf, withFreshContext, withRunResult, withRunning, withTaskMessage, type SubRunRecord } from './registry'
import { runSubAgentTask, type SubRunOutcome } from './runner'
import type { SubAgentBucket, SubAgentDef, SubAgentSession } from './types'

/** 导师这一轮装配子代理工具需要的全部能力（由 useAgent 注入） */
export interface SubAgentToolDeps {
  conversationId: string
  /**
   * 导师这一轮的沙箱基座（learnSandboxOps 的产物）。子代理按定义的 apiGroups
   * 从它取子集——「execute 按需开放」的来源，不另建第二套能力。
   */
  sandbox: SandboxOptions
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow: number
  /** 导师这一轮的中止信号：用户点「停止」，正在跑的子代理级联退场 */
  signal: AbortSignal
  /**
   * 本对话的子代理桶（defs + sessions）现读：工具执行回调里永远读到最新的一份
   * （桶住在 Conversation.subagents 上、随 chat.json 落盘——写回由 setBucket 做）。
   */
  getBucket: () => SubAgentBucket
  /** 桶的写回：函数式更新，宿主落进对话并持久化（会话切换 / 落库并发都安全） */
  setBucket: (update: (prev: SubAgentBucket) => SubAgentBucket) => void
  /** 子代理事件转发（面板实时渲染子会话的流式输出） */
  onEvent?: (sessionId: string, runId: string, e: AgentEvent) => void
  /** 一次任务结束（无论成败）：宿主清掉实时槽 */
  onRunEnd?: (sessionId: string, runId: string) => void
  /** 测试注入替身流 */
  stream?: StreamFn
}

const DEFINE_PARAMETERS = {
  type: 'object',
  properties: {
    key: {
      type: 'string',
      description:
        '这个子代理的标识（agent_run 的 agent 参数就写它）。字母开头，字母/数字/-/_，32 字以内；内置的 key（如 web-search）不可占用。',
    },
    name: { type: 'string', description: '显示名（几个字，界面的会话列表用）' },
    system: {
      type: 'string',
      description:
        '它的系统提示词：角色、工作方式、**交付纪律**（它的最后一条回复是唯一能回到你手里的东西，必须自包含、详细）。',
    },
    tools: {
      type: 'array',
      items: { type: 'string' },
      description:
        '它 execute 里开放的 api 组。可选：web / tmp / res / doc / node / outline / mind / workspace / reading / attention。不给时默认 web + tmp。',
    },
  },
  required: ['key', 'system'],
  additionalProperties: false,
}

const RUN_PARAMETERS = {
  type: 'object',
  properties: {
    agent: { type: 'string', description: '子代理的 key（内置 web-search，或 agent_define 登记过的）' },
    task: {
      type: 'string',
      description:
        '任务描述。要**自包含**：子代理看不到你们的对话——要查/做什么、什么口径、交付什么格式，全写在这里。',
    },
    fresh: { type: 'boolean', description: 'true = 清空它的上下文重开（缺省复用会话：它记得上次任务里读过的东西）' },
  },
  required: ['agent', 'task'],
  additionalProperties: false,
}

const LIST_PARAMETERS = { type: 'object', properties: {}, additionalProperties: false }

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

/** 导师这一轮的全部子代理工具（通常三个一起声明，每轮都一样——不破工具声明的稳定） */
export function createSubAgentTools(deps: SubAgentToolDeps): AgentTool[] {
  /** 把一次会话变更写回桶（函数式更新：宿主落进对话并持久化） */
  const saveSession = (next: SubAgentSession): void => {
    deps.setBucket((prev) => {
      const exists = prev.sessions.some((s) => s.id === next.id)
      const sessions = exists
        ? prev.sessions.map((s) => (s.id === next.id ? next : s))
        : [...prev.sessions, next]
      return { ...prev, sessions }
    })
  }

  const define: AgentTool = {
    name: 'agent_define',
    description:
      '登记一个自定义子代理（只在当前这段对话内有效）：给它系统提示词与可用的 api 组，之后用 agent_run 派活。' +
      '同 key 再登记即覆盖；内置子代理（web-search）不可覆盖、也无需登记。',
    parameters: DEFINE_PARAMETERS,
    run: async (args) => {
      const key = asText(args.key).trim()
      if (!KEY_PATTERN.test(key)) {
        return { ok: false, content: 'key 不合法：字母开头，后面用字母/数字/-/_，32 字以内。' }
      }
      if (findBuiltinSubAgent(key)) {
        return { ok: false, content: '「' + key + '」是内置子代理，提示词与 api 面不可改。换一个 key 登记你自己的。' }
      }
      const system = asText(args.system).trim()
      if (system.length < 20) {
        return { ok: false, content: 'system 太短（' + system.length + ' 字）：它是子代理唯一的角色说明，把角色、工作方式、交付纪律写清楚。' }
      }
      const rawGroups = Array.isArray(args.tools) ? args.tools.map((x) => asText(x).trim()).filter(Boolean) : []
      const groups = [...new Set(rawGroups.length ? rawGroups : ['web', 'tmp'])]
      const invalid = groups.filter((g) => !(SUBAGENT_ALLOWED_GROUPS as readonly string[]).includes(g))
      if (invalid.length) {
        return {
          ok: false,
          content: 'api 组不认识：' + invalid.join('、') + '。可选的只有：' + SUBAGENT_ALLOWED_GROUPS.join('、') + '。',
        }
      }
      const name = asText(args.name).trim() || key
      const def: SubAgentDef = { key, name, builtin: false, system, apiGroups: groups }
      let note = ''
      const bucket = deps.getBucket()
      const prev = bucket.defs.find((d) => d.key === key)
      if (prev) {
        const session = sessionOf(bucket, key)
        if (session && prev.system !== system) {
          // 换提示词 = 设计内的前缀重写：门禁账重置，下一次任务从新前缀记起
          resetPrefixGate('sub:' + session.id)
        }
        note = '（已覆盖同 key 的旧定义' + (session ? '，会话上下文保留，新提示词从下一次任务起生效' : '') + '）'
      }
      deps.setBucket((p) => {
        const defs = p.defs.some((d) => d.key === key) ? p.defs.map((d) => (d.key === key ? def : d)) : [...p.defs, def]
        return { ...p, defs }
      })
      return {
        ok: true,
        content:
          '子代理「' + name + '」（key: ' + key + '）已登记' + note + '。api 组：' + groups.join('、') +
          '。用 agent_run({ agent: "' + key + '", task: … }) 派活；任务描述要自包含。',
      }
    },
  }

  const run: AgentTool = {
    name: 'agent_run',
    description:
      '把一件活派给子代理并**等它做完**：它有自己独立的上下文与工具，跑完只把一份交付消息回给你——' +
      '中间过程不占你的上下文。同一 agent 的会话会复用（它记得上次任务里读过的东西）；fresh:true 才清空重开。' +
      '一轮里可以连续派多个，它们依次执行，全部完成后你才继续。',
    parameters: RUN_PARAMETERS,
    run: async (args) => {
      const key = asText(args.agent).trim()
      const task = asText(args.task).trim()
      if (!task) return { ok: false, content: 'agent_run 需要一段 task。子代理看不到你们的对话，把要做什么、什么口径、交付什么格式写全。' }
      const bucket = deps.getBucket()
      const def = findBuiltinSubAgent(key) ?? bucket.defs.find((d) => d.key === key)
      if (!def) {
        const known = [...BUILTIN_SUBAGENTS.map((d) => d.key), ...bucket.defs.map((d) => d.key)].join('、') || '（一个都没有）'
        return {
          ok: false,
          content: '没有叫「' + key + '」的子代理。现有的：' + known + '。自定义的要先 agent_define 登记再派。',
        }
      }
      let session = sessionOf(bucket, key)
      if (!session) session = createSession(def)
      if (args.fresh === true) {
        session = withFreshContext(session)
        resetPrefixGate('sub:' + session.id)
      }
      const withTask = withTaskMessage(session, task)
      session = withRunning(withTask.session, true)
      saveSession(session)

      // 级联中止：导师这一轮被停止时，正在跑的子代理当场退场。
      // 信号在进来之前就已经废了的话，监听器不会再收到事件，这里直接补一刀。
      const subCtrl = new AbortController()
      const onAbort = () => subCtrl.abort()
      if (deps.signal.aborted) subCtrl.abort()
      else deps.signal.addEventListener('abort', onAbort, { once: true })
      try {
        const runId = crypto.randomUUID()
        let outcome: SubRunOutcome
        try {
          outcome = await runSubAgentTask({
            def,
            sessionId: session.id,
            messages: withTask.session.messages,
            tools: [createExecuteTool(subsetSandbox(deps.sandbox, def.apiGroups))],
            provider: deps.provider,
            model: deps.model,
            effort: deps.effort,
            contextWindow: deps.contextWindow,
            signal: subCtrl.signal,
            onEvent: (e) => deps.onEvent?.(session.id, runId, e),
            ...(deps.stream ? { stream: deps.stream } : {}),
          })
        } catch (err) {
          // runAgent 自己兜住了模型侧的绝大多数错误；能抛到这里的是装配层的问题。
          // 记成一次失败的回复——绝不能让会话卡在「运行中」、实时槽悬着不收。
          const message = err instanceof Error ? err.message : '子代理执行失败'
          outcome = {
            status: 'error',
            delivery: null,
            parts: [{ type: 'notice', level: 'warn', text: message }],
            usage: null,
            error: message,
          }
        }
        const record: SubRunRecord = {
          runId,
          taskMessageId: withTask.message.id,
          parts: outcome.parts,
          usage: outcome.usage,
          status: outcome.status === 'complete' || outcome.status === 'incomplete' ? 'idle' : outcome.status,
          delivery: outcome.delivery,
          issue:
            outcome.error ??
            (outcome.status === 'interrupted'
              ? '任务被中止，没有交付'
              : outcome.status === 'incomplete'
                ? '输出提前结束，交付可能不完整'
                : undefined),
        }
        const done = withRunResult(session, record)
        saveSession(done)
        deps.onRunEnd?.(session.id, runId)

        const head = '【子代理交付 · ' + def.name + '】（key: ' + def.key + ' · 第 ' + done.runs + ' 次任务）\n\n'
        if (outcome.delivery) {
          const note =
            outcome.status === 'incomplete'
              ? '（注意：它的输出提前结束，这份交付可能不完整；再派一次任务可以让它接着写。）\n\n'
              : ''
          return { ok: true, content: clip(head + note + outcome.delivery) }
        }
        const why =
          outcome.status === 'interrupted'
            ? '任务被用户中止，没有交付。它的上下文还在：再派一次任务可以接着做，或用 fresh:true 重开。'
            : outcome.status === 'error'
              ? '执行失败：' + (outcome.error ?? '未知错误') + '。可以再试一次；反复失败就把任务拆小，或换个说法。'
              : '它结束了但没有交付正文（只有工具调用）。再派一次任务，明确要求把结果写成一段完整文字。'
        return { ok: false, content: head + why }
      } finally {
        deps.signal.removeEventListener('abort', onAbort)
      }
    },
  }

  const list: AgentTool = {
    name: 'agent_list',
    description: '列出当前的子代理定义与会话：key、名字、状态、任务次数、最近一次交付或问题。派活前不确定有哪些，先看一眼。',
    parameters: LIST_PARAMETERS,
    run: async () => {
      const bucket = deps.getBucket()
      const statusLabel = (s: SubAgentSession['status']): string =>
        s === 'running' ? '运行中' : s === 'interrupted' ? '上次被中断' : s === 'error' ? '上次出错' : '空闲'
      const lines: string[] = []
      for (const def of BUILTIN_SUBAGENTS) lines.push('- ' + def.key + '（' + def.name + '，内置）')
      for (const def of bucket.defs) lines.push('- ' + def.key + '（' + def.name + '，自定义）')
      for (const s of bucket.sessions) {
        const extra = s.lastDelivery
          ? '最近交付：' + s.lastDelivery
          : s.lastIssue
            ? '最近问题：' + s.lastIssue
            : ''
        lines.push(
          '  · 会话 ' + s.defKey + '：' + statusLabel(s.status) + '，' + s.runs + ' 次任务' + (extra ? '，' + extra : ''),
        )
      }
      const body = lines.length
        ? lines.join('\n')
        : '还没有任何子代理。内置的 web-search 可以直接派；自定义的先 agent_define 登记一个。'
      return { ok: true, content: body }
    },
  }

  return [define, run, list]
}

/**
 * 从导师的沙箱基座里按 apiGroups 取子集：**没开放的东西根本不注入**（buildApi 按
 * 「注入了才有」装配），再叠加通道口的硬白名单（apiAllow）与按需的参数说明（apiBrief）。
 * doc / node 的寻址与读写是必需的基座（buildApi 无条件装配它们），由 apiAllow 挡住越权调用。
 */
function subsetSandbox(base: SandboxOptions, groups: string[]): SandboxOptions {
  const has = (group: string): boolean => groups.includes(group)
  return {
    nodeId: base.nodeId,
    resolveNode: base.resolveNode,
    resolveDoc: base.resolveDoc,
    docOps: base.docOps,
    nodeOps: base.nodeOps,
    ...(has('tmp') && base.tmp ? { tmp: base.tmp } : {}),
    ...(has('res') && base.resources ? { resources: base.resources } : {}),
    ...(has('web') && base.web ? { web: base.web } : {}),
    ...(has('mind') && base.mind ? { mind: base.mind } : {}),
    ...(has('outline') && base.outline ? { outline: base.outline } : {}),
    ...(has('workspace') && base.workspace ? { workspace: base.workspace } : {}),
    ...(has('reading') && base.reading ? { reading: base.reading } : {}),
    ...(has('attention') && base.attention ? { attention: base.attention } : {}),
    // 执行器与超时跟着基座走：探针 / 测试注入的假执行器因此对子代理同样生效
    ...(base.runSandbox ? { runSandbox: base.runSandbox } : {}),
    ...(base.timeoutMs !== undefined ? { timeoutMs: base.timeoutMs } : {}),
    apiAllow: groups,
    apiBrief: apiBriefForGroups(groups),
  }
}
