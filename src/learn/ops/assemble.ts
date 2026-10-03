/**
 * 组装：把上面各组的 ops 与「文档 / 节点」这一组本地实现接成一个 AgentOps。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：agentOps.ts 退成 barrel 之后，
 * 「每个 api 怎么落到 store 上」的接线留在这里；模块总说明仍留在 barrel 顶部。
 */

import type { AgentToolResult } from '../../agent/types'
import type { DocRef, NodeRef, ResolvedDocRef, ResolvedNodeRef, SandboxDocKind } from '../../agent/tools'
import type { AgentOps, AgentOpsDeps } from './deps'
import { MASTERY_LABEL, SELF_REPORT_LABEL, docOf, superDocsOf, type KnowledgeNode, type MasteryStatus, type NoteFile } from '../types'
import { NOTE_DEFAULT_NAME, findNote, notesOf } from '../notes'
import {
  addAnnotation,
  addEdge,
  appendNote,
  createNodeUnder,
  createNote,
  deleteNode,
  moveNode,
  nodeById,
  parentIds,
  prereqIds,
  titleTaken,
  updateDoc,
  updateNode,
  writeNote,
} from '../graph'
import { nodePathOf, docsInfoOf, docPathOf, resolveDoc, resolveNode, type PathScope } from '../paths'
import { writeOutline } from '../outline'
import { ensureReviewPlan } from '../review'
import { clipText } from './text'
import { createLearningOps } from './learning'
import { createSuperDocOps } from './superdoc'
import { createMethodOps } from './method'
import { createCodeOps } from './code'
import { createWorkflowOps } from './workflow'
import { createUserInfoOps } from './userinfo'
import { createResourceOps } from './resource'
import { createAttentionOps, createCheckinOps, createCompactOps, createPomodoroOps, createReadingOps } from './process'
import { createReviewOps } from './review'
import { createWorkspaceOps } from './workspace'
import { createChipOps } from './chip'

