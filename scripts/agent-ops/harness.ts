/**
 * 探针的共享底座：ok() 计数器 + 模块级 fixture（原 scripts/agent-ops.test.ts 里模块求值时跑掉的那一段）。
 *
 * 入口 scripts/agent-ops.test.ts 第一个就 import 它，因此下面这些语句仍然在**所有测试函数之前**、
 * 按原来的相对顺序执行一次：存储往返 / 旧布局迁移 / 路径寻址的断言在这一步就记进 pass。
 * ok() 的 pass / fails 只有这一份，其余分组 import 同一个函数（各抄一份汇总数字就错了）。
 */
import type { LearnStore } from '../../src/learn/types'
import { buildDocs, buildState, parseDocs } from '../../src/learn/files'
import { FIRST_GROUP, allTabs, emptyDocs, focusedTab, groupIdsOf, openInGroup, splitWith } from '../../src/learn/groups'
import { createAgentOps, type ResourceIo, type WorkspaceIo } from '../../src/learn/agentOps'
import { addResource, makeResource } from '../../src/learn/static'
import { docPathOf, nodePathOf, resolveDoc, resolveNode } from '../../src/learn/paths'
import { createExecuteTool, type SandboxRequest, type SandboxReply } from '../../src/agent/tools'

export let pass = 0
export const fails: string[] = []
export function ok(cond: boolean, label: string, extra?: unknown) {
  if (cond) pass++
  else fails.push(label + (extra === undefined ? '' : ' | ' + JSON.stringify(extra)))
}

export const NOW = 1700000000000
export const goalId = 'g1'
export const rootId = 'n1'
export const childId = 'n2'

export function baseStore(): LearnStore {
  return {
    version: 2,
    nodes: [
      {
        id: rootId, title: '微积分', key: '微积分', description: '微积分是什么',
        docs: { teaching: '# 大纲\n\n目标与边界' },
        notes: [],
        annotations: [], status: 'learning', origin: 'user', goalId, createdAt: NOW, updatedAt: NOW,
      },
      {
        id: childId, title: '极限', key: '极限', description: '极限的描述',
        docs: { teaching: '极限的正文，先讲直觉。' },
        notes: [{ name: '笔记', content: '我自己记的极限笔记', createdAt: NOW, updatedAt: NOW }],
        annotations: [], status: 'learning', origin: 'ai', goalId, createdAt: NOW, updatedAt: NOW,
      },
    ],
    edges: [{ from: rootId, to: childId, createdAt: NOW }],
    goals: [{ id: goalId, rootNodeId: rootId, question: '我想弄懂微积分', createdAt: NOW, updatedAt: NOW }],
    conversations: [{ id: 'c1', goalId, messages: [], createdAt: NOW, updatedAt: NOW }],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: goalId,
    activeNodeId: rootId,
    activeConversationId: 'c1',
    // 文档区：一组、没有页签（分组与分割见 learn/groups）
    docArea: emptyDocs(),
    localFiles: [],
  }
}

/* ---------- 1. 存储 ---------- */

const files = buildDocs(baseStore())
const keys = [...files.keys()].sort()
ok(keys.includes('docs/微积分/微积分.md'), '根节点教学文档落盘', keys)
ok(keys.includes('docs/微积分/微积分.meta.json'), '根节点 meta 落盘', keys)
ok(keys.includes('docs/微积分/chat.json'), '对话写在目标目录', keys)
ok(keys.includes('docs/微积分/极限/极限.md'), '子节点教学文档落盘', keys)
ok(keys.includes('docs/微积分/极限/极限.notes/笔记.md'), '子节点笔记落盘（一份笔记一个文件）', keys)
ok(!keys.includes('docs/微积分/极限/chat.json'), '子节点目录不再各写一份 chat.json', keys)
ok(files.get('docs/微积分/极限/极限.notes/笔记.md') === '我自己记的极限笔记', '笔记正文写到 {节点}.notes/{名字}.md')
ok(files.get('docs/微积分/chat.json')!.includes('"goalId": "g1"'), 'chat.json 里记的是 goalId')

