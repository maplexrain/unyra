/**
 * 这个文件负责应用图标与应用菜单：窗口与托盘上那枚图标从哪来、运行时染色的结果怎么应用，
 * 以及那份「只为把 Ctrl+W / Ctrl+Q 让出来」的编辑菜单。
 */
import { Menu, nativeImage } from 'electron'
import path from 'node:path'
import { t } from '../i18n'
import { isDev } from './startup'

/* 把染色后的图标应用出去那件事住在 ./applyIcon：它要碰托盘，而托盘要用本文件的 appIcon()，
   放这儿两边就成环（转出也不行——转出同样是一条 import 边）。用它的 ipc.ts 直接引那一份。 */

/**
 * 应用图标。
 *
 * dev 下渲染层由 Vite 直接服务 public/，生产构建会把 public/ 整份拷进 dist/，
 * 两种运行方式各取一处；图标只有 public/logo.png 一份，不另存副本——
 * 壳上显示的 logo 因此与应用内那个（src/components/Logo.tsx）永远是同一个。
 */
function appIconPath(): string {
  return path.join(__dirname, '..', isDev ? 'public' : 'dist', 'logo.png')
}

export function appIcon(): Electron.NativeImage {
  const img = nativeImage.createFromPath(appIconPath())
  // 读不到就给一张空图：窗口图标缺一个不至于让应用起不来
  return img.isEmpty() ? nativeImage.createEmpty() : img
}

/** 运行时给图标染色的 SVG 原文：与 appIconPath 同一目录（开发时 public，打包后 dist） */
export function logoSvgPath(): string {
  return path.join(__dirname, '..', isDev ? 'public' : 'dist', 'logo.svg')
}

/**
 * 应用菜单：**只为一件事存在——把 Ctrl+W / Ctrl+Q 让出来**。
 *
 * 窗口是无边框的（见 createWindow 的 frame: false），菜单栏根本看不见；可是 Electron 在
 * 没有设置菜单时会挂一份默认菜单，而那份默认菜单把 Ctrl+W 绑成「关闭窗口」、Ctrl+Q 绑成
 * 「退出应用」。菜单的加速键在**浏览器进程里先一步**被处理，渲染层连 keydown 都收不到——
 * 不换掉这份菜单，应用里那两个快捷键（关闭当前标签页 / 聚焦导师输入框，见 lib/shortcuts）
 * 就永远轮不上，按下去只会把窗口关掉。
 *
 * 所以这里只保留编辑与视图两组：复制粘贴要能用，F12 / Ctrl+Shift+I 的开发者工具也要在
 * （排查问题时那是唯一的入口）。关窗点右上角那颗、退出走托盘菜单，都不缺。
 *
 * macOS 不动：Cmd+Q 是系统惯例，且那边的编辑菜单还管着 Cmd+C / Cmd+V 能不能用。
 *
 * 重建是安全的（Menu.setApplicationMenu 幂等）：渲染层切换界面语言时经 `ui-locale`
 * 调 rebuildAppMenu()，把菜单文案换到新语言。启动入口仍是 installAppMenu。
 */
export function installAppMenu(): void {
  rebuildAppMenu()
}

export function rebuildAppMenu(): void {
  if (process.platform === 'darwin') return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: t('编辑'),
        submenu: [
          { role: 'undo', label: t('撤销') },
          { role: 'redo', label: t('重做') },
          { type: 'separator' },
          { role: 'cut', label: t('剪切') },
          { role: 'copy', label: t('复制') },
          { role: 'paste', label: t('粘贴') },
          { role: 'selectAll', label: t('全选') },
        ],
      },
      {
        label: t('视图'),
        submenu: [
          { role: 'reload', label: t('重新加载') },
          { role: 'forceReload', label: t('强制重新加载') },
          { role: 'toggleDevTools', label: t('开发者工具') },
          { type: 'separator' },
          { role: 'resetZoom', label: t('实际大小') },
          { role: 'zoomIn', label: t('放大') },
          { role: 'zoomOut', label: t('缩小') },
          { type: 'separator' },
          {
            /*
             * 全屏**不挂 F11**：那个组合留给渲染层的「纯净阅读模式」（见 lib/shortcuts 的 doc.zen）。
             *
             * 菜单加速键在浏览器进程里先一步被处理，渲染层连 keydown 都收不到——`togglefullscreen`
             * 这个角色自带 F11（Windows/Linux），不摘掉它，F11 永远轮不到阅读模式，按下去只会
             * 把窗口切成全屏。这里改成一个**没有加速键**的普通项：菜单在无边框窗口里本来就看不见，
             * 这一项留着只是让「视图」这一组是完整的；窗口的全屏/最大化仍走右上角那几颗按钮。
             */
            label: t('全屏'),
            click: (_item, win) => {
              if (win) win.setFullScreen(!win.isFullScreen())
            },
          },
        ],
      },
    ]),
  )
}
