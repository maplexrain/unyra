/**
 * 这个文件负责什么：资源库 api 的装配（res.*）——静态资源（图片等）的列举、区间读、
 * 建改删与引用查询。资源本体与引用计数都在宿主 ResourceOps 上，这里只整形参数。
 */
import { asIndex, asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 资源库域：res.list / res.info / res.read / res.create / res.update / res.delete / res.refs */
export function installRes(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  if (opts.resources) {
    const res = opts.resources
    const uuid = (v: unknown): string => asText(v).trim()
    wrapApi(api, 'res.list', () => res.list(), log)
    wrapApi(api, 'res.info', (args) => res.info(uuid(args[0])), log)
    wrapApi(api, 'res.read', (args) => {
      // 区间读法：res.read(uuid, { start, end })
      const a = asRecord(args[1])
      return res.read(uuid(args[0]), { start: asIndex(a.start), end: asIndex(a.end) })
    }, log)
    wrapApi(api, 'res.create', (args) => {
      const a = asRecord(args[0])
      return res.create({ name: asText(a.name), ext: asText(a.ext), content: asText(a.content) })
    }, log)
    wrapApi(api, 'res.update', (args) => {
      const p = asRecord(args[1])
      const patch: { name?: string; description?: string; content?: string } = {}
      if (typeof p.name === 'string') patch.name = p.name
      if (typeof p.description === 'string') patch.description = p.description
      if (typeof p.content === 'string') patch.content = p.content
      return res.update(uuid(args[0]), patch)
    }, log)
    wrapApi(api, 'res.delete', (args) => {
      // res.delete(uuid, { force: true }) 与 res.delete(uuid, true) 都收
      const force = args[1] === true || asRecord(args[1]).force === true
      return res.remove(uuid(args[0]), force)
    }, log)
    wrapApi(api, 'res.refs', (args) => res.refs(args.length ? uuid(args[0]) : undefined), log)
  }
}
