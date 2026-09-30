/**
 * 超级文档（sdoc.*）这一组 ops 的宿主实现：绑定节点的可交互 HTML，只落 state.json。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 sdoc.* 一组。
 */

import type { SuperDocOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import { superDocsOf } from '../types'
import { nodeById } from '../graph'
import { nodePathOf } from '../paths'
import { SUPERDOC_MAX_CHARS, readSuperDoc, removeSuperDoc, writeSuperDoc } from '../superdocs'

/**
 * 超级文档（sdoc.*）的宿主实现：绑定节点的可交互 HTML，只落 state.json、
 * 不做磁盘镜像（见 learn/superdocs）。返回值照旧写成「人话」：模型只有这一句话能依据。
 */
export function createSuperDocOps(deps: AgentOpsDeps): SuperDocOps {
  const store0 = () => deps.getLatest()
  const stamp = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

  return {
    list: (nodeId) => {
      const s = store0()
      const node = nodeById(s, nodeId)
      if (!node) return { error: '这个节点已经不存在了（可能刚被删除）' }
      const items = superDocsOf(node).map((d) => ({
        name: d.name,
        chars: d.html.length,
        empty: !d.html.trim(),
        updatedAt: stamp(d.updatedAt),
      }))
      return {
        node: nodePathOf(s, deps.goalId(), nodeId),
        count: items.length,
        items,
        note: items.length
          ? '打开给用户看用 api.ui.superdoc(path, name)。'
          : '这个节点还没有超级文档。sdoc.write(path, 名字, 完整HTML) 会创建一份。',
      }
    },

    read: (nodeId, name) => {
      const doc = readSuperDoc(store0(), nodeId, name)
      if (!doc) return { error: '这个节点下没有叫「' + name + '」的超级文档。用 api.sdoc.list(path) 核对名字。' }
      return { name: doc.name, chars: doc.html.length, html: doc.html, updatedAt: stamp(doc.updatedAt) }
    },

    write: (nodeId, name, html) => {
      if (!html.trim()) return { error: '内容为空：sdoc.write 需要一份完整的 HTML（按钮、样式、脚本都在里面）' }
      if (html.length > SUPERDOC_MAX_CHARS) {
        return { error: `超级文档最长 ${SUPERDOC_MAX_CHARS} 字符（收到 ${html.length}）；拆成几份或把重逻辑挪进 method 函数` }
      }
      const s = store0()
      const node = nodeById(s, nodeId)
      if (!node) return { error: '这个节点已经不存在了（可能刚被删除）' }
      const existed = !!name && superDocsOf(node).some((d) => d.name.toLowerCase() === name.trim().toLowerCase())
      const next = writeSuperDoc(s, nodeId, name, html)
      if (!next) return { error: '写入失败：这个节点已经不在了' }
      deps.set(next)
      const finalName = name?.trim()
        ? next.nodes.find((n) => n.id === nodeId)?.superdocs?.find(
            (d) => d.name.toLowerCase() === name.trim().toLowerCase(),
          )?.name ?? name.trim()
        : (next.nodes.find((n) => n.id === nodeId)?.superdocs?.slice(-1)[0]?.name ?? '')
      return {
        ok: true,
        name: finalName,
        chars: html.length,
        ...(existed ? {} : { created: true }),
        note:
          (existed ? '已覆盖更新「' + finalName + '」' : '已创建超级文档「' + finalName + '」') +
          '。用 api.ui.superdoc("' + nodePathOf(store0(), deps.goalId(), nodeId) + '", "' + finalName + '") 打开给用户；' +
          '脚本里调 api.method.call(name, ...) 执行持久化函数。',
      }
    },

    remove: (nodeId, name) => {
      const s = store0()
      const node = nodeById(s, nodeId)
      if (!node) return { error: '这个节点已经不存在了（可能刚被删除）' }
      if (!findSuperDocLike(superDocsOf(node), name)) {
        return { error: '这个节点下没有叫「' + name + '」的超级文档。用 api.sdoc.list(path) 核对名字。' }
      }
      deps.set(removeSuperDoc(s, nodeId, name))
      return { ok: true, deleted: name, note: '已删除；开着的那份超级文档页签会一并失效。' }
    },
  }
}

/** 大小写不敏感地找一份超级文档（与 learn/superdocs 的 findSuperDoc 同口径，这里只为报错文案用） */
function findSuperDocLike(docs: Array<{ name: string }>, name: string): { name: string } | undefined {
  const key = (name ?? '').trim().toLowerCase()
  return docs.find((d) => d.name.toLowerCase() === key)
}
