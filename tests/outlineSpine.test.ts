import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { outlineUuid } from '../src/learn/nodeKinds'
import { NodeService } from '../src/learn/nodeKinds/service'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import { buildDocs, parseDocs } from '../src/learn/files'

/*
 * 大纲与文档分离（2026-10-25 定稿，方案 C）：
 * - 附身大纲（node.outline，uuid o:{docId}）不变——交替链 文档-大纲-文档-大纲…；
 * - 游离大纲（store.outlines 独立实体，自己的 uuid）：**没有宿主文档**，拖大纲出来
 *   就是它——分类链 文档-大纲-大纲…的结构层；
 * - 树边两端是树成员 id：文档 id 或 o:{大纲id}；to 以 o: 开头即接在大纲卡上（嵌套）。
 */

function node(id: string, title: string, key: string, outline?: KnowledgeNode['outline']): KnowledgeNode {
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
    ...(outline ? { outline } : {}),
  }
}

/** 根 r（有大纲）→ 子 a（有自己的大纲）→ 孙 c（普通文档）。r→a 接文档还是接大纲由参数决定 */
function storeOf(nested: boolean): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学微积分', createdAt: 1, updatedAt: 1 }],
    nodes: [
      node('r', '微积分', 'weijifen', {
        intro: '',
        children: [
          { key: 'jichu', title: '基础', summary: '' },
          { key: 'yingyong', title: '应用', summary: '' },
        ],
        updatedAt: 1,
      }),
      node('a', '基础', 'jichu', {
        intro: '',
        children: [{ key: 'jixian', title: '极限', summary: '' }],
        updatedAt: 1,
      }),
      node('c', '极限', 'jixian'),
    ],
    edges: [
      { from: 'r', to: nested ? outlineUuid('a') : 'a', createdAt: 1 },
      { from: 'a', to: 'c', createdAt: 1, portKey: 'jixian' },
    ],
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

describe('派生：交替链（子级接文档卡，原有形态原样保留）', () => {
  it('文档-大纲-文档-大纲：树边落在子文档卡上；归属边文档 → 它的大纲', () => {
    const view = deriveCanvas(storeOf(false), 'g1', undefined)
    const keys = view.edges.map((e) => `${e.from}>${e.to}`)
    expect(keys).toContain(`${outlineUuid('r')}>a`)
    expect(keys).toContain(`a>${outlineUuid('a')}`)
    expect(keys).toContain(`r>${outlineUuid('r')}`)
    const x = (uuid: string) => view.cards.find((c) => c.uuid === uuid)!.x
    expect(x('r')).toBeLessThan(x(outlineUuid('r')))
    expect(x(outlineUuid('r'))).toBeLessThan(x('a'))
    expect(x('a')).toBeLessThan(x(outlineUuid('a')))
    // 目标项 childId = 文档卡 uuid；入口徽章在根文档卡上
    expect(view.cards.find((c) => c.uuid === outlineUuid('r'))!.slots!.find((s) => s.key === 'jichu')!.childId).toBe('a')
    expect(view.cards.find((c) => c.uuid === 'r')!.entry).toBe(true)
  })
})

describe('派生：分类链（子级接大纲卡，to = o: 成员）', () => {
  it('文档-大纲-大纲：树边落在子级的大纲卡上，那一对左移一列与父大纲对齐', () => {
    const view = deriveCanvas(storeOf(true), 'g1', undefined)
    const keys = view.edges.map((e) => `${e.from}>${e.to}`)
    expect(keys).toContain(`${outlineUuid('r')}>${outlineUuid('a')}`)
    expect(keys).toContain(`a>${outlineUuid('a')}`)
    expect(keys).toContain(`${outlineUuid('a')}>c`)
    const x = (uuid: string) => view.cards.find((c) => c.uuid === uuid)!.x
    expect(x('a')).toBe(x(outlineUuid('r'))) // 子文档与父大纲同列，在自己的大纲左边
    expect(x(outlineUuid('a'))).toBeGreaterThan(x(outlineUuid('r')))
    expect(x('c')).toBeGreaterThan(x(outlineUuid('a')))
    expect(view.cards.find((c) => c.uuid === outlineUuid('r'))!.slots!.find((s) => s.key === 'jichu')!.childId).toBe(
      outlineUuid('a'),
    )
  })
})

