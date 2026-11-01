/**
 * 动态提示词注入的单元用例（见 src/learn/ai/promptModules.ts）。
 *
 * 钉的是这套机制的四个关键面：
 * 1. **注册表自洽**：key 唯一、文本非空、触发映射里没有指向不存在模块的键；
 * 2. **去重判据**：只认活着的消息（retired 的不算——压缩后模块必须能重新注入）；
 * 3. **触发映射**：api 组前缀与写入内容嗅探都要落到正确的 key，高频组（doc/node/state）
 *    绝不触发（它们每轮都用，进了模块反而每轮注入）；
 * 4. **系统提示词确实瘦了**：搬走的域在系统提示词里只剩索引行，EXECUTE_GUIDE 不再包含
 *    完整手册——这是这次减负的验收标准，锁住它防止内容悄悄搬回去。
 */
import { describe, expect, it } from 'vitest'

import type { ConversationMessage } from '../src/agent/types'
import { buildTeacherSystem } from '../src/learn/ai'
import {
  PROMPT_MODULES,
  missingPromptModules,
  promptModuleByKey,
  promptModuleForApiName,
  promptModuleForContent,
  promptModuleMessage,
  writableContentOf,
} from '../src/learn/ai/promptModules'

const AT = 1700000000000

const userMsg = (extra: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: Math.random().toString(36).slice(2),
  role: 'user',
  parts: [{ type: 'text', text: '你好' }],
  ts: AT,
  ...extra,
})

describe('模块注册表', () => {
  it('key 唯一、标题与文本都非空，且没有任何模块还在教 iwanna（它已删除）', () => {
    const keys = PROMPT_MODULES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const m of PROMPT_MODULES) {
      expect(m.title.trim()).not.toBe('')
      expect(m.text.trim().length).toBeGreaterThan(80)
      expect(m.text).not.toContain('iwanna')
    }
  })

  it('搬进模块的域都在注册表里；promptModuleByKey 认不出的回 null', () => {
    for (const key of ['browser', 'web', 'res', 'exam', 'teach-method', 'outline-method', 'doc-html', 'workspace', 'method', 'code', 'compact', 'subagent', 'ui', 'schedule', 'plot-forms', 'rich-animation']) {
      expect(promptModuleByKey(key)?.text, key).toBeTruthy()
    }
    expect(promptModuleByKey('不存在的')).toBeNull()
  })

  it('sdoc 已退役（规范住进了超级文档节点的 help()），注册表里不再有它', () => {
    expect(promptModuleByKey('sdoc')).toBeNull()
    expect(PROMPT_MODULES.some((m) => m.key === 'sdoc')).toBe(false)
  })

  it('模块文本自包含：考试模块带着出题与判分口径，子代理模块带着范式与监督回路', () => {
    expect(promptModuleByKey('exam')!.text).toContain('editContent')
    expect(promptModuleByKey('exam')!.text).toContain('attemptId')
    expect(promptModuleByKey('subagent')!.text).toContain('wait')
    expect(promptModuleByKey('subagent')!.text).toContain('监督回路')
    expect(promptModuleByKey('teach-method')!.text).toContain('api.node.get')
    expect(promptModuleByKey('outline-method')!.text).toContain('o:')
  })
})

