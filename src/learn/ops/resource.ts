/**
 * 资源库（res.*）这一组 ops 的宿主实现：清单在 store、字节在磁盘，含图片附件与文件卡片。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 res.* 一组。
 */

import type { ResourceOps } from '../../agent/tools'
import type { AgentOpsDeps, ResourceIo } from './deps'
import { READ_LIMIT } from './text'
import {
  addResource,
  dropResource,
  fileNameOf,
  findByHash,
  findResource,
  formatBytes,
  goalStaticDir,
  hashOfText,
  isImageExt,
  makeResource,
  mimeOfExt,
  patchResource,
  refCountOf,
  resourceRel,
  resourcesOf,
  scanRefs,
  shortHash,
  typeOfExt,
  type StaticResource,
} from '../static'

/**
 * 资源库（res.*）的宿主实现：清单落在 store 上，字节落在磁盘上（见 learn/static）。
 *
 * 两条贯穿始终的规矩：
 * 1. **图片不进返回值**。res.read 读图片时只回一句回执，图片挂在 images 上由运行时
 *    送到下一跳——文本通道会把 base64 截成乱码，还永久占着上下文（见 AgentToolResult）。
 * 2. **读不到就说清楚是什么读不到**。清单是内存里的、文件在磁盘上，两者可能不同步
 *    （用户手工删过、改名时没搬成功）。报错要把「清单里有、文件读不到」讲明白，
 *    否则模型只会一遍遍重试同一个 uuid。
 */