describe('游离大纲（独立实体，没有宿主文档）', () => {
  it('create({kind:"outline"}) 不给 under = 纯大纲实体，一个文档都不建', () => {
    const { svc, read } = serviceOf(storeOf(false))
    const before = read().nodes.length
    const r = svc.create({ kind: 'outline', title: '数学基础' })
    expect(r).toMatchObject({ ok: true, created: true })
    if (!('uuid' in r)) return
    expect(r.uuid.startsWith('o:')).toBe(true)
    expect(read().nodes.length).toBe(before) // 关键：没有自动生成文档
    expect(read().outlines).toHaveLength(1)
    // 派生：画布上就是一张游离大纲卡（free 标记，没有归属边）
    const view = deriveCanvas(read(), 'g1', undefined)
    const card = view.cards.find((c) => c.uuid === r.uuid)!
    expect(card.kind).toBe('outline')
    expect(card.free).toBe(true)
    expect(card.title).toBe('数学基础')
    expect(view.edges.some((e) => e.to === r.uuid)).toBe(false)
  })

  it('挂到根大纲之下成分类层；子文档认领它的目标项；树边以它的 uuid 发声', () => {
    const { svc, read } = serviceOf(storeOf(false))
    const layer = svc.create({ kind: 'outline', title: '数学基础', under: outlineUuid('r') })
    expect(layer).toMatchObject({ ok: true })
    if (!('uuid' in layer)) return
    expect(read().edges.some((e) => e.from === 'r' && e.to === layer.uuid)).toBe(true)
    // 给这一层写目标项，再点目标项建文档（认领）
    const o = svc.get(layer.uuid)!
    expect(o.editContent({ intro: '', children: [{ title: '线性代数', summary: '' }] })).toMatchObject({ ok: true })
    const d = svc.create({ kind: 'doc', title: '线性代数', under: layer.uuid, portKey: '线性代数' })
    expect(d).toMatchObject({ ok: true })
    const edge = read().edges.find((e) => e.to === ('uuid' in d ? d.uuid : ''))
    expect(edge).toMatchObject({ from: layer.uuid, portKey: '线性代数' })
    // 派生：根大纲 → 游离层 → 文档叶子，一层一列
    const view = deriveCanvas(read(), 'g1', undefined)
    const keys = view.edges.map((e) => `${e.from}>${e.to}`)
    expect(keys).toContain(`${outlineUuid('r')}>${layer.uuid}`)
    expect(keys).toContain(`${layer.uuid}>${'uuid' in d ? d.uuid : ''}`)
  })

  it('删除游离大纲：实体连同两端树边一起摘，子级都还在', () => {
    const { svc, read } = serviceOf(storeOf(false))
    const layer = svc.create({ kind: 'outline', title: '数学基础', under: outlineUuid('r') })
    if (!('uuid' in layer)) return
    svc.create({ kind: 'doc', title: '线性代数', under: layer.uuid })
    const r = svc.delete(layer.uuid)
    expect(r).toMatchObject({ ok: true })
    expect(read().outlines ?? []).toHaveLength(0)
    expect(read().edges.some((e) => e.from === layer.uuid || e.to === layer.uuid)).toBe(false)
    expect(read().nodes.some((n) => n.title === '线性代数')).toBe(true) // 子文档不连坐
  })

  it('认领目标项：getPortData 读得到上级交给这一层的任务，relations 带上级大纲 uuid', () => {
    const { svc } = serviceOf(storeOf(false))
    const layer = svc.create({ kind: 'outline', title: '数学基础' })
    if (!('uuid' in layer)) return
    expect(svc.get(outlineUuid('r'))!.connect(svc.get(layer.uuid)!, 'down', 'yingyong')).toMatchObject({ ok: true })
    const o = svc.get(layer.uuid)!
    expect(o.getPortData()).toEqual([{ key: 'yingyong', label: '应用', data: { summary: '' } }])
    expect(o.relations.some((r) => r.type === 'up' && r.id === outlineUuid('r') && r.portKey === 'yingyong')).toBe(true)
  })

  it('挂件挂不到游离大纲上（没有宿主文档）', () => {
    const { svc } = serviceOf(storeOf(false))
    const layer = svc.create({ kind: 'outline', title: '数学基础' })
    if (!('uuid' in layer)) return
    const r = svc.create({ kind: 'note', title: '错题本', under: layer.uuid })
    expect('error' in r).toBe(true)
    expect((r as { error: string }).error).toContain('游离大纲没有宿主文档')
  })
})

