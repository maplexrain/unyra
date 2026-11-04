import { describe, expect, it } from 'vitest'
import type { LearnStore } from '../src/learn/types'
import { emptyLearnStore } from '../src/learn/store/empty'
import {
  exportGoalToUnr,
  importGoalFromPackage,
  parseUnrPackage,
  sanitizeGoalForExport,
  UNR_MAGIC,
  UNR_VERSION,
} from '../src/learn/export/unrPackage'

function createSampleStore(): LearnStore {
  const base = emptyLearnStore()
  const goalId = 'g-calc-101'
  const rootNodeId = 'n-limits'
  const subNodeId = 'n-squeeze'
  const outlineId = 'out-calc'
  const examId = 'ex-limits-1'

  return {
    ...base,
    goals: [
      {
        id: goalId,
        title: '微积分导论',
        rootNodeId,
        question: '如何理解极限与微积分？',
        createdAt: 1000,
        updatedAt: 2000,
      },
    ],
    nodes: [
      {
        id: rootNodeId,
        goalId,
        title: '极限概念',
        key: 'limits',
        description: '极限是微积分的基础',
        docs: { teaching: '# 极限概念\n\n极限思想是一切微积分的基石。' },
        notes: [
          {
            id: 'note-1',
            name: '重点笔记',
            content: 'ε-δ 定义要重点理解。',
            createdAt: 1010,
            updatedAt: 1020,
          },
        ],
        superdocs: [
          {
            id: 'sd-1',
            name: '极限可视化',
            html: '<canvas id="plot"></canvas>',
            createdAt: 1030,
            updatedAt: 1040,
          },
        ],
        outline: {
          intro: '第一部分 极限',
          children: [{ key: 'squeeze', title: '夹逼准则', summary: '求极限重要定理' }],
          updatedAt: 1050,
        },
        annotations: [
          { term: 'ε-δ', body: '柯西对极限的严格化定义', kind: 'understand' },
        ],
        status: 'mastered',
        lastStudiedAt: 999999, // 个人隐私打卡
        origin: 'ai',
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: subNodeId,
        goalId,
        title: '夹逼准则',
        key: 'squeeze',
        description: '夹逼定理',
        docs: { teaching: '两边夹住...' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'user',
        createdAt: 1100,
        updatedAt: 2100,
      },
    ],
    edges: [
      { from: rootNodeId, to: subNodeId, createdAt: 1200 },
      { from: rootNodeId, to: `o:${outlineId}`, createdAt: 1250 },
    ],
    outlines: [
      {
        id: outlineId,
        goalId,
        title: '基础知识大纲',
        intro: '准备工作',
        children: [{ key: 'basics', title: '初等函数', summary: '复习' }],
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
    exams: [
      {
        id: examId,
        nodeId: rootNodeId,
        goalId,
        title: '极限阶段测验',
        kind: 'quiz',
        level: 'medium',
        minutes: 15,
        questions: [
          {
            id: 'q1',
            type: 'single',
            stem: 'sin(x)/x 在 x->0 时的极限是？',
            options: [
              { id: 'opt1', text: '0' },
              { id: 'opt2', text: '1' },
            ],
            answer: ['opt2'],
            points: 10,
          },
        ],
        createdAt: 1500,
        // 敏感作答隐私
        attempts: [
          {
            id: 'att-1',
            startedAt: 1600,
            endedAt: 1700,
            status: 'graded',
            answers: [{ questionId: 'q1', value: ['opt2'] }],
            inputs: [{ questionId: 'q1', value: ['opt2'], at: 1650 }],
            dwell: { q1: 50000 },
            blurs: [{ start: 1620, ms: 3000 }],
            forceSubmit: false,
            passed: true,
            summary: '完全答对',
            explanation: '做得很好',
          },
        ],
      },
    ],
    structure: {
      [goalId]: {
        version: 2,
        positions: {
          [rootNodeId]: { x: 100, y: 150, note: '核心' },
          [subNodeId]: { x: 300, y: 150 },
          [`o:${outlineId}`]: { x: 100, y: 350 },
          [`e:${examId}`]: { x: 500, y: 150 },
        },
      },
    },
    detached: {
      [goalId]: {
        notes: [{ id: 'det-note-1', name: '草稿', content: '待归档', createdAt: 100, updatedAt: 200 }],
        superdocs: [],
      },
    },
    // 绝不可导出的隐私字段：
    conversations: [
      {
        id: 'c-secret',
        goalId,
        title: '私密提问',
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: '这是我的个人隐私提问，绝对不能泄露' }],
            ts: 1000,
          },
        ],
      },
    ],
    activeGoalId: goalId,
    activeNodeId: rootNodeId,
    activeConversationId: 'c-secret',
    tmp: { [rootNodeId]: { draft: { value: 'tmp-data', expiresAt: 9999, createdAt: 100 } } },
    drafts: { [rootNodeId]: 'draft text' },
    docScroll: {},
    localFiles: [{ path: 'C:\\Users\\alice\\Documents\\personal.txt', name: 'personal.txt', openedAt: 100 }],
  }
}

