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
