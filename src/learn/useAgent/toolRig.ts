/**
 * useAgent 一轮的**工具装配**（从 useAgent.ts 原样搬出）：这一轮唯一的工具（execute）
 * 在这里拿到它的全部能力——沙箱基座（learnSandboxOps）、工作流排队（wf.invoke）、
 * 子代理、MCP 外部服务、人机协作表单（ask）与权限审批、考试、记忆、等待、提醒、
 * 界面操作（ui.*）、内置浏览器（browser.*），以及交付（delivery）的登记。
 *
 * 装配只在轮首做一次：本函数返回这一轮的中止器、工具数组、交付账与全局模型解析，
 * 轮次循环（streamLoop）与收口（turnClose）从返回值里取。
 */

import type { Dispatch, SetStateAction } from 'react'
import { createExecuteTool, type AskFormPayload, type ExamToolDeps } from '../../agent/tools'
import { ASK_IDLE_TIMEOUT_MS } from '../../agent/sandbox/limits'
import { ensureActivityListeners, userIdleMs } from '../../lib/userActivity'
import { type AiSettings, globalContextWindow, resolveGlobal } from '../../ai/settings'
import { applyAskToProfile, learnSandboxOps, type AgentRunTarget, type AgentUiDeps } from '../agent/sandboxOps'
import { makeMcpOps } from '../../agent/mcp/ops'
import { makePermissionOps } from '../../agent/permissions'
import { createMemoryOps } from '../memory'
import { makeExamTool } from '../agentOps'
import { saveScreenshot } from '../screenshots'
import { makeBrowserOps, type BrowserDeps } from '../web/browserOps'
import type { SubAgentManager } from '../../agent/subagent/manager'
import { emptyDelivery, mergeDelivery, normalizeDelivery } from '../../agent/delivery'
import { native } from '../../lib/native'
import { nodeById } from '../graph'
import { nodePathOf, resolveNode } from '../paths'
import type { LearnStore } from '../types'
import type { AgentSettings } from '../../agent/settings'

/**
 * wf.invoke 允许连着的触发次数（见 pendingWfRef 那一段）。
 *
 * 链本身是合法的编排：开讲 → 出卷 → 阅卷，一条跟着一条走。要防的是**无限的链**——
 * 一条指令里写着「做完再触发它自己」的工作流，会一轮接一轮地烧下去，而每一轮都要真花钱。
 * 三次之后再调就当场拒掉，并把话说给模型听（它该收尾了，而不是再排一条）。
 */
const MAX_WF_CHAIN = 3

/**
 * 装配这一轮的工具（与沙箱基座、ask 表单通道、交付账）。返回：
 * - ctrl：本轮的中止器（ask / wait 的中止语义需要它，停止按钮也从这里摘）；
 * - tools：交给 runAgent 的工具数组（唯一的 execute 工具）；
 * - turnDelivery：本轮的交付账（文件变动 / 参考引证，收口时挂到消息上）；
 * - global / window：全局提供商 / 模型 / 档位与上下文窗口（子代理与 runAgent 都要用）。
 */