describe('域层：大纲连大纲（附身与游离同一套协议）', () => {
  it('大纲.connect(大纲) 落库：附身子级 to = o:{docId}；带 portKey 即认领目标项', () => {
    const store = storeOf(false)
    const d = node('d', '应用', 'yingyong', {
      intro: '',
      children: [{ key: 'daoshu', title: '导数', summary: '' }],
      updatedAt: 1,
    })
    const withD = { ...store, nodes: [...store.nodes, d] }
    const { svc, read } = serviceOf(withD)
    const r = svc.get(outlineUuid('r'))!.connect(svc.get(outlineUuid('d'))!, 'down', 'yingyong')
    expect(r).toMatchObject({ ok: true })
    expect(read().edges.find((e) => e.from === 'r' && e.to === outlineUuid('d'))).toMatchObject({ portKey: 'yingyong' })
    const view = deriveCanvas(read(), 'g1', undefined)
    expect(view.cards.find((c) => c.uuid === outlineUuid('r'))!.slots!.find((s) => s.key === 'yingyong')!.childId).toBe(
      outlineUuid('d'),
    )
  })

  it('大纲.connect(文档) 落库 to = 文档 id（交替链，原有行为）', () => {
    const store = storeOf(false)
    const withE = { ...store, nodes: [...store.nodes, node('e', '进阶', 'jinjie')] }
    const { svc, read } = serviceOf(withE)
    const r = svc.get(outlineUuid('r'))!.connect(svc.get('e')!, 'down')
    expect(r).toMatchObject({ ok: true })
    expect(read().edges.find((e) => e.from === 'r' && e.to === 'e')!.to).toBe('e')
  })

  it('同一接口只认一个下游：先到先得，后来者被拒', () => {
    const store = storeOf(false)
    const withEF = {
      ...store,
      nodes: [...store.nodes, node('e', '进阶', 'jinjie'), node('f', '提高', 'tigao')],
    }
    const { svc } = serviceOf(withEF)
    expect(svc.get(outlineUuid('r'))!.connect(svc.get('e')!, 'down', 'yingyong')).toMatchObject({ ok: true })
    const second = svc.get(outlineUuid('r'))!.connect(svc.get('f')!, 'down', 'yingyong')
    expect('error' in second).toBe(true)
    expect((second as { error: string }).error).toContain('认领')
  })

  it('disconnect(大纲, 子大纲) 拆树边：那层的文档与下级都还在', () => {
    const { svc, read } = serviceOf(storeOf(true))
    const r = svc.get(outlineUuid('r'))!.disconnect(svc.get(outlineUuid('a'))!)
    expect(r).toMatchObject({ ok: true })
    const after = read()
    expect(after.edges.some((e) => e.from === 'r' && e.to === outlineUuid('a'))).toBe(false)
    expect(after.nodes.find((n) => n.id === 'a')!.outline).toBeTruthy()
    expect(after.edges.some((e) => e.from === 'a' && e.to === 'c')).toBe(true)
  })
})

