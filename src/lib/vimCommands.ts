import { Vim } from '@replit/codemirror-vim'
import { triggerShortcutAction } from './shortcuts'
import { foldCurrentScope, unfoldCurrentScope, foldAll, unfoldAll } from './cmFoldScope'
import type { EditorView } from '@codemirror/view'

export interface VimEditorBridge {
  onSave?: () => Promise<boolean | void> | boolean | void
  onClose?: () => void
  getView?: () => EditorView | null
}

let activeBridge: VimEditorBridge | null = null

/**
 * 登记当前活跃的编辑器桥接对象（提供直接保存与关闭支持）
 */
export function setVimEditorBridge(bridge: VimEditorBridge | null): void {
  activeBridge = bridge
}

export function getVimEditorBridge(): VimEditorBridge | null {
  return activeBridge
}

/** 显示 Vim 风格的确认/提示通知 */
function showVimNotice(cm: any, message: string): void {
  if (typeof cm?.openNotification === 'function') {
    try {
      cm.openNotification(message, { bottom: true, duration: 2500 })
    } catch {
      // 容错
    }
  }
}

let registered = false

/**
 * 注册与当前应用程序对应的 Vim 命令模式（Ex 冒号命令）：
 * - :w / :write -> 保存当前文档/源码
 * - :q / :quit -> 关闭当前页签
 * - :wq / :x / :xit -> 保存并关闭当前页签
 * - :tabnew / :tabe / :tabedit -> 新建页签
 * - :tabclose / :tabc -> 关闭当前页签
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
  Vim.defineEx('write', 'w', (cm) => {
    if (activeBridge?.onSave) {
      void activeBridge.onSave()
      showVimNotice(cm, '[已保存]')
      return
    }
    const ok = triggerShortcutAction('learn.save')
    showVimNotice(cm, ok ? '[已保存]' : '[未能保存]')
  })

  // 2. :q / :quit 关闭当前页签
  Vim.defineEx('quit', 'q', (_cm) => {
    if (activeBridge?.onClose) {
      activeBridge.onClose()
      return
    }
    triggerShortcutAction('learn.closeTab')
  })

  // 3. :wq 保存并关闭
  Vim.defineEx('wq', 'wq', (_cm) => {
    if (activeBridge?.onSave) {
      void activeBridge.onSave()
    } else {
      triggerShortcutAction('learn.save')
    }
    if (activeBridge?.onClose) {
      activeBridge.onClose()
    } else {
      triggerShortcutAction('learn.closeTab')
    }
  })

  // 4. :x / :xit 保存并关闭
  Vim.defineEx('xit', 'x', (_cm) => {
    if (activeBridge?.onSave) {
      void activeBridge.onSave()
    } else {
      triggerShortcutAction('learn.save')
    }
    if (activeBridge?.onClose) {
      activeBridge.onClose()
    } else {
      triggerShortcutAction('learn.closeTab')
    }
  })

  // 5. :tabnew / :tabedit / :tabe 新建页签
  Vim.defineEx('tabedit', 'tabe', (cm) => {
    triggerShortcutAction('web.newTab')
    showVimNotice(cm, '[新建页签]')
  })
  Vim.defineEx('tabnew', 'tabnew', (cm) => {
    triggerShortcutAction('web.newTab')
    showVimNotice(cm, '[新建页签]')
  })

  // 6. :tabclose / :tabc 关闭页签
  Vim.defineEx('tabclose', 'tabc', (_cm) => {
    if (activeBridge?.onClose) {
      activeBridge.onClose()
      return
    }
    triggerShortcutAction('learn.closeTab')
  })

  // 7. :find 查找
  Vim.defineEx('find', 'find', () => {
    triggerShortcutAction('doc.find')
  })

  // 8. :replace 替换
  Vim.defineEx('replace', 'replace', () => {
    triggerShortcutAction('doc.replace')
  })

  // 9. :fold 折叠当前代码块 (Ctrl-)
  Vim.defineEx('fold', 'fold', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      const ok = foldCurrentScope(view)
      showVimNotice(cm, ok ? '[代码块已折叠]' : '[无可折叠代码块]')
    }
  })

  // 10. :unfold 展开当前代码块 (Ctrl=)
  Vim.defineEx('unfold', 'unfold', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      const ok = unfoldCurrentScope(view)
      showVimNotice(cm, ok ? '[代码块已展开]' : '[无可展开代码块]')
    }
  })

  // 11. :foldall 全部折叠
  Vim.defineEx('foldall', 'foldall', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      foldAll(view)
      showVimNotice(cm, '[已全部折叠]')
    }
  })

  // 12. :unfoldall 全部展开
  Vim.defineEx('unfoldall', 'unfoldall', (cm) => {
    const view = activeBridge?.getView?.() || cm?.cm6
    if (view) {
      unfoldAll(view)
      showVimNotice(cm, '[已全部展开]')
    }
  })

  // 13. :help 帮助
  Vim.defineEx('help', 'h', (cm) => {
    showVimNotice(
      cm,
      ':w 保存 | :q 关闭 | :wq 保存关闭 | :tabnew 新建 | :fold 折叠 | :unfold 展开 | Ctrl- / Ctrl= 快速折叠/展开',
    )
  })
}
