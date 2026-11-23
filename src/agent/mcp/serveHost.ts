/**
 * 对外 MCP 服务的渲染层宿主：外部 harness（ZCode / Claude Code 等）经命名管道
 * → 主进程 → 'mcpServe:call' 来到这里的 **guest 会话**。工具清单见
 * shared/mcpServeTools（单一事实源，主进程 tools/list 与这里的分发共用）。
 *
 * 为什么 guest 能复用整个沙箱：应用的 agent 是「单工具 execute」哲学——
 * learnSandboxOps（与一轮对话、超级文档桥同一个装配点）+ subsetSandbox
 * （与 work 的 guest 同一把裁剪刀）+ createExecuteTools（与真沙箱同一条 Worker 通道，
 * 每次编排一个 Worker、15 秒上限）。唯一的新决定是白名单：MCP_ALLOWED_GROUPS
 * 与 work 同级（见下），ask/ui/exam/permission/wf/work/chat/mcp 这些「role 层」
 * 的能力一律不对外——要开放得先有对应的审批面。
 *
 * 串行纪律：内部 agent 与 guest 会话会并发改同一份 store，而沙箱只在**一次
 * 编排内**串行。guest 的工具调用在这里排成一条队列（一次跑完才跑下一次），
 * 交叉写坏状态的可能被掐在源头。
 *
 * goalId 的落点：guest 没有会话上下文，取 store.activeGoalId（用户此刻正开着
 * 的目标）——外部 harness 操作的就是用户眼前这份数据；没有活动目标时为空串，
 * 需要 goal 的 api（memory 等）会自己把「没有目标」报出来。
 *
 * 开关与调用记录：设置（agent settings 的 mcpServe.enabled）是事实源，安装时
 * 读一次、面板切换时经 setMcpServeEnabled 写回来并推给主进程启停管道；每次调用
 * 记一条进环形日志（设置页面板经 useSyncExternalStore 读）。
 */
import { learnSandboxOps } from '../../learn/agent/sandboxOps'
import { createMemoryOps } from '../../learn/memory'
import type { LearnStore } from '../../learn/types'
import { native } from '../../lib/native'
import { loadAgentSettings } from '../settings'
import { subsetSandbox } from '../sandbox/subset'
import { renderApiHelp, renderGroupHelp, renderRootHelp } from '../sandbox/apiRegistry'
import { createExecuteTools, type SandboxOptions } from '../tools'
import type { AgentContext } from '../types'
import type { McpServeCall, McpServeReply } from '../../../shared/ipc'

/**
 * guest 会话开放的 api 组：与 work 白名单同级而刻意分开抄——两条名单将来会按各自的
 * 审批面演化（比如 MCP 侧将来带审批地开 ui）。名单里的每个组都必须是 apiRegistry 的
 * 真实组 key（与 work 名单同一条对账纪律）。
 */
const MCP_ALLOWED_GROUPS = ['web', 'tmp', 'node', 'memory', 'workspace'] as const

/** 服务是否开放：设置是事实源，安装时读一次、面板切换时写回来 */
let enabled = true

/** 调用日志里的一条（设置页「对外 MCP 服务」面板展示） */
export interface McpServeLogEntry {
  /** 调用开始时间（Date.now()） */
  at: number
  tool: string
  /** execute 的 description（面板里的人话行） */
  description: string
  ms: number
  /** 工具级成败（isError 的反面） */
  ok: boolean
}

/** 快照整体替换（useSyncExternalStore 靠引用判变化），最近的在最前，上限 50 条 */
let logSnapshot: readonly McpServeLogEntry[] = []
const logListeners = new Set<() => void>()
const notifyLog = (): void => {
  for (const l of [...logListeners]) l()
}

export function getMcpServeLog(): readonly McpServeLogEntry[] {
  return logSnapshot
}

export function subscribeMcpServeLog(listener: () => void): () => void {
  logListeners.add(listener)
  return () => {
    logListeners.delete(listener)
  }
}

