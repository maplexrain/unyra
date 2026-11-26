/**
 * 提示词 XML 分块：顶层标签切块、嵌套标签不拆、代码围栏里的标签不误判。
 */
import { describe, expect, it } from 'vitest'
import { parsePromptXml } from '../src/lib/promptXml'

describe('parsePromptXml', () => {
  it('按顶层标签分块，并给常见标签一个短目录名', () => {
    const blocks = parsePromptXml(
      [
        '<agent_common>',
        '通用规则',
        '</agent_common>',
        '',
        '<tool_capabilities>',
        'API 速查',
        '</tool_capabilities>',
      ].join('\n'),
    )
    expect(blocks.map((b) => b.tag)).toEqual(['agent_common', 'tool_capabilities'])
    expect(blocks.map((b) => b.title)).toEqual(['通用基座', 'API 能力'])
    expect(blocks[0]!.body).toBe('通用规则')
    expect(blocks[1]!.raw).toContain('<tool_capabilities>')
  })

  it('嵌套标签留在外层块里，不会拆成多个目录项', () => {
    const blocks = parsePromptXml(
      ['<role_brief>', '<identity>身份</identity>', '<duties>分工</duties>', '</role_brief>'].join('\n'),
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.tag).toBe('role_brief')
    expect(blocks[0]!.body).toContain('<identity>身份</identity>')
  })

  it('代码围栏里的尖括号不算 XML 块', () => {
    const blocks = parsePromptXml(
      ['<identity>角色</identity>', '```xml', '<div>示例</div>', '```'].join('\n'),
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.body).toContain('<div>示例</div>')
  })

  it('没有标签时整篇作为全文一块', () => {
    const blocks = parsePromptXml('只有 Markdown 的一篇提示词')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ tag: '', title: '全文' })
  })
})
