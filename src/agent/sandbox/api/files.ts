/**
 * 这个文件负责什么：真实文件系统的受控 api 装配（files.*）——读写编辑、列举、建删与
 * 移动复制，全部经宿主原生桥（见 api/native.ts 的 getNativeFiles）。
 * **敏感区（口径一行不能动）**：
 * - resolveSandboxedPath 的路径映射（用户作用域根、笔记/ notes/ 快捷形式、绝对路径放行、
 *   skills/ 到数据根的映射、users/ 前缀识别）；
 * - filesAccessError 的放行校验先于一切 IO；
 * - chat.json 是系统核心会话状态，写 / 改 / 列 / 删都有硬挡；
 * - files.write/edit 落盘成功后的 syncFileToStore 双写（根治正文被空 Store 覆盖的 A2）
 *   与 vfsBus 外部变更通知、skills 目录变动触发 loadSkillsFromDisk。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import { filesAccessError } from '../dataPaths'
import { vfsBus } from '../../../vfs'
import { userAbsPath, userAbsPrefix, storageAbsPath } from '../../../lib/storage'
import { loadSkillsFromDisk } from '../../skill/fs'
import { getNativeFiles } from './native'
import type { SandboxCall, SandboxOptions } from '../types'

/** 真实文件系统域：files.read/write/edit/list/stat/mkdir/copy/move/delete（+ files.download 在 workspace 组） */
export function installFiles(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 基础系统真实文件系统与受控系统进程 (files.* / process.*)——进程通道见 api/process.ts

  /**
   * 将 Agent 传入的相对路径映射到当前活跃用户的作用域根目录。
   * 彻底解决数据契约路径错位 (A3) 并防止泄露应用根的私有文件 (C5)。
   */
  const resolveSandboxedPath = (raw: string): string => {
    let p = raw.trim().replace(/\\/g, '/')
    if (!p || p === '.') {
      return userAbsPrefix()?.replace(/\\/g, '/') ?? p
    }

    // 快捷形式支持：若以 笔记/ 或 notes/ 开头，自动解析至当前打开节点的笔记目录
    if (p.startsWith('笔记/') || p.startsWith('notes/')) {
      const noteName = p.replace(/^(?:笔记|notes)\//, '').replace(/\.md$/, '')
      const curDoc = opts.resolveDoc('')
      if (curDoc.ok) {
        const label = curDoc.ref.label.replace(/\\/g, '/')
        p = `docs/${label}.notes/${noteName}.md`
      }
    }

    // 绝对路径（Windows 盘符如 C:/ 或 POSIX 绝对路径）原样放行，供白名单校验
    if (/^[A-Za-z]:\//.test(p) || p.startsWith('/')) {
      return p
    }
    // 显式以 users/ 开头的路径已自带相对根前缀
    if (p.startsWith('users/')) {
      return p
    }
    // 技能目录：skills/... 位于数据根目录（与 users/ 平级），直接映射到 {root}/skills/...
    if (p === 'skills' || p.startsWith('skills/')) {
      const absSkills = storageAbsPath(p)
      if (absSkills) return absSkills.replace(/\\/g, '/')
    }
    // 相对路径（docs/...、workflows/...、stats/...、tmp/...）一律解析为当前用户目录下的绝对路径
    const abs = userAbsPath(p)
    return abs ? abs.replace(/\\/g, '/') : p
  }

  /**
   * 将写入磁盘的教学正文或大纲双向同步至当前内存 Store 及快照。
   * 彻底根治 A2（正文写入被 UI 空 Store 覆盖清空为 0 字节的问题）。
   */
  const syncFileToStore = (filePath: string, content?: string) => {
    if (typeof content !== 'string') return
    try {
      const norm = filePath.replace(/\\/g, '/')
      const matchDoc = norm.match(/(?:^|\/)docs\/(.+)$/)
      if (!matchDoc) return
      const relDoc = matchDoc[1] // 例如 '微积分/极限/极限.md' 或 '微积分/极限/极限.outline.json' 或 '微积分/极限.notes/错题本.md'
      const isOutline = relDoc.endsWith('.outline.json')
      const isMd = relDoc.endsWith('.md')
      if (!isOutline && !isMd) return

      // 处理笔记模式: *.notes/*.md
      const noteMatch = relDoc.match(/(?:^|\/)([^/]+)\.notes\/([^/]+)\.md$/)
      if (noteMatch) {
        const nodeTarget = noteMatch[1]
        const noteName = noteMatch[2]
        const resolved = opts.resolveDoc(nodeTarget)
        if (resolved.ok && opts.docOps?.write) {
          opts.docOps.write(resolved.ref.id, 'note', noteName, content)
        }
        return
      }

      const cleanTarget = relDoc
        .replace(/\.outline\.json$/, '')
        .replace(/\.md$/, '')
      const resolved = opts.resolveDoc(cleanTarget)
      if (!resolved.ok) return
      const nodeId = resolved.ref.id

      if (isMd && opts.docOps?.write) {
        const kind = resolved.ref.kind === 'note' ? 'note' : 'teaching'
        opts.docOps.write(nodeId, kind, resolved.ref.note, content)
      } else if (isOutline) {
        // 大纲镜像：解析成对象交给大纲节点的 editContent（节点宇宙的正规写入口）
        try {
          const parsed = JSON.parse(content)
          opts.nodes?.service()?.get('o:' + nodeId)?.editContent(parsed)
        } catch {
          // 忽略非标准 json
        }
      }
    } catch {
      // 容错捕获，保证 files.write/edit 主通道不受干扰
    }
  }

  const isProtectedChatFile = (p: string): boolean => {
    const norm = p.replace(/\\/g, '/').toLowerCase()
    return norm === 'chat.json' || norm.endsWith('/chat.json')
  }

  const resolveSandboxedDocPath = (raw: string): { ok: true; path: string } | { ok: false; error: string } => {
    const trimmed = raw.trim()
    if (!trimmed) {
      const curDoc = opts.resolveDoc('')
      if (curDoc.ok) {
        const disk = opts.docPath?.(curDoc.ref.id)
        if (disk) {
          return { ok: true, path: resolveSandboxedPath(disk) }
        }
        const label = curDoc.ref.label.replace(/\\/g, '/')
        const title = curDoc.ref.title
        return { ok: true, path: resolveSandboxedPath(`docs/${label}/${title}.md`) }
      }
      return { ok: false, error: '未指定文件路径且当前无激活的教学节点，请显式提供目标文件路径（例如 "docs/..." 或用 api.workspace.list() 查）' }
    }
    return { ok: true, path: resolveSandboxedPath(trimmed) }
  }

  wrapApi(api, 'files.read', async (args) => {
    const rawP = asText(args[0])
    const resolved = resolveSandboxedDocPath(rawP)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.path
    const denied = filesAccessError(rawP || p, 'read')
    if (denied) return denied
    const optArg = args[1]
    const opt = typeof optArg === 'string' ? { encoding: optArg } : asRecord(optArg)
    const nf = getNativeFiles()
    if (!nf) return { ok: true, content: '', encoding: 'utf8', size: 0 }
    return await nf.read(p, {
      encoding: opt.encoding === 'base64' ? 'base64' : opt.encoding === 'binary' ? 'binary' : 'utf8',
      offset: typeof opt.offset === 'number' ? opt.offset : undefined,
      maxBytes: typeof opt.maxBytes === 'number' ? opt.maxBytes : undefined,
    })
  }, log)

  wrapApi(api, 'files.write', async (args) => {
    const rawP = asText(args[0])
    const resolved = resolveSandboxedDocPath(rawP)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.path
    const denied = filesAccessError(rawP || p, 'write')
    if (denied) return denied
    if (isProtectedChatFile(p)) {
      return { ok: false, error: 'chat.json 属于系统核心会话状态，禁止由脚本直接写入或修改' }
    }
    const rawContent = args[1]
    if (rawContent === undefined || rawContent === null) {
      return { ok: false, error: 'files.write 的 content 参数不能为空 (undefined/null)' }
    }
    const content =
      typeof rawContent === 'string'
        ? rawContent
        : typeof rawContent === 'object'
          ? JSON.stringify(rawContent, null, 2)
          : String(rawContent)
    const opt = asRecord(args[2])
    const nf = getNativeFiles()
    if (!nf) {
      syncFileToStore(rawP, content)
      return { ok: true, path: p, bytesWritten: Buffer.byteLength(content, 'utf8') }
    }
    const res = await nf.write(p, content, {
      encoding: opt.encoding === 'base64' ? 'base64' : 'utf8',
      overwrite: opt.overwrite !== false,
    })
    if (res.ok) {
      syncFileToStore(rawP, content)
      vfsBus.notifyExternalChange({ path: p, action: 'write', content, source: 'agent' })
      if (p.includes('/skills/') || p.endsWith('/skills') || p.includes('\\skills\\') || p.endsWith('\\skills')) {
        void loadSkillsFromDisk()
      }
    }
    return res
  }, log)

  wrapApi(api, 'files.edit', async (args) => {
    const rawP = asText(args[0])
    const resolved = resolveSandboxedDocPath(rawP)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.path
    const denied = filesAccessError(rawP || p, 'edit')
    if (denied) return denied
    if (isProtectedChatFile(p)) {
      return { ok: false, error: 'chat.json 属于系统核心会话状态，禁止由脚本直接修改' }
    }
    const opt = asRecord(args[1])
    const nf = getNativeFiles()
    if (!nf) return { ok: true, path: p, modified: false }
    const replaceObj = opt.replace ? asRecord(opt.replace) : undefined
    const editsArr = Array.isArray(opt.edits) ? opt.edits.map(asRecord) : undefined
    const res = await nf.edit(p, {
      replace: replaceObj
        ? {
            target: asText(replaceObj.target ?? replaceObj.old ?? replaceObj.search ?? replaceObj.find),
            replacement: asText(replaceObj.replacement ?? replaceObj.new ?? replaceObj.replace),
            all: replaceObj.all === true,
          }
        : undefined,
      edits: editsArr
        ? editsArr.map((e) => ({
            ...e,
            target: e.target ?? e.old ?? e.search ?? e.find ? asText(e.target ?? e.old ?? e.search ?? e.find) : undefined,
            replacement: e.replacement ?? e.new ?? e.replace ? asText(e.replacement ?? e.new ?? e.replace) : undefined,
            append: typeof e.append === 'string' ? e.append : undefined,
            prepend: typeof e.prepend === 'string' ? e.prepend : undefined,
            insert: typeof e.insert === 'string' ? e.insert : undefined,
            after: typeof e.after === 'string' ? e.after : undefined,
            before: typeof e.before === 'string' ? e.before : undefined,
            all: e.all === true,
          }))
        : undefined,
      content: typeof opt.content === 'string' ? opt.content : undefined,
      append: typeof opt.append === 'string' ? opt.append : undefined,
      prepend: typeof opt.prepend === 'string' ? opt.prepend : undefined,
      start: typeof opt.start === 'number' ? opt.start : undefined,
      end: typeof opt.end === 'number' ? opt.end : undefined,
    })
    if (res.ok) {
      let latestContent: string | undefined
      try {
        const latest = await nf.read(p, { encoding: 'utf8' })
        if (latest.ok && typeof latest.content === 'string') {
          latestContent = latest.content
          syncFileToStore(rawP, latest.content)
        }
      } catch {
        // ignore
      }
      vfsBus.notifyExternalChange({ path: p, action: 'edit', content: latestContent, source: 'agent' })
      if (p.includes('/skills/') || p.endsWith('/skills') || p.includes('\\skills\\') || p.endsWith('\\skills')) {
        void loadSkillsFromDisk()
      }
    }
    return res
  }, log)

  wrapApi(api, 'files.list', async (args) => {
    const rawP = args.length ? asText(args[0]) : '.'
    const denied = filesAccessError(rawP, 'list')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    const nf = getNativeFiles()
    if (!nf) return { ok: true, path: p, entries: [] }
    const res = (await nf.list(p)) as { ok: boolean; path?: string; entries?: Array<string | { name?: string }> }
    if (res && res.ok && Array.isArray(res.entries)) {
      res.entries = res.entries.filter((e) => {
        const name = typeof e === 'string' ? e : e?.name
        return name !== 'chat.json'
      })
    }
    return res
  }, log)

  wrapApi(api, 'files.stat', async (args) => {
    const rawP = asText(args[0])
    const denied = filesAccessError(rawP, 'stat')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    const nf = getNativeFiles()
    if (!nf) return { ok: true, stat: { exists: true, isDirectory: false, isFile: true, size: 0, mtimeMs: 0, ctimeMs: 0 } }
    return await nf.stat(p)
  }, log)

  wrapApi(api, 'files.mkdir', async (args) => {
    const rawP = asText(args[0])
    const denied = filesAccessError(rawP, 'mkdir')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    return await nf.mkdir(p)
  }, log)

  wrapApi(api, 'files.copy', async (args) => {
    const from = resolveSandboxedPath(asText(args[0]))
    const to = resolveSandboxedPath(asText(args[1]))
    const opt = asRecord(args[2])
    const denied = filesAccessError(asText(args[0]) || from, 'copy') ?? filesAccessError(asText(args[1]) || to, 'copy')
    if (denied) return denied
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    return await nf.copy(from, to, { overwrite: opt.overwrite !== false })
  }, log)

  wrapApi(api, 'files.move', async (args) => {
    const from = resolveSandboxedPath(asText(args[0]))
    const to = resolveSandboxedPath(asText(args[1]))
    const denied = filesAccessError(asText(args[0]) || from, 'move') ?? filesAccessError(asText(args[1]) || to, 'move')
    if (denied) return denied
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    return await nf.move(from, to)
  }, log)

  wrapApi(api, 'files.delete', async (args) => {
    const rawP = asText(args[0])
    const denied = filesAccessError(rawP, 'delete')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    if (isProtectedChatFile(p)) {
      return { ok: false, error: 'chat.json 属于系统核心会话状态，禁止由脚本删除' }
    }
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    const res = await nf.delete(p)
    if (res.ok) {
      vfsBus.notifyExternalChange({ path: p, action: 'delete', source: 'agent' })
      if (p.includes('/skills/') || p.endsWith('/skills') || p.includes('\\skills\\') || p.endsWith('\\skills')) {
        void loadSkillsFromDisk()
      }
    }
    return res
  }, log)
}
