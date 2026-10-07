/**
 * 子代理的宿主管理器：一段导师对话一个实例（useAgent 按 conversationId 持有，跨轮存活）。
 *
 * 并发模型（2026-10-02 起）：run / resume 把 agent loop **放到后台**、api 调用立即返回，
 * 多个子代理因此真正并发；导师在 execute 脚本里用 wait 收交付——
 * - 有挂起交付：立即全部返回；
 * - 有在跑的：监听全部，**任何一个先完成就返回它**（附带仍在跑的清单）；
 *   到了给定的最大时长还没人交付就返回 timedOut（导师据此 查看 → 介入或再等一轮）；
 * - 既没有挂起也没有在跑：立即返回空。
 * 交付时没有 wait 在听就进挂起队列——绝不丢，也不堵 agent。
 *
 * 会话账本仍住在 Conversation.subagents 上（随 chat.json 落盘、随对话删除消失）；
 * 管理器自己只留内存态：在跑的句柄、挂起交付、等待者。进程被杀后「在跑的」复位为
 * 「被中断」（registry 的载入归一化），挂起交付与等待者随进程消失。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import type { AgentEvent, AgentPart, MessageUsage } from '../types'
import { resetPrefixGate } from '../prefixGate'
import { createExecuteTool } from '../sandbox/execute'
import type { SandboxOptions, SubAgentSandboxApi, SubWaitDelivery, SubWaitResult, SubWaitRunning } from '../sandbox/types'
import { asText } from '../sandbox/refs'
import { apiBriefForGroups, SUBAGENT_ALLOWED_GROUPS } from './groups'
import {
  createSession,
  sessionOf,
  withAssistantFlush,
  withRunOutcome,
  withRunning,
  withTaskMessage,
  withUserMessage,
} from './registry'
import { runSubAgentTask, type SubRunOutcome } from './runner'
import type { SubAgentBucket, SubAgentDef, SubAgentSession } from './types'

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

/** 一次 run / resume 启动那一刻的模型配置与沙箱基座（此后这场任务用这份跑完，不随换轮漂移） */
export interface SubTurnConfig {
  sandbox: SandboxOptions
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow: number
}

export interface SubAgentManagerDeps {
  getBucket: () => SubAgentBucket
  setBucket: (update: (prev: SubAgentBucket) => SubAgentBucket) => void
  /** 子代理事件转发（面板实时渲染子会话的流式输出；并发时多场并行） */
  onEvent?: (sessionId: string, runId: string, e: AgentEvent) => void
  /** 一次任务结束（无论成败）：宿主清掉那一场的实时槽 */
  onRunEnd?: (sessionId: string, runId: string) => void
  /** 一场任务开始跑：宿主据此把它的页签开好（agent 栏页签化后，子代理从页签看） */
  onRunStart?: (sessionId: string, runId: string) => void
  /** 测试注入替身流 */
  stream?: StreamFn
}

interface RunHandle {
  runId: string
  defKey: string
  name: string
  ctrl: AbortController
  /** 介入队列：intervene 塞进来，循环在「当前消息完整」的边界取走 */
  injections: string[]
}

interface Waiter {
  resolve: (r: SubWaitResult) => void
  timer: ReturnType<typeof setTimeout>
}

export interface SubAgentManager {
  api: SubAgentSandboxApi
  /** 更新这一轮的模型配置与沙箱基座（每轮 runTurn 现调；已在跑的任务不受影响） */
  setTurn(config: SubTurnConfig): void
  /** 用户点「停止」：中断当前所有在跑的子代理，等待者当场放行 */
  abortAll(): void
}

