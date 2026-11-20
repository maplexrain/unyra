// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  executeVimCommand,
  setGlobalTabOperations,
  setVimEditorBridge,
  setupVimSystemClipboard,
  setupVimImeProtection,
} from '../src/lib/vimCommands'
import { Vim } from '@replit/codemirror-vim'
import { makeTab, isTabPinned, closeTabs } from '../src/learn/tabs'
import { openInGroup } from '../src/learn/groups'
import type { DocWorkspace } from '../src/learn/groups/types'
import { useBrowseVim } from '../src/components/learn/workspace/useBrowseVim'
import { BrowseSmoothCursor } from '../src/components/learn/workspace/browseSmoothCursor'
import { setVimEnabled } from '../src/lib/vimSettings'
import { setGlobalCommandBarOpener } from '../src/lib/commandBarFocus'
import type { LearnStore } from '../src/learn/types'

describe('tab 打开与排序规则', () => {
  it('结构(outline)与智能体团队(agentTeam)始终固定在左侧，普通 Tab (teach/note 等) 默认不固定', () => {
    const tabOutline = makeTab({ kind: 'outline', nodeId: 'n1' }, 0)
    const tabAgentTeam = makeTab({ kind: 'agentTeam', goalId: 'g1' }, 0)
    const tabTeach = makeTab({ kind: 'teach', nodeId: 'n2' }, 1)
    const tabNote = makeTab({ kind: 'note', nodeId: 'n3', note: '随笔' }, 2)

    expect(isTabPinned(tabOutline)).toBe(true)
    expect(isTabPinned(tabAgentTeam)).toBe(true)
    expect(isTabPinned(tabTeach)).toBe(false)
    expect(isTabPinned(tabNote)).toBe(false)

    let docs: DocWorkspace = {
      layout: { kind: 'group', group: 'g1' },
      groups: [{ id: 'g1', tabs: [], active: null }],
      focus: 'g1',
    }

    // 依次打开结构、教学文档、笔记
    docs = openInGroup(docs, 'g1', { kind: 'outline', nodeId: 'n1' }, 0)
    docs = openInGroup(docs, 'g1', { kind: 'teach', nodeId: 'n2' }, 1)
    docs = openInGroup(docs, 'g1', { kind: 'note', nodeId: 'n3', note: '随笔' }, 2)

    const tabIds = docs.groups[0].tabs.map((t) => t.id)
    expect(tabIds).toEqual(['o:n1', 't:n2', 'n:n3:随笔'])

    // 再打开一个外部文件与新的教学文档
    docs = openInGroup(docs, 'g1', { kind: 'local', path: '/workspace/test.ts' }, 3)
    docs = openInGroup(docs, 'g1', { kind: 'teach', nodeId: 'n4' }, 4)

    const finalTabIds = docs.groups[0].tabs.map((t) => t.id)
    expect(finalTabIds).toEqual(['o:n1', 't:n2', 'n:n3:随笔', 'l:/workspace/test.ts', 't:n4'])
  })
})

describe(':tabo 命令在外部文件与全局环境下的调度', () => {
  beforeEach(() => {
    setGlobalTabOperations(null)
    setVimEditorBridge(null)
  })

  it('优先使用 globalTabOps.closeOtherTabs，防止旧 activeBridge 劫持保留错误页签', () => {
    const bridgeCloseOthers = vi.fn()
    const globalCloseOthers = vi.fn()

    // 模拟之前某个教学文档遗留的 activeBridge
    setVimEditorBridge({
      onCloseOthers: bridgeCloseOthers,
    })

    // 工作区当前激活的外部文件通过 globalTabOps 注入
    setGlobalTabOperations({
      closeOtherTabs: globalCloseOthers,
    })

    const res = executeVimCommand(':tabo')
    expect(res.success).toBe(true)
    // 必须调用当前工作区的 globalCloseOthers，而不是遗留的 bridgeCloseOthers
    expect(globalCloseOthers).toHaveBeenCalledTimes(1)
    expect(bridgeCloseOthers).not.toHaveBeenCalled()
  })

  it(':q 命令优先使用 globalTabOps.closeTab', () => {
    const bridgeClose = vi.fn()
    const globalClose = vi.fn()

    setVimEditorBridge({
      onClose: bridgeClose,
    })
    setGlobalTabOperations({
      closeTab: globalClose,
    })

    const res = executeVimCommand(':q')
    expect(res.success).toBe(true)
    expect(globalClose).toHaveBeenCalledTimes(1)
    expect(bridgeClose).not.toHaveBeenCalled()
  })

  it('在普通文档中执行 :tabo 时，拓扑图页签 (kind === outline) 豁免关闭，不被移除', () => {
    const tabOutline = makeTab({ kind: 'outline', nodeId: 'n1' }, 0)
    const tabTeach1 = makeTab({ kind: 'teach', nodeId: 'n2' }, 1)
    const tabTeach2 = makeTab({ kind: 'teach', nodeId: 'n3' }, 2)
    const tabNote = makeTab({ kind: 'note', nodeId: 'n4', note: '随笔' }, 3)

    const tabs = [tabOutline, tabTeach1, tabTeach2, tabNote]

    // 当前激活 tabTeach1，执行关闭其他 (others / :tabo)
    const res = closeTabs(tabs, tabTeach1.id, 'others', tabTeach1.id)
    const keptIds = res.tabs.map((t) => t.id)

    // tabTeach1 自身保留，tabOutline（拓扑图/大纲）也必须保留！其他普通文档 tabTeach2 和 tabNote 被关闭
    expect(keptIds).toContain(tabTeach1.id)
    expect(keptIds).toContain(tabOutline.id)
    expect(keptIds).not.toContain(tabTeach2.id)
    expect(keptIds).not.toContain(tabNote.id)
  })

  it('在拓扑图页签自身执行 :tabo 时，拓扑图保留，其他普通文档页签全部关闭', () => {
    const tabOutline = makeTab({ kind: 'outline', nodeId: 'n1' }, 0)
    const tabTeach1 = makeTab({ kind: 'teach', nodeId: 'n2' }, 1)
    const tabNote = makeTab({ kind: 'note', nodeId: 'n3', note: '随笔' }, 2)

    const tabs = [tabOutline, tabTeach1, tabNote]

    // 当前在拓扑图页签，执行 :tabo
    const res = closeTabs(tabs, tabOutline.id, 'others', tabOutline.id)
    const keptIds = res.tabs.map((t) => t.id)

    expect(keptIds).toEqual([tabOutline.id])
    expect(res.active).toBe(tabOutline.id)
  })
})

