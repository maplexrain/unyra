import { Vim } from '@replit/codemirror-vim'
import { triggerShortcutAction } from './shortcuts'
import { foldCurrentScope, unfoldCurrentScope, foldAll, unfoldAll } from './cmFoldScope'
import { openVimTutor } from './vimTutorState'
import { toggleEditorPreview } from '../components/learn/editor/LiveSplitPreview'
import { toggleAgentPanel, sendAgentMessage } from './agentFocus'
import { EditorView } from '@codemirror/view'

export interface VimEditorBridge {
  onSave?: (force?: boolean) => Promise<boolean | void> | boolean | void
  onClose?: (force?: boolean) => void
  onCloseOthers?: (force?: boolean) => void
  onNewTab?: () => void
  onNextTab?: () => void
  onPrevTab?: () => void
  onSplit?: (direction: 'horizontal' | 'vertical') => void
  onOnly?: () => void
  onReload?: () => void
  getView?: () => EditorView | null
}

export interface GlobalTabOperations {
  closeTab?: (force?: boolean) => void
  closeOtherTabs?: (force?: boolean) => void
  newTab?: () => void
  nextTab?: () => void
  prevTab?: () => void
  split?: (direction: 'horizontal' | 'vertical') => void
  only?: () => void
}

let activeBridge: VimEditorBridge | null = null
let globalTabOps: GlobalTabOperations | null = null

/**
 * 登记当前活跃的编辑器桥接对象（提供直接保存、关闭、分屏等功能支持）
 */
export function setVimEditorBridge(bridge: VimEditorBridge | null): void {
  activeBridge = bridge
}

export function getVimEditorBridge(): VimEditorBridge | null {
  return activeBridge
}

/**
 * 登记工作区全局 Tab 操作接口（供结构页面、思维导图等非编辑页面调度）
 */
export function setGlobalTabOperations(ops: GlobalTabOperations | null): void {
  globalTabOps = ops
}

export function getGlobalTabOperations(): GlobalTabOperations | null {
  return globalTabOps
}

/**
 * 自动校正滚动，让光标所在行尽量在画面垂直中间 (CodeMirror scrollIntoView center)
 */
export function scrollCursorToCenter(view?: EditorView | null): boolean {
  if (!view) return false
  try {
    const pos = view.state?.selection?.main?.head ?? 0
    if (typeof EditorView.scrollIntoView === 'function') {
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
      return true
    }
    return false
  } catch {
    return false
  }
}

/** 显示 Vim 风格的确认/提示通知 */
function showVimNotice(cm: any, message: string): void {
  // 安全防护：兜底保护 currentNotificationClose，彻底防止 dialog 为空时触发 .remove() 报错
  if (cm?.state && typeof cm.state.currentNotificationClose === 'function') {
    const origClose = cm.state.currentNotificationClose
    cm.state.currentNotificationClose = () => {
      try {
        origClose()
      } catch {
        // 安全抑制
      }
    }
  }

  if (typeof cm?.openNotification === 'function') {
    try {
      // CodeMirror Vim 的 openNotification 要求 template 必须是 Node / HTMLElement（内部执行 appendChild）
      const el = document.createElement('span')
      el.textContent = message
      cm.openNotification(el, { bottom: true, duration: 2500 })
    } catch {
      // 容错
    }
  }
}

/** 辅助检测命令是否带有强制感叹号修饰 (如 :q!, :w!) */
function isForceCommand(params: any): boolean {
  if (!params) return false
  const arg = params.argString?.trim() || ''
  const inp = params.input || ''
  return arg.startsWith('!') || inp.includes('!')
}

let registered = false