export function rigTurnTools(io: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  target: AgentRunTarget
  /** 本轮现取的全局 AI 设置快照（runTurnUnchecked 在轮首读的那份） */
  settings: AiSettings
  /** 本轮现取的 agent 设置快照（assembleTurnEntry 读的那份；MCP 配置从这儿来） */
  agentSettings: AgentSettings
  /**
   * 本轮工作流的启动实参（runWorkflow 的 params）。考试工具拿它钉住阅卷对象：
   * 交卷触发的阅卷轮带着 examId / attemptId——判分进行中学习者又交了另一份卷子时，
   * 「最新待判」已经换了人，不钉住就会把 B 卷的分数判到 A 卷的对话里（见 makeExamDeps）。
   */
  wfParams?: Record<string, string | number>
  /** 考试工具依赖；由工作区注入，按节点与阶段动态提供 */
  examDeps?: (nodeId: string, wfParams?: Record<string, string | number>) => ExamToolDeps | undefined
  /**
   * 节点编辑成功后的宿主动作（出卷后的视觉自检等）：由界面层注入，
   * learnSandboxOps 会把它接到节点通道的 afterEdit 上。
   */
  afterNodeEdit?: (uuid: string, kind: string) => void
  /** ui 依赖现取最新的一份（见 hook 里 uiRef 的说明） */
  uiRef: { current: AgentUiDeps | undefined }
  /** browser 依赖工厂现取最新的一份（webMeta 活信息随渲染变，与 uiRef 同款说明） */
  browserFnRef: { current: (() => BrowserDeps | undefined) | undefined }
  wfChainRef: { current: Map<string, number> }
  pendingWfRef: { current: Map<string, Array<{ id: string; params?: Record<string, string | number> }>> }
  askWaitersRef: { current: Map<string, (value: unknown) => void> }
  setPendingAsk: Dispatch<SetStateAction<Record<string, { id: string; form: AskFormPayload }>>>
  /** 转存失败之类的话要能说出来（ui.toast 缺席时的回落通道，见 hook 里 onNoticeRef 的说明） */
  onNoticeRef: { current: ((message: string) => void) | undefined }
  /** 子代理管理器：一段对话一个、跨轮存活（见 hook 的 getOrCreateSubManager） */
  getOrCreateSubManager: (conversationId: string) => SubAgentManager
}) {
  const { getLatest, set, target, settings, agentSettings, wfParams, examDeps, afterNodeEdit, uiRef, browserFnRef, wfChainRef, pendingWfRef, askWaitersRef, setPendingAsk, onNoticeRef, getOrCreateSubManager } = io
  /**
   * 唯一的工具：模型写一段 JS，经由沙箱里的 api 完成读写。
   * 文档、节点、描述、试卷、临时变量、长期记忆、人机协作（ask / tiktok）
   * 与界面操作（ui.*）的全部能力都从这里进出（见 agent/tools）。
   */
  const ctrl = new AbortController()
  const signal = ctrl.signal
  /**
   * 本轮 execute 报上来的提示词模块 key（apiGroup / 内容触发，见 learn/ai/promptModules）。
   * 只收集不落库：轮末 finally 里统一去重、统一追加——绝不在这里改会话。
   */
  // moduleQueue 已退役
  // ui 依赖现取最新的一份（见 uiRef 的说明）
  const uiDeps = uiRef.current
  // browser 依赖现取最新的一份（webMeta 活信息随渲染变，与 uiRef 同款说明）
  const browserDeps = browserFnRef.current?.()
  /**
   * 全局提供商 / 模型 / 思考等级：所有 AI 功能的共同基底。提前到这里，
   * 因为子代理要跑在导师同一轮的模型与档位上（见 subagent 的说明）。
   */
  const global = resolveGlobal(settings)
  const window = globalContextWindow(settings)
  /**
   * 沙箱基座：一轮对话与子代理共用同一套能力（learnSandboxOps 的产物）。
   * execute 拿全量，子代理按定义的 apiGroups 取子集（见 subagent/manager）。
   */
  const sandboxBase = learnSandboxOps({
    getLatest,
    set,
    // 这一轮冲着来的节点是沙箱里的「当前节点」——不是界面上此刻选中的那个
    nodeId: () => target.nodeId,
    goalId: () => target.goalId,
    ...(afterNodeEdit ? { afterNodeEdit } : {}),
    /**
     * wf.invoke 的落点（见 WorkflowOps.invoke）：**只排队，不当场跑**。
     * 这一轮还在跑，工作流的指令要作为一条新的 user 消息进上下文，只能等收口（见下面 finally）。
     *
     * 两条克制：一次编排最多排一条（工作流是独占一轮的流程，排两条等于让模型自己编排两轮
     * 对话）；同一条不重复排（它在同一轮里被调两次，意图只有一个）。上限见 MAX_WF_CHAIN。
     */
    invokeWorkflow: (id, wfOpts) => {
      const depth = wfChainRef.current.get(target.conversationId) ?? 0
      if (depth >= MAX_WF_CHAIN) {
        return {
          error:
            '这条链上已经连着触发了 ' + MAX_WF_CHAIN + ' 条工作流，不能再排了。请就此打住：' +
            '把已经做完的事、看到的结论与下一步交给用户。',
        }
      }
      const q = pendingWfRef.current.get(target.conversationId) ?? []
      if (q.some((x) => x.id === id)) return { ok: true }
      if (q.length) {
        return {
          error:
            '这一轮已经排了一条工作流（它本轮收口后就跑）。不要一次交两件活——' +
            '真要连着做，就把第二件写进你这一轮的收尾，让用户决定。',
        }
      }
      q.push({ id, ...(wfOpts.params ? { params: wfOpts.params } : {}) })
      pendingWfRef.current.set(target.conversationId, q)
      return { ok: true }
    },
  })
  /**
   * 子代理管理器：喂给这一轮的模型配置与沙箱基座；它启动的子代理任务用
   * 启动那一刻的配置跑完（换轮不漂移）。
   */
  const manager = getOrCreateSubManager(target.conversationId)
  manager.setTurn({
    sandbox: sandboxBase,
    provider: global.provider,
    model: global.model,
    // 档位全应用唯一（全局滑条）：子代理与它的宿主同档，绝不各自翻面（见 learn/effortGuard）
    effort: global.effort,
    contextWindow: window,
  })
  // subagent api 挂进沙箱（导师专用；子代理的 apiAllow 白名单里没有这一组）
  sandboxBase.subagent = manager.api
  /*
   * MCP 外部服务挂进沙箱（mcp.list / mcp.discover / mcp.call，见 agent/mcp/ops）。
   * 配置是这一轮现取的快照：用户改了 MCP 设置，下一轮就生效；
   * 总开关关着时不注入——与旧做法「关闭时不注入任何 MCP 工具」同一口径。
   * 子代理的 apiAllow 白名单里没有 mcp，subsetSandbox 也不带它——只敞给导师。
   */
  const mcpOps = makeMcpOps(agentSettings.mcp)
  if (mcpOps) sandboxBase.mcp = mcpOps
  /**
   * ask 的表单通道抽成局部函数：permission.request 的审批复用同一条管线
   * （展示、限时、停止中断全都一致）；区别只在结果的去向——批准由宿主直接落
   * 放行配置（agent/permissions），不把答案交给模型。
   */
  const askHost = (form: AskFormPayload): Promise<unknown> =>
    new Promise<unknown>((resolve) => {
      let idleTimer: ReturnType<typeof setInterval> | null = null
      const askId = crypto.randomUUID()
      const finish = (value: unknown): void => {
        if (askWaitersRef.current.get(askId) !== finish) return
        askWaitersRef.current.delete(askId)
        signal.removeEventListener('abort', onAbort)
        if (idleTimer) clearInterval(idleTimer)
        // 只收走自己挂的那一张：并发时别的会话可能也挂着表单
        setPendingAsk((prev) => {
          if (prev[target.conversationId]?.id !== askId) return prev
          const next = { ...prev }
          delete next[target.conversationId]
          return next
        })
        // 标了 userInfo 的题目：答案在**用户提交的那一刻**就落进画像（见 user/fields），
        // 导师拿到答案时画像已经写好了——不必再 update 一遍，也就没有「转述走样」这一步
        void applyAskToProfile(form, value).then(resolve, () => resolve(value))
      }
      const onAbort = () =>
        finish({ ok: false, content: '用户停止了这一轮，表单已关闭。不要假设用户的回答。' })
      signal.addEventListener('abort', onAbort, { once: true })
      askWaitersRef.current.set(askId, finish)
      setPendingAsk((prev) => ({ ...prev, [target.conversationId]: { id: askId, form } }))
      /*
       * 表单限时：挂出一分钟后用户**没有任何操作**（鼠标键盘都不动，任意操作都会续住它，
       * 见 lib/userActivity）就自动收起并带回 timedOut——agent 据此自行决定继续或交付，
       * 不能为一个没人理的表单把整轮沙箱无限吊着。
       */
      ensureActivityListeners()
      idleTimer = setInterval(() => {
        if (askWaitersRef.current.get(askId) !== finish) return
        if (userIdleMs() >= ASK_IDLE_TIMEOUT_MS) {
          finish({
            ok: false,
            timedOut: true,
            content: '表单挂出一分钟，用户没有任何操作（超时自动收起）。不要假设用户的回答。',
          })
        }
      }, 5_000)
    })
  /*
    这一轮的交付账（文件变动 / 参考引证）。用局部变量而不是 state：它是这一轮的副作用，
    不该触发渲染；收口时挂到消息上，组件自然就出来了（见 agent/delivery）。
  */
  const turnDelivery = emptyDelivery()
  const tools = [
    createExecuteTool({
      ...sandboxBase,
      /*
       * 交付登记：只收结构化数据。正文里不用再复述文件清单与参考来源——
       * 界面在消息底部按「一行一条」统一展示（见 DeliveryBlock）。
       */
      delivery: {
        submit: (input) => {
          const rec = normalizeDelivery(input)
          if (!rec) {
            return {
              ok: false,
              files: 0,
              sources: 0,
              error:
                '至少要给 files 或 sources 里的一项：files: [{ path, action?: created|updated|deleted, note? }]，sources: [{ title, url }]（只收 http/https）',
            }
          }
          if (target.goalId) {
            const st = getLatest()
            for (const f of rec.files) {
              if (!f.goalId) f.goalId = target.goalId
              if (!f.nodeId) {
                const byId = st.nodes.find((n) => n.id === f.path || (f.path.startsWith('#') && n.id === f.path.slice(1)))
                if (byId) {
                  f.nodeId = byId.id
                  continue
                }
                const res = resolveNode(st, { goalId: target.goalId, currentNodeId: target.nodeId ?? null }, f.path)
                if (res.ok) {
                  f.nodeId = res.value.id
                  continue
                }
                const cleanPath = f.path.replace(/\.md$/i, '').trim()
                if (cleanPath !== f.path) {
                  const resClean = resolveNode(st, { goalId: target.goalId, currentNodeId: target.nodeId ?? null }, cleanPath)
                  if (resClean.ok) {
                    f.nodeId = resClean.value.id
                    continue
                  }
                }
                // 兼容 .node.json 磁盘路径或文件名匹配
                const diskMatch = st.nodes.find((n) => {
                  if (n.goalId !== target.goalId) return false
                  const base = n.title
                  return f.path.endsWith(`/${base}.node.json`) || f.path.endsWith(`/${base}.teaching.md`) || f.path === `${base}.node.json` || f.path === `${base}.teaching.md`
                })
                if (diskMatch) {
                  f.nodeId = diskMatch.id
                  continue
                }
                if (target.nodeId) {
                  const targetNode = nodeById(st, target.nodeId)
                  if (targetNode && (cleanPath === targetNode.title || cleanPath === targetNode.id)) {
                    f.nodeId = targetNode.id
                  }
                }
              }
              if (f.nodeId) {
                const matchedNode = nodeById(st, f.nodeId)
                if (matchedNode && (f.path.endsWith('.node.json') || f.path === f.nodeId || f.path === '#' + f.nodeId)) {
                  f.path = nodePathOf(st, target.goalId, f.nodeId) || matchedNode.title
                }
              }
            }
          }
          mergeDelivery(turnDelivery, rec)
          return { ok: true, files: turnDelivery.files.length, sources: turnDelivery.sources.length }
        },
      },
      /*
       * 考试工具：作用对象是这一轮冲着来的那个节点（target.nodeId），
       * 不是「此刻界面上选中的那个」——一轮可能跑好几十秒，期间用户切了节点
       * 也不该把阅卷对象换掉。
       *
       * 「读永远成功、写才看阶段」的翻译全在 learn/agentOps 的 makeExamTool 里
       * （纯装配，Node 探针钉得住）。
       */
      exam: (() => {
        const deps = target.nodeId ? examDeps?.(target.nodeId, wfParams) : undefined
        return deps ? makeExamTool(deps) : undefined
      })(),
      // 动态提示词注入的触发口：execute 只报 key，去重与落库都在轮末（见 moduleQueue）
      // onPromptModule: 不再按需动态入队
      // 用户点「停止」时，正在等用户的 ask 与正在睡的 wait 要能立刻退场
      signal,
      /** 记忆：长期跨目标、工作按目标；绝不自动拼进上下文，agent 需要时主动读写 */
      memory: createMemoryOps({ getLatest, set, goalId: () => target.goalId }),
      wait: (ms) =>
        new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            cleanup()
            resolve()
          }, ms)
          const onAbort = () => {
            cleanup()
            reject(new Error('等待被用户中止'))
          }
          const cleanup = () => {
            clearTimeout(t)
            signal.removeEventListener('abort', onAbort)
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      ask: askHost,
      // 路径放行（导师专用）：审批复用 askHost 那条管线，批准由宿主直接落配置
      permission: makePermissionOps({ ask: askHost }),
      tiktok: async () => {
        // Electron 的 beep：响一声即返回；不在 Electron 里跑时静默跳过
        try {
          native().window.beep()
        } catch {
          // 测试环境没有 native 桥：tiktok 本来就是「尽力提醒」
        }
      },
      ui: {
        ...(uiDeps?.point ? { point: uiDeps.point } : {}),
        ...(uiDeps?.scroll ? { scroll: uiDeps.scroll } : {}),
        ...(uiDeps?.domRoot ? { domRoot: uiDeps.domRoot } : {}),
        ...(uiDeps?.openSuper ? { openSuper: uiDeps.openSuper } : {}),
        // 界面没给 toast 就退回对话栏自己那句提示：都是「说一句话」
        toast: (message) => {
          if (uiDeps?.toast) uiDeps.toast(message)
          else onNoticeRef.current?.(message)
        },
        ...(uiDeps?.captureDoc
          ? {
              capture: async () => {
                const cap = await uiDeps.captureDoc!()
                if (!cap.ok) return { ok: false as const, error: cap.error }
                const saved = await saveScreenshot(getLatest, set, target.goalId, cap.dataUrl)
                if (!saved.ok) return { ok: false as const, error: saved.error }
                return {
                  ok: true as const,
                  path: saved.image.rel,
                  uuid: saved.image.id,
                  note:
                    `截图已保存为文件 "${saved.image.rel}"（可通过 api.files.read 读取），并已注入视觉上下文。`,
                  images: [saved.image],
                }
              },
            }
          : {}),
      },
      // 内置浏览器（browser.*）：宿主依赖在场的回合才有这一组（见 learn/web/browserOps）
      ...(browserDeps ? { browser: makeBrowserOps(browserDeps, target.goalId) } : {}),
    }),
  ]
  return { ctrl, tools, turnDelivery, global, window }
}