describe('落盘往返：游离大纲住目标目录的 outlines.json；旧 toOutline 标记迁到拼法', () => {
  it('build → parse：实体与游离树边原样进出', () => {
    const { svc, read } = serviceOf(storeOf(false))
    const layer = svc.create({ kind: 'outline', title: '数学基础', under: outlineUuid('r') })
    if (!('uuid' in layer)) return
    const files = buildDocs(read())
    const text = files.get('docs/微积分/outlines.json')
    expect(text).toBeTruthy()
    const back = parseDocs(files, { ...emptyLearnStore() })
    expect(back?.outlines ?? []).toHaveLength(1)
    expect(back?.outlines?.[0]).toMatchObject({ title: '数学基础', goalId: 'g1' })
    expect(back?.edges.some((e) => e.from === 'r' && e.to === layer.uuid)).toBe(true)
  })

  it('旧格式（deps 里带 toOutline: true）读盘迁成 to = o:{文档id}', () => {
    const files = buildDocs(storeOf(false))
    // 手改磁盘：给根节点的依赖边打上旧标记
    const nodePath = 'docs/微积分/微积分.node.json'
    const raw = JSON.parse(files.get(nodePath) as string)
    raw.dependencies = [{ to: 'a', createdAt: 1, toOutline: true }]
    files.set(nodePath, JSON.stringify(raw))
    files.delete('docs/微积分/outlines.json')
    const back = parseDocs(files, { ...emptyLearnStore() })
    expect(back?.edges.some((e) => e.from === 'r' && e.to === outlineUuid('a'))).toBe(true)
  })
})

describe('大纲挂在大纲 port 下（进一步拆分目标项）与 getPortData', () => {
  it('附身大纲与游离大纲挂在父大纲 port 下，relations 均包含上级大纲与 portKey，getPortData 可读到认领目标项', () => {
    const store = storeOf(false)
    const { svc } = serviceOf(store)

    // 1. 父大纲 r 包含目标项 'jichu'
    const parentOutline = svc.get(outlineUuid('r'))!
    expect(parentOutline.ports.some((p) => p.key === 'jichu')).toBe(true)

    // 2. 将附身大纲 o:a 挂在父大纲的 'jichu' port 下（进一步拆解该目标项）
    const attachChild = svc.get(outlineUuid('a'))!
    const rConnect = parentOutline.connect(attachChild, 'down', 'jichu')
    expect(rConnect).toMatchObject({ ok: true })

    // 验证附身大纲 o:a 的 relations 包含父大纲与 portKey
    const attachRels = attachChild.relations
    expect(attachRels).toContainEqual(
      expect.objectContaining({ id: outlineUuid('r'), type: 'up', portKey: 'jichu' })
    )

    // 验证 getPortData 读到了父大纲认领的目标项数据
    const attachPorts = attachChild.getPortData()
    expect(attachPorts).toHaveLength(1)
    expect(attachPorts[0].key).toBe('jichu')
    expect(attachPorts[0].label).toBe('基础')

    // 3. 创建游离大纲 layer 并挂在父大纲的 'yingyong' port 下
    const freeLayer = svc.create({ kind: 'outline', title: '微积分应用深入' })
    if (!('uuid' in freeLayer)) throw new Error('Create free outline failed')
    const freeChild = svc.get(freeLayer.uuid)!

    const rFreeConnect = parentOutline.connect(freeChild, 'down', 'yingyong')
    expect(rFreeConnect).toMatchObject({ ok: true })

    const freeRels = freeChild.relations
    expect(freeRels).toContainEqual(
      expect.objectContaining({ id: outlineUuid('r'), type: 'up', portKey: 'yingyong' })
    )

    const freePorts = freeChild.getPortData()
    expect(freePorts).toHaveLength(1)
    expect(freePorts[0].key).toBe('yingyong')
    expect(freePorts[0].label).toBe('应用')
  })
})
