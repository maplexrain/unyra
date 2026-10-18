/*
 * 这个文件负责：一切「把一件事交给导师的工作流去跑」的启动按钮——
 * 出卷、补判分、超级实验室、浏览器操作、大纲，以及设置里工作流列表的
 * 直接运行 / 删除、代码块菜单的「伪编译」登记。外加学习状态里两个纯本地的小动作
 * （改自评、删错误记忆），它们与工作流共享「作用于哪个节点」的同一套收参口径：
 * 可省的 nodeId 一律「省 = 当前节点，指名 = 右键的那一个」。
 *
 * 没配 Key 的统一口径也在这里：拦下、说明、顺手打开设置——每个入口自己再写一遍
 * 迟早有一处忘了。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { KnowledgeNode, LearnStore, SelfReport, WorkflowEffortSetting } from '../../../learn/types'
import { SELF_REPORT_LABEL } from '../../../learn/types'
import { nodeById, updateLearning } from '../../../learn/graph'
import { listWorkflowRows, removeWorkflow, setWorkflowEffort, type WorkflowRow } from '../../../learn/workflows'
import { setCodeHost, type CodeCompileRequest } from '../../../lib/docHost'
import { examNeedingWork } from './examTools'
import type { useAgent } from '../../../learn/useAgent'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>

/** 工作流启动器需要的宿主能力与现成的派生值 */
export interface WorkflowStartersDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  onOpenSettings: () => void
  agent: AgentApi
  hasKey: boolean
  providerName: string
  /** 当前节点 / 目标：可省的 nodeId 的默认值，工作流列表的裁剪基准 */
  activeNode: KnowledgeNode | null
  activeNodeId: string | null
  activeGoal: LearnStore['goals'][number] | null
  activeGoalId: string | null
  store: LearnStore
  setCreating: (v: boolean) => void
}

/**
 * 导师工作流的启动器集合。
 * 返回的动作被三处消费：资源管理器右键菜单、文档区悬浮组、对话栏的斜杠命令与更多菜单。
 */
