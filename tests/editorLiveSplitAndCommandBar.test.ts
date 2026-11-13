import { describe, it, expect } from 'vitest'
import {
  toggleEditorPreview,
  subscribeEditorPreview,
} from '../src/components/learn/editor/LiveSplitPreview'
import {
  executeVimCommand,
  setVimEditorBridge,
  setGlobalTabOperations,
} from '../src/lib/vimCommands'
import { viewOf, makeTab } from '../src/learn/tabs'

describe('双栏实时对照预览 (LiveSplitPreview) 与 Vim :preview 命令', () => {
  it('subscribeEditorPreview 能够正确接收 toggleEditorPreview 广播', () => {
    const received: (boolean | undefined)[] = []
    const unsubscribe = subscribeEditorPreview((force) => {
      received.push(force)
    })

    toggleEditorPreview()
    toggleEditorPreview(true)
    toggleEditorPreview(false)

    expect(received).toEqual([undefined, true, false])
    unsubscribe()

    toggleEditorPreview()
    expect(received.length).toBe(3)
  })

  it('executeVimCommand 支持 :preview 与 :prev 切换分栏预览', () => {
    let triggered = false
    const unsub = subscribeEditorPreview(() => {
      triggered = true
    })

    const res1 = executeVimCommand(':preview')
    expect(res1.success).toBe(true)
    expect(res1.message).toBe('[切换分栏预览]')
    expect(triggered).toBe(true)

    triggered = false
    const res2 = executeVimCommand(':prev')
    expect(res2.success).toBe(true)
    expect(res2.message).toBe('[切换分栏预览]')
    expect(triggered).toBe(true)

    unsub()
  })

  it('executeVimCommand 支持 :w, :q, :tabnew, :tabo, :sp, :vs 等常用指令', () => {
    let saved = false
    let closed = false
    let newTabbed = false
    let splitDir: string | null = null

    setVimEditorBridge({
      onSave: () => {
        saved = true
      },
      onClose: () => {
        closed = true
      },
      onNewTab: () => {
        newTabbed = true
      },
      onSplit: (dir) => {
        splitDir = dir
      },
    })

    const resW = executeVimCommand(':w')
    expect(resW.success).toBe(true)
    expect(saved).toBe(true)

    const resQ = executeVimCommand(':q!')
    expect(resQ.success).toBe(true)
    expect(closed).toBe(true)

    const resNew = executeVimCommand(':tabnew')
    expect(resNew.success).toBe(true)
    expect(newTabbed).toBe(true)

    const resSp = executeVimCommand(':sp')
    expect(resSp.success).toBe(true)
    expect(splitDir).toBe('horizontal')

    const resVs = executeVimCommand(':vs')
    expect(resVs.success).toBe(true)
    expect(splitDir).toBe('vertical')

    // 未知命令
    const resUnknown = executeVimCommand(':not_exist_cmd')
    expect(resUnknown.success).toBe(false)
    expect(resUnknown.message).toContain('未知命令')

    // 清理 bridge
    setVimEditorBridge(null)
  })

  it('在结构页面等非编辑器页面 (无 activeBridge) 下，输入 :tabo 命令通过 globalTabOps 成功关闭其他页签', () => {
    // 确保 activeBridge 为 null（模拟结构/大纲页面）
    setVimEditorBridge(null)

    let closedOthers = false
    let forceUsed = false

    setGlobalTabOperations({
      closeOtherTabs: (force) => {
        closedOthers = true
        forceUsed = !!force
      },
    })

    const resTabo = executeVimCommand(':tabo')
    expect(resTabo.success).toBe(true)
    expect(resTabo.message).toBe('[已关闭其他页签]')
    expect(closedOthers).toBe(true)
    expect(forceUsed).toBe(false)

    // 强退模式 :tabo!
    closedOthers = false
    const resTaboForce = executeVimCommand(':tabo!')
    expect(resTaboForce.success).toBe(true)
    expect(closedOthers).toBe(true)
    expect(forceUsed).toBe(true)

    setGlobalTabOperations(null)
  })

  it('笔记 (kind: note) 默认打开编辑页面 (view: source)', () => {
    const noteTab = makeTab({ kind: 'note', nodeId: 'node-1', note: '我的笔记' }, 100)
    expect(viewOf(noteTab)).toBe('source')
  })
})