export function createResourceOps(deps: AgentOpsDeps, io: ResourceIo): ResourceOps {
  const store0 = () => deps.getLatest()
  const goal = () => deps.goalId()
  /** 回给模型的时间：ISO 前 16 位够读，也不用它去解析毫秒数 */
  const stamp = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
  const missing = (uuid: string): string =>
    '没有这条资源：' +
    (uuid || '（uuid 是空的）') +
    '。用 res.list() 看当前目标有哪些资源，uuid 就是清单里那一串。'
  const find = (uuid: string): StaticResource | null => findResource(store0(), goal(), uuid)
  const kindOf = (r: StaticResource): string =>
    r.type === 'text' ? 'text' : isImageExt(r.ext) ? 'image' : 'binary'
  const bytesOf = (text: string): number => new TextEncoder().encode(text).length

  /** 单条资源的公开面目：清单字段 + 可读的大小与日期 + 引用数 */
  const view = (r: StaticResource): Record<string, unknown> => ({
    uuid: r.uuid,
    file: fileNameOf(r),
    kind: kindOf(r),
    bytes: r.bytes,
    size: formatBytes(r.bytes),
    uploadAt: stamp(r.createdAt),
    updatedAt: stamp(r.updatedAt),
    description: r.description,
    // 指纹只给前 12 位：够认出「这两条内容一样」，又不占地方（完整值见 res.info）
    hash: shortHash(r.hash),
    refs: refCountOf(store0(), r.uuid),
  })

  return {
    list: () => {
      const s = store0()
      const items = resourcesOf(s, goal()).map(view)
      return {
        dir: goalStaticDir(s, goal()),
        count: items.length,
        note: items.length
          ? 'refs 是「本目标里有多少处文档引用了它」。在文档里引用的写法：![说明](moji:static/uuid)'
          : '这个目标还没有资源。用户往输入框里贴图片会自动转存到这里。',
        resources: items,
      }
    },

    info: (uuid) => {
      const r = find(uuid)
      if (!r) return { error: missing(uuid) }
      const refs = scanRefs(store0(), uuid)
      return {
        ...view(r),
        hash: r.hash,
        mime: mimeOfExt(r.ext),
        refs,
        refCount: refs.reduce((sum, x) => sum + x.count, 0),
        hint:
          kindOf(r) === 'image'
            ? 'res.read(uuid) 会把这张图附到你的下一步里（不会给你 base64）。'
            : r.type === 'text'
              ? 'res.read(uuid) 能读到正文；改内容用 res.update(uuid, { content })。'
              : '二进制文件读不出内容；可以 res.refs(uuid) 看谁在引用它。',
      }
    },

    read: async (uuid, range) => {
      const s = store0()
      const r = find(uuid)
      if (!r) return { error: missing(uuid) }
      const rel = resourceRel(s, goal(), r)
      if (!rel) return { error: '找不到这个目标的目录，资源读不了。' }

      if (r.type === 'text') {
        const text = await io.readText(rel)
        if (text === null) {
          return {
            error:
              '文件读不到（清单里有、磁盘上没有）：' +
              fileNameOf(r) +
              '。可能被手工删过或移动过，用 res.list() 核对，必要时重新建一份。',
          }
        }
        const total = text.length
        const start = Math.max(0, Math.min(range?.start ?? 0, total))
        const end = Math.max(start, Math.min(range?.end ?? start + READ_LIMIT, total));
        return {
          uuid,
          file: fileNameOf(r),
          kind: 'text',
          chars: total,
          start,
          end,
          content: text.slice(start, end),
          ...(end < total
            ? {
                note:
                  '只回了第 ' + start + '~' + end + ' 字（共 ' + total + ' 字）。看后面继续用 res.read(uuid, { start, end })。',
              }
            : {}),
        }
      }

      if (isImageExt(r.ext)) {
        const loaded = await io.readImage(rel)
        if (!loaded) {
          return { error: '图片读不到（清单里有、磁盘上没有）：' + fileNameOf(r) + '。请把情况告诉用户。' }
        }
        return {
          uuid,
          file: fileNameOf(r),
          kind: 'image',
          mime: loaded.mime,
          bytes: r.bytes,
          note:
            '图片已附在下一跳，你会在下一步直接看到它（读图有代价，一次只看真正需要的几张）。' +
            '它的文字内容不会以文本形式给你。',
          // 这一项由 agent/tools 收集、由运行时挂成图片片段，不会进文本
          images: [{ id: r.uuid, rel, name: fileNameOf(r), mime: loaded.mime, bytes: r.bytes }],
        }
      }

      return {
        uuid,
        file: fileNameOf(r),
        kind: 'binary',
        mime: mimeOfExt(r.ext),
        bytes: r.bytes,
        note:
          '二进制文件读不出内容（不是图片，没法附给你看）。可以在文档里引用它：' +
          '![说明](moji:static/' +
          uuid +
          ')，或用 res.refs(uuid) 看谁在引用。',
      }
    },

    create: async ({ name, ext, content }) => {
      if (!content.trim()) return { error: '内容为空：res.create 需要 content（文本内容）' }
      const clean = ext.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'md'
      if (typeOfExt(clean) !== 'text') {
        return {
          error:
            '只能新建文本类资源（md / txt / json / csv / yaml…），收到后缀「' +
            clean +
            '」。二进制文件（图片、PDF）请让用户拖进输入框，或放进数据目录后手工登记。',
        }
      }
      const s = store0()
      const rel0 = goalStaticDir(s, goal())
      if (!rel0) return { error: '找不到这个目标的目录，资源建不了。' }
      /**
       * 内容一样就不再存第二份：返回已有的那条，uuid 与文件都不动。
       * 这既是省地方，也是让「同一份东西只有一个身份」——引用它的人不会分成两拨。
       */
      const hash = await hashOfText(content)
      const dup = findByHash(s, goal(), hash)
      if (dup) {
        return {
          ok: true,
          uuid: dup.uuid,
          file: fileNameOf(dup),
          bytes: dup.bytes,
          reused: true,
          note: '内容与已有资源「' + fileNameOf(dup) + '」完全相同，直接复用了它（没有新建文件）。',
        }
      }
      const resource = makeResource({ name: name.trim() || '未命名资源', ext: clean, bytes: bytesOf(content), hash })
      const rel = rel0 + '/' + resource.uuid + '.' + clean
      if (!(await io.writeText(rel, content))) {
        return { error: '文件写入失败，资源没有登记（清单与磁盘必须一致）。' }
      }
      deps.set(addResource(store0(), goal(), resource))
      return {
        ok: true,
        uuid: resource.uuid,
        file: fileNameOf(resource),
        bytes: resource.bytes,
        note:
          '已建好。在文档里引用它写 ![说明](moji:static/' +
          resource.uuid +
          ')，并建议顺手用 res.update(uuid, { description }) 写一句说明。',
      }
    },

    update: async (uuid, patch) => {
      const r = find(uuid)
      if (!r) return { error: missing(uuid) }
      const done: string[] = []
      const now = Date.now()

      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) return { error: '名称不能为空' }
        deps.set(patchResource(store0(), goal(), uuid, { name, updatedAt: now }))
        done.push('名称改为「' + name + '」')
      }
      if (patch.description !== undefined) {
        const description = patch.description.trim()
        deps.set(patchResource(store0(), goal(), uuid, { description, updatedAt: now }))
        done.push('描述' + (description ? '已更新（' + description.length + ' 字）' : '已清空'))
      }
      if (patch.content !== undefined) {
        if (r.type !== 'text') {
          return {
            error:
              '「' +
              fileNameOf(r) +
              '」是二进制资源，内容改不了；名称与描述可以改：res.update(uuid, { name, description })。',
          }
        }
        if (!patch.content.trim()) return { error: '内容为空，未做修改' }
        const rel = resourceRel(store0(), goal(), r)
        if (!rel || !(await io.writeText(rel, patch.content))) {
          return { error: '写入失败：' + fileNameOf(r) + '（清单没有改动）' }
        }
        deps.set(
          patchResource(store0(), goal(), uuid, {
            bytes: bytesOf(patch.content),
            hash: await hashOfText(patch.content),
            updatedAt: now,
          }),
        )
        done.push('内容已更新（' + patch.content.length + ' 字）')
      }

      if (!done.length) return { error: '没有给出要改的字段（name / description / content）' }
      const after = find(uuid)
      return {
        ok: true,
        uuid,
        file: after ? fileNameOf(after) : fileNameOf(r),
        changes: done,
        note: '引用它的文档不用改：文档里存的是 uuid，改名不动 uuid。',
      }
    },

    remove: async (uuid, force) => {
      const r = find(uuid)
      if (!r) return { error: missing(uuid) }
      /**
       * 还被引用时不静默删：删掉之后文档里那几处 ![](moji:static/…) 会变成
       * 「资源不存在」。要删就显式 force，并且把受影响的文档名报出来。
       */
      const refs = scanRefs(store0(), uuid)
      if (refs.length && !force) {
        const where = refs
          .slice(0, 5)
          .map((x) => x.path + '（' + x.docLabel + '，' + x.count + ' 处）')
          .join('、')
        return {
          error:
            '「' +
            fileNameOf(r) +
            '」还被 ' +
            refs.length +
            ' 份文档引用着：' +
            where +
            (refs.length > 5 ? ' 等' : '') +
            '。删掉之后那些引用会变成死链。确认要删就再调一次 res.delete(uuid, { force: true })，' +
            '或者先把文档里的引用改掉。',
        }
      }
      const rel = resourceRel(store0(), goal(), r)
      if (rel && !(await io.remove(rel))) {
        return { error: '文件删除失败：' + fileNameOf(r) + '（清单没有改动）' }
      }
      deps.set(dropResource(store0(), goal(), uuid))
      return {
        ok: true,
        deleted: fileNameOf(r),
        uuid,
        removedRefs: refs.reduce((sum, x) => sum + x.count, 0),
        note: refs.length
          ? '有 ' +
            refs.length +
            ' 份文档里的引用已变成死链（显示为「资源不存在」），需要时顺手清理掉。'
          : '它本来就没有被任何文档引用。',
      }
    },

    refs: (uuid) => {
      const s = store0()
      if (uuid) {
        const r = find(uuid)
        if (!r) return { error: missing(uuid) }
        const list = scanRefs(s, uuid)
        return {
          uuid,
          file: fileNameOf(r),
          count: list.reduce((sum, x) => sum + x.count, 0),
          refs: list.map((x) => ({
            node: x.path,
            nodeId: x.nodeId,
            doc: x.docLabel,
            count: x.count,
            ...(x.foreign ? { foreign: true } : {}),
          })),
          note: list.length
            ? list.some((x) => x.foreign)
              ? '其中有别的目标里的文档在引用它（foreign: true）——那些文档不属于本目标。'
              : ''
            : '没有任何文档引用它。',
        }
      }
      const items = resourcesOf(s, goal()).map((r) => ({
        uuid: r.uuid,
        file: fileNameOf(r),
        kind: kindOf(r),
        size: formatBytes(r.bytes),
        refs: refCountOf(s, r.uuid),
        description: r.description,
      }))
      const orphan = items.filter((x) => !x.refs)
      return {
        count: items.length,
        unreferenced: orphan.length,
        note: orphan.length
          ? '有 ' +
            orphan.length +
            ' 条资源没有任何文档引用（未被引用不等于没用，删之前先确认）。'
          : items.length
            ? '每条资源都至少被引用了一次。'
            : '这个目标还没有资源。',
        resources: items,
      }
    },
  }
}