/**
 * 注册与当前应用程序深度对应的 Vim 命令模式（Ex 冒号命令）：
 * - :w / :write -> 保存当前文档/源码 (:w! 强制保存)
 * - :q / :quit -> 关闭当前页签 (:q! 强制关闭不弹确认)
 * - :wq / :x / :xit -> 保存并关闭当前页签
 * - :tabnew / :tabe / :tabedit -> 新建页签
 * - :tabclose / :tabc -> 关闭当前页签 (:tabc! 强制关闭)
 * - :tabonly / :tabo -> 关闭其他标签页 (:tabo! 强制关闭其他)
 * - :tabnext / :tabn / :bnext / :bn -> 切换至下一个标签页
 * - :tabprev / :tabp / :bprev / :bp -> 切换至上一个标签页
 * - :split / :sp -> 水平分屏 (对偶预览或分屏浏览)
 * - :vsplit / :vs -> 垂直分屏 (对偶预览或分屏浏览)
 * - :only -> 仅保留当前分屏
 * - :bdelete / :bd -> 关闭当前缓冲页签 (:bd! 强制关闭)
 * - :tutor -> 打开交互式游戏化 Vim 闯关教学道场
 * - :find -> 呼起查找面板
 * - :replace -> 呼起替换面板
 * - :fold -> 快速折叠当前代码块 (对应 Ctrl-)
 * - :unfold -> 快速展开当前代码块 (对应 Ctrl=)
 * - :foldall -> 折叠所有代码块
 * - :unfoldall -> 展开所有代码块
 * - :help / :h -> 显示常用命令帮助提示
 */