describe('.unr 目标包导出与脱敏规范', () => {
  it('导出的包严格剥除隐私字段（对话历史、作答记录、阅读打卡）', () => {
    const store = createSampleStore()
    const pkg = sanitizeGoalForExport(store, 'g-calc-101')

    // 格式与标识
    expect(pkg.format).toBe('unyra-goal')
    expect(pkg.version).toBe(1)
    expect(pkg.generator).toBe('Unyra')
    expect(pkg.goal.title).toBe('微积分导论')

    // 绝不包含会话历史
    expect((pkg as any).conversations).toBeUndefined()
    expect((pkg as any).messages).toBeUndefined()
    expect((pkg as any).tmp).toBeUndefined()
    expect((pkg as any).drafts).toBeUndefined()
    expect((pkg as any).localFiles).toBeUndefined()

    // 试卷：attempts 必须清空
    expect(pkg.exams).toHaveLength(1)
    expect(pkg.exams![0].attempts).toEqual([])
    expect(pkg.exams![0].questions).toHaveLength(1)
    expect(pkg.exams![0].questions[0].stem).toContain('sin(x)/x')

    // 知识节点：status 重置为 learning，清空 lastStudiedAt
    const root = pkg.nodes.find((n) => n.id === 'n-limits')!
    expect(root.status).toBe('learning')
    expect(root.lastStudiedAt).toBeUndefined()
    // 教学正文与笔记保留
    expect(root.docs.teaching).toContain('极限思想是一切微积分的基石')
    expect(root.notes).toHaveLength(1)
    expect(root.notes[0].content).toContain('ε-δ')
    expect(root.superdocs).toHaveLength(1)
    expect(root.annotations).toHaveLength(1)

    // 画布坐标保留
    expect(pkg.structure?.positions['n-limits']).toEqual({ x: 100, y: 150, note: '核心' })
    expect(pkg.structure?.positions['e:ex-limits-1']).toEqual({ x: 500, y: 150 })
  })

  it('二进制序列化打包与解包完整 Round-trip', async () => {
    const store = createSampleStore()
    const bytes = await exportGoalToUnr(store, 'g-calc-101')

    // 头部 5 字节
    expect(bytes[0]).toBe(UNR_MAGIC[0])
    expect(bytes[1]).toBe(UNR_MAGIC[1])
    expect(bytes[2]).toBe(UNR_MAGIC[2])
    expect(bytes[3]).toBe(UNR_MAGIC[3])
    expect(bytes[4]).toBe(UNR_VERSION)

    // 解包还原
    const unpacked = await parseUnrPackage(bytes)
    expect(unpacked.format).toBe('unyra-goal')
    expect(unpacked.goal.id).toBe('g-calc-101')
    expect(unpacked.nodes).toHaveLength(2)
    expect(unpacked.edges).toHaveLength(2)
    expect(unpacked.outlines).toHaveLength(1)
    expect(unpacked.exams).toHaveLength(1)
    expect(unpacked.exams![0].attempts).toEqual([])
  })

  it('非 UNR 文件或版本不匹配时安全报错拒绝', async () => {
    // 损坏文件
    const invalidHeader = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    await expect(parseUnrPackage(invalidHeader)).rejects.toThrow('文件头标识不匹配')

    // 文件过短
    const shortFile = new Uint8Array([0x55, 0x4e])
    await expect(parseUnrPackage(shortFile)).rejects.toThrow('文件损坏或过短')

    // 不支持的版本号
    const wrongVersion = new Uint8Array([0x55, 0x4e, 0x52, 0x31, 0x09, 0x1f, 0x8b])
    await expect(parseUnrPackage(wrongVersion)).rejects.toThrow('不支持的目标包格式版本: v9')
  })
})

describe('目标导入与 ID 重映射机制', () => {
  it('当导入已存在的相同目标时，自动进行全新 UUID 重映射与重名隔离', async () => {
    const store = createSampleStore()
    const bytes = await exportGoalToUnr(store, 'g-calc-101')
    const pkg = await parseUnrPackage(bytes)

    // 原 store 中已存在 g-calc-101
    const { store: nextStore, goal: importedGoal } = importGoalFromPackage(store, pkg)

    // 目标总数由 1 变为 2
    expect(nextStore.goals).toHaveLength(2)
    expect(importedGoal.id).not.toBe('g-calc-101') // 分配了新 UUID
    expect(importedGoal.title).toBe('微积分导论 (导入)') // 标题自动去重
    expect(nextStore.activeGoalId).toBe(importedGoal.id) // 自动切换到新目标

    // 根节点 ID 重映射且对应
    expect(importedGoal.rootNodeId).not.toBe('n-limits')
    const importedRootNode = nextStore.nodes.find((n) => n.id === importedGoal.rootNodeId)
    expect(importedRootNode).toBeDefined()
    expect(importedRootNode?.goalId).toBe(importedGoal.id)
    expect(importedRootNode?.docs.teaching).toContain('极限思想')

    // 关系边正确更新两端 ID
    const importedEdges = nextStore.edges.filter((e) => e.from === importedGoal.rootNodeId)
    expect(importedEdges).toHaveLength(2)

    // 试卷与大纲也已挂载至新目标
    const importedExams = nextStore.exams.filter((e) => e.goalId === importedGoal.id)
    expect(importedExams).toHaveLength(1)
    expect(importedExams[0].nodeId).toBe(importedGoal.rootNodeId)
    expect(importedExams[0].attempts).toEqual([])

    // 结构图坐标也使用重映射后的键
    const newStructure = nextStore.structure?.[importedGoal.id]
    expect(newStructure).toBeDefined()
    expect(newStructure?.positions[importedGoal.rootNodeId]).toEqual({ x: 100, y: 150, note: '核心' })
    expect(newStructure?.positions[`e:${importedExams[0].id}`]).toEqual({ x: 500, y: 150 })
  })

  it('全新目标导入时完整融入 store 且不冲突', async () => {
    const store = emptyLearnStore()
    const sample = createSampleStore()
    const bytes = await exportGoalToUnr(sample, 'g-calc-101')
    const pkg = await parseUnrPackage(bytes)

    const { store: nextStore, goal } = importGoalFromPackage(store, pkg)
    expect(nextStore.goals).toHaveLength(1)
    expect(nextStore.activeGoalId).toBe(goal.id)
    expect(nextStore.nodes).toHaveLength(2)
    expect(nextStore.exams).toHaveLength(1)
  })
})
