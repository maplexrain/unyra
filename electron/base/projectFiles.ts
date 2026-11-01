/**
 * 项目节点路径的文件操作实现（project:fs，见 shared/ipc 的契约注释）。
 *
 * 与 base.files 的差别只有一条：**授权模型**。base.files 走「数据根 + 用户放行白名单」；
 * 这里走「声明即授权」——每次调用随行一份 roots（渲染层从 store 现取的已声明 project 根），
 * 请求路径 resolve 之后必须落在某个根之内才执行。渲染层有一道收口（learn/ops/project），
 * 这里是第二道：两道互不共享状态，改路径、删节点的下一拍就生效。
 *
 * 不做 realpath 复验（与 base.files 同档）：项目目录里的符号链接按普通内容对待——
 * 前端工程 node_modules 里全是链接，把它们当「授权传送门」拦掉反而破坏「完全权限」
 * 的语义。授权根是用户亲手在节点上设置的，边界以它为准。
 */
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import type {
  BaseFileEntry,
  BaseFileStat,
  ProjectFsResult,
} from '../../shared/ipc'

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** resolve 后的路径是否落在某个授权根之内（相等也算——根本身就是可操作对象） */
function withinRoots(resolved: string, roots: string[]): boolean {
  for (const raw of roots) {
    const root = path.resolve(raw)
    const rel = path.relative(root, resolved)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true
  }
  return false
}

/** 主入口：校验 + 按 op 分派。所有 fs 操作只认 resolve 过的路径，原样字符串不落 fs。 */
export async function projectFsRun(req: unknown): Promise<ProjectFsResult> {
  if (!req || typeof req !== 'object') return { ok: false, error: 'project:fs 请求为空' }
  const o = req as Record<string, unknown>
  const roots = Array.isArray(o.roots) ? o.roots.map(String).filter((x) => x.trim()) : []
  if (!roots.length) {
    return { ok: false, error: '没有已声明的项目路径（roots 为空）：先在节点宇宙里建一枚 project 节点并设置路径' }
  }
  const op = String(o.op ?? '')
  const rawPath = String(o.path ?? '')
  if (!rawPath) return { ok: false, error: 'path 不能为空' }
  const resolved = path.resolve(rawPath)
  if (!withinRoots(resolved, roots)) {
    return { ok: false, error: '路径越出了已声明的项目根（' + roots.join('、') + '）：' + resolved }
  }

  try {
    switch (op) {
      case 'list':
        return await listOp(resolved)
      case 'stat':
        return await statOp(resolved)
      case 'read':
        return await readOp(resolved, o)
      case 'write':
        return await writeOp(resolved, o, roots)
      case 'edit':
        return await editOp(resolved, o)
      case 'mkdir':
        await fsp.mkdir(resolved, { recursive: true })
        return { ok: true, op: 'mkdir', path: resolved }
      case 'move':
        return await moveOp(resolved, o, roots)
      case 'copy':
        return await copyOp(resolved, o, roots)
      case 'delete':
        return await deleteOp(resolved)
      default:
        return { ok: false, error: '未知操作「' + op + '」：支持 list / stat / read / write / edit / mkdir / move / copy / delete' }
    }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

async function listOp(dir: string): Promise<ProjectFsResult> {
  const dirents = await fsp.readdir(dir, { withFileTypes: true })
  const entries: BaseFileEntry[] = await Promise.all(
    dirents.map(async (d) => {
      let size = 0
      let mtimeMs = 0
      try {
        const s = await fsp.stat(path.join(dir, d.name))
        size = s.size
        mtimeMs = s.mtimeMs
      } catch {
        // 单个条目 stat 失败（竞态删除 / 权限）不影响整目录清单
      }
      return { name: d.name, isDirectory: d.isDirectory(), isFile: d.isFile(), size, mtimeMs }
    }),
  )
  return { ok: true, op: 'list', path: dir, entries }
}

async function statOp(target: string): Promise<ProjectFsResult> {
  try {
    const s = await fsp.stat(target)
    const stat: BaseFileStat = {
      exists: true,
      isDirectory: s.isDirectory(),
      isFile: s.isFile(),
      size: s.size,
      mtimeMs: s.mtimeMs,
      ctimeMs: s.ctimeMs,
    }
    return { ok: true, op: 'stat', path: target, exists: true, stat }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, op: 'stat', path: target, exists: false, stat: null }
    }
    return { ok: false, error: errText(err) }
  }
}