const noteTab = { id: 'n:' + childId + ':笔记', ref: { kind: 'note', nodeId: childId, note: '笔记' }, createdAt: NOW }
// 用**旧版**形状（顶层的 tabs / activeTab）写进来的 state.json：升级路径要能读回来并折成单组
const back = parseDocs(files, {
  activeGoalId: goalId,
  activeNodeId: childId,
  activeConversationId: 'c1',
  tabs: [noteTab],
  activeTab: noteTab.id,
  localFiles: [{ path: 'C:/tmp/笔记.md', name: '笔记.md', openedAt: NOW }],
})
ok(!!back, 'parseDocs 能读回来')
if (back) {
  const root = back.nodes.find((n) => n.id === rootId)
  const child = back.nodes.find((n) => n.id === childId)
  ok(root?.docs.teaching === '# 大纲\n\n目标与边界', '教学文档逐字往返', root?.docs.teaching)
  ok(child?.notes[0]?.content === '我自己记的极限笔记', '笔记逐字往返', child?.notes[0]?.content)
  ok(child?.notes[0]?.name === '笔记', '笔记名字往返（名字就是文件名）', child?.notes[0]?.name)
  ok(back.conversations.length === 1 && back.conversations[0].goalId === goalId, '会话归属目标', back.conversations)
  ok(
    allTabs(back.docArea).length === 1 && focusedTab(back.docArea)?.id === noteTab.id,
    '页签随 state 往返（旧版形状读回来也是同一排）',
    back.docArea,
  )
  ok(back.localFiles[0]?.path === 'C:/tmp/笔记.md', '本地文件列表随 state 往返', back.localFiles)
  ok(back.activeNodeId === childId, '当前节点与激活页签保持一致', back.activeNodeId)
  ok(back.edges.length === 1 && back.edges[0].to === childId, '依赖边往返', back.edges)
}

/*
 * 新版形状（docArea：分组 + 分割）也要原样往返。
 *
 * 分割属于「界面状态」，可它丢了用户就得重分一次屏；而这条路上最容易漏的是
 * files 的 parseDocs——它要把 docArea 从 state.json 里捡起来交给 normalizeDocs
 * （漏了这一句，页签与布局每次重启都回到单组，而单测里那份空文档区看不出来）。
 */
const splitDocs = splitWith(
  openInGroup(
    openInGroup(emptyDocs(), FIRST_GROUP, { kind: 'teach', nodeId: rootId }, NOW),
    FIRST_GROUP,
    { kind: 'teach', nodeId: childId },
    NOW,
  ),
  FIRST_GROUP,
  'col',
  'after',
  't:' + childId,
)
const splitStore: LearnStore = { ...baseStore(), docArea: splitDocs }
const splitBack = parseDocs(buildDocs(splitStore), buildState(splitStore))
ok(!!splitBack, '带分割的 state.json 能读回来')
if (splitBack) {
  const layout = splitBack.docArea.layout
  ok(
    layout.kind === 'split' && layout.dir === 'col' && groupIdsOf(layout).length === 2,
    '分割的布局原样往返（方向与组数都对）',
    layout,
  )
  ok(
    allTabs(splitBack.docArea).map((t) => t.id).join(',') === 't:' + rootId + ',t:' + childId,
    '两格里的页签按布局顺序往返',
    allTabs(splitBack.docArea).map((t) => t.id),
  )
  ok(splitBack.docArea.focus === splitDocs.focus, '焦点格往返', splitBack.docArea.focus)
}

/* ---------- 1b. 旧布局迁移 ---------- */

const legacy = new Map<string, string>()
const legacyMeta = (id: string, title: string, key: string) =>
  JSON.stringify({ version: 1, id, title, key, description: title + '的描述', status: 'learning', origin: 'ai', createdAt: NOW, updatedAt: NOW, annotations: [], dependencies: [], exams: [], goal: id === 'old1' ? { id: 'og1', question: '旧目标', createdAt: NOW, updatedAt: NOW } : undefined })
