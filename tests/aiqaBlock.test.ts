import { describe, expect, it, vi } from 'vitest'
import { parseAiqaBlock } from '../src/lib/aiqaBlock/parse'
import { aiqaBlock } from '../src/lib/aiqaBlock/render'
import { setAiqaBlockHost, aiqaBlockHost, subscribeAiqaBlockHost } from '../src/lib/aiqaBlock/host'
import { normalizeNode } from '../src/learn/store/normalize/node'
import type { PluginRenderContext } from '../src/lib/renderPlugins'
import { escapeHtml, encodeAttr } from '../src/lib/renderPlugins'

const dummyCtx: PluginRenderContext = {
  escape: escapeHtml,
  attr: encodeAttr,
}

describe('aiqaBlock 解析器 (parseAiqaBlock)', () => {
  it('正确解析标准的 - system 和 - question 语法', () => {
    const raw = `
- system: 你是一个经验丰富的计算机老师，你需要在这里考察学生对于虚拟内存的理解。
- question: 请你简单叙述一下虚拟地址到物理地址的转换过程？
`
    const parsed = parseAiqaBlock(raw)
    expect(parsed.system).toBe('你是一个经验丰富的计算机老师，你需要在这里考察学生对于虚拟内存的理解。')
    expect(parsed.question).toBe('请你简单叙述一下虚拟地址到物理地址的转换过程？')
    expect(parsed.id).toMatch(/^aiqa_[a-z0-9]+$/)
  })

  it('支持中文冒号与无横杠语法', () => {
    const raw = `
system：系统提示词内容
question：开场白问题内容
`
    const parsed = parseAiqaBlock(raw)
    expect(parsed.system).toBe('系统提示词内容')
    expect(parsed.question).toBe('开场白问题内容')
  })

  it('支持多行提示词与多行问题', () => {
    const raw = `
- system: 第一行提示词
  第二行提示词
  第三行提示词
- question: 第一行问题
  第二行问题
`
    const parsed = parseAiqaBlock(raw)
    expect(parsed.system).toContain('第一行提示词')
    expect(parsed.system).toContain('第二行提示词')
    expect(parsed.system).toContain('第三行提示词')
    expect(parsed.question).toContain('第一行问题')
    expect(parsed.question).toContain('第二行问题')
  })

  it('相同内容生成相同的确定性 ID，不同内容生成不同的 ID', () => {
    const rawA = `- system: 提示词A\n- question: 问题A`
    const rawA2 = `- system: 提示词A\n- question: 问题A`
    const rawB = `- system: 提示词B\n- question: 问题B`

    const parsedA = parseAiqaBlock(rawA)
    const parsedA2 = parseAiqaBlock(rawA2)
    const parsedB = parseAiqaBlock(rawB)

    expect(parsedA.id).toBe(parsedA2.id)
    expect(parsedA.id).not.toBe(parsedB.id)
  })
})

describe('aiqaBlock 渲染输出 (aiqaBlock)', () => {
  it('渲染直角无圆角卡片并携带必要的数据属性', () => {
    const raw = `
- system: 考察学生关于 TCP 的理解
- question: 什么是三次握手？
`
    const html = aiqaBlock(raw, dummyCtx)
    expect(html).toContain('class="moji-aiqa')
    expect(html).toContain('rounded-none')
    expect(html).toContain('data-aiqa-id="')
    expect(html).toContain('data-aiqa-question="')
    expect(html).toContain('data-aiqa-system="')
    expect(html).toContain('什么是三次握手？')
    expect(html).toContain('发送')
  })

  it('空内容或非法语法给出友好提示而不崩溃', () => {
    const emptyHtml = aiqaBlock('', dummyCtx)
    expect(emptyHtml).toContain('moji-aiqa-error')

    const invalidHtml = aiqaBlock('没有任何配置', dummyCtx)
    expect(invalidHtml).toContain('moji-aiqa-error')
  })
})

describe('KnowledgeNode 持久化规范 (normalizeNode & aiqaChats)', () => {
  it('节点能够正确反序列化并保留 aiqaChats 会话数据', () => {
    const rawNode = {
      id: 'node-1',
      title: '操作系统内存管理',
      body: '教学文档正文',
      aiqaChats: {
        aiqa_123: {
          id: 'aiqa_123',
          messages: [
            { role: 'assistant', content: '开场问题' },
            { role: 'user', content: '我的回答' },
            { role: 'assistant', content: 'AI 的针对性点评与追问' },
          ],
          updatedAt: 1700000000,
        },
      },
    }

    const node = normalizeNode(rawNode)
    expect(node).not.toBeNull()
    expect(node?.aiqaChats).toBeDefined()
    expect(node?.aiqaChats?.aiqa_123).toBeDefined()
    expect(node?.aiqaChats?.aiqa_123.messages).toHaveLength(3)
    expect(node?.aiqaChats?.aiqa_123.messages[0].role).toBe('assistant')
    expect(node?.aiqaChats?.aiqa_123.messages[1].role).toBe('user')
    expect(node?.aiqaChats?.aiqa_123.messages[2].content).toBe('AI 的针对性点评与追问')
  })

  it('过滤非法的消息格式', () => {
    const rawNode = {
      id: 'node-2',
      title: '测试节点',
      aiqaChats: {
        aiqa_bad: {
          id: 'aiqa_bad',
          messages: [
            { role: 'invalid_role', content: '测试' },
            { role: 'user', content: '' },
            { role: 'user', content: '有效回答' },
          ],
        },
      },
    }

    const node = normalizeNode(rawNode)
    expect(node?.aiqaChats?.aiqa_bad.messages).toHaveLength(1)
    expect(node?.aiqaChats?.aiqa_bad.messages[0].content).toBe('有效回答')
  })
})

describe('AiqaBlockHost 全局宿主连接与订阅', () => {
  it('正确支持注册、读取与订阅通知', () => {
    const mockHost = {
      getActiveNodeId: () => 'node-abc',
      getNodeAiqaSession: vi.fn(),
      saveNodeAiqaSession: vi.fn(),
    }

    const listener = vi.fn()
    const unsub = subscribeAiqaBlockHost(listener)

    setAiqaBlockHost(mockHost)
    expect(aiqaBlockHost()).toBe(mockHost)
    expect(listener).toHaveBeenCalledTimes(1)

    unsub()
    setAiqaBlockHost(null)
    expect(aiqaBlockHost()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