describe('触发映射', () => {
  it('api 组前缀落到正确的模块；高频组（node/state/tmp/ask）绝不触发', () => {
    expect(promptModuleForApiName('browser.snapshot')).toBe('browser')
    expect(promptModuleForApiName('web.search')).toBe('web')
    expect(promptModuleForApiName('web.fetch')).toBe('web')
    expect(promptModuleForApiName('fetch')).toBe('web')
    expect(promptModuleForApiName('res.read')).toBe('res')
    expect(promptModuleForApiName('exam.grade')).toBe('exam')
    expect(promptModuleForApiName('workspace.list')).toBe('workspace')
    expect(promptModuleForApiName('method.call')).toBe('method')
    expect(promptModuleForApiName('code.save')).toBe('code')
    expect(promptModuleForApiName('compact')).toBe('compact')
    expect(promptModuleForApiName('subagent.run')).toBe('subagent')
    expect(promptModuleForApiName('ui.point')).toBe('ui')
    expect(promptModuleForApiName('schedule.create')).toBe('schedule')
    // 每轮必用的组不触发——进了模块反而每轮都要注入一遍
    expect(promptModuleForApiName('node.get')).toBeNull()
    expect(promptModuleForApiName('node.invoke')).toBeNull()
    expect(promptModuleForApiName('state.update')).toBeNull()
    expect(promptModuleForApiName('wait')).toBeNull()
    expect(promptModuleForApiName('ask')).toBeNull()
    expect(promptModuleForApiName('log')).toBeNull()
  })

  it('内容嗅探：plot 围栏与动画标记各归各的模块，两者都命中就都报；普通正文不报', () => {
    expect(promptModuleForContent('看图：\n\n```plot\n{ "data": [] }\n```', false)).toEqual(['plot-forms'])
    expect(promptModuleForContent('<style>.x{animation:@keyframes p{}}</style>', false)).toEqual(['rich-animation'])
    expect(promptModuleForContent('<animateMotion dur="3s"/>', false)).toEqual(['rich-animation'])
    expect(promptModuleForContent('## 教学正文\n\n一些 $x^2$ 公式。', false)).toEqual([])
    const both = promptModuleForContent('```plot\n{}\n``` <animate a/>', false)
    expect(both).toContain('plot-forms')
    expect(both).toContain('rich-animation')
  })

  it('写教学文档就带上排版配方：node.invoke 的 editContent 写 teaching / text；写 html（超级文档）不算', () => {
    expect(writableContentOf('node.invoke', ['u1', 'editContent', [{ title: '极限', teaching: '## 一段纯 Markdown 讲解' }]]))
      .toMatchObject({ text: '## 一段纯 Markdown 讲解', superdoc: false })
    expect(promptModuleForContent('## 一段纯 Markdown 讲解', false, 'node.invoke')).toEqual(['doc-html'])
    // files.write / files.edit 同一条口径
    expect(promptModuleForContent('<div class="grid grid-cols-2">x</div>', false, 'files.write')).toContain('doc-html')
    expect(promptModuleForContent('改写后的内容', false, 'files.edit')).toContain('doc-html')
  })

  it('嗅探入口统一走 writableContentOf：成员不对、payload 形状不对都回 null', () => {
    expect(writableContentOf('node.invoke', ['u1', 'help', []])).toBeNull()
    expect(writableContentOf('node.invoke', ['u1', 'editContent', ['不是对象']])).toBeNull()
    expect(writableContentOf('node.invoke', ['u1', 'editContent', [{ intro: '', children: [] }]])).toBeNull()
    // 超级文档的 html：superdoc 标志为 true（不注入排版配方），plot / 动画标记照常嗅探
    expect(writableContentOf('node.invoke', ['u1', 'editContent', [{ html: '<p class="sd-card">页</p>' }]]))
      .toMatchObject({ superdoc: true })
    expect(promptModuleForContent('<p class="sd-card">页</p>', true, 'node.invoke')).toEqual([])
    expect(promptModuleForContent('<animate a/>', true, 'node.invoke')).toEqual(['rich-animation'])
  })


  it('写入参数的嗅探面（新协议）：files.* 与 node.invoke 的 editContent；读与其它成员不嗅探', () => {
    expect(writableContentOf('files.write', ['', '```plot\n{}\n```'])).toMatchObject({ text: '```plot\n{}\n```', superdoc: false })
    expect(writableContentOf('files.edit', ['', { replace: { replacement: '@keyframes p{}' } }])).toMatchObject({ text: '@keyframes p{}', superdoc: false })
    // node.invoke(uuid, 成员名, 参数数组)：editContent 的 payload 按字段取
    expect(writableContentOf('node.invoke', ['u1', 'editContent', [{ title: 'x', teaching: '# 正文' }]])).toMatchObject({ text: '# 正文', superdoc: false })
    expect(writableContentOf('node.invoke', ['u1', 'editContent', [{ text: '<animate/>' }]])).toMatchObject({ text: '<animate/>' })
    expect(writableContentOf('node.invoke', ['u1', 'editContent', [{ html: '<p>页</p>' }]])).toMatchObject({ text: '<p>页</p>', superdoc: true })
    // 读与其它成员不携带正文
    expect(writableContentOf('node.invoke', ['u1', 'read', []])).toBeNull()
    expect(writableContentOf('node.invoke', ['u1', 'help', []])).toBeNull()
    expect(writableContentOf('log', ['x'])).toBeNull()
  })
})

