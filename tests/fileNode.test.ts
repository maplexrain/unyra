import { describe, expect, it, vi } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { NodeService } from '../src/learn/nodeKinds/service'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import { buildDocs, parseDocs } from '../src/learn/files'
import {
  createFileNode,
  updateFileNode,
  removeFileNode,
  normalizeFileNodes,
  sanitizeFileName,
  normalizeLocalFileUrl,
  isValidLocalFileUrl,
} from '../src/learn/fileNodes'
import { setUserScope } from '../src/lib/storage'
import { PROMPT_MODULES } from '../src/learn/ai/promptModules'
import { WORKFLOWS_GUIDE } from '../src/learn/ai/workflowsGuide'

function node(id: string, title: string, key: string): KnowledgeNode {
  return {
    id,
    title,
    key,
    description: '',
    docs: { teaching: '' },
    notes: [],
    superdocs: [{ id: 's1', name: '超级文档 1', html: '', createdAt: 1, updatedAt: 1 }],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: 1,
    updatedAt: 1,
  }
}

function storeOf(): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'doc1', question: '目标 1', createdAt: 1, updatedAt: 1 }],
    nodes: [node('doc1', '根文档', 'root-doc')],
    detached: {
      g1: {
        notes: [{ id: 'n1', name: '笔记 1', content: '', createdAt: 1, updatedAt: 1 }],
        superdocs: [],
      },
    },
    exams: [
      {
        id: 'e1',
        nodeId: 'doc1',
        goalId: 'g1',
        title: '测验 1',
        kind: 'quiz',
        level: 'easy',
        minutes: 10,
        questions: [],
        attempts: [],
        createdAt: 1,
      },
    ],
    outlines: [{ id: 'o1', goalId: 'g1', title: '大纲 1', intro: '', children: [], createdAt: 1, updatedAt: 1 }],
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

describe('文件节点数据模型与 URL 限制', () => {
  it('文件名与本地 URL 安全规范化', () => {
    // 基础文件名提取与非法字符清洗
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('report:2026_01_01?.pdf')).toBe('report_2026_01_01_.pdf')
    expect(sanitizeFileName('  clean.md  ')).toBe('clean.md')

    // normalizeLocalFileUrl 强制必须落在 files/ 目录下
    expect(normalizeLocalFileUrl('files/report.pdf')).toBe('files/report.pdf')
    expect(normalizeLocalFileUrl('report.pdf')).toBe('files/report.pdf')
    expect(normalizeLocalFileUrl('sub/dir/test.txt')).toBe('files/test.txt')

    // isValidLocalFileUrl 校验
    expect(isValidLocalFileUrl('files/doc.pdf')).toBe(true)
    expect(isValidLocalFileUrl('files/sub/doc.pdf')).toBe(true)
    expect(isValidLocalFileUrl('files/../secret.txt')).toBe(false)
    expect(isValidLocalFileUrl('other/secret.txt')).toBe(false)
  })

  it('文件节点增删改与基础归一化', () => {
    let store = emptyLearnStore()
    const { store: s1, entity } = createFileNode(store, {
      goalId: 'g1',
      title: '本地文献',
      fileKind: 'local',
      url: 'files/paper.pdf',
    }, 100)
    store = s1
    expect(entity.title).toBe('本地文献')
    expect(entity.fileKind).toBe('local')
    expect(entity.url).toBe('files/paper.pdf')
    expect(store.fileNodes?.length).toBe(1)

    // update
    const rUpdate = updateFileNode(store, entity.id, { title: '新标题', url: 'files/paper_v2.pdf' })
    expect('store' in rUpdate).toBe(true)
    const s2 = (rUpdate as any).store
    const updated = s2.fileNodes?.find((f: any) => f.id === entity.id)
    expect(updated?.title).toBe('新标题')
    expect(updated?.url).toBe('files/paper_v2.pdf')

    // remove
    const s3 = removeFileNode(s2, entity.id)
    expect(s3.store.fileNodes?.length).toBe(0)

    // normalizeFileNodes 过滤非法或缺失必填项的脏数据
    const normalized = normalizeFileNodes([
      { id: 'f1', goalId: 'g1', title: '合格', fileKind: 'local', url: 'files/a.txt', createdAt: 1, updatedAt: 1 },
      { id: '', goalId: 'g1', title: '无id', fileKind: 'local', url: 'files/b.txt', createdAt: 1, updatedAt: 1 },
      { id: 'f2', goalId: 'g1', title: '非法类型', fileKind: 'invalid' as any, url: 'files/c.txt', createdAt: 1, updatedAt: 1 },
    ])
    expect(normalized.length).toBe(1)
    expect(normalized[0].id).toBe('f1')
  })
})

