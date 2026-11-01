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
import type { KnowledgeNode, LearnStore } from '../../../learn/types'
import { nodeById } from '../../../learn/graph'
import { outlineByMember } from '../../../learn/outline'
import { listWorkflowRows, removeWorkflow, type WorkflowRow } from '../../../learn/workflows'
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
    agent.runWorkflow('browser-use', { nodeId: nid, params: { target: nid } })
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
    // 交付边界随指令钉一遍：这是「往目标文档下面出一份卷」的轮次，不是建树。
    // 画布上有空壳时 api.node.create 会原位复用（同 id 吸收），没有就现建——两条路都是它。
    agent.runWorkflow('exam', { nodeId: target.id, params: { target: target.id } })
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
    agent.runWorkflow('exam-grade', { nodeId: target.id, params: { target: target.id } })
  }

  /**
   * 超级实验室：让导师问清「想做什么实验 / 需要什么功能」后生成一份可交互的超级文档
   * （内置工作流「超级实验室」）。它是个问询类工作流：触发即响铃、对话栏切到主位，
   * 表单压在输入框上方等需求。
   */
  const startSuperLab = (nodeId?: string, shellName?: string) => {
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
    // 指令从节点派生就要带上节点信息：填内容是**在这份超级文档上填**，不是再建一份。
    // 壳的来源两条：画布空壳卡指名道姓（shellName）；文档菜单没指名时，目标下已有的
    // 那份空壳自动顶上（有内容的绝不顶——那是要覆盖交付物的意思）。
    const superdocs = nodeById(getLatest(), target.id)?.superdocs ?? []
    const shellUuid = shellName
      ? superdocs.find((d) => d.name === shellName)?.id
      : (superdocs.find((d) => !d.html.trim())?.id ?? undefined)
    agent.runWorkflow('superlab', {
      nodeId: target.id,
      params: { target: target.id, ...(shellUuid ? { shell: shellUuid } : {}) },
    })
    onToast(t('已启动超级实验室，导师马上会问你想做什么'))
  }

  /**
   * 生成 / 重排一个节点的大纲（内置工作流「生成大纲」，指令见 learn/workflows）。
   *
   * 入口在页头那颗按钮与卡片底栏的「生成」上：那里说的是「眼前这个节点」，
   * 所以必须指名——按可省 nodeId 的同一套口径收参。
   */
  const startOutline = (nodeId?: string) => {
    const target = nodeId ? nodeById(getLatest(), nodeId) : activeNode
    if (!target) return
    if (!hasKey) {
      onToast(t('规划大纲需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    agent.runWorkflow('outline', { nodeId: target.id, params: { target: target.id } })
    onToast(t('已请导师规划「{0}」的大纲，大纲页会随写入更新', target.title))
  }

  /**
   * 前置知识大纲 / 拆层大纲：同一个工作流的两种落点——
   * - 文档卡（右键菜单 / 空大纲卡的按钮）：读那份文档，把「先要学会什么」落成目标项；
   * - 游离大纲卡 / 挂在大纲下的子大纲卡：读它认领的目标项与上级上下文，规划这一层怎么拆。
   * ownerNodeId 收两种：文档 id 或 `o:` 大纲 uuid（工作流的 target 参数原样带着）。
   */
  const startGenerateOutline = (nodeId?: string) => {
    if (!hasKey) {
      onToast(t('生成大纲需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    const currentStore = getLatest()
    let outlineTarget = nodeId
    let targetDocId: string | undefined
    let targetGoalId: string | undefined

    if (outlineTarget && outlineTarget.startsWith('o:')) {
      const found = outlineByMember(currentStore, outlineTarget)
      if (found?.kind === 'free') {
        targetGoalId = found.entity.goalId
        const goal = currentStore.goals.find((g) => g.id === targetGoalId)
        targetDocId = goal?.rootNodeId || currentStore.nodes.find((n) => n.goalId === targetGoalId)?.id || activeNode?.id
      } else if (found?.kind === 'attached') {
        targetDocId = found.docId
        targetGoalId = found.doc.goalId
      }
    } else if (outlineTarget) {
      const doc = nodeById(currentStore, outlineTarget)
      if (doc) {
        targetDocId = doc.id
        targetGoalId = doc.goalId
        outlineTarget = 'o:' + doc.id
      }
    } else if (activeNode) {
      targetDocId = activeNode.id
      targetGoalId = activeNode.goalId
      outlineTarget = 'o:' + activeNode.id
    }

    if (!targetGoalId && activeGoal) {
      targetGoalId = activeGoal.id
    }
    if (!targetGoalId && activeGoalId) {
      targetGoalId = activeGoalId
    }
    if (!targetGoalId && targetDocId) {
      targetGoalId = nodeById(currentStore, targetDocId)?.goalId
    }

    if (!targetGoalId) {
      onToast(t('未找到关联的学习目标，无法生成大纲'))
      return
    }

    const finalNodeId =
      targetDocId ||
      currentStore.goals.find((g) => g.id === targetGoalId)?.rootNodeId ||
      currentStore.nodes.find((n) => n.goalId === targetGoalId)?.id ||
      activeNodeId ||
      undefined

    const finalOutlineTarget = outlineTarget || (finalNodeId ? 'o:' + finalNodeId : '')
    const outlineEntity = finalOutlineTarget ? outlineByMember(currentStore, finalOutlineTarget) : null
    const title =
      outlineEntity?.kind === 'free'
        ? outlineEntity.entity.title
        : outlineEntity?.kind === 'attached'
        ? outlineEntity.doc.title
        : (finalNodeId ? nodeById(currentStore, finalNodeId)?.title : '大纲')

    // 检查此大纲是否认领了上级大纲的端口（大纲连接大纲port，进一步拆分该目标项）
    let hint: string | undefined
    if (finalOutlineTarget) {
      const rawTarget = finalOutlineTarget.startsWith('o:') ? finalOutlineTarget.slice(2) : finalOutlineTarget
      const claimEdge = currentStore.edges.find((e) => (e.to === finalOutlineTarget || e.to === rawTarget || e.to === 'o:' + rawTarget) && e.portKey)
      if (claimEdge) {
        const upOutline = outlineByMember(currentStore, claimEdge.from.startsWith('o:') ? claimEdge.from : 'o:' + claimEdge.from)
        const entries =
          upOutline?.kind === 'attached'
            ? upOutline.outline?.children ?? []
            : upOutline?.kind === 'free'
            ? upOutline.entity.children
            : []
        const slot = entries.find((c) => c.key === claimEdge.portKey)
        const parentTitle =
          upOutline?.kind === 'free'
            ? upOutline.entity.title
            : upOutline?.kind === 'attached'
            ? upOutline.doc.title
            : ''
        if (slot) {
          hint = `【子大纲细化拆解】此大纲挂在上级大纲「${parentTitle}」的目标项「${slot.title}」之下。大纲连接大纲port的目的是对该目标项进行进一步细化与拆分。请阅读认领的目标项上下文，规划这一层的阶段性子目标，不要创建新节点。`
        }
      }
    }

    agent.runWorkflow('outline', {
      nodeId: finalNodeId,
      params: { target: finalOutlineTarget },
      hint,
    })
    onToast(t('已请导师规划「{0}」这一层的大纲，大纲页会随写入更新', title || '大纲'))
  }
  const startPrereqOutline = startGenerateOutline

  /**
   * 视频总览：为绑定的视频规划语义分类结构并生成总览文档（挂在视频节点子级）。
   */
  const startVideoOverview = (videoNodeUuid: string) => {
    if (!hasKey) {
      onToast(t('生成总览文档需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    const store = getLatest()
    const videoNode = (store.videoNodes ?? []).find((v) => v.id === videoNodeUuid)
    if (!videoNode || !videoNode.videoId) {
      onToast(t('该视频节点尚未绑定视频，无法生成总览文档'))
      return
    }
    const goal = store.goals.find((g) => g.id === videoNode.goalId)
    const rootId = goal?.rootNodeId ?? activeNode?.id
    if (!rootId) {
      onToast(t('未找到绑定的学习目标根节点'))
      return
    }
    agent.runWorkflow('video-overview', {
      nodeId: rootId,
      params: { target: videoNodeUuid, videoId: videoNode.videoId },
    })
    onToast(t('已为视频启动总览文档生成工作流，导师正在分析选集语义…'))
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
        params: { target: target.id, language: req.languageId ?? '未标注', key: req.key, code: req.code },
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

  return {
    newExam,
    requestGrading,
    startSuperLab,
    startBrowserUse,
    startOutline,
    startGenerateOutline,
    startPrereqOutline,
    startVideoOverview,
    workflowRows,
    runWorkflowRow,
    removeWorkflowRow,
  }
}
