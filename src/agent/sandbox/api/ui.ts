/**
 * 这个文件负责什么：页面反馈 api 的装配（ui.*）——toast、把教学文档打开并定位给用户看
 * （ui.point，行号→定位文字+比例兜底的规则与 moji:doc/…#L12 跳转语法共用）、页面滚动、
 * 截屏与超级文档打开。docRef / nodeRef 两个寻址闭包原来在 buildApi 顶部，全仓库只有
 * ui.* 用到，随组搬进来。
 * 注意：ui.dom 不在这里注册——回调函数无法穿过 Worker 边界（见 sandboxRuntime 与
 * createExecuteTool 的 callApi 的特判）。
 */
import { needleForDoc } from '../../../lib/docDom'
import { asIndex, asRecord, asText, type DocRef, type NodeRef } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 页面反馈域：ui.toast / ui.point / ui.scroll / ui.screenshot / ui.superdoc */
export function installUi(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  const docRef = (path: unknown): { ref: DocRef } | { error: string } => {
    const r = opts.resolveDoc(asText(path))
    return r.ok ? { ref: r.ref } : { error: r.message }
  }
  const nodeRef = (path: unknown): { ref: NodeRef } | { error: string } => {
    const r = opts.resolveNode(asText(path))
    return r.ok ? { ref: r.ref } : { error: r.message }
  }

  if (opts.ui) {
    const ui = opts.ui
    if (ui.toast) {
      const toast = ui.toast
      wrapApi(api, 'ui.toast', (args) => {
        const message = asText(args[0]).trim()
        if (!message) return { error: '消息不能为空' }
        toast(message.slice(0, 200))
        return { ok: true }
      }, log)
    }
    if (ui.point) {
      const point = ui.point
      wrapApi(api, 'ui.point', async (args) => {
        /**
         * 两种写法都收：ui.point(path, { line, regex }) 与 ui.point({ path, line, regex })。
         * path 省略 = 当前节点的教学文档（与 doc.* 的约定一致）。
         */
        const hasPathFirst = typeof args[0] === 'string'
        const path = hasPathFirst ? asText(args[0]) : asText(asRecord(args[0]).path)
        const obj = asRecord(hasPathFirst ? args[1] : args[0])
        const r = docRef(path)
        if ('error' in r) return { error: r.error }
        const ref = r.ref
        const content = opts.docOps.read(ref.id, ref.kind, ref.note)
        // 行号 → 定位文字 + 比例兜底：这一套规则与文档跳转语法（moji:doc/…#L12）共用，
        // 见 lib/docDom 的 needleForDoc
        const byLine = needleForDoc(content, { line: asIndex(obj.line) })
        let needle = byLine.needle ?? ''
        let fallbackRatio: number | undefined = byLine.fallbackRatio
        const pattern = asText(obj.regex)
        if (!needle && pattern) {
          try {
            const flags = asText(obj.flags)
            const m = new RegExp(pattern, flags).exec(content)
            if (m && m[0]) {
              needle = m[0].replace(/\s+/g, ' ').trim().slice(0, 160)
              fallbackRatio = m.index / Math.max(1, content.length)
            }
          } catch (err) {
            return { error: '正则不合法：' + (err instanceof Error ? err.message : String(err)) }
          }
        }
        const res = await point({
          nodeId: ref.id,
          kind: ref.kind,
          ...(ref.note ? { note: ref.note } : {}),
          ...(needle ? { needle } : {}),
          ...(fallbackRatio !== undefined ? { fallbackRatio } : {}),
        })
        const hasSpecificTarget = !!needle || !!pattern || asIndex(obj.line) !== undefined
        return {
          ok: true,
          path: ref.docLabel,
          located: res.located,
          note: !hasSpecificTarget
            ? '已在页签里打开教学文档，用户看得到。'
            : res.located
              ? '已在页签里打开并定位，用户看得到。'
              : '文档已打开；没能在正文里精确选中（这一行可能是公式或代码），已按大致位置滚动。要指给用户看，请说明去看什么。',
        }
      }, log)
    }
    if (ui.scroll) {
      const scroll = ui.scroll
      wrapApi(api, 'ui.scroll', (args) => {
        const a = asRecord(args[0])
        const to = a.to === 'top' || a.to === 'bottom' ? a.to : undefined
        const by = typeof a.by === 'number' ? Math.max(-20_000, Math.min(20_000, Math.round(a.by))) : undefined
        if (!to && !by) return { error: "要给出方向：ui.scroll({ to: 'top' | 'bottom' }) 或 ui.scroll({ by: 像素，负数往上 })" }
        scroll({ ...(to ? { to } : {}), ...(by !== undefined ? { by } : {}) })
        return { ok: true }
      }, log)
    }
    if (ui.capture) {
      const capture = ui.capture
      wrapApi(api, 'ui.screenshot', () => capture(), log)
    }
    if (ui.openSuper) {
      const openSuper = ui.openSuper
      wrapApi(api, 'ui.superdoc', async (args) => {
        // 两种写法都收：ui.superdoc(path, name) 与 ui.superdoc({ path, name })
        const obj = asRecord(args.length === 1 ? args[0] : args[1])
        const path = args.length === 1 ? asText(obj.path) : asText(args[0])
        const name = (args.length === 1 ? asText(obj.name) : asText(args[1])).trim()
        if (!name) return { error: '要给出超级文档的名字：ui.superdoc(path?, name)' }
        const r = nodeRef(path)
        if ('error' in r) return { error: r.error }
        const res = await openSuper({ nodeId: r.ref.id, name })
        return {
          ok: true,
          opened: res.opened,
          note: res.opened
            ? '已在页签里打开「' + name + '」，用户看得到。'
            : '这个节点下尚未找到叫「' + name + '」的超级文档（请确认已通过 api.files.write 写入对应节点的 superdocs/' + name + '.html 文件）。',
        }
      }, log)
    }
    // ui.dom 不在这里注册：回调函数无法穿过 Worker 边界，Worker 侧特判成
    // 「先建会话、再逐个操作」（见 sandboxRuntime 与 createExecuteTool 的 callApi）
  }
}
