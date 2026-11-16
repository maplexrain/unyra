// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { executeVimCommand, setGlobalTabOperations } from '../src/lib/vimCommands'
import {
  addGoalKnowledge,
  removeGoalKnowledge,
  getGoalKnowledge,
  serializeGoalKnowledge,
  parseGoalKnowledge,
} from '../src/learn/graph/knowledge'
import type { LearnStore } from '../src/learn/types'
import { cleanSourceLine } from '../src/components/learn/editor/previewHighlight'
import { applyAnnotation } from '../src/lib/annotation/dom'

describe('浏览模式文字选区专属 Vim 命令', () => {
  it('支持划词命令 :mark, :comment, :know, :study, :ask 的调度与参数传递', () => {
    const markFn = vi.fn().mockReturnValue({ success: true })
    const commentFn = vi.fn().mockReturnValue({ success: true })
    const knowFn = vi.fn().mockReturnValue({ success: true })
    const studyFn = vi.fn().mockReturnValue({ success: true })
    const askFn = vi.fn().mockReturnValue({ success: true })

    setGlobalTabOperations({
      markSelection: markFn,
      commentSelection: commentFn,
      knowSelection: knowFn,
      studySelection: studyFn,
      askSelection: askFn,
    })

    // 测试 :mark
    const rMark = executeVimCommand(':mark')
    expect(rMark.success).toBe(true)
    expect(markFn).toHaveBeenCalled()

    // 测试 :comment
    const rComment = executeVimCommand(':comment')
    expect(rComment.success).toBe(true)
    expect(commentFn).toHaveBeenCalled()

    // 测试 :know
    const rKnow = executeVimCommand(':know')
    expect(rKnow.success).toBe(true)
    expect(knowFn).toHaveBeenCalled()

    // 测试 :study
    const rStudy = executeVimCommand(':study')
    expect(rStudy.success).toBe(true)
    expect(studyFn).toHaveBeenCalled()

    // 测试 :ask 无参
    const rAsk1 = executeVimCommand(':ask')
    expect(rAsk1.success).toBe(true)
    expect(askFn).toHaveBeenCalledWith('')

    // 测试 :ask 带参数快速提问
    const rAsk2 = executeVimCommand(':ask 这个概念的核心特征是什么？')
    expect(rAsk2.success).toBe(true)
    expect(askFn).toHaveBeenCalledWith('这个概念的核心特征是什么？')
  })
})

describe('非编辑模式命令输入框 :open / :o 正则匹配测试', () => {
  const OPEN_REGEX = /^:?\s*(?:open\b\s*(.*)|o\s+(.*))$/i

  it('完美匹配各种前缀格式的 open 命令', () => {
    // 带冒号形式
    const m1 = ':open document'.match(OPEN_REGEX)
    expect(m1).toBeTruthy()
    expect(m1?.[1] ?? m1?.[2]).toBe('document')

    const m2 = ':o test.ts'.match(OPEN_REGEX)
    expect(m2).toBeTruthy()
    expect(m2?.[1] ?? m2?.[2]).toBe('test.ts')

    // 空格多或无空格
    const m3 = ':open '.match(OPEN_REGEX)
    expect(m3).toBeTruthy()
    expect(m3?.[1] ?? m3?.[2]).toBe('')

    // 不带冒号形式
    const m4 = 'open outline'.match(OPEN_REGEX)
    expect(m4).toBeTruthy()
    expect(m4?.[1] ?? m4?.[2]).toBe('outline')

    const m5 = 'o outline'.match(OPEN_REGEX)
    expect(m5).toBeTruthy()
    expect(m5?.[1] ?? m5?.[2]).toBe('outline')

    // 非 open 命令不匹配
    expect(':edit'.match(OPEN_REGEX)).toBeNull()
    expect(':preview'.match(OPEN_REGEX)).toBeNull()
  })
})

describe('目标级知识库 (Goal Knowledge Base)', () => {
  it('addGoalKnowledge / removeGoalKnowledge / getGoalKnowledge 数据操作与去重更新', () => {
    let store = {
      learningGoals: [{ id: 'goal-1', title: '英语语法' }],
      nodes: [],
      docArea: { layout: { kind: 'empty' }, groups: [], focus: '' },
    } as unknown as LearnStore

    // 初始应为空
    expect(getGoalKnowledge(store, 'goal-1')).toEqual([])

    // 添加条目
    store = addGoalKnowledge(
      store,
      'goal-1',
      '限定词',
      '在名词短语中起限定作用的词，如 the, a, my',
      'node-101',
    )

    const list1 = getGoalKnowledge(store, 'goal-1')
    expect(list1).toHaveLength(1)
    expect(list1[0].term).toBe('限定词')
    expect(list1[0].summary).toContain('限定作用')

    // 重复添加相同 term 时自动更新内容
    store = addGoalKnowledge(store, 'goal-1', '限定词', '更新后的解释：位于名词前的修饰词')
    const list2 = getGoalKnowledge(store, 'goal-1')
    expect(list2).toHaveLength(1)
    expect(list2[0].summary).toBe('更新后的解释：位于名词前的修饰词')

    // 删除条目
    store = removeGoalKnowledge(store, 'goal-1', '限定词')
    expect(getGoalKnowledge(store, 'goal-1')).toHaveLength(0)
  })

  it('serialize / parse 目标知识库 JSON 格式兼容', () => {
    const rawItems = [
      {
        id: 'gk-1',
        term: '名词性从句',
        summary: '在句子中起名词作用的从句',
        sourceNodeId: 'node-1',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ]

    const json = serializeGoalKnowledge(rawItems)
    const parsed = parseGoalKnowledge(json)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].term).toBe('名词性从句')
    expect(parsed[0].summary).toBe('在句子中起名词作用的从句')
  })

  it('applyAnnotation 渲染时对目标级知识库条目在整篇文档的所有出现处进行引用高亮', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p>这是一个包含限定词与另一个限定词的句子。</p>'

    // 没有指定 occurrence 的目标级知识库注解，会对全文出现的匹配词都包裹
    applyAnnotation(container, {
      term: '限定词',
      body: '限定词解释',
      kind: 'understand',
    })

    const highlights = container.querySelectorAll('.moji-anno')
    // 原文中“限定词”出现了 2 次，应该全部被高亮包裹
    expect(highlights.length).toBe(2)
    expect(highlights[0].textContent).toBe('限定词')
    expect(highlights[1].textContent).toBe('限定词')
  })
})

describe('源码行清洗 cleanSourceLine', () => {
  it('正确剥离 Typst 语法和 Markdown 标记以供精准匹配', () => {
    // Typst 函数与宏
    expect(cleanSourceLine('#text(red)[重要概念]')).toBe('重要概念')
    expect(cleanSourceLine('#underline[下划线文字]')).toBe('下划线文字')

    // Markdown 标记
    expect(cleanSourceLine('### 这是一个三级标题')).toBe('这是一个三级标题')
    expect(cleanSourceLine('- **列表加粗内容**')).toBe('列表加粗内容')
    expect(cleanSourceLine('> *引用斜体内容*')).toBe('引用斜体内容')
    expect(cleanSourceLine('`const a = 1;`')).toBe('const a = 1;')
    expect(cleanSourceLine('[点击跳转](https://example.com)')).toBe('点击跳转')
  })
})
