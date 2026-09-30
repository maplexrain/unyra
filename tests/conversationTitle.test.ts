/**
 * 对话命名的单元用例。
 *
 * 钉两件事：拿哪句话去起名（隐藏指令不算数）、模型吐出来的东西怎么收拾成标题。
 * 起名请求本身要联网，不在这里测——这里测的是它前后两端。
 */
import { describe, expect, it } from 'vitest'

import { cleanTitle, namingSource, TITLE_MAX_CHARS } from '../src/learn/title'
import type { Conversation, ConversationMessage } from '../src/agent/types'

function msg(over: Partial<ConversationMessage> & { role: 'user' | 'assistant' }): ConversationMessage {
  return {
    id: 'm' + Math.random().toString(36).slice(2),
    parts: [{ type: 'text', text: '默认正文' }],
    ts: Date.now(),
    ...over,
  }
}

function conv(messages: ConversationMessage[]): Conversation {
  return { id: 'c1', goalId: 'g1', messages, createdAt: 0, updatedAt: 0 }
}

describe('拿哪句话起名', () => {
  it('取第一条给用户看的 user 消息', () => {
    const c = conv([
      msg({ role: 'user', parts: [{ type: 'text', text: '什么是导数' }] }),
      msg({ role: 'assistant', parts: [{ type: 'text', text: '导数是…' }] }),
      msg({ role: 'user', parts: [{ type: 'text', text: '再举个例子' }] }),
    ])
    expect(namingSource(c, '目标问题')).toBe('什么是导数')
  })

  it('跳过隐藏指令（那是我们写给模型的，不是用户说的话）', () => {
    const c = conv([
      msg({ role: 'user', hidden: true, parts: [{ type: 'text', text: '请开始讲解这个节点' }] }),
      msg({ role: 'user', parts: [{ type: 'text', text: '这里的极限怎么理解' }] }),
    ])
    expect(namingSource(c, '目标问题')).toBe('这里的极限怎么理解')
  })

  it('一条用户消息都没有时退回目标问题（新建目标那一轮就是这种情况）', () => {
    const c = conv([msg({ role: 'user', hidden: true, parts: [{ type: 'text', text: '学习大纲指令' }] })])
    expect(namingSource(c, '  我想系统学一遍微积分  ')).toBe('我想系统学一遍微积分')
  })

  it('空对话也没有目标问题时给空串（调用方据此跳过起名）', () => {
    expect(namingSource(conv([]), '')).toBe('')
  })
})

describe('收拾标题', () => {
  it('剥掉引号、前缀与结尾标点', () => {
    expect(cleanTitle('「导数的定义」')).toBe('导数的定义')
    expect(cleanTitle('标题：链式法则。')).toBe('链式法则')
    expect(cleanTitle('Title: chain rule')).toBe('chain rule')
  })

  it('只留第一行', () => {
    expect(cleanTitle('导数的几何意义\n（补充说明）')).toBe('导数的几何意义')
  })

  it('掐到 30 字符以内（按 Unicode 码点数）', () => {
    const long = cleanTitle('用户想要系统了解导数的定义与它在物理中的各种应用场景，最好还能结合例子讲讲')
    expect([...long].length).toBeLessThanOrEqual(TITLE_MAX_CHARS)
    expect(long.length).toBeGreaterThan(0)
  })

  it('英文一样掐得住', () => {
    const long = cleanTitle('understanding the geometric meaning of derivatives in calculus')
    expect([...long].length).toBeLessThanOrEqual(TITLE_MAX_CHARS)
  })

  it('空输出给空串（调用方据此当成失败）', () => {
    expect(cleanTitle('')).toBe('')
    expect(cleanTitle('   \n  ')).toBe('')
  })
})