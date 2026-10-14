/**
 * 工作区目录的**外部变化**监听（给资源管理器：项目 / 子目录行在应用外被增删改名时自动重列）。
 *
 * 渲染层把「此刻展开着的工作区目录」清单推过来（绝对路径，见 ws:watch），这里按目录挂
 * 非递归 fs.watch——一层目录的 watcher 只报它的**直接子项**，正好对齐「每层行只列自己
 * 一层」的展示语义。事件做一次抖动合并后广播 `ws:changed`（不带参数），渲染层收到就摇
 * 一次 wsChanges 的铃，各层行各自重列。
 *
 * 与 local.ts 那套（打开着的外部文件）的两点差异，都是有意的：
 * - 不按文件名过滤、也不记「自写窗口」：重列是**幂等**的（只重新列目录刷列表，不重挂
 *   编辑器），应用自己写引起的回声最坏就是多列一次目录——不值得为它维护一张自写表；
 * - 事件不带具体路径：与 wsChanges 的广播语义一致（「工作区变过」），各层各自对账。
 *
 * 为什么按「展开的目录」挂而不是对 docs 整个挂递归：递归 fs.watch 在 Linux 上不支持、
 * 事件量也大；只盯眼前展开的那几层，语义与开销都刚好。watcher 一律 persistent: false，
 * 不挡进程退出；目录被删 / 改名时 error 自拆，等渲染层下一次推清单时重建。
 */
import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 正在盯的目录（绝对路径）→ watcher；一个目录一个，退出即拆 */
const watchers = new Map<string, fs.FSWatcher>()

/** 抖动合并窗口：一次外部操作常触发好几条事件（Windows 上删一棵目录还带连拍） */
const DEBOUNCE_MS = 180
let pending: ReturnType<typeof setTimeout> | null = null

/** 广播「工作区变过」：所有窗口都收（与 local:changed 同一条规矩） */
function broadcastWsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('ws:changed')
  }
}

function onDirEvent(): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    broadcastWsChanged()
  }, DEBOUNCE_MS)
}

function watchDir(dir: string): void {
  if (watchers.has(dir)) return
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(dir, { persistent: false }, () => onDirEvent())
  } catch {
    // 目录读不到（还没建 / 刚被删）：不挂就是了，等下一次清单同步或父层的 watcher 把它带回来
    return
  }
  // watcher 出错（目录被删、权限变化）就整个拆掉：下次清单同步会重建
  watcher.on('error', () => {
    watcher.close()
    watchers.delete(dir)
  })
  watchers.set(dir, watcher)
}

function unwatchDir(dir: string): void {
  const watcher = watchers.get(dir)
  if (!watcher) return
  watcher.close()
  watchers.delete(dir)
}

/**
 * 渲染层推来的「此刻要盯的工作区目录」清单：与正在盯的做差量，多了挂上、少了拆掉。
 * 空清单 = 全部拆掉（侧栏收起 / 切换用户时渲染层会推——它重挂时先清后立）。
 */
export function setWsWatchList(raw: unknown): { ok: boolean } {
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const next = new Set<string>()
  for (const item of list) {
    const p = path.normalize(item.trim())
    if (path.isAbsolute(p)) next.add(p)
  }
  for (const dir of next) if (!watchers.has(dir)) watchDir(dir)
  for (const dir of [...watchers.keys()]) if (!next.has(dir)) unwatchDir(dir)
  return { ok: true }
}
