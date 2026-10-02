import { describe, expect, it } from 'vitest'
import { axNodesToElements, MAX_SNAPSHOT_ELEMENTS, type AxRawNode } from '../shared/axTree'

/** 造一枚 AX 节点：只填测试关心的字段 */
function ax(fields: {
  role?: string
  name?: string
  value?: string
  ignored?: boolean
  clickable?: boolean
  backendDOMNodeId?: number
}): AxRawNode {
  return {
    ...(fields.ignored ? { ignored: true } : {}),
    ...(fields.role ? { role: { value: fields.role } } : {}),
    ...(fields.name !== undefined ? { name: { value: fields.name } } : {}),
    ...(fields.value !== undefined ? { value: { value: fields.value } } : {}),
    ...(fields.clickable !== undefined ? { properties: [{ type: 'clickable', value: fields.clickable }] } : {}),
    ...(fields.backendDOMNodeId !== undefined ? { backendDOMNodeId: fields.backendDOMNodeId } : {}),
  }
}

describe('axNodesToElements：AX 树 → 带 ref 的可交互元素清单', () => {
  it('可交互角色按序编号，ignored 与无关角色跳过', () => {
    const { elements, truncated } = axNodesToElements([
      ax({ role: 'rootWebArea', name: '示例页' }),
      ax({ ignored: true, role: 'button', name: '看不见的' }),
      ax({ role: 'button', name: '提交', backendDOMNodeId: 11 }),
      ax({ role: 'StaticText', name: '一段正文' }),
      ax({ role: 'link', name: '下一页', backendDOMNodeId: 12 }),
      ax({ role: 'heading', name: '结果' }),
    ])
    expect(truncated).toBe(false)
    expect(elements).toEqual([
      { ref: 1, role: 'button', name: '提交', backendNodeId: 11 },
      { ref: 2, role: 'link', name: '下一页', backendNodeId: 12 },
      { ref: 3, role: 'heading', name: '结果' },
    ])
  })

  it('generic 只有带 clickable 属性才收；StaticText 即使 clickable 也不要', () => {
    const { elements } = axNodesToElements([
      ax({ role: 'generic', name: '自定义可点块', clickable: true, backendDOMNodeId: 21 }),
      ax({ role: 'StaticText', name: '假可点', clickable: true }),
      ax({ role: 'generic', name: '不可点的块', clickable: false }),
    ])
    expect(elements).toEqual([{ ref: 1, role: 'generic', name: '自定义可点块', backendNodeId: 21 }])
  })

  it('textbox 带当前值；无名无值的控件跳过；无名图片不要', () => {
    const { elements } = axNodesToElements([
      ax({ role: 'textbox', name: '搜索', value: '极限', backendDOMNodeId: 31 }),
      ax({ role: 'textbox', name: '', value: '只有值' }),
      ax({ role: 'textbox', name: '空的', value: '' }),
      ax({ role: 'image', name: '' }),
      ax({ role: 'image', name: '验证码', backendDOMNodeId: 32 }),
    ])
    expect(elements).toEqual([
      { ref: 1, role: 'textbox', name: '搜索', value: '极限', backendNodeId: 31 },
      { ref: 2, role: 'textbox', name: '', value: '只有值' },
      { ref: 3, role: 'textbox', name: '空的' },
      { ref: 4, role: 'image', name: '验证码', backendNodeId: 32 },
    ])
  })

  it('超过上限先截断，并标记 truncated', () => {
    const many = Array.from({ length: MAX_SNAPSHOT_ELEMENTS + 10 }, (_, i) =>
      ax({ role: 'button', name: 'b' + i, backendDOMNodeId: i + 1 }),
    )
    const { elements, truncated } = axNodesToElements(many)
    expect(truncated).toBe(true)
    expect(elements.length).toBe(MAX_SNAPSHOT_ELEMENTS)
    expect(elements[0].name).toBe('b0')
    expect(elements[MAX_SNAPSHOT_ELEMENTS - 1].name).toBe('b' + (MAX_SNAPSHOT_ELEMENTS - 1))
  })

  it('空树与非字符串值安全', () => {
    expect(axNodesToElements(undefined)).toEqual({ elements: [], truncated: false })
    const { elements } = axNodesToElements([ax({ role: 'textbox', name: 'x', value: undefined })])
    expect(elements).toEqual([{ ref: 1, role: 'textbox', name: 'x' }])
  })
})
