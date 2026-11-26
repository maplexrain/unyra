/**
 * 画布删除的撤回备货：NodeService.delete 的每一种落点都要能被 captureCanvasDelete 认出来，
 * 并且原样接回（挂件、自由实体、树边、目标锚点都在这一层对账）。
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { emptyOutline } from '../src/learn/types'
import { emptyDocs } from '../src/learn/groups'
import { applyUndo, captureCanvasDelete } from '../src/learn/undo'

const NOW = 1700000000000

function node(id: string, title: string, goalId = 'g1'): KnowledgeNode {
  return {
    id,
    key: title,
    title,
    description: '',
    docs: { teaching: title + ' 正文' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId,
    outline: { ...emptyOutline(), updatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function base(): LearnStore {
  return {
    version: 2,
    nodes: [node('d1', '微积分')],
    edges: [],
    goals: [{ id: 'g1', rootNodeId: 'd1', question: '微积分', createdAt: NOW, updatedAt: NOW }],
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'd1',
    activeConversationId: null,
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
  }
}

describe('captureCanvasDelete：画布删除的每一类节点都能撤回', () => {
  it('游离笔记：连同正文接回池子', () => {
    const s = base()
    s.detached = { g1: { notes: [{ id: 'n1', name: '随手记', content: '正文', createdAt: NOW, updatedAt: NOW }], superdocs: [] } }
    const entry = captureCanvasDelete(s, 'n1')
    expect(entry).toMatchObject({ kind: 'detached-note', goalId: 'g1' })
    const deleted: LearnStore = { ...s, detached: { g1: { notes: [], superdocs: [] } } }
    const r = applyUndo(deleted, entry!)
    expect(r.ok).toBe(true)
    expect(r.store.detached?.g1?.notes.map((n) => n.id)).toEqual(['n1'])
  })

  it('游离超级文档：连同 HTML 接回池子', () => {
    const s = base()
    s.detached = { g1: { notes: [], superdocs: [{ id: 's1', name: '总结', html: '<p>正文</p>', createdAt: NOW, updatedAt: NOW }] } }
    const entry = captureCanvasDelete(s, 's1')
    expect(entry).toMatchObject({ kind: 'detached-super', goalId: 'g1' })
    const deleted: LearnStore = { ...s, detached: { g1: { notes: [], superdocs: [] } } }
    expect(applyUndo(deleted, entry!).store.detached?.g1?.superdocs.map((d) => d.id)).toEqual(['s1'])
  })

  it('文件节点：实体与两端的树边一起回来', () => {
    const s = base()
    s.fileNodes = [{ id: 'f1', goalId: 'g1', title: '课件网页', fileKind: 'web', url: 'https://example.com', createdAt: NOW, updatedAt: NOW }]
    s.edges = [{ from: 'd1', to: 'f1', createdAt: NOW }]
    const entry = captureCanvasDelete(s, 'f1')
    expect(entry).toMatchObject({ kind: 'file' })
    const deleted: LearnStore = { ...s, fileNodes: [], edges: [] }
    const r = applyUndo(deleted, entry!)
    expect(r.ok).toBe(true)
    expect(r.store.fileNodes?.map((f) => f.id)).toEqual(['f1'])
    expect(r.store.edges.some((e) => e.from === 'd1' && e.to === 'f1')).toBe(true)
  })

  it('附身大纲：文档上的 outline 原样回来', () => {
    const s = base()
    const outline = { intro: '导语', children: [], guide: '导读', updatedAt: NOW }
    s.nodes[0]!.outline = outline
    const entry = captureCanvasDelete(s, 'o:d1')
    expect(entry).toMatchObject({ kind: 'outline' })
    const deleted: LearnStore = { ...s, nodes: [{ ...s.nodes[0]!, outline: undefined }] }
    const r = applyUndo(deleted, entry!)
    expect(r.ok).toBe(true)
    expect(r.store.nodes[0]?.outline).toEqual(outline)
  })

  it('项目 / 视频 / 课堂节点：实体与树边都能接回', () => {
    const s = base()
    s.projects = [{ id: 'p1', goalId: 'g1', title: '源码', path: 'src', pathKind: 'relative', createdAt: NOW, updatedAt: NOW }]
    s.videoNodes = [{ id: 'v1', goalId: 'g1', videoId: null, createdAt: NOW, updatedAt: NOW }]
    s.edges = [
      { from: 'd1', to: 'p1', createdAt: NOW },
      { from: 'd1', to: 'v1', createdAt: NOW },
    ]
    for (const id of ['p1', 'v1']) {
      const entry = captureCanvasDelete(s, id)
      expect(entry).not.toBeNull()
      const deleted: LearnStore = {
        ...s,
        projects: (s.projects ?? []).filter((p) => p.id !== id),
        videoNodes: (s.videoNodes ?? []).filter((v) => v.id !== id),
        edges: s.edges.filter((e) => e.to !== id),
      }
      const r = applyUndo(deleted, entry!)
      expect(r.ok).toBe(true)
      expect(r.store.edges.some((e) => e.to === id)).toBe(true)
    }
  })
})
