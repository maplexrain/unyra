/**
 * 消息部件平铺的单元用例（见 panel/partGroups）。
 *
 * 钉的是「过程件不再并成组」这条规矩：思考、工具、提示词模块、轮开始时的注入
 * 都按原顺序各占一项；正文也在同一顺序里。它出错的形态是「界面又冒出一层
 * 思考与工具 · N 步的容器」——不报错、不崩，只有用例说得清什么才算对。
 */
import { describe, expect, it } from 'vitest'

import { flattenParts, isProcessPart } from '../src/components/agent/panel/partGroups'
import { lastLineOf } from '../src/components/agent/panel/preview'
import type { AgentPart } from '../src/agent/types'

const think = (text: string): AgentPart => ({ type: 'thinking', text })
const tool = (id: string): AgentPart => ({
  type: 'tool',
  id,
  name: 'execute',
  args: '{}',
  result: '',
  ok: true,
  status: 'done',
})
const mod = (key: string): AgentPart => ({ type: 'prompt-module', key, text: '规范全文' })
const web = (id: string): AgentPart => ({
  type: 'web',
  id,
  step: 0,
  call: {
    id,
    type: 'deepseek_web_search',
    kind: 'search',
    action: { type: 'search', queries: ['q'] },
    status: 'completed',
  },
})
const text = (t: string): AgentPart => ({ type: 'text', text: t })

describe('过程件的范围', () => {
  it('思考 / 工具 / 联网工具 / 提示词模块都是过程件；正文与提示不是', () => {
    expect(isProcessPart(think('a'))).toBe(true)
    expect(isProcessPart(tool('t1'))).toBe(true)
    expect(isProcessPart(web('w1'))).toBe(true)
    expect(isProcessPart(mod('ui'))).toBe(true)
    expect(isProcessPart(text('正文'))).toBe(false)
    expect(isProcessPart({ type: 'notice', level: 'warn', text: '截断' })).toBe(false)
    expect(isProcessPart({ type: 'hop' })).toBe(false)
  })
})

describe('平铺', () => {
  it('思考、工具与提示词模块按原顺序逐项返回，不再合并成组', () => {
    const items = flattenParts([think('想'), tool('t1'), mod('browser'), think('再想'), tool('t2')])
    expect(items.map((p) => p.type)).toEqual(['thinking', 'tool', 'prompt-module', 'thinking', 'tool'])
  })

  it('正文也在同一顺序里，过程件不会把正文包进组里', () => {
    const items = flattenParts([think('想'), tool('t1'), text('讲完了'), mod('ui'), tool('t2')])
    expect(items.map((p) => p.type)).toEqual(['thinking', 'tool', 'text', 'prompt-module', 'tool'])
  })

  it('hop 是跳边界，不上屏；运行时提示原样留在顺序里', () => {
    const crossed = flattenParts([think('第一跳'), { type: 'hop' }, tool('t1'), think('第二跳')])
    expect(crossed.map((p) => p.type)).toEqual(['thinking', 'tool', 'thinking'])

    const withNotice = flattenParts([think('想'), { type: 'notice', level: 'warn', text: '步数用尽' }, tool('t1')])
    expect(withNotice.map((p) => p.type)).toEqual(['thinking', 'notice', 'tool'])
  })

  it('空消息与只有 hop 的消息都不产出任何一项', () => {
    expect(flattenParts([])).toEqual([])
    expect(flattenParts([{ type: 'hop' }, { type: 'hop' }])).toEqual([])
  })
})

describe('轮开始时的提示词注入', () => {
  const inject = (id: string, label: string) => ({ type: 'inject' as const, id, label, text: '注入全文' })

  it('排在最前面，后面直接接思考 / 工具，每一项独立', () => {
    const items = flattenParts([think('想'), tool('t1')], [inject('m1', '导师人格 · 标准导师')])
    expect(items.map((p) => p.type)).toEqual(['inject', 'thinking', 'tool'])
  })

  it('回复里只有正文时，注入仍然单独占一项', () => {
    const items = flattenParts([text('开场白')], [inject('m1', '文档格式 · 混合')])
    expect(items.map((p) => p.type)).toEqual(['inject', 'text'])
  })

  it('没有注入时平铺结果与不传第二个参数一致', () => {
    expect(flattenParts([think('想')], [])).toEqual(flattenParts([think('想')]))
  })
})

describe('lastLineOf 空值安全防护', () => {
  it('传入 undefined, null, 空串或非字符串时安全返回空字符串，绝不抛异常', () => {
    expect(lastLineOf(undefined as any)).toBe('')
    expect(lastLineOf(null as any)).toBe('')
    expect(lastLineOf('')).toBe('')
    expect(lastLineOf(123 as any)).toBe('')
  })

  it('多行文本正确提取剥除末尾空白后的最后一行', () => {
    expect(lastLineOf('第一行\n第二行\n\n  ')).toBe('第二行')
    expect(lastLineOf('只有一行')).toBe('只有一行')
  })
})
