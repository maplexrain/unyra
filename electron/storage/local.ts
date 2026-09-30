/**
 * 这个文件负责外部文件（拖进来浏览的那些）：绝对路径的白名单校验、读写、按目录挂的 fs.watch
 * 监听，以及系统对话框里的挑选与定位。
 *
 * 三个模块级状态（localWatchers / ownWriteAt / pendingLocalChange）与读写它们的函数都在这一份里。
 */
import { BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from '../i18n'

/* ---------- 外部文件（拖进来浏览的那些） ---------- */

/**
 * 允许通过 local:* 通道读写的外部文件类型。
 *
 * 与 storage:* 的根本差别：这里的路径是**绝对路径**——拖进来的文件本来就不在
 * 用户的数据目录里，套那套相对路径校验根本走不通。既然开了这道口子，就把范围
 * 收在「归一能浏览的文本文件」上：这条通道是给「拖进来看一眼、顺手改两句」用的，
 * 不是通用文件系统入口。
 */
const LOCAL_TEXT_EXTS = new Set(['.md', '.markdown', '.txt', '.html', '.htm'])

/** 校验一个外部文件路径：必须绝对、扩展名在白名单里 */
function localFile(raw: unknown): string | null {
  const p = typeof raw === 'string' ? raw.trim() : ''
  if (!p || !path.isAbsolute(p)) return null
  return LOCAL_TEXT_EXTS.has(path.extname(p).toLowerCase()) ? p : null
}

export async function readLocal(raw: unknown): Promise<{ ok: boolean; content?: string; error?: string }> {
  const p = localFile(raw)
  if (!p) return { ok: false, error: t('这个文件类型不能在这里打开（只支持 md / txt / html）') }
  try {
    return { ok: true, content: await fsp.readFile(p, 'utf-8') }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'ENOENT' ? t('文件不在了（可能已被移动或删除）') : t('读取失败') }
  }
}

export async function writeLocal(raw: unknown, content: unknown): Promise<{ ok: boolean; error?: string }> {
  const p = localFile(raw)
  if (!p) return { ok: false, error: t('这个文件类型不能在这里保存') }
  try {
    await fsp.writeFile(p, typeof content === 'string' ? content : '', 'utf-8')
    // 这是应用自己写的：记一笔，watcher 在一小段窗口内忽略这一份的变化，
    // 否则「保存 → 自己收到外部变化通知 → 页签重挂」会自己追自己
    markLocalOwnWrite(p)
    return { ok: true }
  } catch {
    return { ok: false, error: t('保存失败（文件可能被占用或没有写权限）') }
  }
}

/* ---------- 外部文件的改动监听（给「打开着的本地文件页签」同步外部变化） ---------- */

/**
 * 监听外部文件的变化（渲染层把开着页签的路径清单推过来，见 local:watch）。
 *
 * 实现是**按目录**挂 fs.watch，而不是按文件：Windows 上编辑器保存常用「写临时文件 +
 * 改名替换」的原子写法，直接盯文件的那个 watcher 会随替换一起死；盯住目录则始终活着，
 * 只按文件名过滤。同一个目录里的几个文件共享一个 watcher。
 */
const localWatchers = new Map<string, { watcher: fs.FSWatcher; files: Set<string> }>()
/** 我们自己刚写过的文件：时间戳在这段窗口内的变化一律不算「外部改动」 */
const ownWriteAt = new Map<string, number>()
const OWN_WRITE_WINDOW_MS = 1500
/** 同一个文件的变化抖动合并：编辑器一次保存常触发好几条事件 */
const pendingLocalChange = new Map<string, ReturnType<typeof setTimeout>>()

/** 记一笔「这个文件是应用自己写的」（local:write 与 file:saveText 都走这里） */
export function markLocalOwnWrite(raw: unknown): void {
  const p = typeof raw === 'string' ? path.normalize(raw.trim()) : ''
  if (p) ownWriteAt.set(p, Date.now())
}

function broadcastLocalChange(p: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('local:changed', p)
  }
}

function onWatchedDirEvent(dir: string, filename: string | null): void {
  if (!filename) return
  const entry = localWatchers.get(dir)
  if (!entry) return
  if (!entry.files.has(filename.toLowerCase())) return
  const p = path.join(dir, filename)
  const mine = ownWriteAt.get(p)
  if (mine && Date.now() - mine < OWN_WRITE_WINDOW_MS) return
  const prev = pendingLocalChange.get(p)
  if (prev) clearTimeout(prev)
  pendingLocalChange.set(
    p,
    setTimeout(() => {
      pendingLocalChange.delete(p)
      broadcastLocalChange(p)
    }, 200),
  )
}

function watchLocalPath(p: string): void {
  const dir = path.dirname(p)
  const base = path.basename(p).toLowerCase()
  let entry = localWatchers.get(dir)
  if (!entry) {
    let watcher: fs.FSWatcher
    try {
      watcher = fs.watch(dir, { persistent: false }, (_event, filename) => onWatchedDirEvent(dir, filename))
    } catch {
      // 目录读不到（文件可能已被删）：不挂就是了，渲染层读到「文件不在了」另有兜底
      return
    }
    // watcher 出错（目录被删、权限变化）就整个拆掉：下次清单同步会重建
    watcher.on('error', () => {
      watcher.close()
      localWatchers.delete(dir)
    })
    entry = { watcher, files: new Set() }
    localWatchers.set(dir, entry)
  }
  entry.files.add(base)
}

function unwatchLocalPath(p: string): void {
  const dir = path.dirname(p)
  const base = path.basename(p).toLowerCase()
  const entry = localWatchers.get(dir)
  if (!entry) return
  entry.files.delete(base)
  if (!entry.files.size) {
    entry.watcher.close()
    localWatchers.delete(dir)
  }
}

/** 渲染层推来的「现在开着哪些本地文件」：与正在盯的清单做差量，多了挂上、少了拆掉 */
export function setLocalWatchList(raw: unknown): { ok: boolean } {
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const next = new Set<string>()
  for (const item of list) {
    const p = localFile(item)
    if (p) next.add(path.normalize(p))
  }
  const current = new Set<string>()
  for (const [dir, entry] of localWatchers) {
    for (const base of entry.files) current.add(path.join(dir, base))
  }
  for (const p of next) if (!current.has(p)) watchLocalPath(p)
  for (const p of current) if (!next.has(p)) unwatchLocalPath(p)
  return { ok: true }
}

/**
 * 在系统文件管理器里定位一个外部文件。
 *
 * **不套 LOCAL_TEXT_EXTS**：那条白名单管的是「读进来、写回去」，而这里只是把文件夹
 * 打开、把光标停在某个文件上——它既不读内容也不写内容。真正需要它的是导出：
 * 用户刚在系统对话框里亲自选了路径（可能是 .pdf、.png），随后点「打开所在文件夹」，
 * 此时因为后缀不在白名单里而拒绝，只会让人以为导出失败了。
 */
export async function revealLocal(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const p = typeof raw === 'string' ? raw.trim() : ''
  if (!p || !path.isAbsolute(p)) return { ok: false, error: t('路径不对') }
  shell.showItemInFolder(p)
  return { ok: true }
}

/** 从系统对话框里挑几个本地文件（拖拽之外的第二个入口） */
export async function pickLocal(): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: t('打开本地文件'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('文本文件'), extensions: ['md', 'markdown', 'txt', 'html', 'htm'] }],
  })
  if (canceled || !filePaths?.length) return { ok: false, canceled: true }
  return { ok: true, paths: filePaths.filter((p) => LOCAL_TEXT_EXTS.has(path.extname(p).toLowerCase())) }
}
