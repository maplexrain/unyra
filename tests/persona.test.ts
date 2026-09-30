/**
 * 导师人格的单元用例（见 src/agent/persona.ts）。
 *
 * 钉的是两件事：
 * 1. **人格不进系统提示词**——它是要求里写死的：进去一次，用户每换一次人格，
 *    整段前缀缓存就作废（这正是做成「隐藏 user 消息」的原因）；
 * 2. 「什么时候该补这一句」的判据：一段对话里同一个人格只补一次，被压缩掉之后要能补回来。
 */
import { describe, expect, it } from 'vitest'

import type { ConversationMessage } from '../src/agent/types'
import {
  DEFAULT_PERSONA,
  PERSONAS,
  needsPersonaAnnounce,
  personaMessage,
  personaOf,
} from '../src/agent/persona'
import { DEFAULT_AGENT_SETTINGS, normalizeAgentSettings } from '../src/agent/settings'
import { buildTeacherSystem } from '../src/learn/ai'
import { toChatHistory } from '../src/learn/useAgent'

const AT = 1700000000000

const userMsg = (text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'u' + text.length + Math.round(Math.random() * 999),
  role: 'user',
  parts: [{ type: 'text', text }],
  ts: AT,
  ...extra,
})

describe('三种人格', () => {
  it('三个，id 与短名都在，默认是标准', () => {
    expect(PERSONAS.map((p) => p.id)).toEqual(['concise', 'standard', 'adhd'])
    expect(PERSONAS.map((p) => p.short)).toEqual(['简洁', '标准', 'ADHD'])
    expect(personaOf(DEFAULT_PERSONA).label).toBe('标准导师')
  })

  it('认不出的 id 一律退回默认（老设置文件、手改成别的词都站得住）', () => {
    expect(personaOf('concise').id).toBe('concise')
    expect(personaOf('bogus').id).toBe('standard')
    expect(personaOf(undefined).id).toBe('standard')
  })

  it('每一段指令都是自足的：带人格自己的规矩，也带那份共同底线', () => {
    for (const p of PERSONAS) {
      expect(p.instruction).toContain('共同底线')
      // 底线七条一条不落（人格切换之后最后生效的那条必须把底线带全）
      for (const n of ['1.', '2.', '3.', '4.', '5.', '6.', '7.']) {
        expect(p.instruction).toContain('\n' + n + ' ')
      }
      expect(p.instruction).toContain('【导师人格 · ' + p.short)
    }
    // 三种人格确实不一样：各自的特征句要在自己那一段里
    expect(personaOf('concise').instruction).toContain('不寒暄')
    expect(personaOf('standard').instruction).toContain('直观理解')
    expect(personaOf('adhd').instruction).toContain('可以跑题，但不能跑丢')
  })
})

describe('什么时候补这一句（needsPersonaAnnounce）', () => {
  it('一段刚开的对话：要补', () => {
    expect(needsPersonaAnnounce([], 'standard')).toBe(true)
    expect(needsPersonaAnnounce([userMsg('你好')], 'standard')).toBe(true)
  })

  it('交代过就不再重复（同一个人格只补一次）', () => {
    const messages = [personaMessage('standard', AT, 'p1'), userMsg('你好')]
    expect(needsPersonaAnnounce(messages, 'standard')).toBe(false)
    // 换一个人格：那是新的一条，要补
    expect(needsPersonaAnnounce(messages, 'concise')).toBe(true)
  })

  it('那条被压缩掉（失活）之后要补回来：不然长对话聊到一半会悄悄变回默认语气', () => {
    const messages = [{ ...personaMessage('concise', AT, 'p1'), retired: true }, userMsg('继续')]
    expect(needsPersonaAnnounce(messages, 'concise')).toBe(true)
  })
})

describe('那条隐藏消息本身', () => {
  const msg = personaMessage('adhd', AT, 'p1')

  it('是 user 角色、隐藏、带 mark 与人格 id', () => {
    expect(msg.role).toBe('user')
    expect(msg.hidden).toBe(true)
    expect(msg.mark).toBe('导师人格 · ADHD 导师')
    expect(msg.persona).toBe('adhd')
    expect(msg.ts).toBe(AT)
  })

  it('正文整段进上下文（隐藏只是界面不显示，模型要看得到）', () => {
    const history = toChatHistory([msg, userMsg('讲一下哈希表')])
    expect(history).toHaveLength(2)
    expect(history[0].role).toBe('user')
    expect(String(history[0].content)).toContain('停不下来的好奇鬼')
    expect(String(history[1].content)).toContain('讲一下哈希表')
  })
})

describe('不进系统提示词', () => {
  it('系统提示词里一个字都不提人格（换人格不该让前缀缓存作废）', () => {
    const system = buildTeacherSystem({ goalQuestion: '我想弄懂微积分' })
    for (const p of PERSONAS) {
      expect(system).not.toContain(p.label)
      expect(system).not.toContain(p.instruction.slice(0, 24))
    }
    expect(system).not.toContain('导师人格')
    expect(system).not.toContain('ADHD')
  })
})

describe('设置里那一项', () => {
  it('默认标准；存过的照读；认不出的退回默认', () => {
    expect(DEFAULT_AGENT_SETTINGS.persona).toBe('standard')
    expect(normalizeAgentSettings({}).persona).toBe('standard')
    expect(normalizeAgentSettings({ persona: 'adhd' }).persona).toBe('adhd')
    expect(normalizeAgentSettings({ persona: '暴躁导师' }).persona).toBe('standard')
    // 别的字段照旧各归各位（新增一项不该动到旧的那些）
    expect(normalizeAgentSettings({ compact: { threshold: 0.5 } }).compact.threshold).toBe(0.5)
  })
})