export function registerVimExCommands(): void {
  if (registered) return
  registered = true

  // 1. :w / :write 保存文件
  Vim.defineEx('write', 'w', (cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onSave) {
      void activeBridge.onSave(force)
      showVimNotice(cm, '[已保存]')
      return
    }
    const ok = triggerShortcutAction('learn.save')
    showVimNotice(cm, ok ? '[已保存]' : '[未能保存]')
  })

  // 2. :q / :quit 关闭当前页签 (支持 :q! 强制退出)
  Vim.defineEx('quit', 'q', (_cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onClose) {
      activeBridge.onClose(force)
      return
    }
    triggerShortcutAction('learn.closeTab')
  })

  // 3. :wq 保存并关闭
  Vim.defineEx('wq', 'wq', (_cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onSave) {
      void activeBridge.onSave(force)
    } else {
      triggerShortcutAction('learn.save')
    }
    if (activeBridge?.onClose) {
      activeBridge.onClose(force)
    } else {
      triggerShortcutAction('learn.closeTab')
    }
  })

  // 4. :x / :xit 保存并关闭
  Vim.defineEx('xit', 'x', (_cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onSave) {
      void activeBridge.onSave(force)
    } else {
      triggerShortcutAction('learn.save')
    }
    if (activeBridge?.onClose) {
      activeBridge.onClose(force)
    } else {
      triggerShortcutAction('learn.closeTab')
    }
  })

  // 5. :tabnew / :tabedit / :tabe / :new 新建空白文件页签
  Vim.defineEx('tabedit', 'tabe', (cm) => {
    if (activeBridge?.onNewTab) {
      activeBridge.onNewTab()
      showVimNotice(cm, '[新建空白文件]')
      return
    }
    showVimNotice(cm, '[新建空白文件]')
  })
  Vim.defineEx('tabnew', 'tabnew', (cm) => {
    if (activeBridge?.onNewTab) {
      activeBridge.onNewTab()
      showVimNotice(cm, '[新建空白文件]')
      return
    }
    showVimNotice(cm, '[新建空白文件]')
  })
  Vim.defineEx('new', 'new', (cm) => {
    if (activeBridge?.onNewTab) {
      activeBridge.onNewTab()
      showVimNotice(cm, '[新建空白文件]')
      return
    }
    showVimNotice(cm, '[新建空白文件]')
  })

  // 6. :tabclose / :tabc 关闭页签 (:tabc! 强制关闭)
  Vim.defineEx('tabclose', 'tabc', (_cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onClose) {
      activeBridge.onClose(force)
      return
    }
    triggerShortcutAction('learn.closeTab')
  })

  // 7. :tabonly / :tabo 关闭其他页签
  Vim.defineEx('tabonly', 'tabo', (cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onCloseOthers) {
      activeBridge.onCloseOthers(force)
      showVimNotice(cm, '[已关闭其他页签]')
      return
    }
    if (globalTabOps?.closeOtherTabs) {
      globalTabOps.closeOtherTabs(force)
      showVimNotice(cm, '[已关闭其他页签]')
      return
    }
    showVimNotice(cm, '[关闭其他页签]')
  })

  // 8. :tabnext / :tabn / :bnext / :bn 下一个页签
  Vim.defineEx('tabnext', 'tabn', (cm) => {
    if (activeBridge?.onNextTab) {
      activeBridge.onNextTab()
      showVimNotice(cm, '[下一个页签]')
    }
  })
  Vim.defineEx('bnext', 'bn', (cm) => {
    if (activeBridge?.onNextTab) {
      activeBridge.onNextTab()
      showVimNotice(cm, '[下一个页签]')
    }
  })

  // 9. :tabprevious / :tabp / :bprev / :bp 上一个页签
  Vim.defineEx('tabprevious', 'tabp', (cm) => {
    if (activeBridge?.onPrevTab) {
      activeBridge.onPrevTab()
      showVimNotice(cm, '[上一个页签]')
    }
  })
  Vim.defineEx('bprev', 'bp', (cm) => {
    if (activeBridge?.onPrevTab) {
      activeBridge.onPrevTab()
      showVimNotice(cm, '[上一个页签]')
    }
  })

  // 10. :split / :sp 水平分屏
  Vim.defineEx('split', 'sp', (cm) => {
    if (activeBridge?.onSplit) {
      activeBridge.onSplit('horizontal')
      showVimNotice(cm, '[水平分屏]')
    }
  })

  // 11. :vsplit / :vs 垂直分屏
  Vim.defineEx('vsplit', 'vs', (cm) => {
    if (activeBridge?.onSplit) {
      activeBridge.onSplit('vertical')
      showVimNotice(cm, '[垂直分屏]')
    }
  })

  // 12. :only 仅保留当前分屏
  Vim.defineEx('only', 'on', (cm) => {
    if (activeBridge?.onOnly) {
      activeBridge.onOnly()
      showVimNotice(cm, '[仅保留当前分屏]')
    }
  })

  // 13. :bdelete / :bd 关闭当前缓冲区/页签
  Vim.defineEx('bdelete', 'bd', (_cm, params) => {
    const force = isForceCommand(params)
    if (activeBridge?.onClose) {
      activeBridge.onClose(force)
      return
    }
    triggerShortcutAction('learn.closeTab')
  })

  // 14. :tutor 打开交互式游戏化教学
  Vim.defineEx('tutor', 'tutor', (cm) => {
    openVimTutor()
    showVimNotice(cm, '[打开 Vim 闯关道场]')
  })

  // 15. :find 查找
  Vim.defineEx('find', 'find', () => {
    triggerShortcutAction('doc.find')
  })

  // 16. :replace 替换
  Vim.defineEx('replace', 'replace', () => {
    triggerShortcutAction('doc.replace')
  })

  // 17. :fold 折叠当前代码块 (Ctrl-)
  Vim.defineEx('fold', 'fold', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      const ok = foldCurrentScope(view)
      showVimNotice(cm, ok ? '[代码块已折叠]' : '[无可折叠代码块]')
    }
  })

  // 18. :unfold 展开当前代码块 (Ctrl=)
  Vim.defineEx('unfold', 'unfold', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      const ok = unfoldCurrentScope(view)
      showVimNotice(cm, ok ? '[代码块已展开]' : '[无可展开代码块]')
    }
  })

  // 19. :foldall 全部折叠
  Vim.defineEx('foldall', 'foldall', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      foldAll(view)
      showVimNotice(cm, '[已全部折叠]')
    }
  })

  // 20. :unfoldall 全部展开
  Vim.defineEx('unfoldall', 'unfoldall', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      unfoldAll(view)
      showVimNotice(cm, '[已全部展开]')
    }
  })

  // 21. :help 帮助
  Vim.defineEx('help', 'h', (cm) => {
    showVimNotice(
      cm,
      ':w 保存 | :q 关闭 (:q! 强退) | :preview 预览 | :tabo 关其他 | :sp/:vs 分屏 | :tutor 学习 | Ctrl-/= 折叠/展开',
    )
  })

  // 22. :preview / :prev 切换编辑页面内置的双栏实时对照预览
  Vim.defineEx('preview', 'prev', (cm) => {
    toggleEditorPreview()
    showVimNotice(cm, '[切换分栏预览]')
  })

  // 23. :agent / :ag 快捷打开/收起导师栏，可选参数直接发消息
  Vim.defineEx('agent', 'ag', (cm, params) => {
    const rawArg = params?.argString?.trim() || ''
    if (rawArg) {
      sendAgentMessage(rawArg)
      showVimNotice(cm, `[已向导师发送: ${rawArg.slice(0, 16)}]`)
    } else {
      toggleAgentPanel()
    }
  })

  // 24. :center / :zz 光标所在行垂直居中
  Vim.defineEx('center', 'ce', (cm) => {
    const view: EditorView | null = cm?.cm6 ?? activeBridge?.getView?.()
    if (view && scrollCursorToCenter(view)) {
      showVimNotice(cm, '[光标行已居中]')
    }
  })
  Vim.defineEx('zz', 'zz', (cm) => {
    const view: EditorView | null = cm?.cm6 ?? activeBridge?.getView?.()
    if (view && scrollCursorToCenter(view)) {
      showVimNotice(cm, '[光标行已居中]')
    }
  })

  // 25. Vim 普通模式快捷键：zz、z. 自动校正滚动，让光标所在行尽量在画面垂直中间
  try {
    Vim.noremap('zz', ':center<CR>', 'normal')
    Vim.noremap('z.', ':center<CR>', 'normal')
  } catch {
    // 容错
  }
}

