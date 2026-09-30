import type { KnowledgeNode, LearnStore, DocKind } from './types'
import { isDocKind } from './types'
import { nodeById, normalizeKey, pathToRoot, prereqIds } from './graph'
import { notesOf } from './notes'

/**
 * 路径寻址：Agent 在沙箱里怎么指名「哪个节点的哪份文档」。
 *
 * 为什么要有这一层：会话上下文改成目标级之后，一次对话里 Agent 会同时碰好几个节点
 * （给上一个节点写文档、给这一个改描述、再建一个新节点）。旧 api 全部隐式作用于
 * 「当前节点」，那样它根本没法表达「改那一个」。所以凡是指向文档/节点的 api 都收一个
 * path 参数，语法与文件路径同构：
 *
 *     省略 / ""        当前节点的教学文档（默认）
 *     "笔记"           当前节点的笔记文档
 *     "极限"           本目标里标题为「极限」的节点（教学文档）
 *     "极限/笔记"      同一个节点的笔记文档
 *     "极限/夹逼定理"  从目标根往里走的写法，读起来更像路径
 *     "#3f2a…/笔记"    直接给节点 id（链接与 api.node.list 里拿到的就是它，最不会认错）
 *
 * 两条让解析确定下来的性质：
 * 1. **同一个目标内标题（归一化后）唯一**——addNode 就按这个去重，因此任意一段标题
 *    在目标内最多命中一个节点，路径不需要歧义消解。
 * 2. 走不通就退一步按「最后一段标题在目标内唯一」直接找。多段路径因此只是更好读，
 *    少写一层、中间那层改过名，都还能命中。
 *
 * 失败信息里一定带上「这个节点下有哪些子节点」，模型据此一轮就能改对，
 * 不必反复试探——这是这套 api 能不能被用起来的关键。
 */

/** 省略 nodeId（相对路径）时用哪一份上下文：目标 + 当前打开的节点 */
export interface PathScope {
  goalId: string
  currentNodeId: string | null
}

export interface ResolvedDoc {
  node: KnowledgeNode
  kind: DocKind
  /** kind 为 'note' 时的笔记名；只写「笔记」没写名字时为 undefined（= 第一份 / 新建那份） */
  note?: string
}

export type ResolveResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** 指代「当前节点」的写法；模型这几种都可能写，一律认 */
const CURRENT_ALIASES = new Set(['当前', '当前节点', '本节点', 'this', 'current', '.', '@'])

/** 文档名的写法：中文全称、中文简称与英文都认，大小写不敏感 */
function docKindOfWord(word: string): DocKind | null {
  const w = word.trim().toLowerCase()
  if (isDocKind(w)) return w
  if (w === '教学' || w === '教学文档' || w === '正文' || w === '大纲') return 'teaching'
  if (w === '笔记' || w === '笔记文档' || w === '我的笔记' || w === 'notes') return 'note'
  return null
}

export interface SplitDocPath {
  /** 节点部分的各段（标题或 #id） */
  segments: string[]
  kind: DocKind
  /** 要哪一份笔记；省略表示「这个节点的第一份笔记」 */
  note?: string
}

/**
 * 把 path 拆成「节点部分」「文档类型」「哪一份笔记」。
 *
 * 与一节点一份笔记时的差别：文档类型那个词**后面还可以跟一份笔记的名字**，
 * 如「极限/笔记/错题本」。因此判据从「最后一段是文档名吗」改成「第一个文档名词在哪」——
 * 它之前是节点路径，之后是笔记名。只写「笔记」不带名字仍然认，表示第一份。
 *
 * 节点自己叫「笔记」时（真有这种节点）会与这个词撞上：那时请用 #id 指名节点
 * （api.node.list 里给的就是 id），就像以前一样。
 */