describe('Vim 剪贴板同步与输入法 IME 防护', () => {
  it('setupVimSystemClipboard 确保所有 yank 操作自动写入系统剪贴板', () => {
    setupVimSystemClipboard()
    const rc = (Vim as any).getRegisterController?.()
    expect(rc).toBeDefined()

    const mockClipboardWrite = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: mockClipboardWrite,
      },
    })

    // 模拟 Vim 普通模式下 yank 操作
    rc.pushText(null, 'yank', '要复制的高价值文档段落')

    expect(mockClipboardWrite).toHaveBeenCalledWith('要复制的高价值文档段落')
  })

  it('setupVimImeProtection 在输入法组词及 process/229 时阻断物理键被当作 Vim 命令', () => {
    setupVimImeProtection()
    const vimAny = Vim as any
    expect(typeof vimAny.vimKeyFromEvent).toBe('function')

    // 1. isComposing 为 true 时（中文输入法拼音组词中）
    const composingEvent = {
      isComposing: true,
      key: 'j',
      keyCode: 229,
    } as any
    expect(vimAny.vimKeyFromEvent(composingEvent, {})).toBe('')

    // 2. keyCode === 229 时
    const code229Event = {
      isComposing: false,
      key: 'k',
      keyCode: 229,
    } as any
    expect(vimAny.vimKeyFromEvent(code229Event, {})).toBe('')

    // 3. key === 'Process' 时
    const processEvent = {
      isComposing: false,
      key: 'Process',
      keyCode: 0,
    } as any
    expect(vimAny.vimKeyFromEvent(processEvent, {})).toBe('')

    // 4. 正常英文字符输入（非组词态）应正确返回有效字符
    const normalEvent = {
      isComposing: false,
      key: 'j',
      keyCode: 74,
    } as any
    expect(vimAny.vimKeyFromEvent(normalEvent, {})).toBe('j')
  })

  it('useBrowseVim 在输入法合成态下绝不拦截按键，在有效字符下支持可视模式与复制', async () => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    setVimEnabled(true)
    const toastFn = vi.fn()
    const mockClipboardWrite = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: mockClipboardWrite,
      },
    })

    const dummyStore: LearnStore = {
      docArea: {
        layout: { kind: 'group', group: 'g1' },
        groups: [
          {
            id: 'g1',
            tabs: [{ id: 't1', kind: 'teach', nodeId: 'n1', view: 'preview' as const }],
            active: 't1',
          },
        ],
        focus: 'g1',
      },
    } as any

    function TestComp() {
      useBrowseVim({
        getLatest: () => dummyStore,
        onToast: toastFn,
      })
      return React.createElement(
        'div',
        { 'data-doc-area': 'g1', 'data-doc-area-focus': 'true' },
        React.createElement(
          'div',
          { 'data-doc-pane': 'active' },
          React.createElement('p', { id: 'test-p' }, '第一行测试段落'),
        ),
      )
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(TestComp))
    })

    // 1. 输入法合成态按键测试：isComposing: true 或 keyCode: 229 时，不阻止默认行为
    const imeEvent = new KeyboardEvent('keydown', {
      key: 'j',
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(imeEvent, 'isComposing', { value: true })
    window.dispatchEvent(imeEvent)
    expect(imeEvent.defaultPrevented).toBe(false)

    // 2. 正常按下 'v' 键进入可视模式
    const vEvent = new KeyboardEvent('keydown', {
      key: 'v',
      keyCode: 86,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(vEvent)
    expect(vEvent.defaultPrevented).toBe(true)
    expect(toastFn).toHaveBeenCalledWith('-- 可视模式 (VISUAL) --')

    // 3. 选中一段文字后按 'y' 复制到系统剪贴板
    const pEl = document.getElementById('test-p')
    const range = document.createRange()
    if (pEl?.firstChild) {
      range.selectNodeContents(pEl.firstChild)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }

    const yEvent = new KeyboardEvent('keydown', {
      key: 'y',
      keyCode: 89,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(yEvent)
    expect(yEvent.defaultPrevented).toBe(true)
    expect(mockClipboardWrite).toHaveBeenCalledWith('第一行测试段落')

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('BrowseSmoothCursor 支持平滑位移、跟随拖尾并在位移中保持常亮不闪烁', async () => {
    vi.useFakeTimers()
    const cursor = new BrowseSmoothCursor()
    const area = document.createElement('div')
    area.setAttribute('data-doc-area', 'g1')
    area.setAttribute('data-doc-area-focus', 'true')
    const container = document.createElement('div')
    container.setAttribute('data-doc-pane', 'active')
    const p1 = document.createElement('p')
    p1.textContent = '文字第一行'
    const p2 = document.createElement('p')
    p2.textContent = '文字第二行'
    container.appendChild(p1)
    container.appendChild(p2)
    area.appendChild(container)
    document.body.appendChild(area)

    container.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    })

    const range1 = document.createRange()
    range1.setStart(p1.firstChild!, 0)
    range1.collapse(true)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range1)

    // 初次落位
    cursor.update(sel, false)

    const virtualCursor = container.querySelector('.moji-browse-virtual-cursor') as HTMLElement
    const trail = container.querySelector('.moji-browse-cursor-trail') as HTMLElement
    expect(virtualCursor).not.toBeNull()
    expect(trail).not.toBeNull()

    // 移动光标至下一行
    const range2 = document.createRange()
    range2.setStart(p2.firstChild!, 0)
    range2.collapse(true)
    range2.getBoundingClientRect = () => ({
      left: 50,
      top: 80,
      width: 0,
      height: 20,
      right: 50,
      bottom: 100,
      x: 50,
      y: 80,
      toJSON: () => {},
    })
    sel.removeAllRanges()
    sel.addRange(range2)

    cursor.update(sel, false)

    // 移动时必须移除脉冲闪烁类，保持常亮（不闪烁，清晰可见）
    expect(virtualCursor.classList.contains('moji-browse-cursor-blink')).toBe(false)
    expect(virtualCursor.style.opacity).toBe('1')

    // 静止 450ms 后恢复闪烁
    vi.advanceTimersByTime(500)
    expect(virtualCursor.classList.contains('moji-browse-cursor-blink')).toBe(true)

    cursor.destroy()
    area.remove()
    vi.useRealTimers()
  })

  it('在智能体团队页面中彻底禁用 Vim 模式按键拦截，但保留非输入区冒号唤出命令栏', async () => {
    const openerMock = vi.fn()
    setGlobalCommandBarOpener(openerMock)

    const teamStore: LearnStore = {
      docArea: {
        layout: { kind: 'group', group: 'g1' },
        groups: [
          {
            id: 'g1',
            tabs: [{ id: 'team:all', ref: { kind: 'agentTeam' }, view: 'preview' as const }],
            active: 'team:all',
          },
        ],
        focus: 'g1',
      },
    } as any

    function TeamComp() {
      useBrowseVim({
        getLatest: () => teamStore,
      })
      return React.createElement(
        'div',
        { 'data-agent-team-page': 'true' },
        React.createElement('textarea', { id: 'team-input' }),
        React.createElement('button', { id: 'team-btn' }, '按钮'),
      )
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(TeamComp))
    })

    const textarea = document.getElementById('team-input') as HTMLTextAreaElement
    const button = document.getElementById('team-btn') as HTMLButtonElement

    // 1. 普通 Vim 按键 (如 'j', 'k', 'v') 绝不被拦截
    const jEvent = new KeyboardEvent('keydown', {
      key: 'j',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(jEvent)
    expect(jEvent.defaultPrevented).toBe(false)

    // 2. 非输入元素下按下 ':' 能够唤出全局命令栏
    button.focus()
    const colonEvent = new KeyboardEvent('keydown', {
      key: ':',
      bubbles: true,
      cancelable: true,
    })
    button.dispatchEvent(colonEvent)
    expect(colonEvent.defaultPrevented).toBe(true)
    expect(openerMock).toHaveBeenCalledWith({ mode: ':', prefill: '' })

    // 3. 在输入框内部按下 ':' 绝不唤出全局命令栏，不阻止默认输入
    openerMock.mockClear()
    textarea.focus()
    const colonInInputEvent = new KeyboardEvent('keydown', {
      key: ':',
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(colonInInputEvent)
    expect(colonInInputEvent.defaultPrevented).toBe(false)
    expect(openerMock).not.toHaveBeenCalled()

    setGlobalCommandBarOpener(null)
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})

