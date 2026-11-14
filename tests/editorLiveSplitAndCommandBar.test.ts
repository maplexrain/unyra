// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import ConfirmDialog from '../src/components/ConfirmDialog'
import {
  toggleEditorPreview,
  subscribeEditorPreview,
  subscribeEditorPreviewSwap,
} from '../src/components/learn/editor/previewBus'
import {
  executeVimCommand,
  setVimEditorBridge,
  setGlobalTabOperations,
} from '../src/lib/vimCommands'
import { setAgentMessenger, setAgentToggleHandler } from '../src/lib/agentFocus'
import { setExplorerToggleHandler } from '../src/lib/explorerFocus'
import { setVimPageOpener } from '../src/lib/vimPage'
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

  it(':preview switch 走对调广播，不触发开关广播', () => {
    let swapped = 0
    let toggles = 0
    const unsubSwap = subscribeEditorPreviewSwap(() => {
      swapped++
    })
    const unsubToggle = subscribeEditorPreview(() => {
      toggles++
    })

    const res = executeVimCommand(':preview switch')
    expect(res.success).toBe(true)
    expect(res.message).toBe('[已对调编辑与预览位置]')
    expect(swapped).toBe(1)
    expect(toggles).toBe(0)

    unsubSwap()
    unsubToggle()
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
    let lastOpts: { skipDirty?: boolean } | undefined

    setGlobalTabOperations({
      closeOtherTabs: (force, opts) => {
        closedOthers = true
        forceUsed = !!force
        lastOpts = opts
      },
    })

    const resTabo = executeVimCommand(':tabo')
    expect(resTabo.success).toBe(true)
    expect(resTabo.message).toBe('[已关闭其他页签]')
    expect(closedOthers).toBe(true)
    expect(forceUsed).toBe(false)
    // 不带 ! 的 :tabo 跳过未保存的页签（不弹确认），由 closeTab 那头执行
    expect(lastOpts).toEqual({ skipDirty: true })

    // 强退模式 :tabo!：不跳过，直接全关
    closedOthers = false
    const resTaboForce = executeVimCommand(':tabo!')
    expect(resTaboForce.success).toBe(true)
    expect(closedOthers).toBe(true)
    expect(forceUsed).toBe(true)
    expect(lastOpts).toBeUndefined()

    setGlobalTabOperations(null)
  })

  it(':resources 切换资源管理器的展开 / 收起；没人接时回一句指路', () => {
    // 模拟侧栏登记的切换把手：每喊一次翻转一次，返回切换后的展开状态
    let expanded = true
    setExplorerToggleHandler(() => {
      expanded = !expanded
      return expanded
    })

    // 展开 → 收起
    const res1 = executeVimCommand(':resources')
    expect(res1.success).toBe(true)
    expect(res1.message).toBe('[资源管理器已收起]')
    expect(expanded).toBe(false)

    // :res 短写再切回来：收起 → 展开
    const res2 = executeVimCommand(':res')
    expect(res2.success).toBe(true)
    expect(res2.message).toBe('[资源管理器已展开]')
    expect(expanded).toBe(true)

    // 侧栏不在场（纯阅读等场景）：有人喊没人接，回一句指路而不是装成功
    setExplorerToggleHandler(null)
    const resNone = executeVimCommand(':resources')
    expect(resNone.success).toBe(false)
    expect(resNone.message).toBe('[当前没有资源管理器]')
  })

  it('笔记 (kind: note) 默认打开编辑页面 (view: source)', () => {
    const noteTab = makeTab({ kind: 'note', nodeId: 'node-1', note: '我的笔记' }, 100)
    expect(viewOf(noteTab)).toBe('source')
  })

  it('executeVimCommand :agent 支持快捷打开/收起导师栏，并支持带参数直接发送消息', () => {
    let toggled = false
    let sentMessage: string | null = null

    setAgentToggleHandler({
      toggle: () => {
        toggled = true
      },
    })
    setAgentMessenger((msg) => {
      sentMessage = msg
    })

    // 1. 无参数切换导师栏
    const resToggle = executeVimCommand(':agent')
    expect(resToggle.success).toBe(true)
    expect(toggled).toBe(true)

    // 2. 带参数直接发消息
    const resSend = executeVimCommand(':agent 帮我生成新内容')
    expect(resSend.success).toBe(true)
    expect(resSend.message).toContain('已向导师发送')
    expect(sentMessage).toBe('帮我生成新内容')

    // 清理
    setAgentToggleHandler(null)
    setAgentMessenger(null)
  })

  it('executeVimCommand :center / :zz 支持光标行居中', () => {
    let centered = false
    setVimEditorBridge({
      getView: () =>
        ({
          state: {
            selection: { main: { head: 10 } },
          },
          dispatch: (tr: any) => {
            if (tr.effects) centered = true
          },
        }) as any,
    })

    const resCenter = executeVimCommand(':center')
    expect(resCenter.success).toBe(true)
    expect(resCenter.message).toBe('[光标行已居中]')
    expect(centered).toBe(true)

    centered = false
    const resZz = executeVimCommand(':zz')
    expect(resZz.success).toBe(true)
    expect(resZz.message).toBe('[光标行已居中]')
    expect(centered).toBe(true)

    setVimEditorBridge(null)
  })

  it('ConfirmDialog 支持 Tab 与方向键切换选项，Enter 确认当前选定项', async () => {
    let confirmed = false
    let extraClicked = false
    let cancelled = false

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        React.createElement(ConfirmDialog, {
          title: '测试确认',
          message: '未保存改动说明',
          confirmLabel: '保存',
          extraLabel: '放弃',
          onConfirm: () => {
            confirmed = true
          },
          onExtra: () => {
            extraClicked = true
          },
          onCancel: () => {
            cancelled = true
          },
        }),
      )
    })

    // 挂载时选项按钮自动获取焦点（默认保存确认按钮处于 document.activeElement）
    expect(document.activeElement?.textContent).toContain('保存')

    // 默认聚焦 confirm：按 ArrowLeft 切换到 extra (次级按钮)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    })

    // 切换后 extra 按钮自动获得焦点
    expect(document.activeElement?.textContent).toContain('放弃')

    // 按 Enter，触发当前选中的 extra
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(extraClicked).toBe(true)
    expect(confirmed).toBe(false)

    // 再按 ArrowRight 切换回 confirm
    extraClicked = false
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    })
    expect(document.activeElement?.textContent).toContain('保存')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(confirmed).toBe(true)
    expect(extraClicked).toBe(false)
    expect(cancelled).toBe(false)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('executeVimCommand :vim, :cheat 打开 Vim 命令大全页签（闯关道场已删除，:tutor 成为未知命令）', () => {
    let opened = 0
    setVimPageOpener(() => {
      opened++
    })

    // 1. :vim 打开命令大全
    const resVim = executeVimCommand(':vim')
    expect(resVim.success).toBe(true)
    expect(opened).toBe(1)

    // 2. :cheat 打开命令大全
    const resCheat = executeVimCommand(':cheat')
    expect(resCheat.success).toBe(true)
    expect(opened).toBe(2)

    // 3. :tutor 随闯关道场一并删除：落到未知命令
    const resTutor = executeVimCommand(':tutor')
    expect(resTutor.success).toBe(false)
    expect(resTutor.message).toContain('未知命令')
    expect(opened).toBe(2)

    setVimPageOpener(null)
  })
})
