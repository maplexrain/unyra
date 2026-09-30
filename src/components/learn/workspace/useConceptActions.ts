/*
 * 这个文件负责：正文选区上的全部动作——
 * 「学习」（选中词条 → 创建子节点 → 导师开讲）、「了解」（词条旁挂一条 AI 注解）、
 * 自己写注解 / 删注解、「询问」（就选段向导师提问），以及 AI 大纲里「点击学习」链接的注册。
 *
 * 这几件事共用同一条原则：**正文渲染层只报告发生了什么，决定权在这里**——
 * 建不建节点、发哪段上下文、没配 Key 时拦不拦，都是与 Agent、store 打交道的活。
 */

import { useEffect } from 'react'
import type { AnnotationStyle, DocKind, LearnStore, TabRef } from '../../../learn/types'
import { docOf } from '../../../learn/types'
import {
  addAnnotation,
  createChildNode,
  nodeById,
  removeAnnotation,
  updateDoc,
  updateNode,
} from '../../../learn/graph'
import { openInGroup } from '../../../learn/groups'
import { plainSnippet, offsetToLineCol } from '../../../learn/text'
import { replaceTermWithLink, setLearnLinkHandler } from '../../../lib/nodeLink'
import type { DocSource } from '../NodeNote'
import type { useAgent } from '../../../learn/useAgent'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>

/** 选区动作需要的宿主能力与现成的派生值 */
export interface ConceptActionsDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  onOpenSettings: () => void
  /** useAgent 的那一份：autoTeach / runWorkflow / send 都从这里走 */
  agent: AgentApi
  hasKey: boolean
  providerName: string
  /** 焦点格那份文档的派生值（询问时的 path / 上下文按它算，见 askAboutSelection） */
  docSource: DocSource | null
  setCreating: (v: boolean) => void
}

