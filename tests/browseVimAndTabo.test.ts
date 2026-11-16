import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeVimCommand, setGlobalTabOperations, setVimEditorBridge } from '../src/lib/vimCommands'
import { makeTab, isTabPinned } from '../src/learn/tabs'
import { openInGroup } from '../src/learn/groups'
import type { DocWorkspace } from '../src/learn/groups/types'

describe('tab 打开与排序规则', () => {
  it('新打开的 Tab 永远放在末尾，不因类型 (outline/teach/note 等) 自动排序或自动固定', () => {
    const tabOutline = makeTab({ kind: 'outline', nodeId: 'n1' }, 0)
    const tabTeach = makeTab({ kind: 'teach', nodeId: 'n2' }, 1)
    const tabNote = makeTab({ kind: 'note', nodeId: 'n3', note: '随笔' }, 2)

    expect(isTabPinned(tabOutline)).toBe(false)
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
})
