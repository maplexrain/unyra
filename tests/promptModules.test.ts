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
    for (const key of ['sdoc', 'browser', 'web', 'res', 'exam', 'review', 'workspace', 'method', 'code', 'compact', 'subagent', 'ui', 'learning-process', 'plot-forms', 'rich-animation']) {
      expect(promptModuleByKey(key)?.text, key).toBeTruthy()
    }
    expect(promptModuleByKey('不存在的')).toBeNull()
  })

  it('模块文本自包含：考试模块带着 create 的 payload 字段，子代理模块带着范式与监督回路', () => {
    expect(promptModuleByKey('exam')!.text).toContain('minutes')
    expect(promptModuleByKey('exam')!.text).toContain('attemptId')
    expect(promptModuleByKey('subagent')!.text).toContain('wait')
    expect(promptModuleByKey('subagent')!.text).toContain('监督回路')
    expect(promptModuleByKey('sdoc')!.text).toContain('moji-markdown')
  })
})

describe('触发映射', () => {
  it('api 组前缀落到正确的模块；高频组（doc/node/state/tmp/ask）绝不触发', () => {
    expect(promptModuleForApiName('sdoc.write')).toBe('sdoc')
    expect(promptModuleForApiName('browser.snapshot')).toBe('browser')
    expect(promptModuleForApiName('web.search')).toBe('web')
    expect(promptModuleForApiName('res.read')).toBe('res')
    expect(promptModuleForApiName('exam.create')).toBe('exam')
    expect(promptModuleForApiName('review.record')).toBe('review')
    expect(promptModuleForApiName('workspace.list')).toBe('workspace')
    expect(promptModuleForApiName('method.call')).toBe('method')
    expect(promptModuleForApiName('code.save')).toBe('code')
    expect(promptModuleForApiName('compact')).toBe('compact')
    expect(promptModuleForApiName('subagent.run')).toBe('subagent')
    expect(promptModuleForApiName('ui.switchMain')).toBe('ui')
    expect(promptModuleForApiName('reading.get')).toBe('learning-process')
    expect(promptModuleForApiName('attention.get')).toBe('learning-process')
    expect(promptModuleForApiName('checkin.status')).toBe('learning-process')
    expect(promptModuleForApiName('pomodoro.status')).toBe('learning-process')
    // 每轮必用的组不触发——进了模块反而每轮都要注入一遍
    expect(promptModuleForApiName('doc.write')).toBeNull()
    expect(promptModuleForApiName('node.read')).toBeNull()
    expect(promptModuleForApiName('state.update')).toBeNull()
    expect(promptModuleForApiName('outline.write')).toBeNull()
    expect(promptModuleForApiName('wait')).toBeNull()
    expect(promptModuleForApiName('ask')).toBeNull()
    expect(promptModuleForApiName('log')).toBeNull()
  })

  it('内容嗅探：plot 围栏与动画标记各归各的模块，两者都命中就都报；普通正文不报', () => {
    expect(promptModuleForContent('看图：\n\n```plot\n{ "data": [] }\n```')).toEqual(['plot-forms'])
    expect(promptModuleForContent('<style>.x{animation:@keyframes p{}}</style>')).toEqual(['rich-animation'])
    expect(promptModuleForContent('<animateMotion dur="3s"/>')).toEqual(['rich-animation'])
    expect(promptModuleForContent('## 教学正文\n\n一些 $x^2$ 公式。')).toEqual([])
    const both = promptModuleForContent('```plot\n{}\n``` <animate a/>')
    expect(both).toContain('plot-forms')
    expect(both).toContain('rich-animation')
  })

  it('写入参数的嗅探面：doc.write/append 取第二参、doc.replace 取 payload.content、sdoc.write 取 html，其它调用不嗅探', () => {
    expect(writableContentOf('doc.write', ['', '```plot\n{}\n```'])).toContain('plot')
    expect(writableContentOf('doc.append', ['笔记/x', '<animate/>'])).toBe('<animate/>')
    expect(writableContentOf('doc.replace', ['', { content: '@keyframes p{}' }])).toBe('@keyframes p{}')
    expect(writableContentOf('sdoc.write', ['', '名', '<p>页</p>'])).toBe('<p>页</p>')
    expect(writableContentOf('doc.read', ['', '```plot\n{}\n```'])).toBeNull()
    expect(writableContentOf('node.rename', ['', '```plot\n{}\n```'])).toBeNull()
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
  it('隐藏 user 消息：mark 是分界条文案、promptModule 供去重、正文是模块全文', () => {
    const mod = promptModuleByKey('browser')!
    const m = promptModuleMessage(mod, 'uuid-1', AT)
    expect(m.role).toBe('user')
    expect(m.hidden).toBe(true)
    expect(m.promptModule).toBe('browser')
    expect(m.mark).toContain('内置浏览器')
    expect(m.parts[0]).toEqual({ type: 'text', text: mod.text })
  })
})

describe('系统提示词确实瘦了（减负的验收线）', () => {
  const system = buildTeacherSystem({ goalQuestion: '我想弄懂微积分' })

  it('搬走的域只剩一行索引，完整手册不再整段压在系统提示词里', () => {
    // 索引行在场（模型必须知道能力存在）
    expect(system).toContain('按需加载的能力')
    expect(system).toContain('sdoc.*')
    expect(system).toContain('browser.*')
    expect(system).toContain('subagent.*')
    // 完整手册的标志性长文不在了
    expect(system).not.toContain('moji-demo-pulse')
    expect(system).not.toContain('repeatCount="indefinite"')
    expect(system).not.toContain('fnType": "parametric')
    expect(system).not.toContain('监督回路')
    expect(system).not.toContain('dom(tabId?')
    // 低频 api 的行为细节随模块走，系统提示词里不再逐条展开
    expect(system).not.toContain('api.res.refs(uuid)：谁在引用它')
    expect(system).not.toContain('reach ≥ 0.6')
  })

  it('每轮必用的语法与判断标准一条不丢', () => {
    expect(system).toContain('唯一的工具是 execute')
    expect(system).toContain('写操作的失败不抛异常')
    expect(system).toContain('api.doc.readRange')
    expect(system).toContain('api.state.mistake')
    expect(system).toContain('api.ask')
    expect(system).toContain('需求解耦')
    expect(system).toContain('switchMain')
  })

  it('删除的 api 与历史漂移一并清掉', () => {
    expect(system).not.toContain('iwanna')
    expect(system).not.toContain('三件事')
    expect(system).toContain('四件事')
  })
})
