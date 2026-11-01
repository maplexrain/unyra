import { describe, it, expect } from 'vitest'
import { userInfoMessage, needsUserInfoAnnounce } from '../src/agent/userInfo'
import type { ConversationMessage } from '../src/agent/types'
import type { UserProfile } from '../src/user/types'

describe('学习者画像首轮注入与判定 (userInfoAnnounce)', () => {
  const sampleProfile: UserProfile = {
    nickname: '小墨',
    avatar: 'data:image/png;base64,ignore',
    age: 22,
    gender: 'female',
    education: '本科在读',
    major: '软件工程',
    role: '全栈学习者',
    experience: '掌握 TS/React，正在攻克深度学习',
    skills: 'TypeScript, Python, Web',
    language: '中文',
  }

  it('生成正确的隐藏画像消息（标注为客观信息，inject 为 prompt）', () => {
    const msg = userInfoMessage(sampleProfile, 1700000000000, 'msg-1')
    expect(msg.id).toBe('msg-1')
    expect(msg.role).toBe('assistant')
    expect(msg.hidden).toBe(true)
    expect(msg.mark).toBe('学习者画像')
    expect(msg.userInfo).toBe(true)
    expect(msg.inject).toBe('prompt')

    const text = msg.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    expect(text).toContain('当前学习者画像与背景信息')
    expect(text).toContain('小墨')
    expect(text).toContain('22')
    expect(text).toContain('软件工程')
    expect(text).toContain('全栈学习者')
    expect(text).toContain('TypeScript, Python, Web')
    // 头像不进提示词
    expect(text).not.toContain('base64')
  })

  it('未填写画像时给出优雅提示，告知默认按通用水平讲解', () => {
    const msg = userInfoMessage(null, 1700000000000, 'msg-2')
    const text = msg.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    expect(text).toContain('学习者尚未填写个人画像')
    expect(text).toContain('默认按通用基础水平因材施教')
  })

  it('needsUserInfoAnnounce 正确判断是否已注入画像', () => {
    const emptyMsgs: ConversationMessage[] = []
    expect(needsUserInfoAnnounce(emptyMsgs)).toBe(true)

    const normalUserMsg: ConversationMessage = {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: '你好' }],
      ts: 1000,
    }
    expect(needsUserInfoAnnounce([normalUserMsg])).toBe(true)

    const userProfileMsg = userInfoMessage(sampleProfile, 1001, 'm2')
    expect(needsUserInfoAnnounce([userProfileMsg, normalUserMsg])).toBe(false)

    // retired 的消息不算，长对话压缩后必须允许重新注入
    const retiredMsg: ConversationMessage = { ...userProfileMsg, retired: true }
    expect(needsUserInfoAnnounce([retiredMsg, normalUserMsg])).toBe(true)
  })

  it('首轮消息排序验证：不可变在前（systemPrompt），可变人格和文档格式在后，用户画像在人格和文档格式之后', () => {
    // 模拟 useAgent 首轮组装逻辑：
    // announcer (persona) -> formatAnnouncer (docFormat) -> userInfoAnnouncer (userInfo) -> userMsg
    const announcer: ConversationMessage = {
      id: 'p1',
      role: 'assistant',
      parts: [{ type: 'text', text: '导师人格：标准导师' }],
      ts: 1000,
      hidden: true,
      persona: 'standard',
      inject: 'prompt',
    }
    const formatAnnouncer: ConversationMessage = {
      id: 'f1',
      role: 'assistant',
      parts: [{ type: 'text', text: '文档格式：出版级排版' }],
      ts: 1001,
      hidden: true,
      docFormat: 'doc-html',
      inject: 'prompt',
    }
    const userInfoAnnouncer: ConversationMessage = userInfoMessage(sampleProfile, 1002, 'u1')
    const userMsg: ConversationMessage = {
      id: 'usr1',
      role: 'user',
      parts: [{ type: 'text', text: '我想学习快速排序算法' }],
      ts: 1003,
    }

    const messages = [announcer, formatAnnouncer, userInfoAnnouncer, userMsg]

    // 索引断言：人格在最前（可变层前部），格式次之，画像放人格和文档格式之后，最后为用户消息
    const personaIdx = messages.findIndex((m) => !!m.persona)
    const formatIdx = messages.findIndex((m) => !!m.docFormat)
    const userInfoIdx = messages.findIndex((m) => !!m.userInfo)
    const userMsgIdx = messages.findIndex((m) => m.role === 'user')

    expect(personaIdx).toBe(0)
    expect(formatIdx).toBe(1)
    expect(userInfoIdx).toBe(2)
    expect(userMsgIdx).toBe(3)

    expect(formatIdx).toBeGreaterThan(personaIdx)
    expect(userInfoIdx).toBeGreaterThan(formatIdx)
    expect(userMsgIdx).toBeGreaterThan(userInfoIdx)
  })
})
