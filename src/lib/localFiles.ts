/**
 * 外部文件的读写入口（拖进归一浏览的那些 txt / markdown / html）。
 *
 * 为什么不走 lib/storage：那套 API 的路径一律是**相对数据根**的，由主进程逐段校验
 * 并挡掉越界——而拖进来的文件本来就在用户自己的目录里，套不进去。主进程因此另开了
 * 一组 local:* 通道（见 electron/storage 的 LOCAL_TEXT_EXTS），只认绝对路径、只放行文本。
 *
 * 这里只做三件事：转发、把「桥都没拿到」这种环境错误收成同一形状的失败、
 * 以及把拖拽事件里的 File 转成路径。调用方一律拿到 { ok, error } 而不是异常。
 */
import { t } from '../i18n'
import { native } from './native'

/** 读取结果：失败时 error 是一句可以直接显示给用户的话 */
export interface LocalReadResult {
  ok: boolean
  content: string
  error?: string
}

/** 读一个外部文件的全部文本 */
export async function readLocalFile(path: string): Promise<LocalReadResult> {
  try {
    const r = await native().local.read(path)
    return r.ok ? { ok: true, content: r.content } : { ok: false, content: '', error: r.error }
  } catch {
    return { ok: false, content: '', error: t('读不到这个文件：应用没有跑在 Electron 里') }
  }
}

/**
 * 读外部本地文档旁边的一张图（绝对路径）：图片回 data URL，读不到 / 不是图片回 null。
 *
 * 走 local:readAttach 这条通道：它本来就收任意绝对路径（附件选择的回读），图片扩展名
 * 直接给 dataUrl，还有 32MB 的体积上限。storage 那一组不行——它的路径必须落在数据
 * 目录之内，外部文档（在数据目录之外）的图片会被「路径不合法」拒掉。
 * 只被 lib/docImages 的 LocalDoc 解析器使用（边界夹在文档自己的目录内）。
 */
export async function readLocalImage(path: string): Promise<string | null> {
  try {
    const r = await native().local.readAttach(path)
    if (!r.ok) return null
    return r.kind === 'image' && r.dataUrl ? r.dataUrl : null
  } catch {
    return null
  }
}

/** 写回外部文件；成功返回 null，失败返回一句错误 */
export async function writeLocalFile(path: string, content: string): Promise<string | null> {
  try {
    const r = await native().local.write(path, content)
    return r.ok ? null : (r.error ?? t('保存失败'))
  } catch {
    return t('保存失败：应用没有跑在 Electron 里')
  }
}

/** 在系统资源管理器里定位这个文件 */
export async function revealLocalFile(path: string): Promise<boolean> {
  try {
    const r = await native().local.reveal(path)
    return r.ok
  } catch {
    return false
  }
}

/** 从系统对话框挑几个本地文件；取消返回空数组 */
export async function pickLocalFiles(): Promise<string[]> {
  try {
    const r = await native().local.pick()
    return r.ok ? (r.paths ?? []) : []
  } catch {
    return []
  }
}

/**
 * 拖拽事件里的 File → 磁盘上的绝对路径；不是磁盘文件（网页里的图、虚拟文件）时返回空串。
 *
 * 走 preload 的 webUtils：Electron 32 起 File.path 已经没有了（见 lib/native 的说明）。
 */
export function droppedFilePath(file: File): string {
  try {
    return native().pathForFile(file)
  } catch {
    return ''
  }
}

/**
 * 以 baseFile 所在目录为基准解析一条相对路径（外部 md 里的 `[x](./docs/a.md)`）。
 *
 * 为什么自己写而不用 path 模块：渲染层没有 Node 的 path（浏览器环境），而这条逻辑
 * 只有十几行——按 `/` 与 `\` 都能切（Windows 的绝对路径两种分隔符都可能出现），
 * 逐段消化 `.` 与 `..`，最后用 base 的分隔符拼回去。`..` 越出根时按根算（多退少补）。
 */
export function resolveLocalPath(baseFile: string, rel: string): string {
  const sep = baseFile.includes('\\') ? '\\' : '/'
  // 盘符（C:）算一段根，不吃 `..`：C:\a\.. 退到 C:\，再退也不该把盘符退掉
  const isWinDrive = (seg: string) => /^[a-zA-Z]:$/.test(seg)
  const dir = baseFile.slice(0, Math.max(baseFile.lastIndexOf('/'), baseFile.lastIndexOf('\\')))
  const out: string[] = []
  const push = (seg: string) => {
    if (seg === '' || seg === '.') return
    if (seg === '..') {
      // 退一级；根上（盘符、首段、空栈）就停在那儿
      if (out.length > 1 || (out.length === 1 && !isWinDrive(out[0]))) out.pop()
      return
    }
    out.push(seg)
  }
  for (const seg of dir.split(/[\\/]/)) push(seg)
  if (isWinDrive(out[0] ?? '') && out.length === 1) return out[0] + sep
  for (const seg of rel.split(/[\\/]/)) push(seg)
  return out.join(sep)
}
