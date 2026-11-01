/**
 * 组装：把上面各组的 ops 与「文档 / 节点」这一组本地实现接成一个 AgentOps。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：agentOps.ts 退成 barrel 之后，
 * 「每个 api 怎么落到 store 上」的接线留在这里；模块总说明仍留在 barrel 顶部。
 */

import type { DocRef, NodeRef, ResolvedDocRef, ResolvedNodeRef, SandboxDocKind } from '../../agent/tools'
import { loadAgentSettings } from '../../agent/settings'
import { layoutHintOf } from '../../agent/docFormat'
import type { AgentOps, AgentOpsDeps } from './deps'
import { docOf, type KnowledgeNode, type NoteFile } from '../types'
import { findNote, notesOf } from '../notes'
import { createNote, nodeById, updateDoc, writeNote } from '../graph'
import { nodePathOf, docPathOf, resolveDoc, resolveNode, type PathScope } from '../paths'
import { nodeLayout } from '../layout'
import { NODE_FILE_SUFFIX } from '../files/nodeFile'
import { NodeService } from '../nodeKinds'
import { createMethodOps } from './method'
import { createCodeOps } from './code'
import { createWorkflowOps } from './workflow'
import { createUserInfoOps } from './userinfo'
import { createResourceOps } from './resource'
import { createCompactOps } from './process'
import { createWorkspaceOps } from './workspace'
import { createProjectOps } from './project'
import { createChipOps } from './chip'
import { createScheduleOps } from '../schedule'
import { createVideoOps } from './video'

/**
 * 排版提醒（layoutHintOf，见 agent/docFormat）：挂在整篇写入教学文档的回执上——
 * 节点宇宙里走 docOps.write 的镜像同步，也走节点的 editContent（两处共用同一判定）。
 */
