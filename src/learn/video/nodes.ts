import { detachedPoolOf, withDetached } from '../detached'
import { notesOf, uniqueNoteName } from '../notes'
import type { NoteFile } from '../types'
/**
 * 视频节点的数据层：目标 × 视频的绑定表（store.videoNodes）与它的**双向镜像**
 * （VideoResource.boundTo）。
 *
 * 谁是事实源：store.videoNodes。引用判定（删除守卫、打开视频找目标、总结按钮的
 * 出现条件）一律扫这张表；boundTo 是写给**视频资源**的那一份记录（「学习视频的数据
 * 也会有记录」），由这里的写操作两边同一次提交一起动、读盘归一时整表重建——
 * 它漂了只影响显示，不影响判定。
 */
import type { LearnStore, VideoNodeEntity, VideoResource } from '../types'

/** 取一枚视频节点；不在了返回 undefined */
export function videoNodeById(store: LearnStore, id: string): VideoNodeEntity | undefined {
  return (store.videoNodes ?? []).find((v) => v.id === id)
}

/** 引用着某个视频的全部视频节点（删除守卫、打开时找目标、总结按钮判据都走它） */
export function videoBindingsOf(store: LearnStore, videoId: string): VideoNodeEntity[] {
  return (store.videoNodes ?? []).filter((v) => v.videoId === videoId)
}

/** 这个视频此刻有没有被任何目标绑着（「绑定后」才出现的行为判据） */
export function isVideoBound(store: LearnStore, videoId: string): boolean {
  return videoBindingsOf(store, videoId).length > 0
}

/**
 * 按事实源（videoNodes）重建视频资源上的 boundTo 镜像。读盘归一与目标删除用——
 * 落库的那份永远可以从这张表推回来，镜像里不该有任何「推不出来」的东西。
 */
export function withVideoMirror(store: LearnStore): LearnStore {
  const refs = new Map<string, string[]>()
  for (const v of store.videoNodes ?? []) {
    if (!v.videoId) continue
    refs.set(v.videoId, [...(refs.get(v.videoId) ?? []), v.id])
  }
  const videos = (store.videos ?? []).map((video) => {
    const boundTo = refs.get(video.id) ?? []
    if (boundTo.length) return { ...video, boundTo }
    // 没有引用了：把旧镜像摘掉（只对真有过的资产生成新对象，别的原样返回）
    if (!video.boundTo?.length) return video
    const { boundTo: _stale, ...rest } = video
    return rest
  })
  return { ...store, videos }
}

/** 建一枚视频节点（输入可先为空；画布 palette 落地与 agent 建节点走这里） */
export function createVideoNode(
  store: LearnStore,
  goalId: string,
  at: number,
  initialInput?: string,
  initialTitle?: string,
): { store: LearnStore; entity: VideoNodeEntity } {
  const entity: VideoNodeEntity = {
    id: crypto.randomUUID(),
    goalId,
    videoId: null,
    input: initialInput ?? '',
    ...(initialTitle ? { title: initialTitle } : {}),
    titleCustomized: !!initialTitle,
    confirmed: false,
    createdAt: at,
    updatedAt: at,
  }
  return { store: { ...store, videoNodes: [...(store.videoNodes ?? []), entity] }, entity }
}

/**
 * 更新视频节点字段（输入、标题、手动命名标记等）。
 * 若已确定为视频资源（confirmed = true），则拦截对 input 的修改。
 */
export function updateVideoNode(
  store: LearnStore,
  nodeId: string,
  patch: Partial<Pick<VideoNodeEntity, 'input' | 'title' | 'titleCustomized' | 'confirmed'>>,
  at: number,
): { store: LearnStore; entity: VideoNodeEntity } | { error: string } {
  const entity = videoNodeById(store, nodeId)
  if (!entity) return { error: '这个视频节点已经不在了' }
  if (entity.confirmed && patch.input !== undefined && patch.input !== entity.input) {
    return { error: '视频节点已确定为视频资源并固化，不再支持修改标识' }
  }
  const next: VideoNodeEntity = {
    ...entity,
    ...(patch.input !== undefined ? { input: patch.input } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.titleCustomized !== undefined ? { titleCustomized: patch.titleCustomized } : {}),
    ...(patch.confirmed !== undefined ? { confirmed: patch.confirmed } : {}),
    updatedAt: at,
  }
  return {
    store: { ...store, videoNodes: (store.videoNodes ?? []).map((v) => (v.id === nodeId ? next : v)) },
    entity: next,
  }
}

