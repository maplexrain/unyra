// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { DOC_TW_CLASS } from '../src/lib/docTailwind'

describe('DocNotepad Placement and Dragging', () => {
  it('correctly targets DOM container with DOC_TW_CLASS', () => {
    // 模拟 DOM 树
    const body = document.createElement('div')
    body.className = 'note-preview moji-node-note'

    const docTw = document.createElement('div')
    docTw.className = DOC_TW_CLASS
    body.appendChild(docTw)

    const p0 = document.createElement('p')
    p0.textContent = '段落 0'
    const h1 = document.createElement('h2')
    h1.textContent = '标题 1'
    const p2 = document.createElement('p')
    p2.textContent = '段落 2'

    docTw.appendChild(p0)
    docTw.appendChild(h1)
    docTw.appendChild(p2)

    // 检测正文容器
    const docContainer = (body.querySelector(`.${DOC_TW_CLASS}`) as HTMLElement) || body
    expect(docContainer).toBe(docTw)

    const children = Array.from(docContainer.children).filter(
      (el) => !el.hasAttribute('data-doc-notepad-slot') && !el.classList.contains('block-notepad-slot'),
    ) as HTMLElement[]
    expect(children.length).toBe(3)

    // 模拟插入 blockIndex = -1（文章最顶部）
    const slotTop = document.createElement('div')
    slotTop.setAttribute('data-doc-notepad-slot', 'note-top')
    docContainer.insertBefore(slotTop, docContainer.firstChild)
    expect(docContainer.firstChild).toBe(slotTop)

    // 模拟插入 blockIndex = 1（标题 1 后面）
    const slotMiddle = document.createElement('div')
    slotMiddle.setAttribute('data-doc-notepad-slot', 'note-mid')
    const targetChild = children[1]
    docContainer.insertBefore(slotMiddle, targetChild.nextSibling)
    expect(h1.nextSibling).toBe(slotMiddle)
    expect(slotMiddle.nextSibling).toBe(p2)
  })

  it('calculates target block index based on target node hierarchy', () => {
    const body = document.createElement('div')
    const docTw = document.createElement('div')
    docTw.className = DOC_TW_CLASS
    body.appendChild(docTw)

    const p0 = document.createElement('p')
    p0.innerHTML = '段落 <strong>加粗重点</strong> 结尾'
    const p1 = document.createElement('p')
    p1.textContent = '第二段'

    docTw.appendChild(p0)
    docTw.appendChild(p1)

    const strongEl = p0.querySelector('strong')!

    const container = (body.querySelector(`.${DOC_TW_CLASS}`) as HTMLElement) || body
    const children = Array.from(container.children)

    let targetIndex = -1
    for (let i = 0; i < children.length; i++) {
      if (children[i].contains(strongEl)) {
        targetIndex = i
        break
      }
    }

    expect(targetIndex).toBe(0)
  })
})
