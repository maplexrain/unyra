/**
 * 上下文压缩的单元用例（见 learn/compact）。
 *
 * 压缩这一层错了不会报错，只会**悄悄变傻**：摘要没生效（上下文一直涨）、
 * 该失活的没失活（模型同时看到摘要和原文，前后矛盾）、把没做完的事丢了
 * （下一步接着干的时候从零开始）。所以这里钉的是：摘要怎么成形、应用之后剩下什么、
 * 旧结构怎么折算、以及「值不值得压」的判据。
 */
import { describe, expect, it } from 'vitest'

import type { ContextSummary, Conversation, ConversationMessage } from '../src/agent/types'
import {
  MAX_TASKS,
  MIN_ACTIVE_MESSAGES,
  MIN_SUMMARY_CHARS,
  activeMessages,
  applyCompaction,
  buildSummary,
  compactLabel,
  messageChars,
  migrateConversation,
  shouldCompact,
  summaryBlock,
} from '../src/learn/compact'

const LONG =
  '把极限的直觉讲清楚了：ε-δ 是一套「你给多小我都能更小」的承诺，并且用夹逼定理算出了 sin(x)/x 的极限。' +
  '学习者自己复述时把有界性说漏了，已经纠正并记进错题。'

const msg = (id: string, role: 'user' | 'assistant', text: string, retired = false): ConversationMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  ts: 0,
  ...(retired ? { retired: true } : {}),
})

const toolMsg = (id: string, name: string, args: string, result: string): ConversationMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'tool', id: id + '-t', name, args, result, ok: true, status: 'done' }],
  ts: 0,
})

const conv = (messages: ConversationMessage[], summary?: ContextSummary): Conversation => ({
  id: 'c1',
  goalId: 'g1',
  messages,
  createdAt: 0,
  updatedAt: 0,
  ...(summary ? { summary } : {}),
})

describe('摘要成形（api.compact 的入参）', () => {
  it('正常一份：正文与未完成的事都收下，标记成「还没应用」', () => {
    const out = buildSummary({ summary: LONG, tasks: ['  把「导数」那一节的第三节补完  ', ''] }, 123)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.summary.text).toBe(LONG.trim())
    expect(out.summary.tasks).toEqual(['把「导数」那一节的第三节补完'])
    expect(out.summary.at).toBe(123)
    // 还没应用：旧消息还活着，等本轮 loop 结束才失活（见 applyCompaction）
    expect(out.summary.pending).toBe(true)
  })

  it('空摘要直接拒绝（压缩之后摘要就是唯一的上下文）', () => {
    const out = buildSummary({ summary: '   ' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain('summary')
  })

  it('太短的摘要也拒绝，并说清该怎么写', () => {
    const out = buildSummary({ summary: '讲完了。' })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toContain(String(MIN_SUMMARY_CHARS))
    expect(out.error).toContain('学习目标与背景')
  })

  it('任务条数有上限，非字符串的条目被丢掉', () => {
    const tasks = Array.from({ length: MAX_TASKS + 5 }, (_, i) => '第 ' + i + ' 件事')
    const out = buildSummary({ summary: LONG, tasks: [...tasks, 42, null] }, 1)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.summary.tasks).toHaveLength(MAX_TASKS)
    expect(out.summary.tasks[0]).toBe('第 0 件事')
  })
})

