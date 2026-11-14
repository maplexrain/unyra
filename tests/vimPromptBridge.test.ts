// @vitest-environment happy-dom
/**
 * 编辑器命令行接管桥（lib/commandBarFocus 的 installVimPromptBridge）的集成用例。
 *
 * 统一命令输入框之后，编辑器里的 `:` 不再打开 CodeMirror 原生命令面板，
 * 而是唤起全局命令栏（GlobalVimCommandBar）——这里用**真实 vim() 扩展**钉住契约：
 * - 冒号模板被接管（原生面板不再出现），'/' 搜索提示回落原生面板；
 * - Enter：输入文本经交回通道回到 vim 的回调（processCommand 那条路），且只交回一次；
 * - 取消（undefined）：回调不触发，vim 的命令行状态被清干净（后续按键不卡死）；
 * - 重复安装幂等。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { Vim, vim } from '@replit/codemirror-vim'
import {
  installVimPromptBridge,
  setGlobalCommandBarOpener,
  type CommandBarOpenOpts,
} from '../src/lib/commandBarFocus'

/** 模拟 vim-core showPrompt 传给 openDialog 的 options（Esc 分支自清） */
const promptOptions = {
  onKeyDown: (e: KeyboardEvent, _input: string, close: () => void) => {
    if (e.key === 'Escape') {
      close()
      return true
    }
    return false
  },
}

/** 造一个带 vim() 扩展的编辑器 */
function makeView(): EditorView {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return new EditorView({
    parent: host,
    state: EditorState.create({ doc: 'const a = 1\n', extensions: [vim()] }),
  })
}

type CmAdapter = {
  openDialog: (template: HTMLElement, callback?: (v?: string) => void, options?: object) => unknown
}

function cmOf(view: EditorView): CmAdapter {
  return (view as unknown as { cm: CmAdapter }).cm
}

/** 真 DOM 模板：textContent 是 vim 的提示符前缀（'/' 或 ':'） */
function templateOf(prefix: string): HTMLElement {
  const el = document.createElement('div')
  el.textContent = prefix
  return el
}

let received: string | undefined


describe('编辑器命令行接管桥', () => {
  beforeEach(() => {
    setGlobalCommandBarOpener(null)
    received = undefined
    document.body.innerHTML = ''
  })

  it('冒号模板被接管：唤起全局命令栏并带上交回通道；原生面板不出现', () => {
    const view = makeView()
    installVimPromptBridge(view)
    let captured: CommandBarOpenOpts | null = null
    setGlobalCommandBarOpener((o) => {
      captured = o ?? null
    })

    cmOf(view).openDialog(templateOf(':'), (v) => {
      received = v
    }, promptOptions)

    expect(captured).not.toBeNull()
    expect(captured!.prefill).toBe('')
    expect(typeof captured!.onFinish).toBe('function')
    expect(document.querySelector('.cm-vim-panel')).toBeNull()
  })

  it('Enter：输入文本经交回通道回到 vim 的回调；重复交回被拦（只执行一次）', () => {
    const view = makeView()
    installVimPromptBridge(view)
    let captured: CommandBarOpenOpts | null = null
    setGlobalCommandBarOpener((o) => {
      captured = o ?? null
    })

    cmOf(view).openDialog(templateOf(':'), (v) => {
      received = v
    }, promptOptions)

    captured!.onFinish!('w')
    expect(received).toBe('w')
    captured!.onFinish!('q')
    expect(received).toBe('w')
  })

  it('取消：交回 undefined 不调回调，且 vim 状态被清干净（后续按键不卡死）', () => {
    const view = makeView()
    installVimPromptBridge(view)
    let captured: CommandBarOpenOpts | null = null
    setGlobalCommandBarOpener((o) => {
      captured = o ?? null
    })
    const cm = cmOf(view)

    cm.openDialog(templateOf(':'), (v) => {
      received = v
    }, promptOptions)
    captured!.onFinish!(undefined)

    expect(received).toBeUndefined()
    // 取消之后 vim 还活着：进插入模式、再唤起命令行，都不抛错也不卡死
    expect(() => Vim.handleKey(cm as unknown as Parameters<typeof Vim.handleKey>[0], 'i', 'test')).not.toThrow()
    expect(() => Vim.handleKey(cm as unknown as Parameters<typeof Vim.handleKey>[0], ':', 'test')).not.toThrow()
  })

  it('端到端：编辑器里按 : 直接唤起全局命令栏，不开原生面板', () => {
    const view = makeView()
    installVimPromptBridge(view)
    let captured: CommandBarOpenOpts | null = null
    setGlobalCommandBarOpener((o) => {
      captured = o ?? null
    })
    const cm = cmOf(view)

    Vim.handleKey(cm as unknown as Parameters<typeof Vim.handleKey>[0], ':', 'test')

    expect(captured).not.toBeNull()
    expect(document.querySelector('.cm-vim-panel')).toBeNull()
  })

  it('搜索提示（/）不受接管影响：回落原生面板', () => {
    const view = makeView()
    installVimPromptBridge(view)
    let woken = 0
    setGlobalCommandBarOpener(() => {
      woken++
    })

    cmOf(view).openDialog(templateOf('/'), () => {}, {})

    expect(woken).toBe(0)
    expect(document.querySelector('.cm-vim-panel')).not.toBeNull()
  })

  it('幂等：重复安装不叠加包装', () => {
    const view = makeView()
    installVimPromptBridge(view)
    const first = cmOf(view).openDialog
    installVimPromptBridge(view)
    expect(cmOf(view).openDialog).toBe(first)
  })
})