export function createSubAgentManager(deps: SubAgentManagerDeps): SubAgentManager {
  /** 在跑的句柄（sessionId → handle）：并发的多场任务都在这里 */
  const running = new Map<string, RunHandle>()
  /** 交付时没人在听的挂起队列（下一次 wait 一起领走） */
  const pending: SubWaitDelivery[] = []
  /** 正在 wait 的等待者：任何一个 run 收口就唤醒排得最前面的那位 */
  const waiters: Waiter[] = []
  let turn: SubTurnConfig | null = null

  const setTurn = (config: SubTurnConfig): void => {
    turn = config
  }

  /**
   * 寻址：key 优先，name 作别名（导师常把更显眼的 name 抄进 agent 参数，实测反馈 2026-10-02）。
   * 同名多定义是歧义，拒并列出候选；完全没命中时把 key（name）清单报出来——与 node 寻址
   * 「找不到就列候选」同一套直觉，不退化为笼统提示。
   */
  const resolve = (raw: unknown): { def?: SubAgentDef; session?: SubAgentSession; error?: string } => {
    const addr = asText(raw).trim()
    const b = deps.getBucket()
    const byKey = b.defs.find((d) => d.key === addr)
    if (byKey) return { def: byKey, session: sessionOf(b, byKey.key) }
    const byName = b.defs.filter((d) => d.name === addr)
    if (byName.length === 1) return { def: byName[0]!, session: sessionOf(b, byName[0]!.key) }
    if (byName.length > 1) {
      return {
        error:
          '「' + addr + '」是 ' + byName.length + ' 个子代理的显示名（' +
          byName.map((d) => d.key + '（' + d.name + '）').join('、') + '）。用 key 指名你要的哪一个。',
      }
    }
    const known = b.defs.map((d) => d.key + '（' + d.name + '）').join('、') || '（一个都没有）'
    return {
      error:
        '没有叫「' + addr + '」的子代理。已登记的：' + known + '。' +
        '地址认 key（name 是显示名，碰巧同名也能对上）；没有就先 create({ key, system, tools? }) 登记。',
    }
  }

  const saveSession = (next: SubAgentSession): void => {
    deps.setBucket((prev) => {
      const exists = prev.sessions.some((s) => s.id === next.id)
      return {
        ...prev,
        sessions: exists ? prev.sessions.map((s) => (s.id === next.id ? next : s)) : [...prev.sessions, next],
      }
    })
  }

  /** 把跑到此刻的 parts 固化成一条 assistant 消息（介入插入前 / 任务收口时各一次） */
  const flush = (sessionId: string, parts: AgentPart[], usage?: MessageUsage): void => {
    if (!parts.length) return
    deps.setBucket((prev) => {
      const s = prev.sessions.find((x) => x.id === sessionId)
      if (!s) return prev
      return {
        ...prev,
        sessions: prev.sessions.map((x) => (x.id === sessionId ? withAssistantFlush(s, parts, usage) : x)),
      }
    })
  }

  /** 介入的指令作为一条 user 消息进会话账本 */
  const appendUser = (sessionId: string, text: string): void => {
    deps.setBucket((prev) => {
      const s = prev.sessions.find((x) => x.id === sessionId)
      if (!s) return prev
      return {
        ...prev,
        sessions: prev.sessions.map((x) => (x.id === sessionId ? withUserMessage(s, text).session : x)),
      }
    })
  }

  const runningList = (): SubWaitRunning[] => [...running.values()].map((h) => ({ agent: h.defKey, name: h.name }))

  /** 启动一场任务：句柄登记 + 状态置 running + 后台驱动（不 await——并发的根） */
  const startLoop = (def: SubAgentDef, session: SubAgentSession): void => {
    const handle: RunHandle = {
      runId: crypto.randomUUID(),
      defKey: def.key,
      name: def.name,
      ctrl: new AbortController(),
      injections: [],
    }
    running.set(session.id, handle)
    saveSession(withRunning(session, true))
    deps.onRunStart?.(session.id, handle.runId)
    void drive(def, session, handle)
  }

  const drive = async (def: SubAgentDef, session: SubAgentSession, handle: RunHandle): Promise<void> => {
    // 配置在启动那一刻现取（闭包里的 turn 会被下一轮 setTurn 换掉，先固定住）
    const cfg = turn
    if (!cfg) {
      finishRun(def, session.id, handle, {
        status: 'error',
        delivery: null,
        parts: [],
        usage: null,
        error: '子代理管理器没有可用的轮次配置',
      })
      return
    }
    let outcome: SubRunOutcome
    try {
      outcome = await runSubAgentTask({
        def,
        sessionId: session.id,
        // 启动那一刻的会话消息（含刚追加的任务）——之后长出来的部分由介入通道同步
        messages: session.messages,
        tools: [createExecuteTool(subsetSandbox(cfg.sandbox, def.apiGroups))],
        provider: cfg.provider,
        model: cfg.model,
        ...(cfg.effort ? { effort: cfg.effort } : {}),
        contextWindow: cfg.contextWindow,
        signal: handle.ctrl.signal,
        onEvent: (e) => deps.onEvent?.(session.id, handle.runId, e),
        injections: {
          pull: () => handle.injections.shift() ?? null,
          flush: (ps) => flush(session.id, ps),
          append: (text) => appendUser(session.id, text),
        },
        ...(deps.stream ? { stream: deps.stream } : {}),
      })
    } catch (err) {
      // runAgent 自己兜住了模型侧的绝大多数错误；能抛到这里的是装配层的问题。
      const message = err instanceof Error ? err.message : '子代理执行失败'
      outcome = {
        status: 'error',
        delivery: null,
        parts: [{ type: 'notice', level: 'warn', text: message }],
        usage: null,
        error: message,
      }
    }
    finishRun(def, session.id, handle, outcome)
  }

  const finishRun = (def: SubAgentDef, sessionId: string, handle: RunHandle, outcome: SubRunOutcome): void => {
    running.delete(sessionId)
    // 收口落库：最后一段 parts 固化成回复消息（usage 记在它身上），状态与次数随后落账
    const issue =
      outcome.error ??
      (outcome.status === 'interrupted'
        ? '任务被中止，没有交付'
        : outcome.status === 'incomplete'
          ? '输出提前结束，交付可能不完整'
          : undefined)
    deps.setBucket((prev) => {
      const s = prev.sessions.find((x) => x.id === sessionId)
      if (!s) return prev
      let next = withAssistantFlush(s, outcome.parts, outcome.usage ?? undefined)
      next = withRunOutcome(next, {
        status: outcome.status === 'complete' || outcome.status === 'incomplete' ? 'idle' : outcome.status,
        delivery: outcome.delivery,
        ...(issue ? { issue } : {}),
      })
      return { ...prev, sessions: prev.sessions.map((x) => (x.id === sessionId ? next : x)) }
    })
    deps.onRunEnd?.(sessionId, handle.runId)
    // 迟到的介入指令没有消费者了：中断一路都是丢弃（用户已经叫停），正常收口的都已被边界取走
    handle.injections.length = 0
    // 交付交给排得最前的等待者；没人在听就挂起（绝不丢）。会话已被删掉的交付无处安放，直接扔。
    if (!deps.getBucket().defs.some((d) => d.key === def.key)) return
    const entry: SubWaitDelivery = {
      agent: def.key,
      name: def.name,
      delivery: outcome.delivery,
      status: outcome.status,
      ...(issue ? { issue } : {}),
    }
    const waiter = waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.resolve({ deliveries: [entry], running: runningList() })
    } else {
      pending.push(entry)
    }
  }

  const api: SubAgentSandboxApi = {
    create: (raw) => {
      const key = asText(raw.key).trim()
      if (!KEY_PATTERN.test(key)) {
        return { error: 'key 不合法：字母开头，后面用字母/数字/-/_，32 字以内。' }
      }
      const system = asText(raw.system).trim()
      if (system.length < 20) {
        return { error: 'system 太短（' + system.length + ' 字）：它是子代理唯一的角色说明，把角色、工作方式、交付纪律写清楚。' }
      }
      const rawGroups = Array.isArray(raw.tools) ? raw.tools.map((x) => asText(x).trim()).filter(Boolean) : []
      const groups = [...new Set(rawGroups.length ? rawGroups : ['web', 'tmp'])]
      const invalid = groups.filter((g) => !(SUBAGENT_ALLOWED_GROUPS as readonly string[]).includes(g))
      if (invalid.length) {
        return { error: 'api 组不认识：' + invalid.join('、') + '。可选的只有：' + SUBAGENT_ALLOWED_GROUPS.join('、') + '。' }
      }
      const name = asText(raw.name).trim() || key
      const def: SubAgentDef = { key, name, system, apiGroups: groups }
      const prev = deps.getBucket().defs.find((d) => d.key === key)
      if (prev && prev.system !== system) {
        const session = sessionOf(deps.getBucket(), key)
        if (session) {
          // 换提示词 = 设计内的前缀重写：门禁账重置，下一次任务从新前缀记起
          resetPrefixGate('sub:' + session.id)
        }
      }
      deps.setBucket((p) => ({
        ...p,
        defs: p.defs.some((d) => d.key === key) ? p.defs.map((d) => (d.key === key ? def : d)) : [...p.defs, def],
      }))
      return {
        ok: true,
        key,
        name,
        apiGroups: groups,
        ...(prev
          ? {
              note:
                '⚠️ 已覆盖同 key 的旧定义；会话上下文保留，新提示词从下一次任务起生效。' +
                '一个 key 同一时刻只跑一个任务，要并发请建多个 key。',
            }
          : {
              note:
                '已登记（只登记、未启动）。下一步：run({ agent: "' + key + '", task }) 派任务——地址认 key' +
                '（name 是显示名，碰巧写 name 也能对上）。一个 key 同一时刻只跑一个任务，要并发就建多个 key 再一起 run。',
            }),
      }
    },

    run: (args) => {
      const task = asText(args.task).trim()
      if (!task) {
        return { error: 'run 需要一段 task：要做什么、什么口径、交付什么格式，写全（子代理看不到你们的对话）。' }
      }
      const found = resolve(args.agent)
      if (found.error) return { error: found.error }
      const def = found.def!
      const session = found.session
      if (session && running.has(session.id)) {
        return { error: '「' + def.key + '」正在跑：用 wait 收它的交付，或先 interrupt。' }
      }
      const withTask = withTaskMessage(session ?? createSession(def), task)
      startLoop(def, withTask.session)
      return { ok: true, agent: def.key, note: '已启动，在后台跑。用 wait({ seconds }) 收交付（记得给最大时长）。' }
    },

    resume: (key) => {
      const found = resolve(key)
      if (found.error) return { error: found.error }
      const def = found.def!
      const session = found.session
      if (!session) return { error: '「' + def.key + '」还没跑过任何任务，没有可恢复的上下文。派任务用 run。' }
      if (running.has(session.id)) return { error: '「' + def.key + '」正在跑，无需恢复。' }
      if (session.status !== 'interrupted') {
        return { error: '它没有可恢复的任务（当前状态：' + session.status + '）。派新任务用 run。' }
      }
      startLoop(def, session)
      return { ok: true, agent: key, note: '已从断点继续（上下文保留，不加新指令）。用 wait 收交付。' }
    },

    intervene: (key, instruction) => {
      const text = (instruction ?? '').trim()
      if (!text) return { error: '介入需要一段指令：告诉它往哪调整。' }
      const found = resolve(key)
      if (found.error) return { error: found.error }
      const handle = found.session ? running.get(found.session.id) : undefined
      if (!handle) {
        return { error: '「' + found.def!.key + '」没有在跑：介入只对运行中的 agent 有意义。派任务用 run，恢复用 resume。' }
      }
      handle.injections.push(text)
      return { ok: true, agent: key, queued: handle.injections.length, note: '已排队：等它当前这条消息输出完整后就插入（绝不打断半截输出）。' }
    },

    interrupt: (key) => {
      const found = resolve(key)
      if (found.error) return { error: found.error }
      const handle = found.session ? running.get(found.session.id) : undefined
      if (!handle) return { error: '「' + found.def!.key + '」没有在跑。' }
      handle.ctrl.abort()
      return { ok: true, agent: found.def!.key, note: '已请求中断（上下文保留，之后可 resume）。中断在下一个边界生效；wait 会领回中断回执。' }
    },

    view: (key) => {
      const found = resolve(key)
      if (found.error) return { error: found.error }
      const def = found.def!
      const session = found.session
      const handle = session ? running.get(session.id) : undefined
      const recent = (session?.messages ?? []).slice(-8).map((m) => ({
        role: m.role,
        text: m.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p as { text: string }).text)
          .join(' ')
          .trim()
          .slice(0, 200),
        ...(m.parts.some((p) => p.type === 'tool')
          ? { tools: m.parts.filter((p) => p.type === 'tool').map((p) => (p as { name?: string }).name ?? 'execute') }
          : {}),
      }))
      return {
        ok: true,
        agent: def.key,
        name: def.name,
        status: handle ? 'running' : (session?.status ?? 'idle'),
        runs: session?.runs ?? 0,
        apiGroups: def.apiGroups,
        queuedInstructions: handle?.injections.length ?? 0,
        ...(session?.lastDelivery ? { lastDelivery: session.lastDelivery } : {}),
        ...(session?.lastIssue ? { lastIssue: session.lastIssue } : {}),
        recent,
        note: 'recent 是最近的过程（判断是不是在钻牛角尖看这里）：确实在打转就 intervene 纠偏，走得正常就再发起一轮 wait。',
      }
    },

    remove: (key) => {
      const found = resolve(key)
      if (found.error) return { error: found.error }
      const def = found.def!
      const session = found.session
      const wasRunning = session ? running.has(session.id) : false
      if (session) {
        const handle = running.get(session.id)
        if (handle) handle.ctrl.abort()
      }
      deps.setBucket((prev) => ({
        defs: prev.defs.filter((d) => d.key !== def.key),
        sessions: prev.sessions.filter((s) => s.defKey !== def.key),
      }))
      // 挂起队列里它的交付一并清掉：会话都没了，交付无处安放
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].agent === def.key) pending.splice(i, 1)
      return { ok: true, agent: def.key, note: '已删除定义与会话' + (wasRunning ? '（正在跑的那场已中断）' : '') + '。' }
    },

    wait: (args) => {
      const raw = typeof args.seconds === 'number' ? args.seconds : Number(args.seconds)
      if (!Number.isFinite(raw) || raw <= 0) {
        return Promise.resolve({
          error: 'wait 需要一个正的 seconds（本次愿意等多少秒，按任务难度定）。没有最大时长，监督回路就无从谈起。',
          deliveries: [],
          running: [],
        })
      }
      const seconds = Math.min(600, Math.max(1, Math.round(raw)))
      // 有挂起交付：不管时长，立即把积压的一起清空返回
      if (pending.length) return Promise.resolve({ deliveries: pending.splice(0), running: runningList() })
      // 既没有挂起也没有在跑：立即返回空（不阻塞、不报错）
      if (!running.size) {
        return Promise.resolve({ deliveries: [], running: [], note: '当前没有在跑的子代理，也没有挂起的交付。' })
      }
      // 有在跑的：监听全部——任何一个先完成就返回它；到点没人交付就返回超时
      return new Promise<SubWaitResult>((resolve) => {
        const w = {} as Waiter
        w.timer = setTimeout(() => {
          const i = waiters.indexOf(w)
          if (i >= 0) waiters.splice(i, 1)
          resolve({ deliveries: [], running: runningList(), timedOut: true })
        }, seconds * 1000)
        w.resolve = resolve
        waiters.push(w)
      })
    },
  }

  const abortAll = (): void => {
    for (const h of running.values()) h.ctrl.abort()
    // 等待者当场放行：各场的「已中断」回执随后进挂起队列，下一次 wait 领走
    const ws = waiters.splice(0)
    for (const w of ws) {
      clearTimeout(w.timer)
      w.resolve({ deliveries: [], running: [], aborted: true, note: '用户停止了这一轮，所有在跑的子代理已被中断。' })
    }
  }

  return { api, setTurn, abortAll }
}

/**
 * 从导师的沙箱基座里按 apiGroups 取子集：**没开放的东西根本不注入**（buildApi 按
 * 「注入了才有」装配），再叠加通道口的硬白名单（apiAllow）与按需的参数说明（apiBrief）。
 * doc / node 的寻址与读写是必需的基座（buildApi 无条件装配它们），由 apiAllow 挡住越权调用。
 * subagent 字段刻意不透传：子代理的 api 面里永远没有 subagent.*（不递归在装配层就断了）。
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