/**
 * 确定为视频资源：固化节点的唯一标识输入，生成/关联 videoId，并置 confirmed = true。
 */
export function confirmVideoNode(
  store: LearnStore,
  nodeId: string,
  info: {
    input: string
    title?: string
    pluginId?: string
    pluginName?: string
    fields?: Record<string, string | number | boolean>
  },
  at: number,
): { store: LearnStore; entity: VideoNodeEntity; videoId: string } | { error: string } {
  const entity = videoNodeById(store, nodeId)
  if (!entity) return { error: '这个视频节点已经不在了' }
  const cleanInput = (info.input || entity.input || '').trim()
  if (!cleanInput) return { error: '视频标识不能为空' }

  // 查找现有或新建视频资源
  let video = (store.videos ?? []).find((v) => v.input === cleanInput)
  let nextVideos = store.videos ?? []
  if (!video) {
    const vid = crypto.randomUUID()
    const newRecord: VideoResource = {
      id: vid,
      pluginId: info.pluginId ?? '',
      pluginName: info.pluginName ?? info.pluginId ?? '',
      input: cleanInput,
      ...(info.fields && Object.keys(info.fields).length ? { fields: info.fields } : {}),
      title: info.title || entity.title || cleanInput.slice(0, 60),
      createdAt: at,
    }
    video = newRecord
    nextVideos = [...nextVideos, newRecord]
  }

  const resolvedTitle = entity.titleCustomized
    ? (entity.title || '视频')
    : (info.title || entity.title || video.title || '视频')

  const nextEntity: VideoNodeEntity = {
    ...entity,
    videoId: video.id,
    input: cleanInput,
    title: resolvedTitle,
    confirmed: true,
    updatedAt: at,
  }

  const nextStore = withVideoMirror({
    ...store,
    videos: nextVideos,
    videoNodes: (store.videoNodes ?? []).map((v) => (v.id === nodeId ? nextEntity : v)),
  })
  return { store: nextStore, entity: nextEntity, videoId: video.id }
}

/**
 * 绑定 / 换绑 / 解绑一枚视频节点。videoId 为 null 或空串 = 解绑（节点留在画布上）。
 */
export function bindVideoNode(
  store: LearnStore,
  nodeId: string,
  videoId: string | null,
  at: number,
): { store: LearnStore; entity: VideoNodeEntity } | { error: string } {
  const entity = videoNodeById(store, nodeId)
  if (!entity) return { error: '这个视频节点已经不在了' }
  const raw = (videoId ?? '').trim()
  if (raw && !(store.videos ?? []).some((v) => v.id === raw)) {
    return { error: '没有这个视频：先在侧栏「视频」里创建，再来绑' }
  }
  const next: VideoNodeEntity = { ...entity, videoId: raw || null, confirmed: !!raw, updatedAt: at }
  return { store: withVideoMirror({ ...store, videoNodes: (store.videoNodes ?? []).map((v) => (v.id === nodeId ? next : v)) }), entity: next }
}

/** 删掉一枚视频节点（视频资源不动，镜像重建） */
export function deleteVideoNode(store: LearnStore, nodeId: string): LearnStore | null {
  if (!videoNodeById(store, nodeId)) return null
  const edges = store.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
  return withVideoMirror({ ...store, edges, videoNodes: (store.videoNodes ?? []).filter((v) => v.id !== nodeId) })
}

/**
 * 读盘归一：只认「id 唯一 + 目标还在」的条目；videoId 指向的视频不在了就把绑定
 * 摘掉（节点留下来当空节点——删除守卫拦着，这只兜手改过的 state.json）。
 */
export function normalizeVideoNodes(raw: unknown, goalIds: ReadonlySet<string>, videoIds: ReadonlySet<string>): VideoNodeEntity[] {
  if (!Array.isArray(raw)) return []
  const out: VideoNodeEntity[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const goalId = typeof o.goalId === 'string' ? o.goalId : ''
    if (!id || !goalId || seen.has(id) || !goalIds.has(goalId)) continue
    seen.add(id)
    const videoId = typeof o.videoId === 'string' && o.videoId.trim() && videoIds.has(o.videoId.trim()) ? o.videoId.trim() : null
    const input = typeof o.input === 'string' ? o.input : ''
    const title = typeof o.title === 'string' ? o.title : ''
    const titleCustomized = !!o.titleCustomized
    const confirmed = o.confirmed !== undefined ? !!o.confirmed : !!videoId
    out.push({
      id,
      goalId,
      videoId,
      input,
      title,
      titleCustomized,
      confirmed,
      createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
      updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
    })
  }
  return out
}

