/**
 * role 层附件分层：用户消息只带元信息，图片字节 / 文件正文不进 role 请求；
 * 同一份历史给普通聊天（omit=false）时仍按原样挂图片。
 */
import { describe, expect, it } from 'vitest'
import { toChatHistory } from '../src/learn/agent/history'
import { attachmentMetaBlock } from '../src/learn/attachments'
import type { ConversationMessage } from '../src/agent/types'

const userMessage: ConversationMessage = {
  id: 'm1',
  role: 'user',
  ts: 1000,
  parts: [{ type: 'text', text: '帮我看看这张图和说明' }],
  images: [{ id: 'img-1', name: '猫.png', rel: 'static/img-1.png', mime: 'image/png', bytes: 120 }],
  files: [{ name: '说明.txt', rel: 'static/note.txt', bytes: 20, chars: 12, binary: false }],
}

describe('role 附件分层', () => {
  it('role 请求只有附件元信息，没有图片片段', () => {
    const messages = toChatHistory([userMessage], new Map(), { omitUserAttachments: true })
    expect(messages).toHaveLength(1)
    expect(typeof messages[0]!.content).toBe('string')
    const text = messages[0]!.content as string
    expect(text).toContain('猫.png')
    expect(text).toContain('说明.txt')
    expect(text).toContain('只有附件元信息')
    expect(text).toContain('交给 work')
  })

  it('普通聊天仍把图片片段挂上（omit=false 的现状不变）', () => {
    const bytes = new Map([['img-1', { mime: 'image/png', data: 'AAAA' }]])
    const messages = toChatHistory([userMessage], bytes, { omitUserAttachments: false })
    expect(Array.isArray(messages[0]!.content)).toBe(true)
  })

  it('role 历史把通道抬头的信封 id 写进附件块，work.send 才有可引用的 id', () => {
    const groupMessage: ConversationMessage = {
      ...userMessage,
      id: 'm-internal',
      channel: {
        channel: 'group',
        from: { kind: 'user', id: 'u1', name: 'Maxwell' },
        to: { kind: 'role', id: 'tutor', name: '导师龟' },
        ts: 1000,
        envelopeId: 'g-abc',
      },
    }
    const messages = toChatHistory([groupMessage], new Map(), { omitUserAttachments: true })
    const text = messages[0]!.content as string
    expect(text).toContain('id:g-abc')
    expect(text).toContain('【原消息 id：g-abc')
    expect(text).toContain('messageId: "g-abc"')
  })

  it('元信息块逐项列文件名、体积与尺寸，不写路径正文', () => {
    const block = attachmentMetaBlock(
      [{ id: 'i', name: '大图.jpg', rel: 'static/i.jpg', mime: 'image/jpeg', bytes: 2048, width: 800, height: 600 }],
      [{ name: 'a.md', rel: 'static/a.md', bytes: 10, chars: 300, binary: false }],
    )
    expect(block).toContain('大图.jpg')
    expect(block).toContain('800×600')
    expect(block).toContain('a.md')
    expect(block).toContain('共 300 字')
  })
})