async function readOp(file: string, o: Record<string, unknown>): Promise<ProjectFsResult> {
  const stat = await fsp.stat(file)
  if (!stat.isFile()) return { ok: false, error: '目标路径不是文件：' + file }
  const encoding = o.encoding === 'base64' ? 'base64' : 'utf8'
  const offset = typeof o.offset === 'number' && Number.isFinite(o.offset) ? Math.max(0, Math.floor(o.offset)) : 0
  const maxBytes = typeof o.maxBytes === 'number' && Number.isFinite(o.maxBytes) ? Math.max(0, Math.floor(o.maxBytes)) : undefined
  if (encoding === 'base64') {
    const buf = await fsp.readFile(file)
    const end = maxBytes !== undefined ? Math.min(buf.length, offset + maxBytes) : buf.length
    const sliced = buf.subarray(Math.min(offset, buf.length), end)
    return { ok: true, op: 'read', content: sliced.toString('base64'), encoding, size: stat.size }
  }
  const full = await fsp.readFile(file, 'utf-8')
  const end = maxBytes !== undefined ? offset + maxBytes : full.length
  return {
    ok: true,
    op: 'read',
    content: full.slice(Math.min(offset, full.length), end),
    encoding,
    size: stat.size,
    totalChars: full.length,
  }
}

async function writeOp(file: string, o: Record<string, unknown>, roots: string[]): Promise<ProjectFsResult> {
  // 根本身不可覆盖成文件：根在声明里是目录语义，写穿它会让整棵授权树失去锚点
  if (roots.some((r) => path.resolve(r) === file)) {
    return { ok: false, error: '目标路径是一个已声明的项目根本身，不能当文件写：写到它下面的某个文件' }
  }
  const content = o.content
  if (content === undefined || content === null) return { ok: false, error: 'write 缺少 content' }
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const encoding = o.encoding === 'base64' ? 'base64' : 'utf8'
  if (encoding === 'base64') {
    const buf = Buffer.from(String(content), 'base64')
    if (o.overwrite === false && fs.existsSync(file)) return { ok: false, error: '目标文件已存在且 overwrite=false：' + file }
    await fsp.writeFile(file, buf)
    return { ok: true, op: 'write', path: file, bytesWritten: buf.length }
  }
  if (o.overwrite === false && fs.existsSync(file)) return { ok: false, error: '目标文件已存在且 overwrite=false：' + file }
  await fsp.writeFile(file, String(content), 'utf-8')
  return { ok: true, op: 'write', path: file, bytesWritten: Buffer.byteLength(String(content), 'utf-8') }
}

async function editOp(file: string, o: Record<string, unknown>): Promise<ProjectFsResult> {
  const edit = (o.edit ?? {}) as Record<string, unknown>
  if (!fs.existsSync(file)) return { ok: false, error: '文件不存在：' + file }
  const original = await fsp.readFile(file, 'utf-8')
  let next = original
  if (typeof edit.content === 'string') {
    next = edit.content
  } else if (edit.replace && typeof edit.replace === 'object') {
    const r = edit.replace as Record<string, unknown>
    const target = typeof r.target === 'string' ? r.target : ''
    const replacement = typeof r.replacement === 'string' ? r.replacement : ''
    if (!target) return { ok: false, error: 'edit.replace 缺少 target' }
    if (!original.includes(target)) return { ok: false, error: '未能在文件里找到要替换的片段：「' + target.slice(0, 60) + '」' }
    next = r.all === true ? original.split(target).join(replacement) : original.replace(target, replacement)
  } else if (typeof edit.append === 'string') {
    next = original + edit.append
  } else {
    return { ok: false, error: 'edit 需要content / replace / append 之一' }
  }
  await fsp.writeFile(file, next, 'utf-8')
  return { ok: true, op: 'edit', path: file, modified: next !== original }
}

/** move/copy 的另一端：同样必须落在授权根内（根内互相挪动、挪进来都行，挪出去不行） */
async function resolveDest(o: Record<string, unknown>, roots: string[]): Promise<string | { error: string }> {
  const to = String(o.to ?? '')
  if (!to) return { error: '缺少目标路径 to' }
  const dest = path.resolve(to)
  if (!withinRoots(dest, roots)) {
    return { error: '目标路径越出了已声明的项目根：' + dest }
  }
  return dest
}

async function moveOp(from: string, o: Record<string, unknown>, roots: string[]): Promise<ProjectFsResult> {
  const dest = await resolveDest(o, roots)
  if (typeof dest === 'object') return { ok: false, error: dest.error }
  if (!fs.existsSync(from)) return { ok: false, error: '源路径不存在：' + from }
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.rename(from, dest)
  return { ok: true, op: 'move', path: dest }
}

async function copyOp(from: string, o: Record<string, unknown>, roots: string[]): Promise<ProjectFsResult> {
  const dest = await resolveDest(o, roots)
  if (typeof dest === 'object') return { ok: false, error: dest.error }
  if (!fs.existsSync(from)) return { ok: false, error: '源路径不存在：' + from }
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.cp(from, dest, { recursive: true, force: o.overwrite !== false })
  return { ok: true, op: 'copy', path: dest }
}

async function deleteOp(target: string): Promise<ProjectFsResult> {
  if (!fs.existsSync(target)) return { ok: false, error: '目标不存在，无法删除：' + target }
  await fsp.rm(target, { recursive: true, force: true })
  return { ok: true, op: 'delete', path: target }
}