export function createAgentOps(deps: AgentOpsDeps): AgentOps {
  const store0 = () => deps.getLatest()
  const scope = (): PathScope => ({ goalId: deps.goalId(), currentNodeId: deps.nodeId() })
  /**
   * 一份笔记的定位：给了名字按名字找（大小写不敏感），没给名字取第一份。
   *
   * 一个节点可以有多份笔记（见 learn/notes），所以「笔记」这个词本身是不够的——
   * 不带名字时用第一份，是为了兼容老写法（api.doc.read('笔记')）：那时节点只有一份，
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

  /** 目标里的节点总览：一次编排常常要「先看看有哪些节点」再决定动谁 */
  const nodeInventory = (): unknown => {
    const s = store0()
    const goal = s.goals.find((g) => g.id === deps.goalId())
    const nodes = s.nodes.filter((n) => n.goalId === deps.goalId())
    return {
      goal: goal ? { id: goal.id, question: clipText(goal.question, 200) } : null,
      current: nodeById(s, deps.nodeId() ?? '')?.title ?? null,
      count: nodes.length,
      nodes: nodes.map((n) => {
        const info = docsInfoOf(n)
        return {
          path: nodePathOf(s, deps.goalId(), n.id),
          id: n.id,
          title: n.title,
          status: n.status,
          isGoal: s.goals.some((g) => g.rootNodeId === n.id),
          description: clipText(n.description, 120),
          chars: info.map((d) => d.label + ' ' + d.chars).join('，'),
          // 规划路径要看的是「他会不会」，所以清单里带上掌握度与自评（见 design 的第二节）
          mastery: typeof n.learning?.mastery === 'number' ? n.learning.mastery : null,
          self: n.learning?.self ? SELF_REPORT_LABEL[n.learning.self] : null,
          mistakes: n.learning?.mistakes?.length ?? 0,
          prereqs: prereqIds(s, n.id)
            .map((id) => nodeById(s, id)?.title)
            .filter((t): t is string => !!t),
        }
      }),
    }
  }

  /** 单个节点的详情：标题、描述、状态、各文档字数、上下级 */
  const nodeDetail = (nodeId: string): unknown => {
    const s = store0()
    const n = nodeById(s, nodeId)
    if (!n) return { error: '这个节点已经不存在了（可能刚被删除）' }
    return {
      path: nodePathOf(s, deps.goalId(), n.id),
      id: n.id,
      title: n.title,
      description: n.description,
      status: n.status,
      isGoal: s.goals.some((g) => g.rootNodeId === n.id),
      docs: docsInfoOf(n).map((d) => ({ 文档: d.label, 字数: d.chars, 空: d.empty })),
      superdocs: superDocsOf(n).map((d) => ({ 名称: d.name, 字数: d.html.length, 空: !d.html.trim() })),
      learning: n.learning ?? null,
      parents: parentIds(s, n.id)
        .map((id) => nodeById(s, id)?.title)
        .filter((t): t is string => !!t),
      prereqs: prereqIds(s, n.id)
        .map((id) => nodeById(s, id)?.title)
        .filter((t): t is string => !!t),
    }
  }

  const createNode = (parentId: string, input: { title: string; description?: string }): AgentToolResult => {
    const s = store0()
    const parent = nodeById(s, parentId)
    if (!parent) return { ok: false, content: '父节点不存在' }
    const r = createNodeUnder(s, parentId, input)
    // 目标内已有同名节点时复用：仍然要把它挂到这次请求的父节点之下
    const next = r.created ? r.store : addEdge(r.store, parentId, r.node.id).store
    deps.set(next)
    const label = nodePathOf(next, deps.goalId(), r.node.id)
    return {
      ok: true,
      content: r.created
        ? '已创建节点「' + r.node.title + '」（路径 ' + label + '，id #' + r.node.id +
          '）。教学文档与大纲两份文件已同时就位（都还是空的），接着写：api.description.update、' +
          'api.doc.write（教学文档）与 api.outline.write（大纲，只写直接子层级一层）。'
        : '本目标里已经有「' + r.node.title + '」（路径 ' + label + '），没有重复创建；' +
          '已把它挂到「' + parent.title + '」之下。',
    }
  }

  /** 迁移节点到另一个节点之下（层级变了，大纲与侧栏跟着新父线走） */
  const moveNodeRef = (nodeId: string, newParentId: string): AgentToolResult => {
    const s = store0()
    const node = nodeById(s, nodeId)
    if (!node) return { ok: false, content: '这个节点已经不存在了（可能刚被删除）' }
    const parent = nodeById(s, newParentId)
    if (!parent) return { ok: false, content: '新父节点已经不存在了（可能刚被删除）' }
    const r = moveNode(s, nodeId, newParentId)
    if (r.moved) deps.set(r.store)
    if (!r.moved) return { ok: false, content: r.message }
    return {
      ok: true,
      content:
        '已把「' + node.title + '」移到「' + parent.title + '」之下。它现在的路径是「' +
        nodePathOf(r.store, deps.goalId(), nodeId) + '」。',
    }
  }

  const updateNodeRef = (
    nodeId: string,
    patch: { title?: string; description?: string; status?: MasteryStatus },
  ): AgentToolResult => {
    const s = store0()
    const node = nodeById(s, nodeId)
    if (!node) return { ok: false, content: '这个节点已经不存在了（可能刚被删除）' }
    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) return { ok: false, content: '标题不能为空' }
      // 同目标内标题必须唯一：路径寻址全靠它，重名之后 path 就指不明白是谁了
      const clash = titleTaken(s, node.goalId, title, nodeId)
      if (clash) {
        return {
          ok: false,
          content:
            '本目标里已经有叫「' + clash.title + '」的节点了。同名节点会让路径指不明白，' +
            '请换一个标题，或先给那个节点改名。',
        }
      }
    }
    const next = updateNode(s, nodeId, patch)
    // 状态首次变「已掌握」：复习计划在这里跟着建（与 setNodeStatus 同一条系统侧钩子，见 learn/review）。
    // nodeOps.update 不走 setNodeStatus（标题/描述/状态一次一单），所以这条钩子得单独挂
    const withPlan = patch.status === 'mastered' ? ensureReviewPlan(next, nodeId, Date.now()) : next
    deps.set(withPlan)
    const label = nodePathOf(next, deps.goalId(), nodeId)
    const done: string[] = []
    if (patch.title !== undefined) done.push('标题改为「' + patch.title.trim() + '」')
    if (patch.description !== undefined) done.push('描述已更新（' + patch.description.length + ' 字）')
    if (patch.status !== undefined) done.push('状态改为「' + MASTERY_LABEL[patch.status] + '」')
    return { ok: true, content: done.join('；') + '。它现在的路径是「' + label + '」。' }
  }

  const removeNode = (nodeId: string): AgentToolResult => {
    const s = store0()
    const node = nodeById(s, nodeId)
    if (!node) return { ok: false, content: '这个节点已经不存在了' }
    /*
     * 根节点不能从这里删：deleteNode 对根节点的语义是「删掉整个目标」，
     * 一句 api.node.delete() 就把用户整个学习目标连同对话一起抹掉，代价太大。
     */
    if (s.goals.some((g) => g.rootNodeId === nodeId)) {
      return {
        ok: false,
        content: '「' + node.title + '」是学习目标本身，不能这样删。要删目标请让用户在界面上删。',
      }
    }
    const kids = prereqIds(s, nodeId).length
    deps.set(deleteNode(s, nodeId))
    return {
      ok: true,
      content:
        '已删除节点「' + node.title + '」' +
        (kids ? '（它原有 ' + kids + ' 个下级节点，这些节点本身保留，只是不再挂在它下面）' : '') + '。',
    }
  }

  /**
   * 按字符区间替换某份文档（不传区间即整篇重写）。
   * 与旧版的 update_note_range 行为一致：expected 不符就拒绝，绝不猜位置。
   */
  const replaceDocRange = (
    nodeId: string,
    kind: SandboxDocKind,
    note: string | undefined,
    req: { start?: number; end?: number; content: string; expected?: string },
  ): AgentToolResult => {
    /*
     * 指名了一份还不存在的笔记时：整篇重写（没给区间）按「新建并写入」处理，
     * 与 doc.write 一致；带区间的替换则只能报错——一份空笔记里没有任何区间可替换，
     * 回执要说清「它还不存在」，模型才知道该改用 write。
     */
    const node = nodeById(store0(), nodeId)
    const missing = kind === 'note' && !!note && !!node && !findNote(notesOf(node), note)
    if (missing && (req.start !== undefined || req.end !== undefined)) {
      return {
        ok: false,
        content:
          '这个节点下还没有名为「' + note + '」的笔记，区间替换无从谈起。' +
          '整篇写入请用 api.doc.write("笔记/' + note + '", 内容)。',
      }
    }
    const full = docText(nodeId, kind, note)
    const label = docLabel(kind, note)
    const total = full.length
    const whole = req.start === undefined && req.end === undefined
    const start = whole ? 0 : (req.start ?? 0)
    const rawEnd = whole || req.end === undefined ? total : req.end
    if (start < 0 || rawEnd < start) {
      return { ok: false, content: '区间不合法：需满足 0 ≤ start ≤ end，收到 start=' + start + ' end=' + rawEnd }
    }
    if (start > total) {
      return { ok: false, content: '起点 ' + start + ' 超出' + label + '长度（共 ' + total + ' 字）' }
    }
    const end = Math.min(rawEnd, total)
    const current = full.slice(start, end)
    if (typeof req.expected === 'string' && req.expected !== current) {
      return {
        ok: false,
        content:
          '位置校验失败：区间 [' + start + ', ' + end + ') 当前是「' + current.slice(0, 80) + '」' +
          '，与 expected 不符。可能已被改动，请重新 readRange 定位后再改。',
      }
    }
    if (whole && !req.content.trim()) return { ok: false, content: '内容为空，未做修改' }
    const written = writeDocText(nodeId, kind, note, full.slice(0, start) + req.content + full.slice(end))
    if (!written.ok) {
      return { ok: false, content: '写入失败：节点已经不在了，请重新 api.node.list() 看一眼' }
    }
    const delta = req.content.length - (end - start)
    if (whole) {
      return {
        ok: true,
        content: docLabel(kind, written.note ?? note) + '已整体更新（' + req.content.length + ' 字）',
      }
    }
    return {
      ok: true,
      content:
        '已替换' + label + '的区间 [' + start + ', ' + end + ')（原 ' + (end - start) + ' 字 → 新 ' +
        req.content.length + ' 字）。它现共 ' + (total + delta) + ' 字；其后位置的偏移需相应' +
        (delta >= 0 ? '增加 ' + delta : '减少 ' + -delta) + '。',
    }
  }

  /**
   * 追加到某份文档末尾（空行分隔，与旧行为一致）。
   *
   * 笔记不存在时**新建一份再写**（见 graph 的 appendNote）：模型说「记到笔记里」，
   * 而节点上还没有笔记时，正确的反应是记下来，而不是回一句「没有这份笔记」让它再试一轮。
   */
  const appendDoc = (
    nodeId: string,
    kind: SandboxDocKind,
    note: string | undefined,
    content: string,
  ): AgentToolResult => {
    if (!content.trim()) return { ok: false, content: '内容为空，未做修改' }
    if (kind === 'teaching') {
      const cur = docText(nodeId, kind)
      deps.set(updateDoc(store0(), nodeId, cur ? cur + '\n\n' + content : content))
      return { ok: true, content: '已追加到教学文档末尾（' + content.length + ' 字）' }
    }
    const r = appendNote(store0(), nodeId, note ?? NOTE_DEFAULT_NAME, content)
    if (!r.name) return { ok: false, content: '写入失败：这个节点已经不在了' }
    // 别忘了把新 store 交回去：漏了这一句，回执说「已追加」而内容根本没落进 store，
    // 是那种「界面看着对、下一轮读回来却发现没写」的错（探针当场抓到过）
    deps.set(r.store)
    return { ok: true, content: '已追加到' + docLabel(kind, r.name) + '末尾（' + content.length + ' 字）' }
  }

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
          content: docLabel(kind, r.note ?? note) + '已整体写入（' + content.length + ' 字）',
        }
      },
      replace: replaceDocRange,
      append: appendDoc,
      /*
       * 注解（正文旁边那一条虚线词条）：**挂在节点上**，不属于某一份文档——
       * 这个节点的教学文档与它每一份笔记都共用同一批注解（见 learn/types 的 Annotation）。
       * 因此 path 只用来找节点，落在哪一份文档上不影响结果。
       *
       * term 与 occurrence 都照用户划词那一刻记下的来：同一个词在正文里出现好几回时，
       * 序号决定标记落在哪一处（见 graph 的 addAnnotation）。
       */
      annotate: (nodeId, input) => {
        const term = input.term.trim()
        if (!term) {
          return { ok: false, content: '词条为空：api.doc.annotate({ term, body }) 里的 term 是正文里那一小段文字' }
        }
        if (!input.body.trim()) {
          return { ok: false, content: '注解正文为空：body 写两三句 Markdown，说清它在这篇文档里是什么意思' }
        }
        const s = store0()
        if (!s.nodes.some((n) => n.id === nodeId)) return { ok: false, content: '写入失败：这个节点已经不在了' }
        const existed = nodeById(s, nodeId)?.annotations.some((a) => a.term === term) ?? false
        deps.set(addAnnotation(s, nodeId, term, input.body, 'understand', undefined, input.occurrence))
        return {
          ok: true,
          content:
            (existed ? '已更新' : '已添加') +
            '「' + term + '」的注解（' + input.body.trim().length + ' 字，已划在正文上）',
        }
      },
    },
    nodeOps: {
      list: nodeInventory,
      read: nodeDetail,
      create: createNode,
      update: updateNodeRef,
      remove: removeNode,
      move: moveNodeRef,
    },
    /**
     * 目标大纲（见 learn/outline）：结构化的计划，read 整份回、write 整份覆盖。
     * 没有写过的大纲 read 回 null——那不是错误，模型据此知道要先写一份。
     */
    outline: {
      read: (nodeId) => {
        const n = nodeById(store0(), nodeId)
        return n ? (n.outline ?? null) : { error: '这个节点已经不存在了（可能刚被删除）' }
      },
      write: (nodeId, input) => {
        const r = writeOutline(store0(), nodeId, input, Date.now())
        if (!r.ok) return { ok: false, content: r.error }
        // 别忘了把新 store 交回去（与 appendDoc 同一条教训）：只算不交，回执说「已写入」
        // 而内容根本没落进 store——探针的「写入后立刻读回」当场抓到过这一类错。
        deps.set(r.store)
        const node = nodeById(r.store, nodeId)
        return {
          ok: true,
          content:
            '大纲已写入「' + (node?.title ?? '') + '」：导语 ' + r.outline.intro.length +
            ' 字，子目标 ' + r.outline.children.length + ' 个（只此一层，' +
            '孙辈的大纲由那些子目标自己的 outline 负责）。大纲页会显示每个子目标的学习情况。',
        }
      },
    },
    // 学习状态不需要外部能力（不像 res 要磁盘、exam 要试卷），因此总是可用
    state: createLearningOps(deps),
    // 目标级持久化函数、超级文档、工作流：都是纯 store 逻辑，总是可用
    // （见 learn/methods、learn/superdocs、learn/workflows）
    methods: createMethodOps(deps),
    superdocs: createSuperDocOps(deps),
    workflows: createWorkflowOps(deps),
    // 代码块伪编译的交付口：纯渲染层逻辑（产物表 + 待编译登记），总是可用
    code: createCodeOps(),
    // 学习过程：阅读事实、注意力评级、打卡、番茄钟——都是纯 store 逻辑，总是可用
    // （见 learn/reading、learn/attention、learn/checkin、learn/pomodoro）
    reading: createReadingOps(deps),
    attention: createAttentionOps(deps),
    checkin: createCheckinOps(deps),
    review: createReviewOps(deps),
    pomodoro: createPomodoroOps(deps),
    ...(deps.userInfo ? { userInfo: createUserInfoOps(deps.userInfo) } : {}),
    ...(deps.tmp ? { tmp: deps.tmp } : {}),
    ...(deps.exam ? { exam: deps.exam } : {}),
    ...(deps.resourceIo ? { resources: createResourceOps(deps, deps.resourceIo) } : {}),
    // 工作区目录：真实系统文件的读写（见 learn/ops/workspace）；磁盘那一层由界面注入
    ...(deps.workspaceIo ? { workspace: createWorkspaceOps(deps, deps.workspaceIo) } : {}),
    // 上下文压缩：纯 store 逻辑，总是可用（见 learn/compact）
    compact: createCompactOps(deps),
    // 引用 chip：生成与交付前自查——build 当场对 store 验证可定位（见 learn/ops/chip）
    chip: createChipOps(deps),
    // 读网页：实现整个由界面层给（见 learn/webDocs），这里只接线
    ...(deps.web ? { web: deps.web } : {}),
  }
}
