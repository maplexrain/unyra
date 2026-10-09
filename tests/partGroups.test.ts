/**
 * 消息归组的单元用例（见 panel/partGroups）。
 *
 * 钉的是「谁跟谁合成一组」这条规矩：提示词模块算不算过程件、正文切不切组、
 * 跳边界要不要切断。它出错的形态是「界面看着有点乱」——不报错、不崩，
 * 只有用例说得清什么才算对。
 */
import { describe, expect, it } from 'vitest'

import { groupParts, isProcessPart } from '../src/components/agent/panel/partGroups'
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
const text = (t: string): AgentPart => ({ type: 'text', text: t })

describe('过程件的范围', () => {
  it('思考 / 工具 / 提示词模块都是过程件；正文与提示不是', () => {
    expect(isProcessPart(think('a'))).toBe(true)
    expect(isProcessPart(tool('t1'))).toBe(true)
    expect(isProcessPart(mod('ui'))).toBe(true)
    expect(isProcessPart(text('正文'))).toBe(false)
    expect(isProcessPart({ type: 'notice', level: 'warn', text: '截断' })).toBe(false)
    expect(isProcessPart({ type: 'hop' })).toBe(false)
  })
})

describe('归组', () => {
  it('相邻的思考与工具连成一组，提示词模块并进同一组（在它发生的位置上）', () => {
    const groups = groupParts([think('想'), tool('t1'), mod('browser'), think('再想'), tool('t2')])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('group')
    if (groups[0].kind !== 'group') return
    expect(groups[0].items.map((p) => p.type)).toEqual(['thinking', 'tool', 'prompt-module', 'thinking', 'tool'])
  })

  it('正文一出，组就闭合：前后各成一组', () => {
    const groups = groupParts([think('想'), tool('t1'), text('讲完了'), mod('ui'), tool('t2')])
    expect(groups.map((g) => g.kind)).toEqual(['group', 'single', 'group'])
    if (groups[0].kind === 'group') expect(groups[0].items).toHaveLength(2)
    if (groups[2].kind === 'group') expect(groups[2].items).toHaveLength(2)
  })

  it('hop 是跳边界，不切断组；运行时提示在组外并切断组', () => {
    const crossed = groupParts([think('第一跳'), { type: 'hop' }, tool('t1'), think('第二跳')])
    expect(crossed).toHaveLength(1)
    if (crossed[0].kind === 'group') expect(crossed[0].items).toHaveLength(3)

    const cut = groupParts([think('想'), { type: 'notice', level: 'warn', text: '步数用尽' }, tool('t1')])
    expect(cut.map((g) => g.kind)).toEqual(['group', 'single', 'group'])
  })

  it('落单的过程件也照原样交出去（调用方按单条画，不成组）', () => {
    const groups = groupParts([text('开场'), mod('ui')])
    expect(groups).toHaveLength(2)
    expect(groups[1].kind).toBe('group')
    if (groups[1].kind === 'group') expect(groups[1].items).toHaveLength(1)
  })

  it('空消息与只有 hop 的消息都不产出任何一段', () => {
    expect(groupParts([])).toEqual([])
    expect(groupParts([{ type: 'hop' }, { type: 'hop' }])).toEqual([])
  })
})
