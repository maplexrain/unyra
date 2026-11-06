import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore, VideoResource } from '../src/learn/types'
import { NodeService } from '../src/learn/nodeKinds/service'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import { buildDocs, buildState, parseDocs } from '../src/learn/files'
import { deleteGoal } from '../src/learn/graph'
import { bindVideoNode, normalizeVideoNodes, withVideoMirror } from '../src/learn/video/nodes'
import { parseChapters, parseRecap, transcriptLines, cleanSummaryText } from '../src/learn/video/summarize'
import { makeTab, tabKey } from '../src/learn/tabs'

/*
 * 视频节点（2026-10-25）：目标 × 视频的绑定，只作为游离实体。
 * - 事实源是 store.videoNodes；VideoResource.boundTo 是镜像（随写重建、读盘归一重建）；
 * - 不进大纲树（没有树边、没有上下游）；
 * - 页签 ref.goalId 让绑定的视频页签跟着目标的页签组走。
 */

function node(id: string, title: string, key: string): KnowledgeNode {
  return {
    id,
    title,
    key,
    description: '',
    docs: { teaching: '' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: 1,
    updatedAt: 1,
  }
}

function videoOf(id: string, title: string): VideoResource {
  return { id, pluginId: 'p', input: 'https://example.com/v/' + id, title, createdAt: 1 }
}

function storeOf(): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学微积分', createdAt: 1, updatedAt: 1 }],
    nodes: [node('r', '微积分', 'weijifen')],
    videos: [videoOf('v1', '第一讲'), videoOf('v2', '第二讲')],
  }
}

function serviceOf(store: LearnStore): { svc: NodeService; read: () => LearnStore } {
  let cur = store
  const svc = new NodeService({
    getLatest: () => cur,
    set: (next) => {
      cur = next
    },
    goalId: () => 'g1',
  })
  return { svc, read: () => cur }
}

describe('视频节点：创建与绑定', () => {
  it('create 不给 under = 空节点（没有视频、没有文档）；under 给了直接拒', () => {
    const { svc, read } = serviceOf(storeOf())
    const r = svc.create({ kind: 'video' })
    expect(r).toMatchObject({ ok: true, created: true, title: '视频 · 未绑定' })
    if (!('uuid' in r)) return
    expect(read().videoNodes).toHaveLength(1)
    expect(read().videoNodes?.[0]).toMatchObject({ goalId: 'g1', videoId: null })
    // 画布派生：空视频卡带 blank 标记
    const view = deriveCanvas(read(), 'g1', undefined)
    const card = view.cards.find((c) => c.uuid === r.uuid)
    expect(card?.kind).toBe('video')
    expect(card?.blank).toBe(true)
    const rejected = svc.create({ kind: 'video', under: 'non-exist' })
    expect(rejected).toMatchObject({ error: expect.stringContaining('不存在') })
    const accepted = svc.create({ kind: 'video', under: 'r' })
    expect(accepted).toMatchObject({ ok: true, created: true })
    expect(read().edges.some((e) => e.from === 'r' && e.to === (accepted as any).uuid)).toBe(true)
  })

  it('editContent({ videoId }) 绑定：节点与视频资源两边同一次提交（boundTo 镜像）', () => {
    const { svc, read } = serviceOf(storeOf())
    const created = svc.create({ kind: 'video' })
    if (!('uuid' in created)) return
    const bound = svc.get(created.uuid)!.editContent({ videoId: 'v1' })
    expect(bound).toMatchObject({ ok: true })
    const s = read()
    expect(s.videoNodes?.[0].videoId).toBe('v1')
    // 视频资源上的记录（双向绑定）：引用它的节点 id 在 boundTo 里
    expect(s.videos?.find((v) => v.id === 'v1')?.boundTo).toEqual([created.uuid])
    // 没绑的那个视频不受影响
    expect(s.videos?.find((v) => v.id === 'v2')?.boundTo).toBeUndefined()
    // 标题跟着视频走；get 取对象的内容带绑定信息
    expect(svc.get(created.uuid)!.title).toBe('第一讲 · 视频')
  })

  it('换绑与解绑：镜像跟着重建（旧的 boundTo 摘掉）', () => {
    const { svc, read } = serviceOf(storeOf())
    const created = svc.create({ kind: 'video' })
    if (!('uuid' in created)) return
    expect(svc.get(created.uuid)!.editContent({ videoId: 'v1' })).toMatchObject({ ok: true })
    expect(svc.get(created.uuid)!.editContent({ videoId: 'v2' })).toMatchObject({ ok: true })
    let s = read()
    expect(s.videos?.find((v) => v.id === 'v1')?.boundTo ?? []).toEqual([])
    expect(s.videos?.find((v) => v.id === 'v2')?.boundTo).toEqual([created.uuid])
    expect(svc.get(created.uuid)!.editContent({ videoId: null })).toMatchObject({ ok: true })
    s = read()
    expect(s.videoNodes?.[0].videoId).toBeNull()
    expect(s.videos?.find((v) => v.id === 'v2')?.boundTo ?? []).toEqual([])
  })

  it('绑不存在的视频被拒；help / content 自述绑定状态', () => {
    const { svc } = serviceOf(storeOf())
    const created = svc.create({ kind: 'video' })
    if (!('uuid' in created)) return
    expect(svc.get(created.uuid)!.editContent({ videoId: 'nope' })).toMatchObject({ error: expect.any(String) })
    expect(svc.get(created.uuid)!.editContent({ bogus: 1 })).toMatchObject({ error: expect.any(String) })
    const n = svc.get(created.uuid)!
    expect(n.help().description).toContain('还没有绑视频')
    expect(n.help().connection).toContain('文档')
  })
})

