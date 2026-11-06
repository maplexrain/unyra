// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { BROWSER_RUNTIME_INIT_SCRIPT } from '../src/learn/web/browserRuntimeScript'

describe('browserRuntimeScript：页面内运行时深度穿透与动作仿真', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    // 重新注入运行时全局对象
    delete (window as any).__agentRuntimeReady
    delete (window as any).__agentNodeMap
    delete (window as any).__findAgentNode
    delete (window as any).__agentIndex
    delete (window as any).__agentClick
    delete (window as any).__agentFill
    delete (window as any).__agentType
    delete (window as any).__agentInspect
    delete (window as any).__agentText
    delete (window as any).__agentPress
    delete (window as any).__agentScroll
    eval(BROWSER_RUNTIME_INIT_SCRIPT)
  })

  it('完美支持 Shadow DOM 自定义组件嵌套、解决 Illegal invocation 并统一 isEditable 判定', async () => {
    // 构造模拟 B 站评论区结构：
    // <bili-comment-box> (shadow host)
    //   #shadow-root
    //     <button id="sort-latest">最新</button>
    //     <bili-comment-rich-textarea> (nested shadow host)
    //       #shadow-root
    //         <div class="editor" contenteditable="true" placeholder="评论千万条，等你发一条"></div>

    const commentBox = document.createElement('bili-comment-box')
    document.body.appendChild(commentBox)
    const boxShadow = commentBox.attachShadow({ mode: 'open' })

    const sortButton = document.createElement('button')
    sortButton.id = 'sort-latest'
    sortButton.textContent = '最新'
    boxShadow.appendChild(sortButton)

    const richTextarea = document.createElement('bili-comment-rich-textarea')
    boxShadow.appendChild(richTextarea)
    const textareaShadow = richTextarea.attachShadow({ mode: 'open' })

    const innerEditor = document.createElement('div')
    innerEditor.className = 'editor'
    innerEditor.setAttribute('contenteditable', 'true')
    innerEditor.setAttribute('placeholder', '评论千万条，等你发一条')
    textareaShadow.appendChild(innerEditor)

    // 1. 生成索引
    const indexResult = (window as any).__agentIndex()
    expect(indexResult.text).toContain('bili-comment-rich-textarea[editable]')
    expect(indexResult.text).toContain('评论千万条，等你发一条')

    // 提取分配给 bili-comment-rich-textarea 的 data-agent-id
    const textareaId = Number(richTextarea.getAttribute('data-agent-id'))
    expect(textareaId).toBeGreaterThan(0)

    // 2. 验证 inspect 的 isEditable 与 index 完全一致，并返回 resolvedTag: 'div'
    const inspectResult = (window as any).__agentInspect(textareaId)
    expect(inspectResult.ok).toBe(true)
    expect(inspectResult.tag).toBe('bili-comment-rich-textarea')
    expect(inspectResult.resolvedTag).toBe('div')
    expect(inspectResult.isEditable).toBe(true)
    expect(inspectResult.placeholder).toBe('评论千万条，等你发一条')

    // 3. 验证 fill：命中 shadow host 自定义元素时，绝不抛出 Illegal invocation，而是下钻到真实 contenteditable 并输入
    const fillResult = (window as any).__agentFill(textareaId, '这是测试评论内容')
    expect(fillResult.ok).toBe(true)
    expect(fillResult.tag).toBe('bili-comment-rich-textarea')
    expect(fillResult.resolvedTag).toBe('div')
    expect(fillResult.resolvedType).toBe('contenteditable')
    expect(innerEditor.innerText || innerEditor.textContent).toContain('这是测试评论内容')

    // 4. 验证 fill 命中外层包裹容器 bili-comment-box 时也能自动下钻输入
    const boxId = Number(commentBox.getAttribute('data-agent-id'))
    expect(boxId).toBeGreaterThan(0)
    const fillBoxResult = (window as any).__agentFill(boxId, '第二条评论', { clear: false })
    expect(fillBoxResult.ok).toBe(true)
    expect(fillBoxResult.resolvedTag).toBe('div')

    // 5. 验证 type：逐字符输入仿真与 IME
    const typeResult = await (window as any).__agentType(textareaId, '肖申克的救赎')
    expect(typeResult.ok).toBe(true)
    expect(typeResult.typedChars).toBe(6)
    expect(typeResult.resolvedTag).toBe('div')

    // 6. 验证 CSS 选择器跨 Shadow DOM 穿透查找 (Deep QuerySelector)
    const foundDirect = (window as any).__findAgentNode('bili-comment-rich-textarea')
    expect(foundDirect).toBe(richTextarea)

    const foundInner = (window as any).__findAgentNode('[contenteditable="true"]')
    expect(foundInner).toBe(innerEditor)

    const foundCombinator = (window as any).__findAgentNode('bili-comment-box >>> button#sort-latest')
    expect(foundCombinator).toBe(sortButton)

    // 7. 验证 click 穿透 Shadow DOM 并派发 composed: true
    let buttonClicked = false
    let clickComposed = false
    sortButton.addEventListener('click', (ev) => {
      buttonClicked = true
      clickComposed = ev.composed
    })

    const buttonId = Number(sortButton.getAttribute('data-agent-id'))
    expect(buttonId).toBeGreaterThan(0)
    const clickResult = (window as any).__agentClick(buttonId)
    expect(clickResult.ok).toBe(true)
    expect(buttonClicked).toBe(true)
    expect(clickComposed).toBe(true)
  })

  it('原生 input / textarea 正常受控输入与 setter 调用', async () => {
    const input = document.createElement('input')
    input.type = 'text'
    input.id = 'search-bar'
    document.body.appendChild(input)

    let inputEventCount = 0
    let changeEventCount = 0
    input.addEventListener('input', () => { inputEventCount++ })
    input.addEventListener('change', () => { changeEventCount++ })

    const fillResult = (window as any).__agentFill('input#search-bar', '肖申克的救赎', { pressEnter: false })
    expect(fillResult.ok).toBe(true)
    expect(fillResult.resolvedType).toBe('input')
    expect(input.value).toBe('肖申克的救赎')
    expect(inputEventCount).toBeGreaterThanOrEqual(1)
    expect(changeEventCount).toBeGreaterThanOrEqual(1)
  })

  it('错误返回健全且被序列化为字符串，杜绝 [object Object]', async () => {
    const nonExistentResult = (window as any).__agentFill(99999, 'test')
    expect(nonExistentResult.ok).toBe(false)
    expect(typeof nonExistentResult.error).toBe('string')
    expect(nonExistentResult.error).toContain('未找到节点 [99999]')
  })
})