export function createAgentOps(deps: AgentOpsDeps): AgentOps {
  const store0 = () => deps.getLatest()
  const scope = (): PathScope => ({ goalId: deps.goalId(), currentNodeId: deps.nodeId() })
  /**
   * 一份笔记的定位：给了名字按名字找（大小写不敏感），没给名字取第一份。
   *
   * 一个节点可以有多份笔记（见 learn/notes），所以「笔记」这个词本身是不够的——
   * 不带名字时用第一份，是为了兼容更早的单一笔记时代，
   * 现在它仍然指向「最前面那份」，模型的旧习惯不至于当场失灵。
   */
  const findNoteOf = (node: KnowledgeNode, name?: string): NoteFile | undefined => {
    const list = notesOf(node)
    return name ? findNote(list, name) : list[0]
  }

  /** 文档在回执里的称呼：笔记带上名字，模型才知道刚才动的是哪一份 */
  const docLabel = (kind: SandboxDocKind, note?: string): string =>
    kind === 'teaching' ? '教学文档' : note ? '笔记「' + note + '」' : '笔记'

  const docText = (nodeId: string, kind: SandboxDocKind, note?: string): string => {
    const n = nodeById(store0(), nodeId)
    if (!n) return ''
    if (kind === 'teaching') return docOf(n, 'teaching')
    return findNoteOf(n, note)?.content ?? ''
  }

  /**
   * 写入某份文档的正文。
   *
   * 笔记**不存在就新建一份**（名字用它给的那个）：write 的语义是「让它变成这个内容」，
   * 而模型说「写进笔记」时想要的是「这段东西被记下来了」，不是「请告诉我没有这份笔记」。
   * 名字没给又一份笔记都没有时，按默认名建一份（见 learn/notes 的 NOTE_DEFAULT_NAME）。
   *
   * 返回最终落到哪份笔记的名字（教学文档为 null）——回执里要写它，
   * 否则模型下一轮再引用「笔记」时不知道指的是不是同一份。
   */
  const writeDocText = (
    nodeId: string,
    kind: SandboxDocKind,
    note: string | undefined,
    content: string,
  ): { ok: boolean; note: string | null } => {
    const s = store0()
    const node = nodeById(s, nodeId)
    if (!node) return { ok: false, note: null }
    if (kind === 'teaching') {
      deps.set(updateDoc(s, nodeId, content))
      return { ok: true, note: null }
    }
    const existing = findNoteOf(node, note)
    if (existing) {
      deps.set(writeNote(s, nodeId, existing.name, content))
      return { ok: true, note: existing.name }
    }
    const created = createNote(s, nodeId, note)
    if (!created.name) return { ok: false, note: null }
    deps.set(writeNote(created.store, nodeId, created.name, content))
    return { ok: true, note: created.name }
  }
  const toNodeRef = (node: KnowledgeNode): NodeRef => ({
    id: node.id,
    title: node.title,
    label: nodePathOf(store0(), deps.goalId(), node.id),
  })
  const toDocRef = (node: KnowledgeNode, kind: SandboxDocKind, note?: string): DocRef => {
    const base = toNodeRef(node)
    return {
      ...base,
      kind,
      ...(note ? { note } : {}),
      docLabel: docPathOf(store0(), deps.goalId(), node.id, kind, note),
    }
  }
  const resolveNodeRef = (path: string): ResolvedNodeRef => {
    const r = resolveNode(store0(), scope(), path)
    return r.ok ? { ok: true, ref: toNodeRef(r.value) } : { ok: false, message: r.message }
  }
  const resolveDocRef = (path: string): ResolvedDocRef => {
    const r = resolveDoc(store0(), scope(), path)
    return r.ok ? { ok: true, ref: toDocRef(r.value.node, r.value.kind, r.value.note) } : { ok: false, message: r.message }
  }

  /** 单个节点在数据根下的磁盘落点（files.* 空路径兜底用；一个节点一个文件，见 files/build） */
  const nodeDiskPath = (nodeId: string): string | null => {
    const layout = nodeLayout(store0()).get(nodeId)
    if (!layout) return null
    return 'docs/' + layout.dir.join('/') + '/' + layout.base + NODE_FILE_SUFFIX
  }

  /*
   * 节点宇宙（api.node）：行为在 learn/nodeKinds 的类型子类里，这里只把 NodeService
   * 接上 store 通道；出题阶段闸门与出卷后的视觉自检由界面层经 deps 注入（纯模型之外的事）。
   */
  const nodeService = () =>
    new NodeService({ getLatest: deps.getLatest, set: deps.set, goalId: deps.goalId })

  return {
    nodeId: deps.nodeId,
    resolveNode: resolveNodeRef,
    resolveDoc: resolveDocRef,
    docOps: {
      read: (nodeId, kind, note) => docText(nodeId, kind, note),
      write: (nodeId, kind, note, content) => {
        if (!content.trim()) return { ok: false, content: '内容为空，未做修改' }
        const r = writeDocText(nodeId, kind, note, content)
        if (!r.ok) return { ok: false, content: '写入失败：这个节点已经不在了' }
        return {
          ok: true,
          content:
            docLabel(kind, r.note ?? note) + '已整体写入（' + content.length + ' 字）' +
            layoutHintOf(kind, content, loadAgentSettings().docFormat),
        }
      },
    },
    nodes: {
      service: nodeService,
      ...(deps.nodeGuard ? { guard: deps.nodeGuard } : {}),
      ...(deps.afterNodeEdit ? { afterEdit: deps.afterNodeEdit } : {}),
    },
    docPath: nodeDiskPath,

    // 目标级持久化函数与工作流：纯 store 逻辑，总是可用（见 learn/methods、learn/workflows）
    methods: createMethodOps(deps),
    workflows: createWorkflowOps(deps),
    // 代码块伪编译的交付口：纯渲染层逻辑（产物表 + 待编译登记），总是可用
    code: createCodeOps(),
    // 日程：用户级的提醒清单（见 learn/schedule）——agent 能排、能改，响铃在宿主那边
    schedule: createScheduleOps({ getLatest: deps.getLatest, set: deps.set, goalId: deps.goalId }),
    ...(deps.userInfo ? { userInfo: createUserInfoOps(deps.userInfo) } : {}),
    ...(deps.tmp ? { tmp: deps.tmp } : {}),
    ...(deps.exam ? { exam: deps.exam } : {}),
    ...(deps.resourceIo ? { resources: createResourceOps(deps, deps.resourceIo) } : {}),
    // 工作区目录：真实系统文件的读写（见 learn/ops/workspace）；磁盘那一层由界面注入
    ...(deps.workspaceIo ? { workspace: createWorkspaceOps(deps, deps.workspaceIo) } : {}),
    // 项目路径：对已声明 project 节点的真实路径做文件操作（声明即授权，见 learn/ops/project）
    ...(deps.projectIo ? { project: createProjectOps(deps, deps.projectIo) } : {}),
    // 上下文压缩：纯 store 逻辑，总是可用（见 learn/compact）
    compact: createCompactOps(deps),
    // 引用 chip：生成与交付前自查——build 当场对 store 验证可定位（见 learn/ops/chip）
    chip: createChipOps(deps),
    video: createVideoOps(deps),
    // 读网页：实现整个由界面层给（见 learn/webDocs），这里只接线
    ...(deps.web ? { web: deps.web } : {}),
    // 看图（顶层 api.see）：实现由界面层给（见 learn/see），这里只接线
    ...(deps.see ? { see: deps.see } : {}),
  }
}