/**
 * 这个文件负责把 storage 各子模块的处理函数注册到同名 IPC 通道上（通道名一个都没改）。
 * 注册顺序与原来一致；通道名与 preload 暴露的形状是一对（见 electron/preload.ts）。
 */
import { ipcMain } from 'electron'
import { pickAttach, readAttach } from './attach'
import { readBinary, readImage, writeBinary, writeImage } from './binary'
import {
  listDir,
  mkdirPath,
  movePath,
  readSession,
  readText,
  readYaml,
  removePath,
  revealPath,
  writeSession,
  writeText,
  writeYaml,
} from './files'
import { flushSync } from './flush'
import { pickLocal, readLocal, revealLocal, setLocalWatchList, writeLocal } from './local'
import { closeBehavior, currentRoot, defaultRoot, loadGlobal, pickRoot, setCloseBehavior, setRoot } from './settings'

/* ---------- IPC 注册 ---------- */

export function registerStorageIpc(): void {
  ipcMain.handle('storage:info', () => ({
    root: currentRoot(),
    defaultRoot: defaultRoot(),
    isDefault: !loadGlobal().root,
  }))

  ipcMain.handle('storage:setRoot', (_e, dir: unknown) => setRoot(dir))

  // 关窗行为：主进程拦关窗时读它（见 main.ts 的 attachCloseGuard），
  // 渲染层的设置面板与关窗询问对话框读写它
  ipcMain.handle('shell:getCloseBehavior', () => closeBehavior())
  ipcMain.handle('shell:setCloseBehavior', (_e, value: unknown) => setCloseBehavior(value))

  ipcMain.handle('storage:pickRoot', () => pickRoot())

  ipcMain.handle('storage:list', (_e, rel: unknown) => listDir(rel))
  ipcMain.handle('storage:read', (_e, rel: unknown) => readText(rel))
  ipcMain.handle('storage:write', (_e, rel: unknown, content: unknown) => writeText(rel, content))
  // 图片走单独的通道：文本通道是 utf-8 的，二进制过不去（见 writeImage 的说明）
  ipcMain.handle('storage:writeImage', (_e, rel: unknown, dataUrl: unknown) => writeImage(rel, dataUrl))
  ipcMain.handle('storage:readImage', (_e, rel: unknown) => readImage(rel))
  // 资源库：任意扩展名的二进制，与图片通道分开（见 writeBinary 的说明）
  ipcMain.handle('storage:writeBinary', (_e, rel: unknown, dataUrl: unknown) => writeBinary(rel, dataUrl))
  ipcMain.handle('storage:readBinary', (_e, rel: unknown) => readBinary(rel))
  // 改名时把整个目录挪走，避免旧目录的递归删除带走资源库里的二进制（见 movePath）
  ipcMain.handle('storage:move', (_e, from: unknown, to: unknown) => movePath(from, to))
  ipcMain.handle('storage:remove', (_e, rel: unknown) => removePath(rel))
  // 工作区的新建目录（真实 mkdir，见 mkdirPath）
  ipcMain.handle('storage:mkdir', (_e, rel: unknown) => mkdirPath(rel))
  ipcMain.handle('storage:reveal', (_e, rel: unknown) => revealPath(rel))
  ipcMain.handle('storage:readYaml', (_e, rel: unknown) => readYaml(rel))
  ipcMain.handle('storage:writeYaml', (_e, rel: unknown, data: unknown) => writeYaml(rel, data))

  // 外部文件：拖进来浏览的那些（绝对路径，见上面的说明）
  ipcMain.handle('local:read', (_e, p: unknown) => readLocal(p))
  ipcMain.handle('local:write', (_e, p: unknown, content: unknown) => writeLocal(p, content))
  ipcMain.handle('local:reveal', (_e, p: unknown) => revealLocal(p))
  ipcMain.handle('local:pick', () => pickLocal())
  // 外部文件的改动监听：渲染层把「开着页签的路径清单」推过来，变化经 local:changed 推回
  ipcMain.handle('local:watch', (_e, list: unknown) => setLocalWatchList(list))
  // 附件：任意扩展名，读了内容直接交给渲染层（见 readAttach 的说明）
  ipcMain.handle('local:pickAttach', () => pickAttach())
  ipcMain.handle('local:readAttach', (_e, p: unknown) => readAttach(p))

  ipcMain.handle('storage:readSession', () => readSession())
  ipcMain.handle('storage:writeSession', (_e, data: unknown) => writeSession(data))

  // 同步版本：页面卸载前的最后一批写（见 flushSync 的说明）
  ipcMain.on('storage:flush', (event, items: unknown) => {
    event.returnValue = flushSync(items)
  })
}