/** 查询挂载在某个视频节点下的全部笔记节点实体 */
export function getNotesForVideoNode(store: LearnStore, videoNodeId?: string): NoteFile[] {
  if (!videoNodeId) return []
  const edgeNoteIds = new Set(
    (store.edges ?? []).filter((e) => e.from === videoNodeId).map((e) => e.to)
  )
  if (edgeNoteIds.size === 0) return []

  const result: NoteFile[] = []
  for (const pool of Object.values(store.detached ?? {})) {
    for (const note of pool.notes) {
      if (edgeNoteIds.has(note.id)) {
        result.push(note)
      }
    }
  }
  for (const node of store.nodes ?? []) {
    for (const note of notesOf(node)) {
      if (edgeNoteIds.has(note.id)) {
        result.push(note)
      }
    }
  }
  return result
}

/** 为视频节点新建并挂载一个笔记节点 */
export function createNoteForVideoNode(
  store: LearnStore,
  videoNodeId: string,
  initialTitle?: string
): { store: LearnStore; note: NoteFile } {
  const vNode = videoNodeById(store, videoNodeId)
  const targetGoalId = vNode?.goalId || store.goals?.[0]?.id || 'default'

  const pool = detachedPoolOf(store, targetGoalId)
  const existingNotes = getNotesForVideoNode(store, videoNodeId)
  const defaultName = initialTitle || `笔记 ${existingNotes.length + 1}`
  const name = uniqueNoteName(pool.notes, defaultName)
  const id = crypto.randomUUID()
  const note: NoteFile = {
    id,
    name,
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const nextPool = {
    ...pool,
    notes: [...pool.notes, note],
  }
  const nextStore = withDetached(store, targetGoalId, nextPool)
  const nextEdges = [...(nextStore.edges ?? []), { from: videoNodeId, to: id, createdAt: Date.now() }]

  return {
    store: {
      ...nextStore,
      edges: nextEdges,
    },
    note,
  }
}

/** 更新视频节点下某份笔记（修改名称或内容） */
export function updateNoteForVideoNode(
  store: LearnStore,
  noteId: string,
  patch: { name?: string; content?: string }
): LearnStore {
  let changed = false
  const nextDetached = { ...(store.detached ?? {}) }
  for (const [gId, pool] of Object.entries(nextDetached)) {
    const idx = pool.notes.findIndex((n) => n.id === noteId)
    if (idx >= 0) {
      const cur = pool.notes[idx]
      const updated: NoteFile = {
        ...cur,
        name: patch.name !== undefined ? patch.name : cur.name,
        content: patch.content !== undefined ? patch.content : cur.content,
        updatedAt: Date.now(),
      }
      nextDetached[gId] = {
        ...pool,
        notes: pool.notes.map((n, i) => (i === idx ? updated : n)),
      }
      changed = true
      break
    }
  }
  if (!changed) {
    const nextNodes = (store.nodes ?? []).map((node) => {
      const idx = (node.notes ?? []).findIndex((n) => n.id === noteId)
      if (idx >= 0) {
        changed = true
        return {
          ...node,
          notes: (node.notes ?? []).map((n, i) =>
            i === idx
              ? {
                  ...n,
                  name: patch.name !== undefined ? patch.name : n.name,
                  content: patch.content !== undefined ? patch.content : n.content,
                  updatedAt: Date.now(),
                }
              : n
          ),
        }
      }
      return node
    })
    if (changed) return { ...store, nodes: nextNodes }
  }
  return changed ? { ...store, detached: nextDetached } : store
}

/** 删除视频节点下挂载的某份笔记 */
export function deleteNoteForVideoNode(store: LearnStore, noteId: string): LearnStore {
  const nextEdges = (store.edges ?? []).filter((e) => e.from !== noteId && e.to !== noteId)
  const nextDetached = { ...(store.detached ?? {}) }
  for (const [gId, pool] of Object.entries(nextDetached)) {
    nextDetached[gId] = {
      ...pool,
      notes: pool.notes.filter((n) => n.id !== noteId),
    }
  }
  const nextNodes = (store.nodes ?? []).map((node) => ({
    ...node,
    notes: (node.notes ?? []).filter((n) => n.id !== noteId),
  }))
  return {
    ...store,
    edges: nextEdges,
    detached: nextDetached,
    nodes: nextNodes,
  }
}
