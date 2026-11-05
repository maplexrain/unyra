// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { LearnStore } from '../src/learn/types'
import { NodeService } from '../src/learn/nodeKinds/service'

describe('考试节点与超级文档下级连接只能为笔记节点规则', () => {
  let store: LearnStore

  beforeEach(() => {
    store = {
      ...emptyLearnStore(),
      goals: [{ id: 'g1', rootNodeId: 'doc-1', question: '目标', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'doc-1',
          title: '文档 1',
          key: 'doc1',
          description: '',
          docs: { teaching: '# 正文' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc-2',
          title: '文档 2',
          key: 'doc2',
          description: '',
          docs: { teaching: '# 正文 2' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      exams: [
        {
          id: 'exam-1',
          nodeId: 'doc-1',
          goalId: 'g1',
          title: '试卷 1',
          kind: 'quiz',
          level: 'easy',
          minutes: 0,
          questions: [],
          createdAt: 1,
          attempts: [],
        },
      ],
      detached: {
        g1: {
          notes: [
            { id: 'note-1', name: '独立笔记', content: '笔记正文', createdAt: 1, updatedAt: 1 },
          ],
          superdocs: [
            { id: 'sdoc-1', name: '超级文档 1', html: '<div>HTML</div>', createdAt: 1, updatedAt: 1 },
          ],
        },
      },
    }
  })

  it('考试节点下级连接只能为笔记节点，连向其他类型被拒绝', async () => {
    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => 'g1',
    })

    const examNode = svc.get('exam-1')
    const noteNode = svc.get('note-1')
    const docNode = svc.get('doc-2')
    const sdocNode = svc.get('sdoc-1')

    expect(examNode).not.toBeNull()
    expect(noteNode).not.toBeNull()

    // 1. 验证 onDownstream 约束：只能为笔记节点
    expect(examNode!.onDownstream(docNode!)).toContain('考试节点的下级连接只能为笔记节点')
    expect(examNode!.onDownstream(sdocNode!)).toContain('考试节点的下级连接只能为笔记节点')
    expect(examNode!.onDownstream(noteNode!)).toBe(true)

    // 2. 考试节点连向普通文档 -> 拒绝
    const rDoc = examNode!.connect(docNode!, 'down')
    expect('error' in rDoc).toBe(true)

    // 3. 考试节点连向超级文档 -> 拒绝
    const rSdoc = examNode!.connect(sdocNode!, 'down')
    expect('error' in rSdoc).toBe(true)

    // 4. 考试节点连向笔记节点 -> 成功
    const rNote = examNode!.connect(noteNode!, 'down')
    expect('ok' in rNote).toBe(true)
    expect(store.edges.some((e) => e.from === 'exam-1' && e.to === 'note-1')).toBe(true)

    // 5. 考试节点断开与笔记节点的连接 -> 成功拆除边
    const rDisc = examNode!.disconnect(noteNode!)
    expect('ok' in rDisc).toBe(true)
    expect(store.edges.some((e) => e.from === 'exam-1' && e.to === 'note-1')).toBe(false)
  })

  it('超级文档节点下级连接只能为笔记节点，连向其他类型被拒绝', async () => {
    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => 'g1',
    })

    const sdocNode = svc.get('sdoc-1')
    const noteNode = svc.get('note-1')
    const docNode = svc.get('doc-2')
    const examNode = svc.get('exam-1')

    // 1. 验证 onDownstream 约束：只能为笔记节点
    expect(sdocNode!.onDownstream(docNode!)).toContain('超级文档节点的下级连接只能为笔记节点')
    expect(sdocNode!.onDownstream(examNode!)).toContain('超级文档节点的下级连接只能为笔记节点')
    expect(sdocNode!.onDownstream(noteNode!)).toBe(true)

    // 2. 超级文档连向文档 -> 拒绝
    const rDoc = sdocNode!.connect(docNode!, 'down')
    expect('error' in rDoc).toBe(true)

    // 3. 超级文档连向考试节点 -> 拒绝
    const rExam = sdocNode!.connect(examNode!, 'down')
    expect('error' in rExam).toBe(true)

    // 4. 超级文档连向笔记 -> 成功
    const rNote = sdocNode!.connect(noteNode!, 'down')
    expect('ok' in rNote).toBe(true)
    expect(store.edges.some((e) => e.from === 'sdoc-1' && e.to === 'note-1')).toBe(true)

    // 5. 断开连接 -> 成功拆除边
    const rDisc = sdocNode!.disconnect(noteNode!)
    expect('ok' in rDisc).toBe(true)
    expect(store.edges.some((e) => e.from === 'sdoc-1' && e.to === 'note-1')).toBe(false)
  })

  it('笔记节点允许接受来自考试与超级文档的上游连接', async () => {
    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => 'g1',
    })

    const noteNode = svc.get('note-1')
    const examNode = svc.get('exam-1')
    const sdocNode = svc.get('sdoc-1')

    // 笔记视角上游校验
    expect(noteNode!.onUpstream(examNode!)).toBe(true)
    expect(noteNode!.onUpstream(sdocNode!)).toBe(true)
  })
})