/**
 * 面板开关的运行面落点：更新渲染层闸门 + 推给主进程启停管道（端点文件随之出现/消失）。
 * 设置本身的持久化走 saveAgentSettings（面板 onChange），这里不管。
 */
export function setMcpServeEnabled(on: boolean): void {
  enabled = on
  try {
    void native().mcpServe.setEnabled(on)
  } catch {
    // 非 Electron 环境没有主进程可推：渲染层闸门照常生效
  }
}

/** 当前挂载的卸载函数（单例：重挂自动卸旧换新，LearnWorkspace 一次挂载只装一份） */
let activeDisposer: (() => void) | null = null

export function installMcpServeHost(io: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
}): () => void {
  activeDisposer?.()
  activeDisposer = null

  // 开机对齐：把设置里的开关推给主进程（用户关过的话，P0 时代默认起的管道在这里收掉）
  enabled = loadAgentSettings().mcpServe?.enabled !== false
  try {
    void native().mcpServe.setEnabled(enabled)
  } catch {
    // 非 Electron 环境没有主进程
  }

  const goalId = (): string => io.getLatest().activeGoalId ?? ''
  const base = learnSandboxOps({
    getLatest: io.getLatest,
    set: io.set,
    // guest 没有会话上下文：没有「当前节点」，目标跟随用户此刻正开着的那一个
    nodeId: () => null,
    goalId,
  })
  // memory 组由一轮宿主注入（createAgentOps 不管它）：与 toolRig 同款装配
  base.memory = createMemoryOps({ getLatest: io.getLatest, set: io.set, goalId })
  // 与 work 同一把裁剪刀：名单外的东西根本不注入，通道口还有 apiAllow 硬闸
  const [execute] = createExecuteTools(subsetSandbox(base as SandboxOptions, [...MCP_ALLOWED_GROUPS]))

  const run = async (call: McpServeCall): Promise<McpServeReply> => {
    const startedAt = Date.now()
    const finish = (content: string, isError: boolean): McpServeReply => {
      logSnapshot = [
        {
          at: startedAt,
          tool: call.tool,
          description: String(call.args?.description ?? '').slice(0, 80),
          ms: Date.now() - startedAt,
          ok: !isError,
        },
        ...logSnapshot,
      ].slice(0, 50)
      notifyLog()
      return { requestId: call.requestId, content, isError }
    }
    try {
      if (!enabled) {
        return finish('对外 MCP 服务已在设置里关闭（超级导师设置 → 对外 MCP 服务）。', true)
      }
      if (call.tool === 'execute') {
        // ctx 在 executeBody 里只用于轮次上下文，guest 没有：类型上必填，运行时不用
        const res = await execute.run(
          { description: call.args?.description, body: call.args?.body },
          undefined as unknown as AgentContext,
        )
        return finish(res.content, !res.ok)
      }
      if (call.tool === 'api_manual') {
        const target = String(call.args?.target ?? '').trim()
        const text =
          !target || target === 'root'
            ? renderRootHelp()
            : target.includes('.')
              ? renderApiHelp(target)
              : renderGroupHelp(target)
        return finish(text, false)
      }
      return finish('没有这个工具：' + call.tool + '。可用：execute、api_manual（见 tools/list）。', true)
    } catch (err) {
      return finish('工具执行失败：' + (err instanceof Error ? err.message : String(err)), true)
    }
  }

  /** 串行队列：一次编排跑完才跑下一次（见文件头串行纪律） */
  let tail: Promise<unknown> = Promise.resolve()
  const disposer = native().mcpServe.onCall((call) => {
    const next = tail.then(
      () => run(call),
      () => run(call),
    )
    tail = next
    void next
      .then((reply) => native().mcpServe.reply(reply))
      .catch((err) => {
        // 队列层不该有错误，兜一条：保证每个 requestId 都有回执（主进程在等）
        native().mcpServe.reply({
          requestId: call.requestId,
          content: '工具执行失败：' + (err instanceof Error ? err.message : String(err)),
          isError: true,
        })
      })
  })
  activeDisposer = disposer
  return () => {
    if (activeDisposer === disposer) activeDisposer = null
    disposer()
  }
}
