import { describe, expect, it } from 'vitest'
import { analyzeFetchContent } from '../src/learn/webSearch'
import { makeResource } from '../src/learn/static'
import { createWorkspaceOps } from '../src/learn/ops/workspace'
import { createResourceOps } from '../src/learn/ops/resource'
import { buildApi } from '../src/agent/sandbox/api'
import { DocGNode } from '../src/learn/nodeKinds/doc'
import type { LearnStore } from '../src/learn/types'

describe('Agent 交互与数据抓取优化测试', () => {
  it('1. analyzeFetchContent 能准确提取公式、图片并捕获丢图与断句悬空诊断', () => {
    const normalText = '# 标题\n这是一段正常内容，包含公式 $E=mc^2$ 以及图片 ![架构图](https://example.com/arch.png)。'
    const diag1 = analyzeFetchContent(normalText)
    expect(diag1.images).toBe(1)
    expect(diag1.formulas).toBe(1)
    expect(diag1.danglingRefs).toHaveLength(0)
    expect(diag1.warning).toBeUndefined()

    // 缺少图片但出现“如下图所示”
    const lostImageText = '我们对该系统进行重构，架构设计如下图所示，可以发现清晰的分层。'
    const diag2 = analyzeFetchContent(lostImageText)
    expect(diag2.images).toBe(0)
    expect(diag2.danglingRefs).toContain('如下图所示')
    expect(diag2.warning).toContain('配图可能已被服务丢弃')

    // 语法残句特征（如丢掉了公式或内联标签）
    const brokenText = '在第二阶段我们将系统改造，改为异步的 和 ，提升吞吐。'
    const diag3 = analyzeFetchContent(brokenText)
    expect(diag3.danglingRefs.length).toBeGreaterThan(0)
    expect(diag3.warning).toContain('语法断裂或残句')
  })

  it('2. makeResource 与 res.list 完整透出 name, caption, order', () => {
    const res = makeResource({
      name: '架构图',
      ext: 'png',
      bytes: 2048,
      caption: '图 1 核心系统架构图',
      order: 1,
    })
    expect(res.name).toBe('架构图')
    expect(res.caption).toBe('图 1 核心系统架构图')
    expect(res.order).toBe(1)

    const store: LearnStore = {
      version: 4,
      goals: [{ id: 'g1', title: '测试目标', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          kind: 'doc',
          title: '根文档',
          key: 'gendowen',
          createdAt: 1,
          updatedAt: 1,
          status: 'learning',
        },
      ],
      resources: {
        g1: [res],
      },
      edges: [],
    }

    const rOps = createResourceOps(
      {
        getLatest: () => store,
        set: () => {},
        goalId: () => 'g1',
        nodeId: () => 'n1',
      },
      {
        readText: async () => null,
        writeText: async () => true,
        readImage: async () => null,
        removeFile: async () => true,
      },
    )

    const listRes = rOps.list() as any
    expect(listRes.count).toBe(1)
    expect(listRes.resources[0].name).toBe('架构图')
    expect(listRes.resources[0].caption).toBe('图 1 核心系统架构图')
    expect(listRes.resources[0].order).toBe(1)
    expect(listRes.resources[0].file).toBe('架构图.png')
  })

  it('3. workspace.grep 支持按 anchors / query 定向检索并返回精准 1-based 行号', async () => {
    const testArticle = '# 深度长文分析\n引言背景介绍\n核心定理定义与推导\n补充说明\n实验数据评估\n结语与展望'

    const store: LearnStore = {
      version: 4,
      goals: [{ id: 'g1', title: '测试目标', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          kind: 'doc',
          title: '根文档',
          key: 'gendowen',
          createdAt: 1,
          updatedAt: 1,
          status: 'learning',
        },
      ],
      edges: [],
    }

    const wsOps = createWorkspaceOps(
      {
        getLatest: () => store,
        set: () => {},
        goalId: () => 'g1',
        nodeId: () => 'n1',
      },
      {
        list: async () => ({ ok: true, entries: [] }),
        read: async () => ({ ok: true, content: testArticle }),
        write: async () => ({ ok: true }),
      },
    )

    const grepRes = (await wsOps.grep({
      path: 'article.md',
      anchors: ['核心定理', '实验数据'],
    })) as any

    expect(grepRes.ok).toBe(true)
    expect(grepRes.totalLines).toBe(6)
    expect(grepRes.matchCount).toBe(2)
    expect(grepRes.matches[0]).toEqual({
      anchor: '核心定理',
      line: 3,
      text: '核心定理定义与推导',
    })
    expect(grepRes.matches[1]).toEqual({
      anchor: '实验数据',
      line: 5,
      text: '实验数据评估',
    })
  })

  it('4. browser.eval 支持 saveTo 自动落盘工作区并避免上下文过载', async () => {
    let savedPath = ''
    let savedContent = ''

    const fakeWs = {
      list: async () => ({ ok: true, entries: [] }),
      read: async () => ({ ok: true, content: '' }),
      write: async (input: Record<string, unknown>) => {
        savedPath = String(input.path)
        savedContent = String(input.content)
        return { ok: true, path: savedPath }
      },
      grep: async () => ({ ok: true }),
    }

    const fakeBrowser = {
      open: async () => ({ ok: true, tabId: 't1' }),
      tabs: async () => ({ ok: true, tabs: [] }),
      activate: async () => ({ ok: true }),
      close: async () => ({ ok: true }),
      index: async () => ({ ok: true }),
      text: async () => ({ ok: true }),
      inspect: async () => ({ ok: true }),
      click: async () => ({ ok: true }),
      fill: async () => ({ ok: true }),
      type: async () => ({ ok: true }),
      press: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
      query: async () => ({ ok: true, matches: [] }),
      waitFor: async () => ({ ok: true }),
      screenshot: async () => ({ ok: true, uuid: '123' }),
      toImage: async () => ({ ok: true, uuid: '123' }),
      eval: async (_tabId: any, code: string) => {
        return { ok: true, result: 'line1\nline2\nline3\n' + code }
      },
    }

    const { api } = buildApi({
      workspace: fakeWs as any,
      browser: fakeBrowser as any,
    }) as any

    const res = await api.browser.eval('return document.title', {
      saveTo: 'workspace/article.md',
    })

    expect(res.ok).toBe(true)
    expect(res.saved).toBe(true)
    expect(res.path).toBe('workspace/article.md')
    expect(res.lines).toBe(4)
    expect(savedPath).toBe('workspace/article.md')
    expect(savedContent).toContain('return document.title')
  })

  it('5. DocGNode.editContent 对 moji:static 资源和 quote 语法进行严格校验并返回 diagnostics', () => {
    let currentStore: LearnStore = {
      version: 4,
      goals: [{ id: 'g1', title: '测试目标', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          kind: 'doc',
          title: '测试文档',
          key: 'ceshiwendang',
          createdAt: 1,
          updatedAt: 1,
          status: 'learning',
        },
      ],
      resources: {
        g1: [
          makeResource({
            uuid: 'res-1111',
            name: '有效图片',
            ext: 'png',
            bytes: 100,
          }),
        ],
      },
      edges: [],
    }

    const ctx = {
      store: () => currentStore,
      commit: (next: LearnStore) => {
        currentStore = next
      },
    }

    const docNode = new DocGNode(ctx as any, 'n1')

    // 写入包含有效与无效静态资源、正常与异常 quote 区间的正文
    const writeRes = docNode.editContent({
      title: '测试文档',
      description: '描述',
      teaching: `
# 标题
这里引用有效资源：![图](moji:static/res-1111)
这里引用不存在的资源：![丢图](moji:static/res-ghost)

\`\`\`quote
正常引用
@workspace/main.py(10-25)
异常引用（行号倒挂）
@workspace/main.py(50-20)
\`\`\`
`,
    })

    expect(writeRes.ok).toBe(true)
    expect((writeRes as any).diagnostics).toBeDefined()
    const diag = (writeRes as any).diagnostics
    expect(diag.staticResources.valid).toContain('res-1111')
    expect(diag.staticResources.missing).toContain('res-ghost')
    expect(diag.quotes.valid).toHaveLength(1)
    expect(diag.quotes.invalid).toHaveLength(1)
    expect(diag.warnings.length).toBeGreaterThan(0)
    expect((writeRes as any).note).toContain('引用校验提示')
  })
})