legacy.set('docs/旧目标/旧目标.md', '旧正文（来自裸 md）')
legacy.set('docs/旧目标/旧目标.meta.json', legacyMeta('old1', '旧目标', '旧目标'))
legacy.set('docs/旧目标/chat.json', JSON.stringify({ version: 1, conversations: [{ id: 'oc1', nodeId: 'old1', messages: [], createdAt: NOW, updatedAt: NOW }] }))
legacy.set('docs/旧目标/子概念/子概念.md', '子概念正文')
legacy.set('docs/旧目标/子概念/子概念.meta.json', legacyMeta('old2', '子概念', '子概念'))
legacy.set('docs/旧目标/子概念/chat.json', JSON.stringify({ version: 1, conversations: [{ id: 'oc2', nodeId: 'old2', messages: [], createdAt: NOW, updatedAt: NOW }, { id: 'oc3', nodeId: '已删除的节点', messages: [], createdAt: NOW, updatedAt: NOW }] }))
const migrated = parseDocs(legacy, {})
ok(!!migrated, '旧布局能读出来')
if (migrated) {
  const convs = migrated.conversations.map((c) => c.id).sort()
  ok(convs.join(',') === 'oc1,oc2', '散在各节点目录的对话并到目标上（已删节点的丢弃）', convs)
  ok(migrated.conversations.every((c) => c.goalId === 'og1'), '旧 nodeId 折算成 goalId', migrated.conversations)
  const old = migrated.nodes.find((n) => n.id === 'old2')
  ok(old?.docs.teaching === '子概念正文', '旧 content/裸 md 迁成教学文档', old?.docs.teaching)
  ok(old?.notes.length === 0, '旧节点没有笔记，按空数组处理', old?.notes)
}

/* ---------- 2. 路径寻址 ---------- */

const st = baseStore()
const scope = { goalId, currentNodeId: childId }
const resolve = (p: string) => { const r = resolveDoc(st, scope, p); return r.ok ? r.value : r.message }
const v0 = resolve('') as { node: { id: string }; kind: string }
ok(v0.node.id === childId && v0.kind === 'teaching', '省略 path = 当前节点的教学文档', v0)
const v1 = resolve('笔记') as { node: { id: string }; kind: string }
ok(v1.node.id === childId && v1.kind === 'note', '「笔记」= 当前节点的笔记文档', v1)
const v2 = resolve('微积分') as { node: { id: string }; kind: string }
ok(v2.node.id === rootId && v2.kind === 'teaching', '按标题找到别的节点', v2)
const v3 = resolve('微积分/极限/笔记') as { node: { id: string }; kind: string }
ok(v3.node.id === childId && v3.kind === 'note', '多段路径 + 文档后缀', v3)
const v4 = resolve('#n2/笔记') as { node: { id: string }; kind: string }
ok(v4.node.id === childId && v4.kind === 'note', '#id 写法', v4)
const v5 = resolve('当前/教学') as { node: { id: string }; kind: string }
ok(v5.node.id === childId, '「当前」别名', v5)
const bad = resolve('不存在的标题')
ok(typeof bad === 'string' && bad.includes('微积分'), '找不到时列出候选', bad)
ok(nodePathOf(st, goalId, childId) === '微积分/极限', 'nodePathOf', nodePathOf(st, goalId, childId))
ok(docPathOf(st, goalId, childId, 'note') === '微积分/极限/笔记', 'docPathOf', docPathOf(st, goalId, childId, 'note'))
ok(
  docPathOf(st, goalId, childId, 'note', '错题本') === '微积分/极限/笔记/错题本',
  'docPathOf 指名某一份笔记',
  docPathOf(st, goalId, childId, 'note', '错题本'),
)
const vNote = resolve('笔记/错题本') as { node: { id: string }; kind: string; note?: string }
ok(
  vNote.node.id === childId && vNote.kind === 'note' && vNote.note === '错题本',
  '「笔记/名字」指到具体那一份',
  vNote,
)
ok(!resolveNode(st, scope, '不存在').ok, 'resolveNode 失败时有 message')


/* ---------- 3. execute 工具（假沙箱执行器） ---------- */

/**
 * 与真实 Worker 同构的执行器：把 body 当函数求值，用 Proxy 把 api.x.y(...) 转成 callApi。
 * 真实沙箱多的只是「跑在 Worker 里 + 超时 terminate」，宿主这侧的逻辑完全一致。
 */
