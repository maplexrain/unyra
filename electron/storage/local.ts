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
 * 允许通过 local:read / local:write 读写的外部**文本**文件类型。
 *
 * 与 storage:* 的根本差别：这里的路径是**绝对路径**——拖进来的文件本来就不在
 * 用户的数据目录里，套那套相对路径校验根本走不通。既然开了这道口子，就把范围
 * 收在「常见文本后缀」上：这条通道是给「拖进来看一眼、顺手改两句」用的，
 * 不是通用文件系统入口。媒体文件（图片 / 音频 / 视频）走下面的 readLocalMedia。
 */
const LOCAL_TEXT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.html', '.htm',
  '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.less',
  '.py', '.rb', '.php', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.rs', '.go', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf', '.properties',
  '.xml', '.csv', '.tsv', '.log', '.sql', '.vue', '.svelte', '.dart', '.lua', '.r', '.tex',
  '.graphql', '.gql', '.diff', '.patch', '.dockerfile', '.zig', '.hs', '.scala', '.ex',
])

/** 本地文件的**媒体预览**扩展名：与 learn/tabs 的 MEDIA_EXTS 一张表拆两处（一边后缀、一边渲染） */
const LOCAL_MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus',
  '.mp4', '.webm', '.mkv', '.mov', '.m4v',
])

const MEDIA_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
}

/** 媒体预览的体积上限：一段 45 分钟的课大约 200MB，再大的就让用户用系统播放器 */
const MEDIA_MAX_BYTES = 200 * 1024 * 1024

/** 校验一个外部文件路径：必须绝对、扩展名在白名单里 */
function localFile(raw: unknown): string | null {
  const p = typeof raw === 'string' ? raw.trim() : ''
  if (!p || !path.isAbsolute(p)) return null
  return LOCAL_TEXT_EXTS.has(path.extname(p).toLowerCase()) ? p : null
}

/** 读本地媒体文件：回 base64 data URL（多媒体预览页签用，见 LocalDoc 的 media 视图） */
export async function readLocalMedia(
  raw: unknown,
): Promise<{ ok: boolean; mime?: string; dataUrl?: string; error?: string }> {
  const p = typeof raw === 'string' ? raw.trim() : ''
  const ext = p ? path.extname(p).toLowerCase() : ''
  if (!p || !path.isAbsolute(p) || !LOCAL_MEDIA_EXTS.has(ext)) {
    return { ok: false, error: t('这个文件类型不能在这里预览') }
  }
  try {
    const stat = await fsp.stat(p)
    if (!stat.isFile()) return { ok: false, error: t('这不是一个文件') }
    if (stat.size > MEDIA_MAX_BYTES) return { ok: false, error: t('文件太大（超过 200MB），用系统播放器打开吧') }
    const mime = MEDIA_MIME[ext] ?? 'application/octet-stream'
    const buf = await fsp.readFile(p)
    return { ok: true, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'ENOENT' ? t('文件不在了（可能已被移动或删除）') : t('读取失败') }
  }
}

export async function readLocal(raw: unknown): Promise<{ ok: boolean; content?: string; error?: string }> {
  const p = localFile(raw)
  if (!p) return { ok: false, error: t('这个文件类型不能在这里编辑（文本类：md / txt / 代码等；媒体文件会自动进预览）') }
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

/** 从系统对话框里挑几个本地文件（拖拽之外的第二个入口）：不设扩展名过滤，文本 / 媒体都能进 */
export async function pickLocal(): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: t('打开本地文件'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('全部文件'), extensions: ['*'] }],
  })
  if (canceled || !filePaths?.length) return { ok: false, canceled: true }
  return { ok: true, paths: filePaths }
}