export function useWorkflowStarters(deps: WorkflowStartersDeps) {
  const {
    getLatest,
    set,
    onToast,
    onOpenSettings,
    agent,
    hasKey,
    providerName,
    activeNode,
    activeNodeId,
    activeGoal,
    activeGoalId,
    store,
    setCreating,
  } = deps

  /** 浏览器操作：交给导师用内置浏览器代办（看=截图、输入=模拟鼠标键盘），低档推理走快流程 */
  const startBrowserUse = useCallback((nodeId?: string) => {
    // 指名的节点（keepalive 的页签面板）优先；缺省 = 当前节点
    const named = nodeId ? nodeById(getLatest(), nodeId) : null
    const nid = named?.id ?? activeNodeId ?? activeGoal?.rootNodeId ?? null
    if (!nid) return
    if (!hasKey) {
      onToast(t('浏览器操作要先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    agent.runWorkflow('browser-use', { nodeId: nid })
  }, [activeGoal, activeNodeId, agent, getLatest, hasKey, onToast, onOpenSettings, providerName])

  /**
   * 新增一份试卷：**不先问类型与难度**，直接跑内置工作流「出卷」——导师会自己 ask 用户
   * （类型 / 难度由它问、时限由它按题量与难度估，见 learn/workflows 的 EXAM_INSTRUCTION）。
   */
  const newExam = (nodeId?: string) => {
    // 可省的 nodeId：文档区那几块 tip 说的是「当前节点」，资源管理器的右键菜单说的是
    // 「我右击的那一个」——后者必须指名，否则在 A 上右键、卷子出到 B 上去了
    const target = nodeId ? nodeById(getLatest(), nodeId) : activeNode
    if (!target) return
    if (!hasKey) {
      onToast(t('出题需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    if (examNeedingWork(getLatest(), target.id)) {
      onToast(t('有一次考试还没判分、或还没写错题讲解，先让导师把它收尾'))
      return
    }
    setCreating(false)
    agent.runWorkflow('exam', { nodeId: target.id })
  }

  /**
   * 手动重跑「判分 + 讲解」：导师中途断了、或当时没配 Key，都靠它补。
   * 收 nodeId：入口在资源管理器的试卷行右键菜单里，那里说的可能是**任意一个**节点。
   */
  const requestGrading = (nodeId?: string) => {
    const target = nodeId ? nodeById(getLatest(), nodeId) : activeNode
    if (!target) return
    if (!hasKey) {
      onToast(t('判分与讲解需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    if (!examNeedingWork(getLatest(), target.id)) {
      onToast(t('这个节点没有等着判分或讲解的考试'))
      return
    }
    agent.runWorkflow('exam-grade', { nodeId: target.id })
  }

  /* ---------- 学习状态（自评 / 掌握度 / 错误记忆 / 检验） ---------- */

  /**
   * 学习者自己改自评。
   *
   * 掌握度不给他改——那是系统的估计；自评本来就是他的主观判断，只能由他给。
   * 点这一下的意义在于把「导师猜的」变成「我确认的」（selfBy 从 'ai' 翻成 'user'），
   * 导师据此决定是先补课还是直接往下走（见 ai.ts 的学习状态一节）。
   */
  const setSelfReport = (nodeId: string, self: SelfReport) => {
    set(updateLearning(getLatest(), nodeId, { self, selfBy: 'user' }))
    onToast(t('已记为「{0}」', t(SELF_REPORT_LABEL[self])))
  }

  /** 删掉一条错误记忆：这个错法已经改掉了，留着只会误导下一次教学 */
  const clearMistake = (nodeId: string, pattern: string) => {
    const node = nodeById(getLatest(), nodeId)
    const kept = (node?.learning?.mistakes ?? []).filter((m) => m.pattern !== pattern)
    set(updateLearning(getLatest(), nodeId, { mistakes: kept }))
  }

  /**
   * 超级实验室：让导师问清「想做什么实验 / 需要什么功能」后生成一份可交互的超级文档
   * （内置工作流「超级实验室」）。它是个问询类工作流：触发即响铃、对话栏切到主位，
   * 表单压在输入框上方等需求。
   */
  const startSuperLab = (nodeId?: string) => {
    // 与 newExam 同一条：可省的 nodeId 让「右键某一个节点新建」落到那一个节点上
    const target = nodeId ? nodeById(getLatest(), nodeId) : activeNode
    if (!target) {
      onToast(t('超级实验室的实验要绑在一个知识点上，先选一个节点'))
      return
    }
    if (!hasKey) {
      onToast(t('超级实验室需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    agent.runWorkflow('superlab', { nodeId: target.id })
    onToast(t('已启动超级实验室，导师马上会问你想做什么'))
  }

  /**
   * 生成 / 重排一个节点的大纲（内置工作流「生成大纲」，指令见 learn/workflows）。
   *
   * 入口在大纲页上（「还没有大纲」的占位与页头的那颗按钮）：那里说的是
   * 「眼前这个节点」，所以必须指名——按可省 nodeId 的同一套口径收参。
   */
  const startOutline = (nodeId?: string) => {
    const target = nodeId ? nodeById(getLatest(), nodeId) : activeNode
    if (!target) return
    if (!hasKey) {
      onToast(t('规划大纲需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    agent.runWorkflow('outline', { nodeId: target.id })
    onToast(t('已请导师规划「{0}」的大纲，大纲页会随写入更新', target.title))
  }

  /**
   * 把「谁来跑伪编译工作流」交给代码块菜单（见 lib/docHost）。
   *
   * 为什么由学习区注册：跑工作流要用 useAgent 的 runWorkflow，还要知道有没有配 Key、
   * 当前是哪个节点——这些只有这一层有。菜单是渲染期命令式挂进 DOM 的，不在组件树里，
   * props 传不到它手上，于是用一根模块级的线牵起来（与 lib/quoteFocus 同一种做法）。
   *
   * 卸载时注销：没有学习区的地方（AI 对话里的代码块、试卷副本、超级文档 iframe）
   * 就拿不到 host，菜单据此把「编译」按住不点——而不是点了没反应。
   *
   * 注册只做一次，回调本体每次渲染后刷进 ref（与 useAgent 里 uiRef / onNoticeRef 同一路数）：
   * agent / activeNode / hasKey 每个渲染都是新值，直接进依赖数组会让「注册」跟着每次渲染重来，
   * 而每次注册都会叫醒所有菜单重画一遍——AI 流式输出时那是每秒好几次的无谓开销。
   */
  const compileRef = useRef<(req: CodeCompileRequest) => void>(() => {})
  useEffect(() => {
    compileRef.current = (req) => {
      if (!hasKey) {
        onToast(t('伪编译需要超级导师，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      const target = activeNode
      if (!target) {
        onToast(t('先选一个知识点：伪编译要在这篇文档的上下文里做'))
        return
      }
      const sent = agent.runWorkflow('code-compile', {
        nodeId: target.id,
        params: { language: req.languageId ?? '未标注', key: req.key, code: req.code },
      })
      if (!sent) {
        // 对话还没就绪（没有会话/目标）：这一轮根本发不出去，菜单不该空转
        onToast(t('现在发不出编译请求：先打开一个知识点，等对话框就绪再点'))
        return
      }
      onToast(t('已把这段代码交给导师伪编译，结果与说明见右侧对话'))
    }
  })
  useEffect(() => {
    setCodeHost({ compile: (req) => compileRef.current(req) })
    return () => setCodeHost(null)
  }, [])

  /**
   * 工作流列表（超级导师设置 → 工作流）：三级并成一张，当前目标裁剪。
   * 从列表直接跑的入口也在这里：内置条目里能直接从列表跑的都不带占位参数。
   */
  const workflowRows = useMemo(() => listWorkflowRows(store, activeGoalId), [store, activeGoalId])
  const runWorkflowRow = (row: WorkflowRow) => {
    if (!hasKey) {
      onToast(t('运行工作流需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    if (!activeNode) {
      onToast(t('先选一个知识点：工作流要在它的上下文里跑'))
      return
    }
    agent.runWorkflow(row.id, { nodeId: activeNode.id })
    onToast(t('已启动「{0}」', t(row.name)))
  }
  /** 设置里的删除（FlowTab 先弹过确认框）：只删登记的，内置的到不了这里 */
  const removeWorkflowRow = (row: WorkflowRow) => {
    set(removeWorkflow(getLatest(), row.id))
    onToast(t('已删除工作流「{0}」', t(row.name)))
  }
  /** 设置里改一条工作流的思考档位（三态；内置与登记通吃，键 = id 记在全局 efforts 表） */
  const setWorkflowEffortRow = (row: WorkflowRow, effort: WorkflowEffortSetting) => {
    set(setWorkflowEffort(getLatest(), row.id, effort))
  }

  return {
    newExam,
    requestGrading,
    setSelfReport,
    clearMistake,
    startSuperLab,
    startBrowserUse,
    startOutline,
    workflowRows,
    runWorkflowRow,
    removeWorkflowRow,
    setWorkflowEffortRow,
  }
}