export const fakeRunner = async (req: SandboxRequest): Promise<SandboxReply> => {
  try {
    const fn = new Function('api', 'return (' + req.body + ')')() as (api: unknown) => unknown
    const api = new Proxy({}, {
      get: (_t, group: string) =>
        // 组代理本身是**可调用**的函数：不带点的顶层 api（wait…）走 api.wait(...) 直调，
        // 带点的组（doc.*）则继续取方法。两条路都归到 callApi。
        new Proxy((...args: unknown[]) => req.callApi(group, args), {
          get: (_t2, method: string) =>
            (...args: unknown[]) => req.callApi(group + '.' + String(method), args),
        }),
    })
    const value = await fn(api)
    return { ok: true, value, ms: 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const harness = (init: LearnStore, current: string) => {
  let s = init
  const ws = fakeWorkspaceIo()
  const ops = createAgentOps({
    getLatest: () => s,
    set: (n) => { s = n },
    nodeId: () => current,
    goalId: () => goalId,
    // 工作区那一组要磁盘：给一份假的（见 fakeWorkspaceIo），workspace.* 的探针才有靶子
    workspaceIo: ws.io,
  })
  const tool = createExecuteTool({ ...ops, runSandbox: fakeRunner })
  return {
    run: (body: string) => tool.run({ description: '测试', body }, { nodeId: current, goalId }),
    store: () => s,
    /** 假工作区的文件表：探针据此核对「api 说写了」与「盘上真有」 */
    ws: ws.files,
  }
}

/**
 * 假的工作区磁盘：内存里的一棵文件树。
 *
 * 与主进程同一套口径：list 对「目录不存在」回空清单（不报错）、read 对「文件不存在」
 * 回 content: null、write 无条件成功——探针里真正要钉住的是 ops 层的定位与措辞。
 */
export function fakeWorkspaceIo() {
  const files = new Map<string, string>()
  const io: WorkspaceIo = {
    list: async (rel) => {
      const prefix = rel.replace(/\/+$/, '') + '/'
      const seen = new Map<string, boolean>()
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue
        const tail = path.slice(prefix.length)
        if (!tail) continue
        seen.set(tail.split('/')[0], tail.includes('/'))
      }
      return { ok: true, entries: [...seen].map(([name, dir]) => ({ name, dir })) }
    },
    read: async (rel) => ({ ok: true, content: files.get(rel) ?? null }),
    write: async (rel, content) => {
      files.set(rel, content)
      return { ok: true }
    },
  }
  return { io, files }
}

/* ---------- 6. 资源库（static）与工具附图的通道 ---------- */

/**
 * 这一段守两件容易悄悄坏掉的事：
 * 1. **清单与文件必须一致**。清单在 store 里（跟着文档一起落盘）、文件在 static/ 下，
 *    两者分属两套机制；「登记了但没写文件」「删了文件没删条目」在界面上都看不出来，
 *    只会在 Agent 照着清单去读的时候得到一句「文件读不到」。
 * 2. **图片只走图像通道**。res.read 读图绝不把 base64 放进返回值（会被 3.2 万字符的
 *    截断毁掉、还永久占着上下文），而是挂在工具结果上由运行时送上下一跳；
 *    历史还原还要与实发的那一条逐字节一致，否则前缀缓存整段作废。
 */

export const PNG_UUID = '3f2a1b4c-0000-4000-8000-000000000001'
export const MD_UUID = '7c9d0e11-0000-4000-8000-000000000002'
export const PNG_REL = 'docs/微积分/static/' + PNG_UUID + '.png'
export const MD_REL = 'docs/微积分/static/' + MD_UUID + '.md'

/** 假的资源磁盘：只记在内存里，用来核对「清单说有什么」与「盘上真有什么」 */
export function fakeResourceIo(files: Map<string, string>, images: Map<string, string>) {
  const removed: string[] = []
  const io: ResourceIo = {
    readText: async (rel) => files.get(rel) ?? null,
    writeText: async (rel, content) => {
      files.set(rel, content)
      return true
    },
    readImage: async (rel) => {
      const data = images.get(rel)
      return data ? { mime: 'image/png', data, url: 'data:image/png;base64,' + data } : null
    },
    remove: async (rel) => {
      files.delete(rel)
      images.delete(rel)
      removed.push(rel)
      return true
    },
  }
  return { io, removed }
}

export function staticStore(): LearnStore {
  let s = baseStore()
  s = addResource(s, goalId, makeResource({ uuid: PNG_UUID, name: '题图', ext: 'png', bytes: 2048, description: '第二题的插图', now: NOW }))
  s = addResource(s, goalId, makeResource({ uuid: MD_UUID, name: '公式速查', ext: 'md', bytes: 40, now: NOW }))
  return s
}
