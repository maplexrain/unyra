/**
 * Vim 冒号命令执行器（供全局命令行与快捷键调度）：
 * 执行 :w, :q, :wq, :edit, :browser, :fullscreen, :open 等全局 Ex 命令。
 */

import { triggerShortcutAction } from './shortcuts'
import { openVimPage } from './vimPage'
import { toggleEditorPreview, swapEditorPreview } from '../components/learn/editor/previewBus'
import { toggleAgentPanel, sendAgentMessage } from './agentFocus'
import { toggleExplorer } from './explorerFocus'
import { getVimEditorBridge, getGlobalTabOperations, scrollCursorToCenter } from './vimCommands'
import { executeOpenTarget } from './vimOpenTargets'
import { normalizeWebInput } from '../learn/webUrl'

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

  const activeBridge = getVimEditorBridge()
  const globalTabOps = getGlobalTabOperations()

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
      if (globalTabOps?.closeTab) {
        globalTabOps.closeTab(isForce)
        return { success: true }
      }
      if (activeBridge?.onClose) {
        activeBridge.onClose(isForce)
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
      if (globalTabOps?.closeTab) {
        globalTabOps.closeTab(isForce)
        return { success: true }
      }
      if (activeBridge?.onClose) {
        activeBridge.onClose(isForce)
        return { success: true }
      }
      const ok = triggerShortcutAction('learn.closeTab')
      return { success: ok }
    }
    case 'tabo':
    case 'tabonly': {
      const opts = isForce ? undefined : { skipDirty: true }
      if (globalTabOps?.closeOtherTabs) {
        globalTabOps.closeOtherTabs(isForce, opts)
        return { success: true, message: '[已关闭其他页签]' }
      }
      if (activeBridge?.onCloseOthers) {
        activeBridge.onCloseOthers(isForce, opts)
        return { success: true, message: '[已关闭其他页签]' }
      }
      return { success: false }
    }
    case 'tabn':
    case 'tabnext':
    case 'bn':
    case 'bnext': {
      if (globalTabOps?.nextTab) {
        globalTabOps.nextTab()
        return { success: true }
      }
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
      if (globalTabOps?.prevTab) {
        globalTabOps.prevTab()
        return { success: true }
      }
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
      toggleEditorPreview(false)
      return { success: true, message: '[仅保留编辑栏]' }
    }
    case 'preview':
    case 'prev': {
      const arg = clean.slice(baseCmd.length).trim().toLowerCase()
      if (arg === 'switch') {
        swapEditorPreview()
        return { success: true, message: '[已对调编辑与预览位置]' }
      }
      toggleEditorPreview()
      return { success: true, message: '[切换分栏预览]' }
    }
    case 'resources':
    case 'res': {
      const expanded = toggleExplorer()
      if (expanded === null) return { success: false, message: '[当前没有资源管理器]' }
      return { success: true, message: expanded ? '[资源管理器已展开]' : '[资源管理器已收起]' }
    }
    case 'focus':
    case 'fo': {
      const view = activeBridge?.getView?.()
      if (!view) return { success: false, message: '[当前没有编辑器]' }
      view.focus()
      return { success: true, message: '[焦点已交给编辑器]' }
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
    case 'vim':
    case 'cheat': {
      openVimPage()
      return { success: true, message: '[打开 Vim 命令大全]' }
    }
    case 'find': {
      triggerShortcutAction('doc.find')
      return { success: true }
    }
    case 'replace': {
      triggerShortcutAction('doc.replace')
      return { success: true }
    }
    case 'edit':
    case 'e': {
      if (globalTabOps?.switchToEdit) {
        return globalTabOps.switchToEdit()
      }
      return { success: false, message: '[当前环境不支持切换编辑]' }
    }
    case 'view':
    case 'read':
    case 'browse':
    case 'noedit': {
      if (globalTabOps?.switchToView) {
        return globalTabOps.switchToView()
      }
      return { success: false, message: '[当前环境不支持切换浏览模式]' }
    }
    case 'wrap': {
      if (activeBridge?.onSetWrap) {
        activeBridge.onSetWrap(true)
        return { success: true, message: '[已开启自动换行]' }
      }
      return { success: false, message: '[当前环境不支持设置换行]' }
    }
    case 'nowrap': {
      if (activeBridge?.onSetWrap) {
        activeBridge.onSetWrap(false)
        return { success: true, message: '[已关闭自动换行]' }
      }
      return { success: false, message: '[当前环境不支持设置换行]' }
    }
    case 'set': {
      const opt = clean.slice(baseCmd.length).trim().toLowerCase()
      if (opt === 'wrap') {
        if (activeBridge?.onSetWrap) {
          activeBridge.onSetWrap(true)
          return { success: true, message: '[已开启自动换行]' }
        }
        return { success: false, message: '[当前环境不支持设置换行]' }
      }
      if (opt === 'nowrap') {
        if (activeBridge?.onSetWrap) {
          activeBridge.onSetWrap(false)
          return { success: true, message: '[已关闭自动换行]' }
        }
        return { success: false, message: '[当前环境不支持设置换行]' }
      }
      return { success: true, message: `[设置选项: ${opt}]` }
    }
    case 'browser':
    case 'web': {
      const rawUrl = clean.slice(baseCmd.length).trim()
      const url = rawUrl ? normalizeWebInput(rawUrl) : ''
      if (globalTabOps?.openWebTab) {
        globalTabOps.openWebTab(url)
        return { success: true, message: url ? `[打开网页: ${url.slice(0, 24)}]` : '[打开浏览器页签]' }
      }
      return { success: false, message: '[当前环境不支持打开浏览器]' }
    }
    case 'fullscreen':
    case 'zen':
    case 'fs': {
      if (globalTabOps?.setPure) {
        globalTabOps.setPure(true)
        return { success: true, message: '[已进入纯净阅读模式]' }
      }
      return { success: false }
    }
    case 'exitfullscreen':
    case 'unfullscreen':
    case 'nozen':
    case 'unfs': {
      if (globalTabOps?.setPure) {
        globalTabOps.setPure(false)
        return { success: true, message: '[已退出纯净阅读模式]' }
      }
      return { success: false }
    }
    case 'open':
    case 'o': {
      const arg = clean.slice(baseCmd.length).trim()
      return executeOpenTarget(arg)
    }
    case 'help':
    case 'h': {
      return {
        success: true,
        message: ':w 保存 | :q 关闭 | :edit 编辑 | :browser 浏览器 | :fullscreen 纯净阅读 | :open 打开目标 | :sp/:vs 分屏',
      }
    }
    default:
      return { success: false, message: `未知命令: :${baseCmd}` }
  }
}
