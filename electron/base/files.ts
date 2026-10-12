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
 * base.files.read: 读取真实路径的文件，支持各类文件格式（文本或二进制 base64），支持分片读取
 */
export async function baseFileRead(
  rawPath: unknown,
  opts?:
    | 'utf8'
    | 'base64'
    | 'binary'
    | {
        encoding?: 'utf8' | 'base64' | 'binary'
        maxBytes?: number
        offset?: number
      },
): Promise<BaseFileReadResult> {
  const perm = checkPathPermission(String(rawPath ?? ''))
  if (!perm.allowed) return { ok: false, error: perm.error || '权限拒绝' }

  try {
    const stat = await fsp.stat(perm.normalized)
    if (!stat.isFile()) return { ok: false, error: '目标路径不是文件' }

    const options = typeof opts === 'string' ? { encoding: opts } : opts || {}
    const encoding = options.encoding || 'utf8'
    if (options.encoding && !['utf8', 'utf-8', 'base64', 'binary'].includes(options.encoding)) {
      return { ok: false, error: `不支持的读取编码「${options.encoding}」，仅支持 utf8, base64, binary` }
    }

    const offset = typeof options.offset === 'number' ? Math.max(0, options.offset) : 0
    const hasSlice = typeof options.offset === 'number' || typeof options.maxBytes === 'number'
    const sliceLimit = typeof options.maxBytes === 'number' ? Math.max(0, options.maxBytes) : 30 * 1024 * 1024

    if (!hasSlice && stat.size > sliceLimit) {
      return { ok: false, error: `文件体积 (${stat.size} 字节) 超过单次读取上限 (${sliceLimit} 字节)，请传入 { offset, maxBytes } 进行分片读取` }
    }

    if (encoding === 'base64' || encoding === 'binary') {
      const buf = await fsp.readFile(perm.normalized)
      const slicedBuf = hasSlice ? buf.subarray(offset, offset + sliceLimit) : buf
      const content = encoding === 'binary' ? slicedBuf.toString('binary') : slicedBuf.toString('base64')
      return {
        ok: true,
        content,
        encoding,
        size: stat.size,
        sizeBytes: stat.size,
        chars: content.length,
      }
    }

    // 默认尝试文本读取；遇到无法解析的二进制可优雅回退
    try {
      const fullText = await fsp.readFile(perm.normalized, 'utf-8')
      const text = hasSlice ? fullText.slice(offset, offset + sliceLimit) : fullText
      return {
        ok: true,
        content: text,
        encoding: 'utf8',
        size: stat.size,
        sizeBytes: stat.size,
        chars: text.length,
        totalChars: fullText.length,
      }
    } catch {
      const buf = await fsp.readFile(perm.normalized)
      const slicedBuf = hasSlice ? buf.subarray(offset, offset + sliceLimit) : buf
      return {
        ok: true,
        content: slicedBuf.toString('base64'),
        encoding: 'base64',
        size: stat.size,
        sizeBytes: stat.size,
        chars: slicedBuf.length,
      }
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

    if (content === undefined || content === null) {
      return { ok: false, error: 'files.write content 不能为空 (undefined/null)' }
    }

    const encoding = opts?.encoding || 'utf8'
    if (opts?.encoding && !['utf8', 'utf-8', 'base64'].includes(opts.encoding)) {
      return { ok: false, error: `不支持的写入编码「${opts.encoding}」，仅支持 utf8, base64` }
    }
    const rawStr =
      typeof content === 'string'
        ? content
        : typeof content === 'object'
          ? JSON.stringify(content, null, 2)
          : String(content)

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
 * base.files.edit: 修改已存在的文件，支持字符串替换、多项编辑、追加/插入或全篇替换
 */
export async function baseFileEdit(
  rawPath: unknown,
  opts?: {
    replace?: { target?: string; replacement?: string; old?: string; new?: string; search?: string; find?: string; replace?: string; all?: boolean }
    edits?: Array<{
      target?: string
      replacement?: string
      old?: string
      new?: string
      search?: string
      find?: string
      replace?: string
      append?: string
      prepend?: string
      insert?: string
      after?: string
      before?: string
      all?: boolean
      [k: string]: unknown
    }>
    content?: string
    append?: string
    prepend?: string
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

    if (Array.isArray(opts?.edits) && opts.edits.length > 0) {
      let matchedAny = false
      for (const edit of opts.edits) {
        const target = edit.target ?? edit.old ?? edit.search ?? edit.find ?? ''
        const replacement = edit.replacement ?? edit.new ?? edit.replace ?? ''
        const appendText = typeof edit.append === 'string' ? edit.append : undefined
        const prependText = typeof edit.prepend === 'string' ? edit.prepend : undefined
        const insertText = typeof edit.insert === 'string' ? edit.insert : undefined

        if (appendText !== undefined) {
          nextContent = nextContent + appendText
          matchedAny = true
        } else if (prependText !== undefined) {
          nextContent = prependText + nextContent
          matchedAny = true
        } else if (insertText !== undefined) {
          if (edit.after && nextContent.includes(edit.after)) {
            const idx = nextContent.indexOf(edit.after) + edit.after.length
            nextContent = nextContent.slice(0, idx) + insertText + nextContent.slice(idx)
            matchedAny = true
          } else if (edit.before && nextContent.includes(edit.before)) {
            const idx = nextContent.indexOf(edit.before)
            nextContent = nextContent.slice(0, idx) + insertText + nextContent.slice(idx)
            matchedAny = true
          } else {
            return {
              ok: false,
              error: `insert 操作未定位到定位锚点「${edit.after || edit.before || ''}」`,
            }
          }
        } else if (target) {
          if (nextContent.includes(target)) {
            matchedAny = true
            if (edit.all) {
              nextContent = nextContent.split(target).join(replacement)
            } else {
              nextContent = nextContent.replace(target, replacement)
            }
          }
        } else {
          return {
            ok: false,
            error: `edits 项缺少有效编辑键（识别到未知键: ${Object.keys(edit).join(', ')}）。支持的键名: { target/old/search/find, replacement/new }, { append }, { prepend }, { insert, after/before }`,
          }
        }
      }
      if (!matchedAny) {
        return { ok: false, error: '未能匹配到任何要替换的目标片段，请检查原文本内容。' }
      }
    } else if (opts?.replace) {
      const target = opts.replace.target ?? opts.replace.old ?? opts.replace.search ?? opts.replace.find ?? ''
      const replacement = opts.replace.replacement ?? opts.replace.new ?? opts.replace.replace ?? ''
      const all = opts.replace.all
      if (!target) {
        return { ok: false, error: '未指定要替换的目标文本 target / old / search / find' }
      }
      if (!nextContent.includes(target)) {
        return { ok: false, error: `未能匹配到目标文本：「${target.slice(0, 50)}」，请检查原文件内容。` }
      }
      if (all) {
        nextContent = original.split(target).join(replacement)
      } else {
        nextContent = original.replace(target, replacement)
      }
    } else if (typeof opts?.append === 'string') {
      nextContent = original + opts.append
    } else if (typeof opts?.prepend === 'string') {
      nextContent = opts.prepend + original
    } else if (typeof opts?.start === 'number' && typeof opts?.end === 'number' && typeof opts?.content === 'string') {
      nextContent = original.slice(0, opts.start) + opts.content + original.slice(opts.end)
    } else if (typeof opts?.content === 'string') {
      nextContent = opts.content
    } else {
      return { ok: false, error: '未提供有效的编辑参数（需要 replace、edits、append、prepend 或 content）' }
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
export async function baseFileList(rawPath: unknown): Promise<BaseFileListResult & { items?: unknown[] }> {
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

    return { ok: true, path: perm.normalized, entries, items: entries }
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
      exists: true,
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
        exists: false,
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
    const exists = fs.existsSync(perm.normalized)
    if (!exists) {
      return { ok: false, error: `目标不存在，无法删除：${perm.normalized}` }
    }
    await fsp.rm(perm.normalized, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}
