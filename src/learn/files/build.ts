/** 这个文件负责什么：内存 → 磁盘——把整份学习数据摊成「相对路径 → 文件内容」（buildDocs），以及某个节点的文档在数据根下的落点（nodeDocPath）。 */

/* ---------- 内存 → 磁盘 ---------- */

import type { DependencyEdge, DocKind, LearnStore, NodeDocs } from '../types'
import type { Exam } from '../exam'
import { DOCS_DIR, MANIFEST_FILE, STATIC_DIR, nodeLayout } from '../layout'
import { manifestText } from '../static/manifest'
import { docFileName, noteFileName, outlineFileName } from './names'
import { CHAT_VERSION, META_VERSION, jsonText, tmpText, type MetaFile } from './meta'

/**
 * 一个节点上一次序列化出来的 meta.json 文本（见 buildDocs 里的复用判断）。
 *
 * 为什么可以复用：这一段是整份摊平里最贵的一笔（每个节点一次 JSON.stringify(…, null, 2)），
 * 而一次保存里绝大多数节点一个字都没动。凭据是**节点对象本身 + 派生它的那三份 store 级数组**：
 * store 是不可变的（图操作一律返回新 store，数组只换不原地改），这四样全同就意味着
 * 这一份 meta 的每个字段都同、JSON 文本逐字节相同。
 *
 * 每次 buildDocs 都重建这张表、只把凭据仍然成立的条目搬过去：表的大小因此跟着当前节点数走，
 * 删掉的节点不会留在这里。
 */
interface MetaCacheEntry {
  node: LearnStore['nodes'][number]
  edges: LearnStore['edges']
  exams: LearnStore['exams']
  goals: LearnStore['goals']
  text: string
}

let metaCache = new Map<string, MetaCacheEntry>()

/** 凭据全同 ⇒ 上一份 meta.json 文本可以原样再用（理由见 MetaCacheEntry） */
function metaReusable(
  cached: MetaCacheEntry | undefined,
  node: MetaCacheEntry['node'],
  store: LearnStore,
): cached is MetaCacheEntry {
  return (
    !!cached &&
    cached.node === node &&
    cached.edges === store.edges &&
    cached.exams === store.exams &&
    cached.goals === store.goals
  )
}

/**
 * 把整份学习数据摊成「相对路径 → 文件内容」。
 *
 * 路径是**相对用户根目录**的，必须以 `docs/` 开头——读（parseDocs）、写
 * （store 的 userRel）、差异比对（diffDocs）三处共用同一套路径，
 * 少一层前缀就会「写得进去、读不回来」。
 *
 * 保存时拿它与上一次的快照比对，只写真正变了的文件。
 */