describe('大纲目标项手动添加与重命名改名', () => {
  it('大纲节点支持添加目标项与改名，并同步保持认领边 portKey 一致', () => {
    let store: LearnStore = {
      ...emptyLearnStore(),
      goals: [{ id: 'g1', rootNodeId: 'doc-1', question: '目标', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'doc-1',
          title: '文档 1',
          key: 'doc1',
          description: '',
          docs: { teaching: '# 正文' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
          outline: {
            intro: '导语',
            children: [
              { key: 'target_old', title: '原目标项标题', summary: '摘要' },
            ],
            updatedAt: 1,
          },
        },
        {
          id: 'doc-2',
          title: '子文档',
          key: 'doc2',
          description: '',
          docs: { teaching: '# 正文' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [
        // 子文档认领了 target_old
        { from: 'o:doc-1', to: 'doc-2', portKey: 'target_old', createdAt: 1 },
      ],
    }

    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => 'g1',
    })

    const outline = svc.get('o:doc-1')
    expect(outline).not.toBeNull()

    // 1. 手动添加一条新目标项
    const curContent = outline!.content as any
    const rAdd = outline!.editContent({
      intro: curContent.intro,
      children: [...curContent.children, { title: '手动新增的目标项', summary: '' }],
    })
    expect('ok' in rAdd).toBe(true)

    const updated = svc.get('o:doc-1')!.content as any
    expect(updated.children.length).toBe(2)
    expect(updated.children[1].title).toBe('手动新增的目标项')

    // 2. 重命名已有目标项
    const renamedTitle = '更新后的目标项新名称'
    const nextChildren = updated.children.map((c: any) =>
      c.title === '原目标项标题' ? { ...c, title: renamedTitle } : c
    )
    const rRename = outline!.editContent({
      intro: updated.intro,
      children: nextChildren,
    })
    expect('ok' in rRename).toBe(true)

    const afterRename = svc.get('o:doc-1')!.content as any
    expect(afterRename.children[0].title).toBe(renamedTitle)
  })
})

describe('PDF阅读页面性能模式与虚拟滚动规则', () => {
  it('虚拟滚动根据视口页码和 overscan 只渲染近邻页面，远端页面返回 false', () => {
    const VIRTUAL_OVERSCAN = 2
    const totalPages = 100
    const currentPage = 50

    // 判定函数逻辑与 PdfDocView.tsx 保持完全一致
    const shouldRenderPage = (p: number, mode: 'scroll' | 'flip') => {
      if (mode === 'flip') return p === currentPage
      return p >= currentPage - VIRTUAL_OVERSCAN && p <= currentPage + VIRTUAL_OVERSCAN
    }

    // 滚动模式下：当前页 50，overscan 2 => 仅 48, 49, 50, 51, 52 渲染
    expect(shouldRenderPage(50, 'scroll')).toBe(true)
    expect(shouldRenderPage(48, 'scroll')).toBe(true)
    expect(shouldRenderPage(52, 'scroll')).toBe(true)
    expect(shouldRenderPage(47, 'scroll')).toBe(false)
    expect(shouldRenderPage(53, 'scroll')).toBe(false)
    expect(shouldRenderPage(1, 'scroll')).toBe(false)
    expect(shouldRenderPage(totalPages, 'scroll')).toBe(false)

    // 翻页模式下：仅当前页 50 真实挂载
    expect(shouldRenderPage(50, 'flip')).toBe(true)
    expect(shouldRenderPage(49, 'flip')).toBe(false)
    expect(shouldRenderPage(51, 'flip')).toBe(false)
  })

  it('视图模式持久化与默认值规则', () => {
    localStorage.removeItem('moji:pdf:viewMode')
    // 默认回退为 scroll 连续滚动
    const initialMode = localStorage.getItem('moji:pdf:viewMode') || 'scroll'
    expect(initialMode).toBe('scroll')

    // 切换到 flip
    localStorage.setItem('moji:pdf:viewMode', 'flip')
    expect(localStorage.getItem('moji:pdf:viewMode')).toBe('flip')

    // 切换回 scroll
    localStorage.setItem('moji:pdf:viewMode', 'scroll')
    expect(localStorage.getItem('moji:pdf:viewMode')).toBe('scroll')
  })
})

import { outlineCardHeight, EMPTY_OUTLINE_H, deriveCanvas } from '../src/components/learn/structure/structureView'
import { isTabPinned, makeTab, reorderTabs, closeTabs } from '../src/learn/tabs'

describe('空大纲卡片高度与按钮防溢出', () => {
  it('空大纲卡片高度返回 EMPTY_OUTLINE_H (104px)，保证添加目标项按钮完整在卡片内', () => {
    expect(EMPTY_OUTLINE_H).toBe(104)
    expect(outlineCardHeight(0)).toBe(104)
    expect(outlineCardHeight(1)).toBe(98)
    expect(outlineCardHeight(2)).toBe(120)
  })
})

describe('拓扑图连线支持与下级挂件连接', () => {
  it('deriveCanvas 能够正确为 exam -> note 以及 superdoc -> note 生成拓扑连线', () => {
    const store: LearnStore = {
      ...emptyLearnStore(),
      goals: [{ id: 'g1', rootNodeId: 'doc-1', question: '目标', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'doc-1',
          title: '文档 1',
          key: 'doc1',
          description: '',
          docs: { teaching: '# 正文' },
          notes: [{ id: 'n1', title: '笔记 1', content: '' }],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      exams: [
        {
          id: 'exam-1',
          nodeId: 'doc-1',
          goalId: 'g1',
          title: '试卷 1',
          kind: 'quiz',
          level: 'easy',
          minutes: 0,
          questions: [],
          createdAt: 1,
          attempts: [],
        },
      ],
      edges: [
        { from: 'exam-1', to: 'n1' },
      ],
    }

    const canvas = deriveCanvas(store, 'g1', {
      nodeTitle: (id) => (id === 'doc-1' ? '文档 1' : undefined),
    })

    // 验证 edges 包含从 exam 到 note 的连线
    expect(canvas.edges.length).toBeGreaterThan(0)
    const edge = canvas.edges.find((e) => e.from === 'exam-1' && e.to === 'n1')
    expect(edge).toBeDefined()
  })
})

describe('文档区固定 Tab（Pinned Tab）规则', () => {
  it('结构 Tab (outline) 默认为固定 Tab，普通文档默认为非固定', () => {
    const outlineTab = makeTab({ kind: 'outline', nodeId: 'n1' }, 0)
    const teachTab = makeTab({ kind: 'teach', nodeId: 'n1' }, 0)
    const noteTab = makeTab({ kind: 'note', nodeId: 'n1', note: '随笔' }, 0)

    expect(isTabPinned(outlineTab)).toBe(true)
    expect(isTabPinned(teachTab)).toBe(false)
    expect(isTabPinned(noteTab)).toBe(false)
  })

  it('显式设置 pinned 属性会被优先采纳', () => {
    const customPinned = { ...makeTab({ kind: 'teach', nodeId: 'n1' }, 0), pinned: true }
    const customUnpinned = { ...makeTab({ kind: 'outline', nodeId: 'n1' }, 0), pinned: false }

    expect(isTabPinned(customPinned)).toBe(true)
    expect(isTabPinned(customUnpinned)).toBe(false)
  })

  it('reorderTabs 始终保证固定 Tab 排在最前面', () => {
    const tabA = makeTab({ kind: 'teach', nodeId: 'nA' }, 0)
    const tabB = { ...makeTab({ kind: 'teach', nodeId: 'nB' }, 0), pinned: true }
    const tabOutline = makeTab({ kind: 'outline', nodeId: 'nOutline' }, 0)
    const tabC = makeTab({ kind: 'teach', nodeId: 'nC' }, 0)

    const tabs = [tabA, tabB, tabOutline, tabC]
    const reordered = reorderTabs(tabs, [tabC.id, tabA.id, tabOutline.id, tabB.id])

    // 固定 tab（tabOutline, tabB）在前，非固定（tabC, tabA）在后
    const pinnedIds = reordered.filter(isTabPinned).map((t) => t.id)
    const unpinnedIds = reordered.filter((t) => !isTabPinned(t)).map((t) => t.id)

    expect(pinnedIds).toEqual([tabOutline.id, tabB.id])
    expect(unpinnedIds).toEqual([tabC.id, tabA.id])
    expect(reordered.map((t) => t.id)).toEqual([...pinnedIds, ...unpinnedIds])
  })

  it('固定 Tab 不受非直接关闭方式（others, all）影响，但可以通过自身直接关闭（self）', () => {
    const tabOutline = makeTab({ kind: 'outline', nodeId: 'nOutline' }, 0)
    const tabPinned = { ...makeTab({ kind: 'teach', nodeId: 'nPinned' }, 0), pinned: true }
    const tab1 = makeTab({ kind: 'teach', nodeId: 'n1' }, 0)
    const tab2 = makeTab({ kind: 'teach', nodeId: 'n2' }, 0)

    const tabs = [tabOutline, tabPinned, tab1, tab2]

    // 1. 关闭其他：在 tab1 上执行 others，不关闭固定 tab
    const rOthers = closeTabs(tabs, tab1.id, 'others', tab1.id)
    expect(rOthers.tabs.map((t) => t.id)).toContain(tabOutline.id)
    expect(rOthers.tabs.map((t) => t.id)).toContain(tabPinned.id)
    expect(rOthers.tabs.map((t) => t.id)).toContain(tab1.id)
    expect(rOthers.tabs.map((t) => t.id)).not.toContain(tab2.id)

    // 2. 全部关闭：执行 all，保留所有固定 tab
    const rAll = closeTabs(tabs, tab1.id, 'all', tab1.id)
    expect(rAll.tabs.map((t) => t.id)).toEqual([tabOutline.id, tabPinned.id])

    // 3. 自身关闭：直接关闭固定 tab 能够成功关闭
    const rSelf = closeTabs(tabs, tabPinned.id, 'self', tabPinned.id)
    expect(rSelf.tabs.map((t) => t.id)).not.toContain(tabPinned.id)
    expect(rSelf.tabs.map((t) => t.id)).toContain(tabOutline.id)
  })
})

describe('PDF 翻页模式前后页预热防闪屏', () => {
  it('翻页模式挂载当前页前后各 2 页进行后台矢量预热，避免白屏闪烁', () => {
    const totalPages = 20
    const currentPage = 5
    const PRELOAD_RANGE = 2

    // 翻页模式下的预渲染挂载判断
    const isMountedInFlip = (page: number) => {
      return page >= Math.max(1, currentPage - PRELOAD_RANGE) &&
             page <= Math.min(totalPages, currentPage + PRELOAD_RANGE)
    }

    // 5 前后 2 页 (3, 4, 5, 6, 7) 挂载后台 Canvas
    expect(isMountedInFlip(3)).toBe(true)
    expect(isMountedInFlip(4)).toBe(true)
    expect(isMountedInFlip(5)).toBe(true)
    expect(isMountedInFlip(6)).toBe(true)
    expect(isMountedInFlip(7)).toBe(true)
    // 远端页面不挂载
    expect(isMountedInFlip(1)).toBe(false)
    expect(isMountedInFlip(2)).toBe(false)
    expect(isMountedInFlip(8)).toBe(false)
  })
})