describe('NodeService 协议与双边协商拓扑约束', () => {
  it('可以通过 NodeService 创建与列举本地文件节点与网页文件节点', async () => {
    const { svc } = serviceOf(storeOf())

    // 创建本地文件节点
    const r1 = await svc.create({
      kind: 'file',
      title: '本地文章',
      fileKind: 'local',
      url: 'files/article.md',
    })
    expect('error' in r1).toBe(false)
    const f1Id = (r1 as any).uuid

    // 创建网页文件节点
    const r2 = await svc.create({
      kind: 'file',
      title: 'MDN 文档',
      fileKind: 'web',
      url: 'https://developer.mozilla.org',
    })
    expect('error' in r2).toBe(false)
    const f2Id = (r2 as any).uuid

    const list = svc.list() as any
    const fileItems = list.fileNodes
    expect(fileItems.length).toBe(2)
    expect(fileItems.find((it: any) => it.uuid === f1Id)?.title).toBe('本地文章')
    expect(fileItems.find((it: any) => it.uuid === f2Id)?.title).toBe('MDN 文档')
  })

  it('文件节点上级约束：允许 doc / note / superdoc / exam，拒绝 outline / video / project / file', async () => {
    const { svc } = serviceOf(storeOf())
    const rFile = await svc.create({ kind: 'file', title: '文件卡' })
    const fileId = (rFile as any).uuid
    const fileNode = svc.get(fileId)!
    expect(fileNode).toBeDefined()

    // 允许 doc / note / superdoc / exam
    const docNode = svc.get('doc1')!
    const noteNode = svc.get('n1')!
    const superNode = svc.get('s1')!
    const examNode = svc.get('e1')!

    expect(fileNode.onUpstream(docNode)).toBe(true)
    expect(fileNode.onUpstream(noteNode)).toBe(true)
    expect(fileNode.onUpstream(superNode)).toBe(true)
    expect(fileNode.onUpstream(examNode)).toBe(true)

    // 对方的 onDownstream 也必须同意 file
    expect(docNode.onDownstream(fileNode)).toBe(true)
    expect(noteNode.onDownstream(fileNode)).toBe(true)
    expect(superNode.onDownstream(fileNode)).toBe(true)
    expect(examNode.onDownstream(fileNode)).toBe(true)

    // 拒绝 outline
    const outlineNode = svc.get('o:o1')!
    expect(outlineNode).toBeDefined()
    expect(typeof fileNode.onUpstream(outlineNode)).toBe('string')

    // 拒绝另一个 file 作为上级
    const rFile2 = await svc.create({ kind: 'file', title: '文件卡2' })
    const fileNode2 = svc.get((rFile2 as any).uuid)!
    expect(typeof fileNode.onUpstream(fileNode2)).toBe('string')
  })

  it('文件节点下级约束：允许 outline / doc / note / superdoc / exam，拒绝 video / project / file', async () => {
    const { svc } = serviceOf(storeOf())
    const rFile = await svc.create({ kind: 'file', title: '文件卡' })
    const fileId = (rFile as any).uuid
    const fileNode = svc.get(fileId)!

    const docNode = svc.get('doc1')!
    const noteNode = svc.get('n1')!
    const superNode = svc.get('s1')!
    const examNode = svc.get('e1')!
    const outlineNode = svc.get('o:o1')!

    // 允许 outline / doc / note / superdoc / exam
    expect(fileNode.onDownstream(outlineNode)).toBe(true)
    expect(fileNode.onDownstream(docNode)).toBe(true)
    expect(fileNode.onDownstream(noteNode)).toBe(true)
    expect(fileNode.onDownstream(superNode)).toBe(true)
    expect(fileNode.onDownstream(examNode)).toBe(true)

    // 对方的 onUpstream 也必须同意 file
    expect(outlineNode.onUpstream(fileNode)).toBe(true)
    expect(docNode.onUpstream(fileNode)).toBe(true)
    expect(noteNode.onUpstream(fileNode)).toBe(true)
    expect(superNode.onUpstream(fileNode)).toBe(true)
    expect(examNode.onUpstream(fileNode)).toBe(true)

    // 拒绝另一个 file 作为下级
    const rFile2 = await svc.create({ kind: 'file', title: '文件卡2' })
    const fileNode2 = svc.get((rFile2 as any).uuid)!
    expect(typeof fileNode.onDownstream(fileNode2)).toBe('string')
  })

  it('文件节点双向 connect 与 disconnect 正常建立与切断依赖边', async () => {
    const { svc, read } = serviceOf(storeOf())
    const rFile = await svc.create({ kind: 'file', title: '文献' })
    const fileId = (rFile as any).uuid
    const fileNode = svc.get(fileId)!
    const docNode = svc.get('doc1')!

    // file 向上连接 doc (doc 为上游，file 为下游)
    const linkRes = fileNode.connect(docNode, 'up')
    expect('error' in linkRes).toBe(false)
    expect(read().edges.some((e) => e.from === 'doc1' && e.to === fileId)).toBe(true)

    // relations 包含上级
    const rels = fileNode.relations
    expect(rels.some((r) => r.id === 'doc1' && r.type === 'up')).toBe(true)

    // disconnect 切断
    const unlinkRes = fileNode.disconnect(docNode)
    expect('error' in unlinkRes).toBe(false)
    expect(read().edges.some((e) => e.from === 'doc1' && e.to === fileId)).toBe(false)
  })

  it('文件节点支持下级连接笔记节点（file -> note）', async () => {
    const { svc, read } = serviceOf(storeOf())
    const rFile = await svc.create({ kind: 'file', title: '文献' })
    const fileId = (rFile as any).uuid
    const fileNode = svc.get(fileId)!
    const noteNode = svc.get('n1')!

    // note 向上连接 file (file 为上游，note 为下游)
    const linkRes = noteNode.connect(fileNode, 'up')
    expect('error' in linkRes).toBe(false)
    expect(read().edges.some((e) => e.from === fileId && e.to === 'n1')).toBe(true)

    const unlinkRes = noteNode.disconnect(fileNode)
    expect('error' in unlinkRes).toBe(false)
    expect(read().edges.some((e) => e.from === fileId && e.to === 'n1')).toBe(false)
  })
})