export function buildDocs(store: LearnStore): Map<string, string> {
  const files = new Map<string, string>()
  const byId = new Map(store.nodes.map((n) => [n.id, n]))

  // 依赖边按来源分组：写进各自的 meta.json
  const deps = new Map<string, DependencyEdge[]>()
  for (const e of store.edges) {
    const dl = deps.get(e.from)
    if (dl) dl.push(e)
    else deps.set(e.from, [e])
  }

  /**
   * 检验记录按节点分组、目标按 id 查表：都搬到按节点循环的**外面**做一次。
   *
   * 循环体里原先每次都是 `store.exams.filter(…)` 与 `store.goals.find(…)`，
   * 整份摊平因此是 O(节点数 × 检验数 + 节点数 × 目标数)：节点一多，每 320ms 一次的
   * 保存就变成纯浪费（这个函数还会在启动 hydrate 时各跑一遍）。
   *
   * 顺序与原写法逐个对齐：分组保持 store.exams 的先后（= filter 的结果），
   * 同 id 的目标只记第一个（= find 的结果），因此 meta.json 的内容逐字节不变。
   */
  const examsOf = new Map<string, Exam[]>()
  for (const e of store.exams) {
    const list = examsOf.get(e.nodeId)
    if (list) list.push(e)
    else examsOf.set(e.nodeId, [e])
  }
  const goalById = new Map<string, LearnStore['goals'][number]>()
  for (const g of store.goals) if (!goalById.has(g.id)) goalById.set(g.id, g)

  /** 这一轮还要复用的 meta 文本；循环结束后整张换上去（见 MetaCacheEntry） */
  const nextMetaCache = new Map<string, MetaCacheEntry>()

  for (const [id, { dir, base }] of nodeLayout(store)) {
    const node = byId.get(id)
    if (!node) continue
    const goal = goalById.get(node.goalId)
    // 目标目录及其下的层级都落在 docs/ 之下
    const path = [DOCS_DIR, ...dir].join('/')
    const docs: NodeDocs = node.docs ?? { teaching: '' }
    // 教学文档一律写出：它是节点的主体，别的工具（资源管理器、外部编辑器）都按它认路
    files.set(`${path}/${docFileName(base)}`, docs.teaching ?? '')
    /**
     * 大纲与教学文档配对落盘（`{节点}.outline.json`，见 OutlineDoc）：节点上有大纲
     * （新建的节点创建那一刻就有一份空的大纲）就写文件——哪怕它是空的，因为
     * 「创建节点时两个文件同时生成」是写在数据布局上的承诺，缺一个用户就会问。
     * 老数据没有大纲，不凭空造文件。
     */
    if (node.outline) files.set(`${path}/${outlineFileName(base)}`, jsonText(node.outline))
    /**
     * 笔记一份一个文件，写在 `{节点}.notes/{笔记名}.md`。
     *
     * 空笔记不落盘（绝大多数笔记是从空白开始的，建一个空文件只会让人以为里面有东西）。
     * 于是「刚新建、还没写」的笔记只活在内存与 meta 的名字清单里——刷新一下就没了，
     * 这正是想要的：新建之后一个字没写，本来就不该在磁盘上留下痕迹。
     */
    for (const note of node.notes ?? []) {
      if (note.content.trim()) files.set(`${path}/${noteFileName(base, note.name)}`, note.content)
    }
    /**
     * 这个节点的 meta 一个字都没动就直接用上一份文本（见 MetaCacheEntry）：
     * 它是整份摊平里唯一一处对大对象做 JSON.stringify 的地方，而保存是每 320ms 一次的事。
     */
    const cached = metaCache.get(id)
    let metaText: string
    if (metaReusable(cached, node, store)) {
      metaText = cached.text
      nextMetaCache.set(id, cached)
    } else {
      const meta: MetaFile = {
        version: META_VERSION,
        id: node.id,
        title: node.title,
        key: node.key,
        description: node.description,
        status: node.status,
        origin: node.origin,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        annotations: node.annotations,
        dependencies: (deps.get(node.id) ?? []).map((e) => ({ to: e.to, createdAt: e.createdAt })),
        exams: examsOf.get(node.id) ?? [],
        learning: node.learning,
        // 复习计划跟着节点走（状态首次变 mastered 时系统建的，见 learn/review）；没有就不写这一项
        ...(node.review ? { review: node.review } : {}),
        // 笔记清单（只有名字与时间，正文在 .notes/ 下的 .md 里）：顺序稳定靠它
        notes: (node.notes ?? []).map((n) => ({
          name: n.name,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })),
        // 超级文档整份进 meta（可交互 HTML 只给渲染器用，不落独立文件，见 MetaFile 的说明）
        ...(node.superdocs?.length ? { superdocs: node.superdocs } : {}),
        // 目标信息只写在根节点的 meta 里：一个目标一份文档，根节点就是那份文档
        ...(goal && id === goal.rootNodeId
          ? {
              goal: {
                id: goal.id,
                question: goal.question,
                createdAt: goal.createdAt,
                updatedAt: goal.updatedAt,
              },
            }
          : {}),
      }
      metaText = jsonText(meta)
      nextMetaCache.set(id, {
        node,
        edges: store.edges,
        exams: store.exams,
        goals: store.goals,
        text: metaText,
      })
    }
    files.set(`${path}/${base}.meta.json`, metaText)
    /**
     * 对话写在**目标目录**里（一个目标一份上下文）。目标目录同时就是根节点的目录，
     * 所以判据是「这个节点是不是根」而不是「这个节点有没有对话」。
     */
    if (goal && id === goal.rootNodeId) {
      const conversations = store.conversations.filter((c) => c.goalId === goal.id)
      files.set(`${path}/chat.json`, jsonText({ version: CHAT_VERSION, conversations }))
      /**
       * 资源清单写在目标目录的资源目录里（见 learn/static）。没有资源就不写这个文件——
       * 空清单只会让人以为里面登记过东西。文件本体不走这条文本通道，由调用方直接写盘。
       */
      const resources = store.resources?.[goal.id] ?? []
      if (resources.length) {
        files.set(`${path}/${STATIC_DIR}/${MANIFEST_FILE}`, manifestText(resources))
      }
      /**
       * 长期记忆（mind，见 learn/mind）写在目标目录里，与 chat.json / 资源清单同一层：
       * 它与对话、资源同属「目标级的学习数据」。没有记忆就不写文件（同空清单的道理）。
       */
      const minds = store.minds?.[goal.id] ?? []
      if (minds.length) {
        files.set(`${path}/mind.json`, jsonText({ version: 1, minds }))
      }
      /**
       * 目标级持久化函数（method，见 learn/methods）同样写在目标目录里、同一条纪律：
       * 没有函数就不写文件。
       */
      const methods = store.methods?.[goal.id] ?? []
      if (methods.length) {
        files.set(`${path}/method.json`, jsonText({ version: 1, methods }))
      }
      /**
       * 目标级工作流（wf，见 learn/workflows）同样写在目标目录里、同一条纪律：
       * 没有登记过就不写文件。全局级的那份不在 docs/ 里——它跟 state.json 走（buildState），
       * 因为它跨目标生效、跟着用户走，不属于任何一个目标的目录。
       */
      const goalWorkflows = store.workflows?.byGoal?.[goal.id] ?? []
      if (goalWorkflows.length) {
        files.set(`${path}/workflow.json`, jsonText({ version: 1, workflows: goalWorkflows }))
      }
      /**
       * 有效阅读与打卡也是**目标级**的账（见 learn/reading 的 ReadingBook、
       * learn/checkin 的 CheckinBook），写在目标目录里、同一条纪律：这个目标没有记录就不写文件。
       *
       * 为什么不放 state.json：它们是「这门课学了多久」，与目标同生共死——
       * 删掉目标时那份记录该跟着一起走，而不是在用户账上留一段无主的时长。
       */
      const goalReading = store.reading?.byGoal?.[goal.id]
      if (goalReading && (goalReading.sessions.length || Object.keys(goalReading.days).length)) {
        files.set(`${path}/reading.json`, jsonText(goalReading))
      }
      const goalCheckin = store.checkin?.byGoal?.[goal.id]
      if (goalCheckin && Object.keys(goalCheckin.days).length) {
        files.set(`${path}/checkin.json`, jsonText(goalCheckin))
      }
    }
    /**
     * 临时变量（Agent 的大块中间数据）写在 chat.json 旁边。
     * 一个节点没有暂存数据时不写这个文件——绝大多数节点都不需要它，
     * 每个目录都塞一个空 tmp.json 只会让人以为里面有东西。
     */
    const tmp = tmpText(store.tmp?.[node.id])
    if (tmp) files.set(`${path}/tmp.json`, tmp)
  }

  // 整张换上去：这一轮没走到的节点（删掉的、读不出来的）自然就从缓存里消失了
  metaCache = nextMetaCache
  return files
}