/** 正文选区上的动作。渲染层（NodeNote 的选区菜单）从返回值里拿回调。 */
export function useConceptActions(deps: ConceptActionsDeps) {
  const { getLatest, set, onToast, onOpenSettings, agent, hasKey, providerName, docSource, setCreating } = deps

  /**
   * 创建一个概念子节点并跳过去，立刻把它交给 Agent（标题 / 描述 / 正文都由它写）。
   * 用户选中词条的「学习」与 AI 大纲里的「点击学习」链接共用这一条路径。
   *
   * 这里**不再预生成描述**：节点当场建出来、界面当场有反馈，Agent 在自己的那一轮里
   * 顺手把标题与描述补上（见内置工作流「开讲」，learn/workflows）。
   *
   * rewriteLink：是否把父节点教学文档里该词条改写成指向新节点的链接。
   * 大纲链接本身已经指向这个概念，改写反而会把大纲的 `[名](moji:learn "说明")`
   * 替换成 `[名](moji:node/id)`、丢掉说明，因此那种情况传 false。
   */
  const openConcept = (parentId: string, term: string, opts?: { hint?: string; rewriteLink?: boolean }) => {
    const latest = getLatest()
    const parent = nodeById(latest, parentId)
    if (!parent) return
    const r = createChildNode(latest, parentId, term)
    const hint = opts?.hint?.trim()
    const parentDoc = docOf(parent, 'teaching')
    let next = r.store
    if (!r.created && hint && !r.node.description.trim()) {
      // 复用已有节点（同一目标内去重）时，顺手补上大纲里那句说明
      next = updateNode(next, r.node.id, { description: hint })
    }
    if (opts?.rewriteLink !== false) {
      const linkedContent = replaceTermWithLink(parentDoc, term, r.node.id)
      if (linkedContent !== parentDoc) next = updateDoc(next, parentId, linkedContent)
    }
    // 跳过去时一定落在教学文档上：Agent 正要往那里写东西。
    // 页签照旧只开一次：这个概念已经开着的话，这里只是把它激活
    const childRef: TabRef = { kind: 'teach', nodeId: r.node.id }
    set({
      ...next,
      activeGoalId: parent.goalId,
      activeNodeId: r.node.id,
      activeConversationId: r.conversationId,
      docArea: openInGroup(next.docArea, next.docArea.focus, childRef, Date.now()),
    })
    setCreating(false)

    if (!r.created) {
      onToast(t('「{0}」已在本目标中，已跳到该节点', term))
      return
    }
    onToast(t('已创建节点「{0}」', term))

    if (!hasKey) return
    // 大纲里那句定位说明作为额外上下文交给 Agent，其余（标题/描述/正文）由它自己安排
    agent.autoTeach({ goalId: parent.goalId, nodeId: r.node.id, conversationId: r.conversationId }, false, hint)
  }

  // 注册「点击学习」链接：AI 大纲里的概念点一下就创建/跳转下级节点。
  // 不写依赖数组，每次渲染后重挂一次，回调因此始终闭包到最新的 store/agent 状态。
  useEffect(() => {
    setLearnLinkHandler((term, hint) => {
      const parentId = getLatest().activeNodeId
      if (parentId) void openConcept(parentId, term, { hint, rewriteLink: false })
    })
    return () => setLearnLinkHandler(null)
  })

  /**
   * 「了解」：不建节点，只在这个词旁边挂一条两三句的注解。
   *
   * 交付物由**内置工作流「了解」**跑出来（见 learn/workflows 的 EXPLAIN_INSTRUCTION）：
   * 从前这里是一次性就地调用（generateShortAnnotation → 直接写注解），现在与开讲 / 回忆 /
   * 出卷同一条路——导师在对话里写解释，再由它自己调 api.doc.annotate 划到正文上。
   * 换过来的好处**在上下文**：导师已经知道这个目标讲过什么、他哪里卡过，
   * 写出来的释义与对话是连贯的；一次性那条路每次都是一段陌生的文档 + 一个陌生的词。
   *
   * prep 是 'show'：只响一声铃、不抢主位——交付物就画在用户盯着的那段文字旁边。
   */
  const understandConcept = (nodeId: string, term: string, occurrence?: number, snippet?: string) => {
    const node = nodeById(getLatest(), nodeId)
    if (!node) return
    if (!hasKey) {
      onToast(t('生成释义需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    // 「词条还在不在正文里」不在这里判：词条是跨元素选出来的，源文里根本没有这一段
    // 连续文字（中间隔着 **、[](…)、公式），拿 includes 判会把正常选择一并拦掉。
    // 真正的判断落在渲染结果上，由 NodeNote 在选词/保存时做（见 lib/annotation 的 canAnnotate）。
    if (node.annotations.some((a) => a.term === term)) {
      // 「了解」不覆盖已有注解：用户自己写的那条更值得保留
      onToast(t('「{0}」已有注解', term))
      return
    }
    agent.runWorkflow('explain', {
      nodeId,
      params: {
        term,
        occurrence: occurrence ?? 0,
        // 选段给导师一份：省掉它为了看一眼这个词先读整篇的那一步（序号与位置照旧以 term 为准）
        snippet: plainSnippet(snippet ?? '', 400),
      },
    })
    onToast(t('已请导师解释「{0}」，注解会划在正文上', term))
  }

  /* ---------- 选中文字 → 写自己的注解（支持 Markdown，可改可删） ---------- */

  const saveAnnotation = (nodeId: string, term: string, body: string, style?: AnnotationStyle, occurrence?: number) => {
    const node = nodeById(getLatest(), nodeId)
    if (!node) return
    // 「词条还在不在正文里」由 NodeNote 在渲染结果上判（同 understandConcept 的说明）
    const existed = node.annotations.some((a) => a.term === term && a.kind === 'note')
    // occurrence 是用户划词那一处的序号：同一个词出现好几回时要标到同一处
    set(addAnnotation(getLatest(), nodeId, term, body, 'note', style, occurrence))
    onToast(existed ? t('已更新「{0}」的注解', term) : t('已为「{0}」添加注解', term))
  }

  const deleteAnnotation = (nodeId: string, term: string) => {
    set(removeAnnotation(getLatest(), nodeId, term))
    onToast(t('已删除「{0}」的注解', term))
  }

  /* ---------- 选中一段文字 → 就地向 AI 提问 ---------- */

  /**
   * 「询问」：菜单里输入疑问后回车触发。位置由 NodeNote 在渲染 DOM 上
   * 映射成源文偏移后一并送来（见 lib/sourceMap），这里只负责组装上下文。
   * 只给位置、不复述选段内容——Agent 用 api.doc.readRange 按位置自取，
   * 既省 token 又保证读到的是文档当前的真实内容。
   */
  const askAboutSelection = (
    nodeId: string,
    payload: { question: string; text: string; start?: number; end?: number },
  ) => {
    const { question, text, start, end } = payload
    if (!hasKey) {
      onToast(t('提问需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
      return
    }
    const node = nodeById(getLatest(), nodeId)
    if (!node) return
    /**
     * 选段来自哪一份文档：**由激活的页签决定**（见宿主里的 docSource），不再看节点上那个
     * 「当前文档」字段——一个节点有多份笔记之后，「当前」只有页签说得清。
     * 拿不到（本地文件页签等）时按教学文档算，这也是 api.doc 省略 path 时的默认。
     */
    const kind: DocKind = docSource?.kind ?? 'teaching'
    const noteName = docSource?.note
    const docText = docSource?.content ?? ''
    const docName = kind === 'note' ? (noteName ? '笔记「' + noteName + '」' : '笔记') : '教学文档'
    const located = typeof start === 'number' && typeof end === 'number' && end > start
    // quote 存进消息：气泡里作为引文展示，点击可回到文档高亮这段文字
    const quote = located ? { text: text.slice(0, 300), start, end } : { text: text.slice(0, 300) }
    let context: string
    if (located) {
      const line = offsetToLineCol(docText, start).line
      // 指给模型的是 api.doc 的 path：笔记要带上名字，否则它不知道该改哪一份
      const path = kind === 'note' ? (noteName ? '笔记/' + noteName : '笔记') : ''
      context =
        `【选段位置】我在${docName}里选中了一段文字，它在 Markdown 源文中的字符区间是 ` +
        `[${start}, ${end})（左闭右开，约第 ${line} 行，共 ${end - start} 字）。` +
        `你可用 api.doc.readRange('${path}', ${start}, ${end}) 精确读取这段原文，不必整篇重读；` +
        `如需修改，用 api.doc.replace('${path}', { start, end, content, expected }) 按区间替换。` +
        `请针对这段内容回答我的疑问。`
    } else {
      context =
        `【选段位置】我在${docName}里选中了一段渲染后的内容，但没能把它映射回 Markdown 源文` +
        `（可能跨了代码块等结构）。请先用 api.doc.readRange 读一读${docName}再回答我的疑问。`
    }
    agent.send(question, { context, quote })
    onToast(t('已就选段提问，回复见右侧对话框'))
  }

  return {
    openConcept,
    understandConcept,
    saveAnnotation,
    deleteAnnotation,
    askAboutSelection,
  }
}
