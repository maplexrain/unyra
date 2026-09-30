/**
 * 这个文件负责「要发给超级导师的附件」这条通道：不设扩展名白名单，只管限体积、判断文本还是
 * 二进制，再把内容原样交回去（见下面那段说明）。
 */
import { BrowserWindow, dialog } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from '../i18n'

/* ---------- 附件（要发给超级导师的文件） ---------- */

/**
 * 附件通道：**任意扩展名**，与上面的 local:* 分开。
 *
 * 上面那条是「拖进来看一眼、顺手改两句」——只收归一自己能打开的文本（md / txt / html），
 * 这一条是「把这份文件发给导师看看」：源码、csv、json、日志、图片都该能发，
 * 所以扩展名不设白名单。放开的是**读**，而且读的是用户在系统对话框里亲手选中的那一个，
 * 因此这里只管三件事：限体积、判断是文本还是二进制、把内容原样交回去。
 * 「读任意路径」没有暴露给沙箱里运行的模型——渲染层只是把结果递给它。
 */
const ATTACH_MAX_BYTES = 32 * 1024 * 1024
/**
 * 文本附件最多读这么多字节。
 *
 * 2MB 已经远远超过任何模型的上下文（约百万字），再往上读只是让 IPC 白搬一趟；
 * 超出就截断，并在结果里带一句 truncated——界面会如实说「只附上了开头一部分」。
 */
const ATTACH_TEXT_MAX_BYTES = 2 * 1024 * 1024
const ATTACH_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
const ATTACH_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/** 看着像二进制吗：前 4KB 里出现 NUL 就当二进制（文本文件几乎不会含 NUL） */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 4096)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export interface AttachRead {
  ok: boolean
  name?: string
  bytes?: number
  kind?: 'image' | 'text' | 'binary'
  text?: string
  dataUrl?: string
  truncated?: boolean
  error?: string
}

export async function readAttach(raw: unknown): Promise<AttachRead> {
  const p = typeof raw === 'string' ? raw.trim() : ''
  if (!p || !path.isAbsolute(p)) return { ok: false, error: t('路径无效') }
  try {
    const stat = await fsp.stat(p)
    if (!stat.isFile()) return { ok: false, error: t('这不是一个文件') }
    if (stat.size > ATTACH_MAX_BYTES) return { ok: false, error: t('文件超过 32MB，压小一点再发') }
    const name = path.basename(p)
    const ext = path.extname(p).toLowerCase()
    const buf = await fsp.readFile(p)
    const bytes = buf.length
    if (ATTACH_IMAGE_EXTS.has(ext)) {
      const mime = ATTACH_IMAGE_MIME[ext] ?? 'image/png'
      return { ok: true, name, bytes, kind: 'image', dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    }
    if (looksBinary(buf)) return { ok: true, name, bytes, kind: 'binary' }
    const truncated = buf.length > ATTACH_TEXT_MAX_BYTES
    return {
      ok: true,
      name,
      bytes,
      kind: 'text',
      text: buf.subarray(0, ATTACH_TEXT_MAX_BYTES).toString('utf-8'),
      truncated,
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'ENOENT' ? t('文件不在了（可能已被移动或删除）') : t('读取失败') }
  }
}

/** 挑要发的附件：**不设扩展名过滤**（见上面那段），可以多选 */
export async function pickAttach(): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: t('选择要发给超级导师的文件'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('全部文件'), extensions: ['*'] }],
  })
  if (canceled || !filePaths?.length) return { ok: false, canceled: true }
  return { ok: true, paths: filePaths }
}