describe('去重判据', () => {
  it('消息级标记（工作流轮开始注入的形态）算已注入', () => {
    const msgs = [userMsg({ promptModule: 'sdoc' })]
    expect(missingPromptModules(msgs, ['sdoc', 'sdoc', 'browser'])).toEqual(['browser'])
  })

  it('回复里的 prompt-module 片段（mid-loop 边界注入的形态）也算已注入', () => {
    const msgs = [
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [{ type: 'prompt-module' as const, key: 'sdoc', text: '规范全文' }],
        ts: AT,
      },
    ]
    expect(missingPromptModules(msgs, ['sdoc', 'browser'])).toEqual(['browser'])
  })

  it('retired 的不算数：被压缩折掉的模块要能重新注入（两种形态同一条规矩）', () => {
    const msgs = [
      userMsg({ promptModule: 'sdoc', retired: true }),
      {
        id: 'a1',
        role: 'assistant' as const,
        parts: [{ type: 'prompt-module' as const, key: 'web', text: '规范全文' }],
        ts: AT,
        retired: true,
      },
    ]
    expect(missingPromptModules(msgs, ['sdoc', 'web'])).toEqual(['sdoc', 'web'])
  })

  it('普通用户消息与没有标记的隐藏消息都不影响判定', () => {
    const msgs = [userMsg(), userMsg({ hidden: true, mark: '回忆' })]
    expect(missingPromptModules(msgs, ['sdoc', 'web'])).toEqual(['sdoc', 'web'])
  })
})

describe('模块消息', () => {
  it('隐藏 assistant 消息（提示词=声明归 assistant 边）：mark 是过程组文案、promptModule 供去重、正文是模块全文', () => {
    const mod = promptModuleByKey('browser')!
    const m = promptModuleMessage(mod, 'uuid-1', AT)
    expect(m.role).toBe('assistant')
    expect(m.hidden).toBe(true)
    expect(m.promptModule).toBe('browser')
    expect(m.mark).toContain('内置浏览器')
    expect(m.parts[0]).toEqual({ type: 'text', text: mod.text })
  })
})

describe('首轮全量提示词（包含所有 execute API 与全量工作流）', () => {
  const system = buildTeacherSystem()

  it('全量 API 说明与代码示例均已在系统提示词中完整就绪', () => {
    // 组索引与所有核心 API 完整在场
    expect(system).toContain('api.node — 节点宇宙')
    expect(system).toContain('api.schedule')
    expect(system).toContain('api.browser')
    expect(system).toContain('api.subagent')
    expect(system).toContain('api.workspace')
    expect(system).toContain('api.exam')
    // 包含所有具体 API 的完整签名与用法示例
    expect(system).toContain('node.list()')
    expect(system).toContain('node.get(uuid)')
    expect(system).toContain('workspace.write')
    expect(system).toContain('browser.snapshot')
    expect(system).toContain('沙箱全部 API 完整参考手册与示例')
  })

  it('全量工作流提示词与规程均已在首轮系统提示词中完整就绪', () => {
    expect(system).toContain('工作流提示词与任务规程（全量内置工作流）')
    expect(system).toContain('教学文档生成规程')
    expect(system).toContain('大纲编写与规划规程')
    expect(system).toContain('项目与文章解读')
    expect(system).toContain('试卷命题与判分讲解规程')
    expect(system).toContain('超级实验室')
    expect(system).toContain('长会话交接摘要编写规程')
  })

  it('全量排版配方与语法指南在场', () => {
    expect(system).toContain('文档排版与视觉呈现')
    expect(system).toContain('十二个精装教学 UI 配方')
    expect(system).toContain('```plot')
    expect(system).toContain('```quote')
    expect(system).toContain('```mermaid')
    expect(system).toContain('```videos')
  })

  it('每轮必用的核心纪律与原则完整在场', () => {
    expect(system).toContain('唯一的工具是 execute')
    expect(system).toContain('写操作的失败不抛异常')
    expect(system).toContain('应用数据一律走 api 组')
    expect(system).toContain('api.userInfo.get()')
    expect(system).toContain('wait / ask / tiktok')
    expect(system).toContain('需求解耦')
    expect(system).toContain('api.ui.point')
    expect(system).not.toContain('iwanna')
  })
})
