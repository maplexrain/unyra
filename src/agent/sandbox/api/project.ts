/**
 * 这个文件负责什么：项目节点与视频节点附属 api 的装配（project.* / video.*）——
 * project.* 把项目节点内部当成一个小文件系统来读写（tree/read/write/edit/mkdir/
 * move/copy/delete），video.* 是视频节点内容的查询入口。全部走宿主 ProjectOps /
 * VideoOps，uuid 都来自 api.node.list 的清单。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 项目与视频节点域：project.* + video.* */
export function installProject(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  if (opts.video) {
    wrapApi(api, 'video.list', async () => {
      return opts.video?.list() ?? []
    }, log)
    wrapApi(api, 'video.get', async (args) => {
      const target = asText(args[0]).trim()
      if (!target) return { ok: false, error: 'video.get 需要提供 videoId 或视频节点的 uuid' }
      return await opts.video?.get(target)
    }, log)
  }

  if (opts.project) {
    const po = opts.project
    wrapApi(api, 'project.list', async () => {
      return po.list()
    }, log)
    wrapApi(api, 'project.tree', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.tree 需要项目节点的 uuid（api.node.list() 的 projects 段）' }
      const sub = typeof args[1] === 'string' ? args[1] : ''
      return po.tree(uuid, sub)
    }, log)
    wrapApi(api, 'project.read', async (args) => {
      const uuid = asText(args[0]).trim()
      const sub = asText(args[1])
      if (!uuid) return { ok: false, error: 'project.read 需要项目节点的 uuid 与它内部的相对路径（subPath，根写空串）' }
      const rawOpt = args[2]
      const opt = typeof rawOpt === 'string' ? { encoding: rawOpt as 'utf8' | 'base64' } : asRecord(rawOpt)
      return po.read(uuid, sub, opt as { encoding?: 'utf8' | 'base64'; maxBytes?: number; offset?: number })
    }, log)
    wrapApi(api, 'project.write', async (args) => {
      const uuid = asText(args[0]).trim()
      const sub = asText(args[1])
      if (!uuid) return { ok: false, error: 'project.write 需要项目节点的 uuid 与它内部的相对路径（subPath，根写空串）' }
      const content = args[2]
      if (content === undefined || content === null) return { ok: false, error: 'project.write 缺少 content' }
      const opt = asRecord(args[3])
      return po.write(uuid, sub, typeof content === 'string' ? content : JSON.stringify(content, null, 2), opt as { encoding?: 'utf8' | 'base64'; overwrite?: boolean })
    }, log)
    wrapApi(api, 'project.edit', async (args) => {
      const uuid = asText(args[0]).trim()
      const sub = asText(args[1])
      if (!uuid) return { ok: false, error: 'project.edit 需要项目节点的 uuid 与它内部的相对路径（subPath）' }
      const edit = asRecord(args[2])
      if (!Object.keys(edit).length) return { ok: false, error: 'project.edit 需要 { content | replace | append } 之一的编辑参数' }
      return po.edit(uuid, sub, edit as { content?: string; replace?: { target: string; replacement: string; all?: boolean }; append?: string })
    }, log)
    wrapApi(api, 'project.mkdir', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.mkdir 需要项目节点的 uuid 与要建的目录路径（相对该项目根）' }
      return po.mkdir(uuid, asText(args[1]))
    }, log)
    wrapApi(api, 'project.move', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.move 需要 uuid、from（项目内相对路径）与 to（同样是项目内相对路径）' }
      const from = asText(args[1])
      const to = asText(args[2])
      if (!from || !to) return { ok: false, error: 'project.move 的 from / to 都要给（项目内的相对路径）' }
      return po.move(uuid, from, to)
    }, log)
    wrapApi(api, 'project.copy', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.copy 需要 uuid、from 与 to（项目内的相对路径）' }
      const from = asText(args[1])
      const to = asText(args[2])
      if (!from || !to) return { ok: false, error: 'project.copy 的 from / to 都要给（项目内的相对路径）' }
      const opt = asRecord(args[3])
      return po.copy(uuid, from, to, opt as { overwrite?: boolean })
    }, log)
    wrapApi(api, 'project.delete', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.delete 需要 uuid 与要删的路径（项目内的相对路径；不可逆，先确认）' }
      const sub = asText(args[1])
      if (!sub) return { ok: false, error: 'subPath 不能是空串：删除项目根本身请走 api.node.delete 撤掉这条声明' }
      return po.delete(uuid, sub)
    }, log)
  }
}