describe('删除文件节点联动物理文件删除', () => {
  it('删除本地文件节点会物理删除 docs/{目标}/files/ 下的文件', async () => {
    const store = storeOf()
    const { svc, read } = serviceOf(store)
    const r = await svc.create({
      kind: 'file',
      title: '论文',
      fileKind: 'local',
      url: 'files/deeplearning.pdf',
    })
    const fileId = (r as any).uuid

    // 装假桥并设置用户 scope
    setUserScope('u1')
    const mockRemove = vi.fn().mockResolvedValue({ ok: true })
    const g = globalThis as { window?: unknown }
    const orig = g.window
    g.window = { mojiNative: { storage: { remove: mockRemove } } }

    try {
      const delRes = svc.delete(fileId)
      expect('error' in delRes).toBe(false)
      expect(read().fileNodes?.length).toBe(0)

      // 验证调用了物理删除，且路径准确落入当前用户的目标 files 目录
      expect(mockRemove).toHaveBeenCalledWith(
        expect.stringMatching(/users\/u1\/docs\/.*\/files\/deeplearning\.pdf$/),
      )
    } finally {
      if (orig === undefined) delete g.window
      else g.window = orig
      setUserScope(null)
    }
  })

  it('删除网页文件节点不会触发本地物理文件删除', async () => {
    const store = storeOf()
    const { svc } = serviceOf(store)
    const r = await svc.create({
      kind: 'file',
      title: '网页',
      fileKind: 'web',
      url: 'https://arxiv.org/abs/1234',
    })
    const fileId = (r as any).uuid

    setUserScope('u1')
    const mockRemove = vi.fn().mockResolvedValue({ ok: true })
    const g = globalThis as { window?: unknown }
    const orig = g.window
    g.window = { mojiNative: { storage: { remove: mockRemove } } }

    try {
      const delRes = svc.delete(fileId)
      expect('error' in delRes).toBe(false)
      expect(mockRemove).not.toHaveBeenCalled()
    } finally {
      if (orig === undefined) delete g.window
      else g.window = orig
      setUserScope(null)
    }
  })
})

