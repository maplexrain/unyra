import { Vim, vim } from '@replit/codemirror-vim'
import { triggerShortcutAction } from './shortcuts'
import { foldCurrentScope, unfoldCurrentScope, foldAll, unfoldAll } from './cmFoldScope'
import { openVimPage } from './vimPage'
import { toggleEditorPreview, swapEditorPreview } from '../components/learn/editor/previewBus'
import { toggleAgentPanel, sendAgentMessage } from './agentFocus'
import { toggleExplorer } from './explorerFocus'
import { EditorView } from '@codemirror/view'
import { executeOpenTarget } from './vimOpenTargets'
import { normalizeWebInput } from '../learn/webUrl'

export interface VimEditorBridge {
  onSave?: (force?: boolean) => Promise<boolean | void> | boolean | void
  onClose?: (force?: boolean) => void
  /** opts.skipDirty：有未保存改动的页签不关（跳过），而不是弹确认打断 */
  onCloseOthers?: (force?: boolean, opts?: { skipDirty?: boolean }) => void
  onNewTab?: () => void
  onNextTab?: () => void
  onPrevTab?: () => void
  onSplit?: (direction: 'horizontal' | 'vertical') => void
  onReload?: () => void
  getView?: () => EditorView | null
  onSetWrap?: (enable: boolean) => void
  isWrapEnabled?: () => boolean
}