describe('应用压缩：一条原消息都不留', () => {
  const built = (): ContextSummary => {
    const out = buildSummary({ summary: LONG, tasks: ['接着讲导数'] }, 1)
    if (!out.ok) throw new Error(out.error)
    return out.summary
  }

  it('所有还活着的消息失活，摘要成为第一条（条数与字数记下来给界面）', () => {
    const start = conv(
      [msg('u1', 'user', '我想弄懂极限'), msg('a1', 'assistant', '好，先看直觉'), toolMsg('t1', 'execute', '{}', 'x'.repeat(500))],
      built(),
    )
    const { conv: next, label } = applyCompaction(start)
    expect(next.messages.every((m) => m.retired)).toBe(true)
    expect(next.summary?.pending).toBe(false)
    expect(next.summary?.messages).toBe(3)
    expect(next.summary?.chars).toBe(
      messageChars(start.messages[0]) + messageChars(start.messages[1]) + messageChars(start.messages[2]),
    )
    expect(label).toContain('3 条')
  })

  it('幂等：应用过一次之后再调，不会把新的消息也标掉', () => {
    const first = applyCompaction(conv([msg('u1', 'user', '一'), msg('a1', 'assistant', '二')], built())).conv
    const withNew: Conversation = { ...first, messages: [...first.messages, msg('u2', 'user', '新的问题')] }
    const again = applyCompaction(withNew)
    expect(again.label).toBe('')
    expect(again.conv.messages[again.conv.messages.length - 1].retired).toBeUndefined()
  })

  it('没有摘要时什么都不做（没有可应用的东西）', () => {
    const c = conv([msg('u1', 'user', '一')])
    expect(applyCompaction(c).conv).toBe(c)
  })

  it('活着的消息数就是「还有多少条进上下文」', () => {
    const c = conv([msg('u1', 'user', '一', true), msg('a1', 'assistant', '二'), msg('u2', 'user', '三')])
    expect(activeMessages(c.messages).map((m) => m.id)).toEqual(['a1', 'u2'])
  })
})

describe('值不值得压', () => {
  it('到阈值、而且确实有东西可压', () => {
    expect(shouldCompact(MIN_ACTIVE_MESSAGES, 0.8, 0.7)).toBe(true)
    // 还没到阈值：不压
    expect(shouldCompact(20, 0.5, 0.7)).toBe(false)
    // 消息太少：压了省不下什么，还白起一轮工作流
    expect(shouldCompact(MIN_ACTIVE_MESSAGES - 1, 0.9, 0.7)).toBe(false)
  })
})

describe('摘要怎么进上下文', () => {
  it('正文之前先放「还没做完的事」，并说明原始消息已不再提供', () => {
    const s: ContextSummary = {
      at: 0,
      text: LONG,
      tasks: ['把第三节补完', '下次考一次夹逼定理'],
      messages: 12,
      chars: 3000,
    }
    const block = summaryBlock(s)
    expect(block).toContain('已不再随本次请求提供')
    expect(block.indexOf('还没做完的事')).toBeGreaterThan(0)
    expect(block.indexOf('还没做完的事')).toBeLessThan(block.indexOf(LONG))
    expect(block).toContain('- 把第三节补完')
    expect(block).toContain(LONG)
  })

  it('界面上的说法带上条数、字数与未完成的事', () => {
    const s: ContextSummary = { at: 0, text: LONG, tasks: ['甲'], messages: 12, chars: 3400 }
    const label = compactLabel(s)
    expect(label).toContain('12 条')
    expect(label).toContain('3k')
    expect(label).toContain('1 件事')
  })
})

describe('旧结构（throughId 分界）的折算', () => {
  const old = {
    id: 'c1',
    goalId: 'g1',
    createdAt: 0,
    updatedAt: 0,
    messages: [msg('u1', 'user', '一'), msg('a1', 'assistant', '二'), msg('u2', 'user', '三')],
    summary: { throughId: 'a1', text: '老摘要', at: 9, messages: 2, chars: 100, by: 'auto' },
  } as unknown as Conversation

  it('分界之前的消息补上失活标记，摘要换成新形状', () => {
    const next = migrateConversation(old)
    expect(next.messages.map((m) => !!m.retired)).toEqual([true, true, false])
    expect(next.summary).toMatchObject({ text: '老摘要', at: 9, tasks: [] })
    expect((next.summary as unknown as Record<string, unknown>).throughId).toBeUndefined()
  })

  it('分界消息已经不在了：不猜，原样留着（摘要作废，历史照旧全发）', () => {
    const broken = { ...old, summary: { ...(old.summary as object), throughId: 'gone' } } as unknown as Conversation
    const next = migrateConversation(broken)
    expect(next.messages.every((m) => !m.retired)).toBe(true)
  })

  it('已经是新结构：只补 tasks，不碰消息', () => {
    const fresh = conv([msg('u1', 'user', '一', true), msg('u2', 'user', '二')], {
      at: 1,
      text: '新',
      messages: 1,
      chars: 1,
    } as ContextSummary)
    const next = migrateConversation(fresh)
    expect(next.summary?.tasks).toEqual([])
    expect(next.messages.map((m) => !!m.retired)).toEqual([true, false])
  })
})