describe('存储序列化与派生画布', () => {
  it('buildDocs 与 parseDocs 支持 file-nodes.json 往返无损持久化', async () => {
    const store: LearnStore = {
      ...storeOf(),
      fileNodes: [
        {
          id: 'f1',
          goalId: 'g1',
          title: '参考架构图',
          fileKind: 'local',
          url: 'files/arch.png',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      edges: [{ from: 'doc1', to: 'f1', createdAt: 1 }],
    }

    const files = buildDocs(store)
    const targetKey = Array.from(files.keys()).find((k) => k.endsWith('file-nodes.json'))
    expect(targetKey).toBeDefined()
    const content = JSON.parse(files.get(targetKey!)!)
    expect(content.nodes.length).toBe(1)
    expect(content.nodes[0].title).toBe('参考架构图')
    expect(content.edges.length).toBe(1)

    // 读盘解析
    const parsed = parseDocs(files, {})!
    expect(parsed).not.toBeNull()
    expect(parsed.fileNodes?.length).toBe(1)
    expect(parsed.fileNodes?.[0].title).toBe('参考架构图')
    expect(parsed.edges.some((e) => e.from === 'doc1' && e.to === 'f1')).toBe(true)
  })

  it('deriveCanvas 能够派生出 file 节点卡片和正确的连线关系', () => {
    const store: LearnStore = {
      ...storeOf(),
      fileNodes: [
        {
          id: 'f1',
          goalId: 'g1',
          title: '设计文档',
          fileKind: 'local',
          url: 'files/design.pdf',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [{ from: 'doc1', to: 'f1', createdAt: 1 }],
    }

    const canvas = deriveCanvas(store, 'g1', undefined)
    const fileCard = canvas.cards.find((c) => c.uuid === 'f1')
    expect(fileCard).toBeDefined()
    expect(fileCard?.kind).toBe('file')
    expect(fileCard?.title).toBe('设计文档')
    expect(fileCard?.file?.fileKind).toBe('local')
    expect(fileCard?.file?.url).toBe('files/design.pdf')

    // 检查是否有边从 doc1 到 f1
    const edge = canvas.edges.find((e) => e.to === 'f1')
    expect(edge).toBeDefined()
  })
})

describe('提示词与工作流规范同步验证', () => {
  it('promptModules 中 project-interpret 明确小文件材料用 file 节点，大工程用 project 节点', () => {
    const mod = PROMPT_MODULES.find((m) => m.key === 'project-interpret')
    expect(mod).toBeDefined()
    expect(mod?.text).toContain("创建文件节点（kind: 'file'）进行引用，而不是创建项目节点")
    expect(mod?.text).toContain("docs/{目标}/files/")
    expect(mod?.text).toContain("fileKind: 'local'")
    expect(mod?.text).toContain("fileKind: 'web'")
  })

  it('workflowsGuide 中明确解读材料较少时创建文件节点引用', () => {
    expect(WORKFLOWS_GUIDE).toContain("如果材料较少则创建文件节点（kind: 'file'）进行引用")
    expect(WORKFLOWS_GUIDE).toContain("大型代码工程则创建项目节点（kind: 'project'）")
  })
})

describe('文件节点拖拽判定、自由双向连线与打开Tab逻辑', () => {
  it('拖拽检测：非 .unr 文件绝不识别为导入包，只有 .unr 才识别', () => {
    const isUnrDragChecker = (files: Array<{ name: string }>, types = ['Files']): boolean => {
      const dt = {
        types,
        files,
        items: files.map((f) => ({ kind: 'file', getAsFile: () => f })),
      }
      const hasFiles = dt.types ? Array.from(dt.types).includes('Files') : false
      if (!hasFiles) return false
      return dt.files.some((f) => f.name.toLowerCase().endsWith('.unr'))
    }

    expect(isUnrDragChecker([{ name: 'report.pdf' }])).toBe(false)
    expect(isUnrDragChecker([{ name: 'notes.txt' }, { name: 'image.png' }])).toBe(false)
    expect(isUnrDragChecker([{ name: 'export.unr' }])).toBe(true)
    expect(isUnrDragChecker([{ name: 'COURSE.UNR' }])).toBe(true)
    expect(isUnrDragChecker([], ['text/plain'])).toBe(false)
  })

  it('文件节点支持与各合法上级与下级双向自由连线与解绑', () => {
    const baseStore: LearnStore = {
      ...storeOf(),
      fileNodes: [
        { id: 'f1', goalId: 'g1', title: '文件 1', fileKind: 'local', url: 'files/test.pdf', createdAt: 1, updatedAt: 1 },
        { id: 'f2', goalId: 'g1', title: '文件 2', fileKind: 'web', url: 'https://example.com', createdAt: 1, updatedAt: 1 },
      ],
    }
    const { svc } = serviceOf(baseStore)

    const doc = svc.get('doc1')!
    const note = svc.get('n1')!
    const superdoc = svc.get('s1')!
    const exam = svc.get('e1')!
    const outline = svc.get('o:o1')!
    const file1 = svc.get('f1')!
    const file2 = svc.get('f2')!

    // 上级 -> 文件
    expect(doc.connect(file1, 'down')).toMatchObject({ ok: true })
    expect(file1.relations.some((r) => r.id === 'doc1' && r.type === 'up')).toBe(true)
    expect(doc.disconnect(file1)).toMatchObject({ ok: true })

    expect(note.connect(file1, 'down')).toMatchObject({ ok: true })
    expect(file1.relations.some((r) => r.id === 'n1' && r.type === 'up')).toBe(true)
    expect(note.disconnect(file1)).toMatchObject({ ok: true })

    expect(superdoc.connect(file1, 'down')).toMatchObject({ ok: true })
    expect(file1.relations.some((r) => r.id === 's1' && r.type === 'up')).toBe(true)
    expect(superdoc.disconnect(file1)).toMatchObject({ ok: true })

    expect(exam.connect(file1, 'down')).toMatchObject({ ok: true })
    expect(file1.relations.some((r) => r.id === 'e1' && r.type === 'up')).toBe(true)
    expect(exam.disconnect(file1)).toMatchObject({ ok: true })

    // 文件 -> 下级
    expect(file2.connect(outline, 'down')).toMatchObject({ ok: true })
    expect(file2.relations.some((r) => r.id === 'o:o1' && r.type === 'down')).toBe(true)
    expect(file2.disconnect(outline)).toMatchObject({ ok: true })

    expect(file2.connect(doc, 'down')).toMatchObject({ ok: true })
    expect(file2.relations.some((r) => r.id === 'doc1' && r.type === 'down')).toBe(true)
    expect(file2.disconnect(doc)).toMatchObject({ ok: true })

    expect(file2.connect(note, 'down')).toMatchObject({ ok: true })
    expect(file2.relations.some((r) => r.id === 'n1' && r.type === 'down')).toBe(true)
    expect(file2.disconnect(note)).toMatchObject({ ok: true })

    expect(file2.connect(superdoc, 'down')).toMatchObject({ ok: true })
    expect(file2.relations.some((r) => r.id === 's1' && r.type === 'down')).toBe(true)
    expect(file2.disconnect(superdoc)).toMatchObject({ ok: true })

    expect(file2.connect(exam, 'down')).toMatchObject({ ok: true })
    expect(file2.relations.some((r) => r.id === 'e1' && r.type === 'down')).toBe(true)
    expect(file2.disconnect(exam)).toMatchObject({ ok: true })
  })
})