export interface GlobalTabOperations {
  closeTab?: (force?: boolean) => void
  /** opts.skipDirty：有未保存改动的页签不关（跳过），而不是弹确认打断 */
  closeOtherTabs?: (force?: boolean, opts?: { skipDirty?: boolean }) => void
  newTab?: () => void
  nextTab?: () => void
  prevTab?: () => void
  setPure?: (pure: boolean) => void
  isPure?: () => boolean
  togglePure?: () => void
  openWebTab?: (url: string) => void
  switchToEdit?: () => { success: boolean; message?: string }
  switchToView?: () => { success: boolean; message?: string }
  markSelection?: () => { success: boolean; message?: string }
  commentSelection?: () => { success: boolean; message?: string }
  knowSelection?: () => { success: boolean; message?: string }
  studySelection?: () => { success: boolean; message?: string }
  askSelection?: (query?: string) => { success: boolean; message?: string }
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
 * - :split / :sp / :vsplit / :vs -> 展开分栏实时预览（与 :preview 相同）
 * - :only -> 仅保留当前分屏
 * - :bdelete / :bd -> 关闭当前缓冲页签 (:bd! 强制关闭)
 * - :find -> 呼起查找面板
 * - :replace -> 呼起替换面板
 * - :fold -> 快速折叠当前代码块 (对应 Ctrl-)
 * - :unfold -> 快速展开当前代码块 (对应 Ctrl=)
 * - :foldall -> 折叠所有代码块
 * - :unfoldall -> 展开所有代码块
 * - :help / :h -> 显示常用命令帮助提示
 */
/**
 * 优化 Vim 复制功能：确保所有 Vim 复制 (yank / y / yy) 直接复制到系统剪贴板
 */
export function setupVimSystemClipboard(): void {
  try {
    const rc = (Vim as any).getRegisterController?.()
    if (!rc || rc.__systemClipboardPatched) return
    rc.__systemClipboardPatched = true
    const origPushText = rc.pushText.bind(rc)
    rc.pushText = function (
      registerName: string | null | undefined,
      operator: string,
      text: string,
      linewise?: boolean,
      blockwise?: boolean,
    ) {
      origPushText(registerName, operator, text, linewise, blockwise)
      if (operator === 'yank' || !registerName || registerName === '"' || registerName === '+' || registerName === '*') {
        if (text && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(() => {})
        }
      }
    }
  } catch {
    // 忽略异常
  }
}

/**
 * 优化系统输入法和 Vim 命令的冲突：
 * 检测有效字符输入来匹配 Vim 行为；当处于输入法组词中时，阻止物理键盘按键误触发 Vim 命令
 */
export function setupVimImeProtection(): void {
  try {
    const vimAny = Vim as any
    if (vimAny.vimKeyFromEvent && !vimAny.__imeProtectionPatched) {
      vimAny.__imeProtectionPatched = true
      const origVimKey = vimAny.vimKeyFromEvent.bind(vimAny)
      vimAny.vimKeyFromEvent = function (e: KeyboardEvent, vimState: unknown) {
        if (
          e.isComposing ||
          e.keyCode === 229 ||
          e.key === 'Process' ||
          e.key === 'Unidentified' ||
          e.key === 'Dead'
        ) {
          return ''
        }
        return origVimKey(e, vimState)
      }
    }

    // 同时防御 codemirror-vim ViewPlugin keydown handler
    const ext = typeof vim === 'function' ? (vim() as any[]) : []
    const vp = ext.find((x) => x && x.domEventHandlers)
    if (vp?.domEventHandlers && !vp.domEventHandlers.__imePatched) {
      vp.domEventHandlers.__imePatched = true
      const origKeydown = vp.domEventHandlers.keydown
      vp.domEventHandlers.keydown = function (e: KeyboardEvent, view: any) {
        if (
          e.isComposing ||
          e.keyCode === 229 ||
          e.key === 'Process' ||
          e.key === 'Unidentified' ||
          e.key === 'Dead'
        ) {
          this.lastKeydown = 'Process'
          this.useNextTextInput = true
          return
        }
        return origKeydown.call(this, e, view)
      }
    }
  } catch {
    // 忽略异常
  }
}

export function registerVimExCommands(): void {
  setupVimSystemClipboard()
  setupVimImeProtection()
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
    if (globalTabOps?.closeTab) {
      globalTabOps.closeTab(force)
      return
    }
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

  // 7. :tabonly / :tabo 关闭其他页签（不带 ! 时跳过有未保存改动的页签，不弹确认）
  Vim.defineEx('tabonly', 'tabo', (cm, params) => {
    const force = isForceCommand(params)
    const opts = force ? undefined : { skipDirty: true }
    if (globalTabOps?.closeOtherTabs) {
      globalTabOps.closeOtherTabs(force, opts)
      showVimNotice(cm, '[已关闭其他页签]')
      return
    }
    if (activeBridge?.onCloseOthers) {
      activeBridge.onCloseOthers(force, opts)
      showVimNotice(cm, '[已关闭其他页签]')
      return
    }
    showVimNotice(cm, '[关闭其他页签]')
  })

  // 8. :tabnext / :tabn / :bnext / :bn 下一个页签
  Vim.defineEx('tabnext', 'tabn', (cm) => {
    if (globalTabOps?.nextTab) {
      globalTabOps.nextTab()
      showVimNotice(cm, '[下一个页签]')
      return
    }
    if (activeBridge?.onNextTab) {
      activeBridge.onNextTab()
      showVimNotice(cm, '[下一个页签]')
    }
  })
  Vim.defineEx('bnext', 'bn', (cm) => {
    if (globalTabOps?.nextTab) {
      globalTabOps.nextTab()
      showVimNotice(cm, '[下一个页签]')
      return
    }
    if (activeBridge?.onNextTab) {
      activeBridge.onNextTab()
      showVimNotice(cm, '[下一个页签]')
    }
  })

  // 9. :tabprevious / :tabp / :bprev / :bp 上一个页签
  Vim.defineEx('tabprevious', 'tabp', (cm) => {
    if (globalTabOps?.prevTab) {
      globalTabOps.prevTab()
      showVimNotice(cm, '[上一个页签]')
      return
    }
    if (activeBridge?.onPrevTab) {
      activeBridge.onPrevTab()
      showVimNotice(cm, '[上一个页签]')
    }
  })
  Vim.defineEx('bprev', 'bp', (cm) => {
    if (globalTabOps?.prevTab) {
      globalTabOps.prevTab()
      showVimNotice(cm, '[上一个页签]')
      return
    }
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

  // 12. :only 只留编辑栏（收起分栏预览）
  Vim.defineEx('only', 'on', (cm) => {
    toggleEditorPreview(false)
    showVimNotice(cm, '[仅保留编辑栏]')
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

  // 14. :vim / :cheat 打开 Vim 命令大全
  Vim.defineEx('vim', 'vim', (cm) => {
    openVimPage()
    showVimNotice(cm, '[打开 Vim 命令大全]')
  })
  Vim.defineEx('cheat', 'ch', (cm) => {
    openVimPage()
    showVimNotice(cm, '[打开 Vim 命令大全]')
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
      ':w 保存 | :q 关闭 (:q! 强退) | :preview 预览 | :resources 资源管理器 | :tabo 关其他 | :cheat 命令大全 | Ctrl-/= 折叠/展开',
    )
  })

  // 22. :preview / :prev 切换编辑页面内置的双栏实时对照预览；带 switch 参数对调编辑与预览的位置
  Vim.defineEx('preview', 'prev', (cm, params) => {
    const arg = params?.argString?.trim().toLowerCase() || ''
    if (arg === 'switch') {
      swapEditorPreview()
      showVimNotice(cm, '[已对调编辑与预览位置]')
      return
    }
    toggleEditorPreview()
    showVimNotice(cm, '[切换分栏预览]')
  })

  // 23. :resources / :res 切换左侧资源管理器的窄条 ↔ 完整栏
  Vim.defineEx('resources', 'res', (cm) => {
    const expanded = toggleExplorer()
    showVimNotice(
      cm,
      expanded === null ? '[当前没有资源管理器]' : expanded ? '[资源管理器已展开]' : '[资源管理器已收起]',
    )
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

  // 24. :focus / :fo 把焦点还给编辑器（编辑页才有编辑器；其它页面无可聚焦）
  Vim.defineEx('focus', 'fo', (cm) => {
    const view = activeBridge?.getView?.()
    if (view) {
      view.focus()
      showVimNotice(cm, '[焦点已交给编辑器]')
      return
    }
    showVimNotice(cm, '[当前没有编辑器]')
  })

  // 25. :edit / :e 切换为编辑模式
  Vim.defineEx('edit', 'e', (cm) => {
    if (globalTabOps?.switchToEdit) {
      const res = globalTabOps.switchToEdit()
      if (res.message) showVimNotice(cm, res.message)
    }
  })

  // 25b. :view / :read / :browse / :noedit 切换为浏览模式
  const onView = (cm: any) => {
    if (globalTabOps?.switchToView) {
      const res = globalTabOps.switchToView()
      if (res.message) showVimNotice(cm, res.message)
    }
  }
  Vim.defineEx('view', 'vi', onView)
  Vim.defineEx('read', 'rea', onView)
  Vim.defineEx('browse', 'brow', onView)
  Vim.defineEx('noedit', 'noe', onView)

  // 25c. :wrap / :nowrap 开启与关闭自动换行
  const onWrap = (cm: any) => {
    if (activeBridge?.onSetWrap) {
      activeBridge.onSetWrap(true)
      showVimNotice(cm, '[已开启自动换行]')
    } else {
      showVimNotice(cm, '[当前环境不支持设置换行]')
    }
  }
  const onNoWrap = (cm: any) => {
    if (activeBridge?.onSetWrap) {
      activeBridge.onSetWrap(false)
      showVimNotice(cm, '[已关闭自动换行]')
    } else {
      showVimNotice(cm, '[当前环境不支持设置换行]')
    }
  }
  Vim.defineEx('wrap', 'wra', onWrap)
  Vim.defineEx('nowrap', 'now', onNoWrap)

  // 26. :browser / :web 打开浏览器页签
  const onBrowser = (cm: any, params: any) => {
    const rawUrl = params?.argString?.trim() || ''
    const url = rawUrl ? normalizeWebInput(rawUrl) : ''
    if (globalTabOps?.openWebTab) {
      globalTabOps.openWebTab(url)
      showVimNotice(cm, url ? `[打开网页: ${url.slice(0, 20)}]` : '[打开浏览器页签]')
    }
  }
  Vim.defineEx('browser', 'brow', onBrowser)
  Vim.defineEx('web', 'web', onBrowser)

  // 27. :fullscreen / :fs / :zen 进入纯净阅读
  const onFullscreen = (cm: any) => {
    if (globalTabOps?.setPure) {
      globalTabOps.setPure(true)
      showVimNotice(cm, '[已进入纯净阅读模式]')
    }
  }
  Vim.defineEx('fullscreen', 'full', onFullscreen)
  Vim.defineEx('fs', 'fs', onFullscreen)
  Vim.defineEx('zen', 'zen', onFullscreen)

  // 28. :exitfullscreen / :unfs / :nozen 退出纯净阅读
  const onExitFullscreen = (cm: any) => {
    if (globalTabOps?.setPure) {
      globalTabOps.setPure(false)
      showVimNotice(cm, '[已退出纯净阅读模式]')
    }
  }
  Vim.defineEx('exitfullscreen', 'exitf', onExitFullscreen)
  Vim.defineEx('unfs', 'unfs', onExitFullscreen)
  Vim.defineEx('nozen', 'nozen', onExitFullscreen)

  // 29. :open / :o 打开目标
  Vim.defineEx('open', 'o', (cm, params) => {
    const arg = params?.argString?.trim() || ''
    const res = executeOpenTarget(arg)
    if (res.message) showVimNotice(cm, res.message)
  })

  // 30. 浏览模式划词专属命令 (:mark, :comment, :know, :study, :ask)
  Vim.defineEx('mark', 'mark', (cm) => {
    if (globalTabOps?.markSelection) {
      const res = globalTabOps.markSelection()
      if (res.message) showVimNotice(cm, res.message)
    }
  })
  Vim.defineEx('comment', 'comment', (cm) => {
    if (globalTabOps?.commentSelection) {
      const res = globalTabOps.commentSelection()
      if (res.message) showVimNotice(cm, res.message)
    }
  })
  Vim.defineEx('know', 'know', (cm) => {
    if (globalTabOps?.knowSelection) {
      const res = globalTabOps.knowSelection()
      if (res.message) showVimNotice(cm, res.message)
    }
  })
  Vim.defineEx('study', 'study', (cm) => {
    if (globalTabOps?.studySelection) {
      const res = globalTabOps.studySelection()
      if (res.message) showVimNotice(cm, res.message)
    }
  })
  Vim.defineEx('ask', 'ask', (cm, params) => {
    const q = params?.argString?.trim() || ''
    if (globalTabOps?.askSelection) {
      const res = globalTabOps.askSelection(q)
      if (res.message) showVimNotice(cm, res.message)
    }
  })

  // 31. Vim 普通模式快捷键：zz、z. 自动校正滚动，让光标所在行尽量在画面垂直中间
  try {
    Vim.noremap('zz', ':center<CR>', 'normal')
    Vim.noremap('z.', ':center<CR>', 'normal')
  } catch {
    // 容错
  }
}

export { executeVimCommand } from './vimExecutor'