describe('视频节点：删除与级联', () => {
  it('删节点只摘绑定：视频资源、boundTo 镜像、别的节点都不动', () => {
    const { svc, read } = serviceOf(storeOf())
    const a = svc.create({ kind: 'video' })
    const b = svc.create({ kind: 'video' })
    if (!('uuid' in a) || !('uuid' in b)) return
    svc.get(a.uuid)!.editContent({ videoId: 'v1' })
    svc.get(b.uuid)!.editContent({ videoId: 'v1' })
    const r = svc.delete(a.uuid)
    expect(r).toMatchObject({ ok: true })
    const s = read()
    expect(s.videoNodes?.map((v) => v.id)).toEqual([b.uuid])
    // 引用镜像只剩 b；视频资源还在
    expect(s.videos?.find((v) => v.id === 'v1')?.boundTo).toEqual([b.uuid])
    expect(s.videos).toHaveLength(2)
  })

  it('删目标级联：这个目标的视频节点与绑定的视频页签一起走，资源原样', () => {
    let cur = storeOf()
    const svc = new NodeService({
      getLatest: () => cur,
      set: (next) => {
        cur = next
      },
      goalId: () => 'g1',
    })
    const created = svc.create({ kind: 'video' })
    if (!('uuid' in created)) return
    const bound = bindVideoNode(cur, created.uuid, 'v1', 2)
    if ('error' in bound) throw new Error(bound.error)
    cur = bound.store
    // 绑定的视频页签记在该目标名下（ref.goalId）
    const vRef = { kind: 'video' as const, videoId: 'v1', goalId: 'g1' }
    cur = {
      ...cur,
      docArea: {
        ...cur.docArea,
        groups: [{ ...cur.docArea.groups[0], tabs: [makeTab(vRef, 1)], active: tabKey(vRef) }],
      },
    }
    // 先删视频资源本身：被引用着，但这层守卫在界面；数据层直接删资要自己重建镜像
    const next = withVideoMirror({ ...deleteGoal(cur, 'g1'), videos: cur.videos })
    expect(next.videoNodes ?? []).toEqual([])
    expect(next.videos).toHaveLength(2) // 资源是用户级的，删目标不带走
    expect(next.videos?.find((v) => v.id === 'v1')?.boundTo ?? []).toEqual([])
    // 绑定视频的页签随目标一起关（tabOwners 归属判据 refOwner 的 video 分支）；
    // 空格由 settle 补一枚空白底页，那是正常行为，只看视频页签走没走
    expect(next.docArea.groups[0].tabs.some((t) => t.ref.kind === 'video')).toBe(false)
  })
})

