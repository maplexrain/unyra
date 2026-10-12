/**
 * 真实文件系统操作实现 (base.files.*)。
 * 支持在放行白名单范围内的任意文件类型读写、编辑、属性查询与目录管理。
 */
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { checkPathPermission } from './permissions'
import type {
  BaseFileEditResult,
  BaseFileListResult,
  BaseFileOpResult,
  BaseFileReadResult,
  BaseFileStatResult,
  BaseFileWriteResult,
} from '../../shared/ipc'

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * base.files.read: 读取真实路径的文件，支持各类文件格式（文本或二进制 base64）
 */
export async function baseFileRead(
  rawPath: unknown,
  opts?: { encoding?: 'utf8' | 'base64' | 'binary'; maxBytes?: number },
): Promise<BaseFileReadResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    const stat = await fsp.stat(perm.normalized)
    if (!stat.isFile()) return { ok: false, error: '目标路径不是文件' }

    const maxBytes = opts?.maxBytes ?? 30 * 1024 * 1024 // 默认上限 30MB
    if (stat.size > maxBytes) {
      return { ok: false, error: `文件体积 (${stat.size} 字节) 超过单次读取上限 (${maxBytes} 字节)` }
    }

    const encoding = opts?.encoding || 'utf8'
    if (encoding === 'base64') {
      const buf = await fsp.readFile(perm.normalized)
      return { ok: true, content: buf.toString('base64'), encoding: 'base64', size: stat.size }
    }

    // 默认尝试文本读取；遇到无法解析的二进制可优雅回退
    try {
      const text = await fsp.readFile(perm.normalized, 'utf-8')
      return { ok: true, content: text, encoding: 'utf8', size: stat.size }
    } catch {
      const buf = await fsp.readFile(perm.normalized)
      return { ok: true, content: buf.toString('base64'), encoding: 'base64', size: stat.size }
    }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.write: 写入某个真实路径文件，不存在则自动递归创建父目录与文件
 */
export async function baseFileWrite(
  rawPath: unknown,
  content: unknown,
  opts?: { encoding?: 'utf8' | 'base64'; overwrite?: boolean },
): Promise<BaseFileWriteResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    await fsp.mkdir(path.dirname(perm.normalized), { recursive: true })

    const encoding = opts?.encoding || 'utf8'
    const rawStr = typeof content === 'string' ? content : String(content ?? '')

    if (encoding === 'base64') {
      const buf = Buffer.from(rawStr, 'base64')
      await fsp.writeFile(perm.normalized, buf)
      return { ok: true, path: perm.normalized, bytesWritten: buf.length }
    }

    await fsp.writeFile(perm.normalized, rawStr, 'utf-8')
    return { ok: true, path: perm.normalized, bytesWritten: Buffer.byteLength(rawStr, 'utf-8') }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.edit: 修改已存在的文件，支持字符串替换或全篇替换
 */
export async function baseFileEdit(
  rawPath: unknown,
  opts?: {
    replace?: { target: string; replacement: string; all?: boolean }
    content?: string
    start?: number
    end?: number
  },
): Promise<BaseFileEditResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    const exists = fs.existsSync(perm.normalized)
    if (!exists) return { ok: false, error: `文件不存在：${perm.normalized}` }

    const original = await fsp.readFile(perm.normalized, 'utf-8')
    let nextContent = original

    if (opts?.replace) {
      const { target, replacement, all } = opts.replace
      if (all) {
        nextContent = original.split(target).join(replacement)
      } else {
        nextContent = original.replace(target, replacement)
      }
    } else if (typeof opts?.start === 'number' && typeof opts?.end === 'number' && typeof opts?.content === 'string') {
      nextContent = original.slice(0, opts.start) + opts.content + original.slice(opts.end)
    } else if (typeof opts?.content === 'string') {
      nextContent = opts.content
    }

    await fsp.writeFile(perm.normalized, nextContent, 'utf-8')
    return { ok: true, path: perm.normalized, modified: nextContent !== original }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.list: 列出某个路径下的所有文件/目录及其基本元数据
 */
export async function baseFileList(rawPath: unknown): Promise<BaseFileListResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    const dirents = await fsp.readdir(perm.normalized, { withFileTypes: true })
    const entries = await Promise.all(
      dirents.map(async (d) => {
        let size = 0
        let mtimeMs = 0
        try {
          const s = await fsp.stat(path.join(perm.normalized, d.name))
          size = s.size
          mtimeMs = s.mtimeMs
        } catch {
          // 忽略单个权限或丢失状态
        }
        return {
          name: d.name,
          isDirectory: d.isDirectory(),
          isFile: d.isFile(),
          size,
          mtimeMs,
        }
      }),
    )

    return { ok: true, path: perm.normalized, entries }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.stat: 查看某个文件的详细信息（是否存在、大小、修改时间等）
 */
export async function baseFileStat(rawPath: unknown): Promise<BaseFileStatResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    const s = await fsp.stat(perm.normalized)
    return {
      ok: true,
      stat: {
        exists: true,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        size: s.size,
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
      },
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        ok: true,
        stat: {
          exists: false,
          isDirectory: false,
          isFile: false,
          size: 0,
          mtimeMs: 0,
          ctimeMs: 0,
        },
      }
    }
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.mkdir: 创建目录
 */
export async function baseFileMkdir(rawPath: unknown): Promise<BaseFileOpResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    await fsp.mkdir(perm.normalized, { recursive: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.copy: 复制文件或目录
 */
export async function baseFileCopy(
  rawFrom: unknown,
  rawTo: unknown,
  opts?: { overwrite?: boolean },
): Promise<BaseFileOpResult> {
  const pFrom = checkPathPermission(String(rawFrom ?? ''))
  if (!pFrom.allowed) return { ok: false, error: pFrom.error || '源路径权限拒绝' }

  const pTo = checkPathPermission(String(rawTo ?? ''))
  if (!pTo.allowed) return { ok: false, error: pTo.error || '目标路径权限拒绝' }

  try {
    await fsp.mkdir(path.dirname(pTo.normalized), { recursive: true })
    await fsp.cp(pFrom.normalized, pTo.normalized, {
      recursive: true,
      force: opts?.overwrite !== false,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.move: 移动或重命名文件或目录
 */
export async function baseFileMove(rawFrom: unknown, rawTo: unknown): Promise<BaseFileOpResult> {
  const pFrom = checkPathPermission(String(rawFrom ?? ''))
  if (!pFrom.allowed) return { ok: false, error: pFrom.error || '源路径权限拒绝' }

  const pTo = checkPathPermission(String(rawTo ?? ''))
  if (!pTo.allowed) return { ok: false, error: pTo.error || '目标路径权限拒绝' }

  try {
    await fsp.mkdir(path.dirname(pTo.normalized), { recursive: true })
    await fsp.rename(pFrom.normalized, pTo.normalized)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * base.files.delete: 删除文件或目录
 */
export async function baseFileDelete(rawPath: unknown): Promise<BaseFileOpResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    await fsp.rm(perm.normalized, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}
