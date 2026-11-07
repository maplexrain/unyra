/**
 * webview 的事件面：guest 指针事件桥（electron/guestPreload 上报 → 校验后转主窗口）、
 * 新窗口拦截、右键原生菜单、before-input-event 快捷键转发。
 */
import { BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { canOpenExternal } from '../../link-core'
import { mainWindow } from '../mainWindow'
import { t } from '../../i18n'
import type { WebTranslatePayload } from '../../../shared/ipc'
import { yieldDebuggerToDevtools } from './sessionCdp'

/**
 * 焦点在网页里也要能用的应用快捷键（guest 进程吃掉按键，宿主的 keydown 收不到，
 * 见 before-input-event 里的转发）：q = 聚焦导师，w = 关页签，l = 新建网页页签，
 * s = 保存，f / h = 查找 / 替换，e = 导出，F11 = 纯净阅读。
 * 复制 / 粘贴 / 全选那些组合故意不在列：那是网页自己的活，不抢。
 */
const FORWARD_KEYS = new Set(['q', 'w', 'l', 's', 'f', 'h', 'e', 'f11'])

/** 右键按下后的横向位移台账（wcId → 起点 x 与是否已算「划过」）：划过的右键不弹菜单 */
const markDrag = new Map<number, { x0: number; moved: boolean }>()

/**
 * guest 的指针事件上报（见 electron/guestPreload）：校验形状后原样转给主窗口，
 * 渲染层据此在对应的 <webview> 元素上合成可冒泡的 PointerEvent——「网页里触发的事件
 * 冒泡到宿主」走的就是这一条（右键横划换页签那一类手势因此能在网页页签里用）。
 * preload 只上报、不向页面世界暴露任何东西（contextIsolation 下页面摸不到它），
 * 所以这条通道的攻击面就只有「伪造指针事件」，伪造出来的也不过是让手势动一动。
 */
export function registerGuestInputIpc(): void {
  ipcMain.on('web:guest-input', (e, raw: unknown) => {
    const p = raw as Partial<Record<'type' | 'x' | 'y' | 'button' | 'buttons', unknown>> | null
    if (!p || typeof p !== 'object') return
    const type = p.type
    if (type !== 'pointerdown' && type !== 'pointermove' && type !== 'pointerup') return
    const { x, y, button, buttons } = p
    if (typeof x !== 'number' || typeof y !== 'number' || typeof button !== 'number' || typeof buttons !== 'number') return
    // 右键台账：划动判定在这里记一份——右键菜单由这里弹，只有它知道「刚刚是不是手势」
    if (type === 'pointerdown' && button === 2) markDrag.set(e.sender.id, { x0: x, moved: false })
    else if (type === 'pointermove' && button === 2) {
      const d = markDrag.get(e.sender.id)
      if (d && Math.abs(x - d.x0) >= 4) d.moved = true
    }
    mainWindow()?.webContents.send('web:guest-input', { type, x, y, button, buttons, wcId: e.sender.id })
  })
}

/** 页签挂上后的三件事件接线：新窗口拦截 / 右键原生菜单 / 快捷键转发（装配入口按序调用） */
export function attachGuestEventHandlers(contents: WebContents): void {
  // 网页想开新窗口：一律不开原生窗——http(s) 落成应用里的新 web 页签，mailto 给系统，
  // 其余（data:、blob:…）直接拒
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:')) void shell.openExternal(url)
    else if (canOpenExternal(url)) mainWindow()?.webContents.send('web:openTab', url)
    return { action: 'deny' }
  })

  /*
   * guest 的右键菜单：弹**原生菜单**（就落在网页里，而不是应用层再糊一张）。
   * 复制 / 粘贴用 role：它们作用于**聚焦的 WebContents**——右键此刻在 guest 里，正好。
   * 右键横划是换页签的手势（渲染层在文档区接；事件经 web:guest-input 上来）：
   * 划过了就不弹，否则每划一次都跳出一份菜单。
   */
  contents.on('context-menu', (e2, params) => {
    e2.preventDefault()
    const d = markDrag.get(contents.id)
    markDrag.delete(contents.id)
    if (d?.moved) return

    const selectedText = (params.selectionText ?? '').trim()
    const hasSelection = selectedText.length > 0

    const template: MenuItemConstructorOptions[] = []

    if (hasSelection) {
      template.push(
        {
          label: t('翻译选中文本'),
          submenu: [
            {
              label: t('⚡ 极速翻译（免费公用）'),
              click: () => {
                mainWindow()?.webContents.send('web:translate', {
                  wcId: contents.id,
                  mode: 'selection',
                  engine: 'fast',
                  text: selectedText,
                  x: params.x,
                  y: params.y,
                } satisfies WebTranslatePayload)
              },
            },
            {
              label: t('🤖 AI 深度翻译'),
              click: () => {
                mainWindow()?.webContents.send('web:translate', {
                  wcId: contents.id,
                  mode: 'selection',
                  engine: 'ai',
                  text: selectedText,
                  x: params.x,
                  y: params.y,
                } satisfies WebTranslatePayload)
              },
            },
          ],
        },
        { type: 'separator' },
      )
    }

    template.push(
      { label: t('复制'), role: 'copy', enabled: params.editFlags.canCopy },
      { label: t('粘贴'), role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      {
        label: t('整页双语翻译'),
        submenu: [
          {
            label: t('⚡ 极速双语翻译（免费公用）'),
            click: () => {
              mainWindow()?.webContents.send('web:translate', {
                wcId: contents.id,
                mode: 'page',
                engine: 'fast',
              } satisfies WebTranslatePayload)
            },
          },
          {
            label: t('🤖 AI 深度双语翻译'),
            click: () => {
              mainWindow()?.webContents.send('web:translate', {
                wcId: contents.id,
                mode: 'page',
                engine: 'ai',
              } satisfies WebTranslatePayload)
            },
          },
          { type: 'separator' },
          {
            label: t('隐藏 / 显示双语对照'),
            click: () => {
              mainWindow()?.webContents.send('web:translate', {
                wcId: contents.id,
                mode: 'toggle',
              } satisfies WebTranslatePayload)
            },
          },
          {
            label: t('清除网页译文'),
            click: () => {
              mainWindow()?.webContents.send('web:translate', {
                wcId: contents.id,
                mode: 'clear',
              } satisfies WebTranslatePayload)
            },
          },
        ],
      },
      { type: 'separator' },
      { label: t('刷新'), click: () => contents.reload() },
      { type: 'separator' },
      {
        label: t('检查元素'),
        click: () => {
          yieldDebuggerToDevtools(contents)
          if (!contents.isDevToolsOpened()) contents.openDevTools({ mode: 'detach' })
          contents.inspectElement(params.x, params.y)
        },
      },
    )

    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(contents.hostWebContents ?? contents) ?? undefined,
    })
  })

  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    // 功能键（F11）不带修饰键；其余只转 Ctrl/Meta（无 Alt/Shift）的应用组合
    const bare = /^F\d{1,2}$/.test(input.key)
    if (!bare && (!(input.control || input.meta) || input.alt || input.shift)) return
    const key = input.key.toLowerCase()
    if (!FORWARD_KEYS.has(key)) return
    e.preventDefault()
    mainWindow()?.webContents.send('web:shortcut', key)
  })
}