describe('视频节点：归一与守卫的纯函数', () => {
  it('normalizeVideoNodes：目标没了 / 视频没了 / 重复 id 的行丢掉或摘绑定', () => {
    const raw = [
      { id: 'n1', goalId: 'g1', videoId: 'v1', createdAt: 1, updatedAt: 1 },
      { id: 'n2', goalId: 'gX', videoId: 'v1', createdAt: 1, updatedAt: 1 }, // 目标不在
      { id: 'n3', goalId: 'g1', videoId: 'vX', createdAt: 1, updatedAt: 1 }, // 视频不在 → 摘绑定留节点
      { id: 'n1', goalId: 'g1', videoId: 'v2', createdAt: 1, updatedAt: 1 }, // 重复 id
      'junk',
    ]
    const out = normalizeVideoNodes(raw, new Set(['g1']), new Set(['v1']))
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'n1', videoId: 'v1' })
    expect(out[1]).toMatchObject({ id: 'n3', videoId: null })
  })
})

describe('落盘往返：视频节点住目标目录的 video-nodes.json', () => {
  it('build → parse：绑定行与下级树边原样进出，boundTo 镜像重建一致', () => {
    const { svc, read } = serviceOf(storeOf())
    const created = svc.create({ kind: 'video' })
    if (!('uuid' in created)) return
    svc.get(created.uuid)!.editContent({ videoId: 'v1' })
    // 创建挂在视频节点之下的文档
    const doc = svc.create({ kind: 'doc', title: '视频总览文档', under: created.uuid })
    expect(doc).toMatchObject({ ok: true, created: true })
    if (!('uuid' in doc)) return

    // 验证边存在：created.uuid -> doc.uuid
    expect(read().edges.some((e) => e.from === created.uuid && e.to === doc.uuid)).toBe(true)

    const files = buildDocs(read())
    const videoJson = files.get('docs/微积分/video-nodes.json')
    expect(videoJson).toBeTruthy()
    expect(videoJson).toContain(created.uuid)
    expect(videoJson).toContain(doc.uuid)

    // 视频资源是用户级的（state.json），roundtrip 要把 state 侧也带上
    const back = parseDocs(files, buildState(read()))
    expect(back?.videoNodes ?? []).toHaveLength(1)
    expect(back?.videoNodes?.[0]).toMatchObject({ goalId: 'g1', videoId: 'v1' })
    // 镜像按事实源重建（读回来的 boundTo 不作数）
    expect(back?.videos?.find((v) => v.id === 'v1')?.boundTo).toEqual([created.uuid])
    // 树边经 parseDocs 后正确恢复
    expect(back?.edges.some((e) => e.from === created.uuid && e.to === doc.uuid)).toBe(true)

    // 摘线验证：通过 disconnect 断开连接
    const docGNode = svc.get(doc.uuid)
    const videoGNode = svc.get(created.uuid)
    expect(docGNode && videoGNode).toBeTruthy()
    const unlinkRes = docGNode?.disconnect(videoGNode!)
    expect(unlinkRes).toMatchObject({ ok: true })
    expect(read().edges.some((e) => e.from === created.uuid && e.to === doc.uuid)).toBe(false)
  })

  it('文档已存在时以 under: videoNodeUuid 创建会自动补全连线', () => {
    const { svc, read } = serviceOf(storeOf())
    const v = svc.create({ kind: 'video' })
    if (!('uuid' in v)) return
    const d1 = svc.create({ kind: 'doc', title: '已有文档' })
    if (!('uuid' in d1)) return
    expect(read().edges.some((e) => e.from === v.uuid && e.to === d1.uuid)).toBe(false)

    // 再次以 under: v.uuid 创建同名文档
    const d2 = svc.create({ kind: 'doc', title: '已有文档', under: v.uuid })
    expect(d2).toMatchObject({ ok: true, created: false, uuid: d1.uuid })
    expect(read().edges.some((e) => e.from === v.uuid && e.to === d1.uuid)).toBe(true)
  })

  it('normalizeLearnStore 自动修补包含 videos 代码块的无上游文档连线', () => {
    const base = storeOf()
    const vId = 'vn-repair'
    const docId = 'doc-repair'
    const unlinkedDoc: KnowledgeNode = {
      ...node(docId, '视频总览', 'spzl'),
      docs: { teaching: '# 总览\n```videos\n' + vId + '\n1-10\n```' },
    }
    const storeToFix: LearnStore = {
      ...base,
      videoNodes: [{ id: vId, goalId: 'g1', videoId: 'v1', createdAt: 1, updatedAt: 1 }],
      nodes: [...base.nodes, unlinkedDoc],
      edges: [],
    }
    // 序列化落盘再读回，触发 normalizeLearnStore 自动补齐边
    const files = buildDocs(storeToFix)
    const restored = parseDocs(files, buildState(storeToFix))
    expect(restored?.edges.some((e) => e.from === vId && e.to === docId)).toBe(true)
  })
})