export function splitDocPath(path: string | undefined): SplitDocPath {
  const segments = (path ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
  const i = segments.findIndex((s) => docKindOfWord(s) !== null)
  if (i < 0) return { segments, kind: 'teaching' }
  const kind = docKindOfWord(segments[i]) as DocKind
  if (kind === 'teaching') return { segments: segments.slice(0, i), kind }
  const note = segments.slice(i + 1).join('/').trim()
  return { segments: segments.slice(0, i), kind, ...(note ? { note } : {}) }
}

function goalRoot(store: LearnStore, goalId: string): KnowledgeNode | undefined {
  const goal = store.goals.find((g) => g.id === goalId)
  return goal ? nodeById(store, goal.rootNodeId) : undefined
}

/** 按「id（# 前缀）」或「标题（目标内唯一）」找节点 */
export function findNodeByRef(store: LearnStore, goalId: string, ref: string): KnowledgeNode | undefined {
  const r = ref.trim()
  if (!r) return undefined
  if (r.startsWith('#')) {
    const id = r.slice(1).trim()
    return store.nodes.find((n) => n.id === id)
  }
  const key = normalizeKey(r)
  return store.nodes.find((n) => n.goalId === goalId && n.key === key)
}

/** 该节点在本目标里的标题路径，如「极限/夹逼定理」；找不到根时退回标题 */
export function nodePathOf(store: LearnStore, goalId: string, nodeId: string): string {
  const goal = store.goals.find((g) => g.id === goalId)
  const node = nodeById(store, nodeId)
  if (!goal || !node) return node?.title ?? nodeId
  const chain = pathToRoot(store, goal.rootNodeId, nodeId)
  if (!chain) return node.title
  return chain.map((id) => nodeById(store, id)?.title ?? id).join('/')
}

/** 文档的完整路径，用于回给模型确认「改的是哪一份」（笔记带上名字，否则它不知道改的是哪份） */
export function docPathOf(
  store: LearnStore,
  goalId: string,
  nodeId: string,
  kind: DocKind,
  note?: string,
): string {
  const base = nodePathOf(store, goalId, nodeId)
  if (kind === 'note') return base + '/笔记' + (note ? '/' + note : '')
  return base + '/教学'
}

/** 候选清单：路径找不到时列出来，模型据此一轮改对 */
function candidatesText(store: LearnStore, goalId: string, from: KnowledgeNode | undefined): string {
  const own = from ? '「' + from.title + '」' : '本目标'
  const children = from
    ? prereqIds(store, from.id)
        .map((id) => nodeById(store, id))
        .filter((n): n is KnowledgeNode => !!n)
    : []
  if (!children.length) {
    const all = store.nodes.filter((n) => n.goalId === goalId)
    if (!all.length) return own + '下还没有任何节点。'
    return (
      own + '下没有子节点。本目标的全部节点：' + all.slice(0, 20).map((n) => n.title).join('、')
    )
  }
  const head = children.slice(0, 20).map((n) => n.title + '（#' + n.id + '）')
  return own + '现有的子节点：' + head.join('、') + (children.length > 20 ? ' 等' : '')
}

/** path → 节点 */
export function resolveNode(
  store: LearnStore,
  scope: PathScope,
  path: string | undefined,
): ResolveResult<KnowledgeNode> {
  const { segments } = splitDocPath(path)
  const current = scope.currentNodeId ? nodeById(store, scope.currentNodeId) : undefined

  if (!segments.length) {
    if (current) return { ok: true, value: current }
    return { ok: false, message: '没有指定节点，此刻也没有打开的节点；先 api.node.list() 看看有哪些节点' }
  }

  if (segments.length === 1) {
    const only = segments[0]
    if (CURRENT_ALIASES.has(only.toLowerCase())) {
      if (current) return { ok: true, value: current }
      return { ok: false, message: '「当前节点」此刻不存在，请用 api.node.list() 指名一个节点' }
    }
    const found = findNodeByRef(store, scope.goalId, only)
    if (found) return { ok: true, value: found }
    return {
      ok: false,
      message: '本目标里没有「' + only + '」这个节点。' + candidatesText(store, scope.goalId, goalRoot(store, scope.goalId)),
    }
  }

  // 多段：从根（或某个起点）逐段往下走
  let cursor: KnowledgeNode | undefined
  let i = 0
  if (segments[0].startsWith('#')) {
    cursor = findNodeByRef(store, scope.goalId, segments[0])
    i = 1
  } else if (CURRENT_ALIASES.has(segments[0].toLowerCase())) {
    cursor = current
    i = 1
  } else {
    cursor = goalRoot(store, scope.goalId)
  }
  if (!cursor) {
    return {
      ok: false,
      message: '路径「' + segments.join('/') + '」的起点找不到。' + candidatesText(store, scope.goalId, undefined),
    }
  }

  let deepest: KnowledgeNode = cursor
  let here: KnowledgeNode = cursor
  for (; i < segments.length; i++) {
    const seg = segments[i]
    const kids: Array<KnowledgeNode | undefined> = prereqIds(store, here.id).map((id) => nodeById(store, id))
    const child = kids.find((n): n is KnowledgeNode => !!n && (n.key === normalizeKey(seg) || n.id === seg))
    if (!child) {
      /*
       * 走不通了。多段路径只是「更好读」的写法，真正定位靠的是标题在目标内唯一，
       * 所以退一步按最后一段直接找——少写一层、中间那层改名了，都还能命中。
       */
      const fallback = findNodeByRef(store, scope.goalId, segments[segments.length - 1])
      if (fallback) return { ok: true, value: fallback }
      return {
        ok: false,
        message: '路径「' + segments.join('/') + '」走不通：' + candidatesText(store, scope.goalId, deepest),
      }
    }
    here = child
    deepest = child
  }
  return { ok: true, value: here }
}

/** path → 节点 + 文档类型 + 哪一份笔记 */
export function resolveDoc(
  store: LearnStore,
  scope: PathScope,
  path: string | undefined,
): ResolveResult<ResolvedDoc> {
  const { kind, note } = splitDocPath(path)
  const r = resolveNode(store, scope, path)
  if (!r.ok) return r
  return { ok: true, value: { node: r.value, kind, ...(note ? { note } : {}) } }
}

/** 一份文档在清单里的样子 */
export interface DocInfo {
  doc: DocKind
  /** 给人（与模型）看的名字：教学文档 / 笔记「错题本」 */
  label: string
  /** 笔记名；教学文档没有这一项 */
  note?: string
  chars: number
  empty: boolean
}

/**
 * 一个节点的全部文档及其字数。
 * Agent 想知道「这个节点有几份文档、各写了多少」时看它，不必先把正文读进上下文。
 *
 * 笔记**一份一行**（名字要带上）：模型据此知道「写进哪一份」，
 * 只报一个「笔记 120 字」的话，它接着只能瞎猜一个名字，然后得到一句「没有这份笔记」。
 * 一份笔记都没有时给一行空笔记占位：写「笔记」时会自动建一份，这件事得说出来。
 */
export function docsInfoOf(node: KnowledgeNode): DocInfo[] {
  const teaching = node.docs?.teaching ?? ''
  const list: DocInfo[] = [
    { doc: 'teaching', label: '教学文档', chars: teaching.length, empty: !teaching.trim() },
  ]
  const notes = notesOf(node)
  for (const n of notes) {
    list.push({ doc: 'note', label: '笔记「' + n.name + '」', note: n.name, chars: n.content.length, empty: !n.content.trim() })
  }
  if (!notes.length) list.push({ doc: 'note', label: '笔记（还没有，写入时自动新建一份）', chars: 0, empty: true })
  return list
}
