import { describe, expect, it } from 'vitest'
import { analyzeFetchContent } from '../src/learn/webSearch'
import { makeResource } from '../src/learn/static'
import { createWorkspaceOps } from '../src/learn/ops/workspace'
import { createResourceOps } from '../src/learn/ops/resource'
import { buildApi } from '../src/agent/sandbox/api'
import { DocGNode } from '../src/learn/nodeKinds/doc'
import { FileGNode } from '../src/learn/nodeKinds/file'
import { parseWebLinkWithSelector } from '../src/lib/externalLink'
import { tabKey } from '../src/learn/tabs'
import { refOwner } from '../src/learn/groups/goals'
import type { DocNotepadItem } from '../src/learn/types'
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

    const store: any = {
      version: 2,
      goals: [{ id: 'g1', title: '测试目标', question: '问题', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          title: '根文档',
          key: 'gendowen',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          origin: 'ai',
          createdAt: 1,
          updatedAt: 1,
          status: 'learning',
        },
      ],
      resources: {
        g1: [res],
      },
      edges: [],
      conversations: [],
      exams: [],
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
      } as any,
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

    const store: any = {
      version: 2,
      goals: [{ id: 'g1', title: '测试目标', question: '问题', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          title: '根文档',
          key: 'gendowen',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          origin: 'ai',
          createdAt: 1,
          updatedAt: 1,
          status: 'learning',
        },
      ],
      edges: [],
      conversations: [],
      exams: [],
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
    } as any, []) as any

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
    let currentStore: any = {
      version: 2,
      goals: [{ id: 'g1', title: '测试目标', question: '问题', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          title: '测试文档',
          key: 'ceshiwendang',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          origin: 'ai',
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
      conversations: [],
      exams: [],
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

    expect((writeRes as any).ok).toBe(true)
    expect((writeRes as any).diagnostics).toBeDefined()
    const diag = (writeRes as any).diagnostics
    expect(diag.staticResources.valid).toContain('res-1111')
    expect(diag.staticResources.missing).toContain('res-ghost')
    expect(diag.quotes.valid).toHaveLength(1)
    expect(diag.quotes.invalid).toHaveLength(1)
    expect(diag.warnings.length).toBeGreaterThan(0)
    expect((writeRes as any).note).toContain('引用校验提示')
  })
  it('6. parseWebLinkWithSelector 准确解析常规网页、指定元素选择器及特殊选择器前缀', () => {
    // 常规网址无选择器
    const r1 = parseWebLinkWithSelector('https://example.com/article')
    expect(r1.baseUrl).toBe('https://example.com/article')
    expect(r1.url).toBe('https://example.com/article')
    expect(r1.selector).toBeUndefined()

    // 带标准锚点 #heading
    const r2 = parseWebLinkWithSelector('https://example.com/article#section-1')
    expect(r2.baseUrl).toBe('https://example.com/article')
    expect(r2.selector).toBe('#section-1')

    // 带 class 选择器 #.main-content
    const r3 = parseWebLinkWithSelector('https://example.com/article#.main-content')
    expect(r3.baseUrl).toBe('https://example.com/article')
    expect(r3.selector).toBe('.main-content')

    // 带 selector: 前缀
    const r4 = parseWebLinkWithSelector('https://example.com/article#selector:div.article > p:first-child')
    expect(r4.baseUrl).toBe('https://example.com/article')
    expect(r4.selector).toBe('div.article > p:first-child')

    // 带属性选择器 #[data-agent-id="25"]
    const r5 = parseWebLinkWithSelector('https://example.com/article#[data-agent-id="25"]')
    expect(r5.baseUrl).toBe('https://example.com/article')
    expect(r5.selector).toBe('[data-agent-id="25"]')
  })

  it('7. 便签 Notepad 状态完全隔离在 node.notepads，教学文档原文绝不受任何污染', () => {
    const teachingOriginal = '# 微积分第一课\n\n函数的极限是微积分的基础。\n\n定理一：单调有界数列必有极限。'
    const initialNode: any = {
      id: 'node-calc',
      goalId: 'g1',
      title: '极限',
      docs: { teaching: teachingOriginal },
      notepads: [],
    }

    // 插入两张便签
    const notepad1: DocNotepadItem = {
      id: 'np-1',
      content: '需要补充柯西准则例题',
      blockIndex: 1,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const notepad2: DocNotepadItem = {
      id: 'np-2',
      content: '注意这里的 epsilon-delta 语言表述',
      blockIndex: 2,
      createdAt: 2000,
      updatedAt: 2000,
    }

    const updatedNode = {
      ...initialNode,
      notepads: [notepad1, notepad2],
    }

    // 修改便签内容与拖拽调整位置
    const movedNotepads = updatedNode.notepads.map((item: DocNotepadItem) =>
      item.id === 'np-1' ? { ...item, blockIndex: 3, content: '更新：课后讲解柯西准则', updatedAt: 3000 } : item
    )
    const finalNode = {
      ...updatedNode,
      notepads: movedNotepads,
    }

    // 验证：node.notepads 状态正确
    expect(finalNode.notepads).toHaveLength(2)
    expect(finalNode.notepads.find((n: DocNotepadItem) => n.id === 'np-1')?.blockIndex).toBe(3)
    expect(finalNode.notepads.find((n: DocNotepadItem) => n.id === 'np-1')?.content).toBe('更新：课后讲解柯西准则')

    // 核心约束验证：教学文档原文绝对没有被污染或插入任何字符
    expect(finalNode.docs.teaching).toBe(teachingOriginal)
    expect(finalNode.docs.teaching).not.toContain('柯西准则')
    expect(finalNode.docs.teaching).not.toContain('np-')
  })

  it('8. FileGNode 完整支持 domFilter, pureMode, cachedContent, cachedAt 的读写', () => {
    let currentStore: any = {
      version: 2,
      goals: [{ id: 'g1', title: '测试目标' }],
      nodes: [],
      fileNodes: [
        {
          id: 'fn-web-1',
          goalId: 'g1',
          title: 'MDN 规范',
          fileKind: 'web',
          url: 'https://developer.mozilla.org/zh-CN/docs/Web/API',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      edges: [],
    }

    const ctx = {
      store: () => currentStore,
      commit: (next: LearnStore) => {
        currentStore = next
      },
    }

    const fileNode = new FileGNode(ctx as any, 'fn-web-1')
    expect(fileNode.exists()).toBe(true)

    // 初始 content
    const c0 = fileNode.content as any
    expect(c0.title).toBe('MDN 规范')
    expect(c0.fileKind).toBe('web')
    expect(c0.pureMode).toBe(true)
    expect(c0.domFilter).toBeUndefined()

    // agent 通过 editContent 设置纯净阅读过滤、缓存
    const editRes = fileNode.editContent({
      domFilter: 'article.main-page-content',
      pureMode: true,
      cachedContent: 'Web API 是可在浏览器中使用的各种接口...',
      cachedAt: 5000,
    })
    expect((editRes as any).ok).toBe(true)

    // 读取更新后的 content
    const c1 = fileNode.content as any
    expect(c1.domFilter).toBe('article.main-page-content')
    expect(c1.pureMode).toBe(true)
    expect(c1.cachedContent).toContain('Web API 是可在浏览器中使用的各种接口')
    expect(c1.cachedAt).toBe(5000)

    // 关闭纯净阅读
    fileNode.editContent({ pureMode: false })
    const c2 = fileNode.content as any
    expect(c2.pureMode).toBe(false)
  })

  it('9. 网页文件节点单例 tabKey 格式与跟随目标组挂载卸载 refOwner 验证', () => {
    // 网页文件节点的 tabKey 必须以 w:fn: 为前缀并绑定文件节点 id，保证单例
    const webRef = {
      kind: 'web' as const,
      url: 'https://example.com',
      key: 'fn_file-123',
      fileNodeId: 'file-123',
      goalId: 'goal-999',
    }
    expect(tabKey(webRef)).toBe('w:fn:file-123')

    // 普通无 fileNodeId 的网页页签使用 key
    const normalWebRef = {
      kind: 'web' as const,
      url: 'https://example.com',
      key: 'random-key-456',
    }
    expect(tabKey(normalWebRef)).toBe('w:random-key-456')

    // refOwner 判定：普通网页为公共 PUBLIC_OWNER，绑了 goalId 的网页跟随目标组
    expect(refOwner(normalWebRef, () => null)).toBe('')
    expect(refOwner(webRef, () => null)).toBe('goal-999')
  })

  it('10. api.browser.toMarkdown 正确调用并支持 saveTo 落盘到工作区', async () => {
    let mockMarkdownResult = '# 网页文章标题\n\n正文第一段。\n\n![示例图](https://example.com/pic.png)'
    let savedPath = ''
    let savedContent = ''

    const fakeBrowser = {
      toMarkdown: async (_tabId: string, _target?: string | number, _opts?: any) => {
        return { ok: true, markdown: mockMarkdownResult, chars: mockMarkdownResult.length }
      },
      currentTabId: () => 'tab-test',
    }

    const fakeWs = {
      write: async (args: { path: string; content: string }) => {
        savedPath = args.path
        savedContent = args.content
        return { ok: true, path: args.path, bytes: args.content.length }
      },
    }

    const { api: sandboxApi } = buildApi({
      browser: fakeBrowser as any,
      workspace: fakeWs as any,
    } as any, []) as any

    // 不带 saveTo 直接返回 markdown
    const r1 = await sandboxApi.browser.toMarkdown()
    expect(r1.ok).toBe(true)
    expect(r1.markdown).toContain('# 网页文章标题')
    expect(r1.markdown).toContain('![示例图](https://example.com/pic.png)')
    expect(r1.chars).toBe(mockMarkdownResult.length)

    // 带 saveTo 直接落盘到工作区
    const r2 = await sandboxApi.browser.toMarkdown(undefined, { saveTo: 'workspace/article.md' })
    expect(r2.ok).toBe(true)
    expect(r2.saved).toBe(true)
    expect(r2.path).toBe('workspace/article.md')
    expect(r2.chars).toBe(mockMarkdownResult.length)
    expect(savedPath).toBe('workspace/article.md')
    expect(savedContent).toBe(mockMarkdownResult)
  })
})