/**
 * 统一执行 Vim 冒号命令（供全局命令栏或快捷键调用）
 */
export function executeVimCommand(rawCmd: string): { success: boolean; message?: string } {
  const line = rawCmd.trim()
  if (!line) return { success: false }

  // 剔除开头的冒号 ':'
  const clean = line.startsWith(':') ? line.slice(1).trim() : line
  if (!clean) return { success: false }

  const parts = clean.split(/\s+/)
  const cmd = parts[0]
  const isForce = cmd.endsWith('!')
  const baseCmd = isForce ? cmd.slice(0, -1) : cmd

  switch (baseCmd) {
    case 'w':
    case 'write': {
      if (activeBridge?.onSave) {
        void activeBridge.onSave(isForce)
        return { success: true, message: '[已保存]' }
      }
      const ok = triggerShortcutAction('learn.save')
      return { success: ok, message: ok ? '[已保存]' : '[未能保存]' }
    }
    case 'q':
    case 'quit': {
      if (activeBridge?.onClose) {
        activeBridge.onClose(isForce)
        return { success: true }
      }
      if (globalTabOps?.closeTab) {
        globalTabOps.closeTab(isForce)
        return { success: true }
      }
      const ok = triggerShortcutAction('learn.closeTab')
      return { success: ok }
    }
    case 'wq':
    case 'x':
    case 'xit': {
      if (activeBridge?.onSave) {
        void activeBridge.onSave(isForce)
      } else {
        triggerShortcutAction('learn.save')
      }
      if (activeBridge?.onClose) {
        activeBridge.onClose(isForce)
      } else if (globalTabOps?.closeTab) {
        globalTabOps.closeTab(isForce)
      } else {
        triggerShortcutAction('learn.closeTab')
      }
      return { success: true }
    }
    case 'tabnew':
    case 'tabedit':
    case 'tabe':
    case 'new': {
      if (activeBridge?.onNewTab) {
        activeBridge.onNewTab()
        return { success: true, message: '[新建空白文件]' }
      }
      if (globalTabOps?.newTab) {
        globalTabOps.newTab()
        return { success: true, message: '[新建空白文件]' }
      }
      return { success: false, message: '[当前环境不支持新建页签]' }
    }
    case 'tabc':
    case 'tabclose':
    case 'bd':
    case 'bdelete': {
      if (activeBridge?.onClose) {
        activeBridge.onClose(isForce)
        return { success: true }
      }
      if (globalTabOps?.closeTab) {
        globalTabOps.closeTab(isForce)
        return { success: true }
      }
      const ok = triggerShortcutAction('learn.closeTab')
      return { success: ok }
    }
    case 'tabo':
    case 'tabonly': {
      if (activeBridge?.onCloseOthers) {
        activeBridge.onCloseOthers(isForce)
        return { success: true, message: '[已关闭其他页签]' }
      }
      if (globalTabOps?.closeOtherTabs) {
        globalTabOps.closeOtherTabs(isForce)
        return { success: true, message: '[已关闭其他页签]' }
      }
      return { success: false }
    }
    case 'tabn':
    case 'tabnext':
    case 'bn':
    case 'bnext': {
      if (activeBridge?.onNextTab) {
        activeBridge.onNextTab()
        return { success: true }
      }
      return { success: false }
    }
    case 'tabp':
    case 'tabprevious':
    case 'bp':
    case 'bprev': {
      if (activeBridge?.onPrevTab) {
        activeBridge.onPrevTab()
        return { success: true }
      }
      return { success: false }
    }
    case 'sp':
    case 'split': {
      if (activeBridge?.onSplit) {
        activeBridge.onSplit('horizontal')
        return { success: true, message: '[水平分屏]' }
      }
      return { success: false }
    }
    case 'vs':
    case 'vsplit': {
      if (activeBridge?.onSplit) {
        activeBridge.onSplit('vertical')
        return { success: true, message: '[垂直分屏]' }
      }
      return { success: false }
    }
    case 'only':
    case 'on': {
      if (activeBridge?.onOnly) {
        activeBridge.onOnly()
        return { success: true, message: '[仅保留当前分屏]' }
      }
      return { success: false }
    }
    case 'preview':
    case 'prev': {
      toggleEditorPreview()
      return { success: true, message: '[切换分栏预览]' }
    }
    case 'agent':
    case 'ag': {
      const msg = clean.slice(cmd.length).trim()
      if (msg) {
        sendAgentMessage(msg)
        return { success: true, message: `[已向导师发送: ${msg.slice(0, 16)}]` }
      }
      toggleAgentPanel()
      return { success: true }
    }
    case 'center':
    case 'zz': {
      const view = activeBridge?.getView?.()
      if (view && scrollCursorToCenter(view)) {
        return { success: true, message: '[光标行已居中]' }
      }
      return { success: false, message: '[当前无活动编辑器]' }
    }
    case 'tutor': {
      openVimTutor()
      return { success: true, message: '[打开 Vim 闯关道场]' }
    }
    case 'find': {
      triggerShortcutAction('doc.find')
      return { success: true }
    }
    case 'replace': {
      triggerShortcutAction('doc.replace')
      return { success: true }
    }
    case 'help':
    case 'h': {
      return {
        success: true,
        message: ':w 保存 | :q 关闭 | :preview 预览 | :agent 导师 | zz 居中 | :tabo 关其他 | :sp/:vs 分屏',
      }
    }
    default:
      return { success: false, message: `未知命令: :${baseCmd}` }
  }
}
