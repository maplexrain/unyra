import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { NodeService } from '../src/learn/nodeKinds/service'
import { deriveCanvas, KIND_BADGE, KIND_TONE } from '../src/components/learn/structure/structureView'
import { confirmVideoNode } from '../src/learn/video/nodes'
import { tabKey, tabTitle } from '../src/learn/tabs'

function docNode(id: string, title: string): KnowledgeNode {
  return {
    id,
    title,
    key: 'k_' + id,
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

function baseStore(): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'd1', question: '目标', createdAt: 1, updatedAt: 1 }],
    nodes: [docNode('d1', '根文档')],
  }
}

function createSvc(store: LearnStore) {
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

describe('视频模块重构：视频节点全生命周期与固化流程', () => {
  it('视频节点配色必须是粉色 (Pink)', () => {
    expect(KIND_TONE['video']).toContain('pink')
    expect(KIND_BADGE['video']).toContain('pink')
  })

  it('生命周期：创建 -> 输入唯一标识 -> 打开Tab -> 确定为资源 -> 固化输入框', () => {
    const { svc, read } = createSvc(baseStore())

    // 1. 创建视频节点
    const created = svc.create({ kind: 'video' })
    expect(created).toMatchObject({ ok: true, created: true })
    const uuid = (created as { uuid: string }).uuid
    let node = svc.get(uuid)!
    expect(node).toBeTruthy()
    expect(read().videoNodes?.[0].confirmed).toBe(false)

    // 2. 输入视频唯一标识（如 B站 BV号 或 URL）
    const updateRes = svc.get(uuid)!.editContent({ input: 'BV1xx411c7mD' })
    expect(updateRes).toMatchObject({ ok: true })
    expect(read().videoNodes?.[0].input).toBe('BV1xx411c7mD')
    expect(read().videoNodes?.[0].confirmed).toBe(false)

    // 3. 点击标题打开视频 Tab（单例并带 videoNodeId）
    const tabRef = { kind: 'video' as const, videoNodeId: uuid, goalId: 'g1' }
    expect(tabKey(tabRef)).toBe('vn:' + uuid)
    expect(tabTitle(tabRef, () => undefined, undefined, (vnId) => (vnId === uuid ? '测试视频标题' : undefined))).toBe('测试视频标题')

    // 4. 确定为视频资源
    const now = Date.now()
    const confirmRes = confirmVideoNode(
      read(),
      uuid,
      {
        input: 'BV1xx411c7mD',
        title: 'B站教程实战精讲',
        pluginId: 'bilibili',
      },
      now,
    )
    expect(confirmRes).not.toHaveProperty('error')
    if ('error' in confirmRes) return

    // 确定后视频资源存入 store.videos，节点标记 confirmed = true
    const storeAfterConfirm = confirmRes.store
    expect(storeAfterConfirm.videos).toHaveLength(1)
    expect(storeAfterConfirm.videos?.[0].input).toBe('BV1xx411c7mD')
    const entityAfterConfirm = storeAfterConfirm.videoNodes?.find((vn) => vn.id === uuid)
    expect(entityAfterConfirm?.confirmed).toBe(true)
    expect(entityAfterConfirm?.videoId).toBe(storeAfterConfirm.videos?.[0].id)
    expect(entityAfterConfirm?.title).toBe('B站教程实战精讲')

    // 5. 固化视频节点的标识输入框不再提供修改操作
    const { svc: svcConfirmed } = createSvc(storeAfterConfirm)
    const blockedEdit = svcConfirmed.get(uuid)!.editContent({ input: 'https://new-url.com' })
    expect(blockedEdit).toMatchObject({ error: expect.stringContaining('固化') })
  })

  it('允许文档节点作为视频节点的上级，连线与拓扑正确生成', () => {
    const { svc, read } = createSvc(baseStore())

    // 创建文档节点与视频节点
    const docNodeObj = svc.get('d1')!
    const vRes = svc.create({ kind: 'video' })
    expect(vRes).toMatchObject({ ok: true })
    const vUuid = (vRes as { uuid: string }).uuid
    const vNodeObj = svc.get(vUuid)!

    // 文档节点作为视频节点的上级进行连接
    const linkRes = docNodeObj.connect(vNodeObj, 'down')
    expect(linkRes).toMatchObject({ ok: true })
    expect(read().edges.some((e) => e.from === 'd1' && e.to === vUuid)).toBe(true)

    // 验证视频节点 onUpstream 允许文档节点
    expect(vNodeObj.onUpstream(docNodeObj)).toBe(true)

    // 验证拓扑画布派生正确画出从文档到视频节点的边
    const canvas = deriveCanvas(read(), 'g1', undefined)
    expect(canvas.edges.some((e) => e.from === 'd1' && e.to === vUuid)).toBe(true)
    const videoCard = canvas.cards.find((c) => c.uuid === vUuid)
    expect(videoCard?.kind).toBe('video')

    // 摘线测试
    const unlinkRes = docNodeObj.disconnect(vNodeObj)
    expect(unlinkRes).toMatchObject({ ok: true })
    expect(read().edges.some((e) => e.from === 'd1' && e.to === vUuid)).toBe(false)
  })

  it('create 时直接通过 under 指定上级文档节点成功挂接', () => {
    const { svc, read } = createSvc(baseStore())
    const createdUnderDoc = svc.create({ kind: 'video', under: 'd1' })
    expect(createdUnderDoc).toMatchObject({ ok: true, created: true })
    const vUuid = (createdUnderDoc as { uuid: string }).uuid
    expect(read().edges.some((e) => e.from === 'd1' && e.to === vUuid)).toBe(true)
  })
})