/**
 * 某个节点的一份文档在数据根下的相对路径；节点不在任何目标里时返回 null。
 * 用来「在资源管理器中打开」——定位到 .md 而不是目录，用户一眼就能看到那篇文档。
 *
 * target.kind 为 'note' 时必须给 note（笔记名）：一个节点有多份笔记，光说「笔记」
 * 指不出是哪一份。指名不存在的笔记时返回 null，调用方据此提示「这份笔记不在了」。
 * target.kind 为 'outline' 时指到 `{节点}.outline.json`——大纲与教学文档一样是
 * 一个真实的文件，资源管理器里要能找到它。
 */
export function nodeDocPath(
  store: LearnStore,
  nodeId: string,
  target: { kind: DocKind | 'outline'; note?: string } = { kind: 'teaching' },
): string | null {
  const entry = nodeLayout(store).get(nodeId)
  if (!entry) return null
  if (target.kind === 'note') {
    const name = target.note ?? ''
    if (!name) return null
    return [DOCS_DIR, ...entry.dir, noteFileName(entry.base, name)].join('/')
  }
  if (target.kind === 'outline') return [DOCS_DIR, ...entry.dir, outlineFileName(entry.base)].join('/')
  return [DOCS_DIR, ...entry.dir, docFileName(entry.base)].join('/')
}