describe('视频语义分段（learn/video/summarize 的纯函数）', () => {
  it('transcriptLines：按 ~20 秒聚桶，行首带时间戳', () => {
    const seg = (startMs: number, text: string) => ({ startMs, endMs: startMs + 1000, text })
    const lines = transcriptLines([seg(0, '你好'), seg(5000, '今天讲极限'), seg(25_000, '接下来讲连续'), seg(30_000, '它的定义')])
    expect(lines).toEqual([
      expect.stringContaining('[00:00]'),
      expect.stringContaining('[00:25]'),
    ])
    expect(lines[0]).toContain('今天讲极限')
    expect(lines[1]).toContain('它的定义')
  })

  it('parseChapters：剥围栏抓数组、坏项丢弃、按时间排序去重', () => {
    const raw = '前言\n```json\n[{"startMs":30000,"summary":"第二段"},{"startMs":0,"summary":"开头"},{"startMs":0,"summary":"重复的时间点"},{"startMs":"bad","summary":"x"},{"startMs":5000,"summary":""}]\n```'
    expect(parseChapters(raw)).toEqual([
      { startMs: 0, summary: '开头' },
      { startMs: 30000, summary: '第二段' },
    ])
    // 不是 JSON / 没有数组：空表（调用方当作失败处理）
    expect(parseChapters('我觉得分为三段')).toEqual([])
  })

  it('cleanSummaryText：剥围栏与标题记号、逐行拼成一段、掐到上限', () => {
    expect(cleanSummaryText('```markdown\n## 总结\n讲了极限的直观。\n引入了 ε-δ 语言。\n```')).toBe(
      '总结 讲了极限的直观。 引入了 ε-δ 语言。',
    )
    expect(cleanSummaryText('   ')).toBe('')
    expect(cleanSummaryText('短')).toBe('短')
  })

  it('parseRecap：抓 JSON 对象、summary 与 chapters 都有效才算成功（合在同一个动作）', () => {
    const raw = '好的\n```json\n{"summary":"讲了极限与连续。","chapters":[{"startMs":0,"summary":"开场"},{"startMs":30000,"summary":"极限的定义"}]}\n```'
    expect(parseRecap(raw)).toEqual({
      summary: '讲了极限与连续。',
      chapters: [
        { startMs: 0, summary: '开场' },
        { startMs: 30000, summary: '极限的定义' },
      ],
    })
    // 缺 summary / 缺分段 / 不是对象：null（调用方当失败，两样一起重来的才是成功）
    expect(parseRecap('{"summary":"只有总结"}')).toBeNull()
    expect(parseRecap('{"chapters":[{"startMs":0,"summary":"只有分段"}]}')).toBeNull()
    expect(parseRecap('我觉得讲了极限')).toBeNull()
  })
})
