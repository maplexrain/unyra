import { describe, it, expect } from 'vitest'
import {
  toggleEditorPreview,
  subscribeEditorPreview,
} from '../src/components/learn/editor/LiveSplitPreview'
import {
  executeVimCommand,
  setVimEditorBridge,
} from '../src/lib/vimCommands'

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
})
