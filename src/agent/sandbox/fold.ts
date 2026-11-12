/**
 * 回执折节点对象：节点对象（__node 门面）的 content 是吐 Promise 的 getter、方法都是
 * 函数——结构化克隆必炸（真沙箱），进 safeJson 也只会变成 {}（进程内）。返回值里遇到
 * 就折成一份**纯数据快照**（uuid/kind/title/relations）：回执照样可读，模型要再用这个
 * 节点就按 uuid 重新 get。
 *
 * 两份运行时各自自包含：真沙箱的副本在 sandboxRuntime.js（结构守卫
 * tests/sandboxRuntimeFacade.test.ts 钉住两份都在），本文件服务进程内直调。
 */
const MAX_NESTED_STRING_CHARS = 1500

export function foldNodes(v: unknown, seen: Set<unknown> = new Set(), isRoot: boolean = true): unknown {
  if (!v || typeof v !== 'object') {
    if (typeof v === 'string' && !isRoot && v.length > MAX_NESTED_STRING_CHARS && !v.startsWith('data:image/')) {
      return (
        v.slice(0, 300) +
        `\n... [折叠: 字段内容共 ${v.length} 字符，已持久化落盘，回执自动折叠避免撑爆上下文] ...\n` +
        v.slice(-100)
      )
    }
    return v
  }
  // __node 判定放在 seen 之前：节点对象折成快照就返回（终结点），不进路径也不该挡后面再次出现
  if ((v as { __node?: unknown }).__node === true) {
    const n = v as { uuid?: unknown; kind?: unknown; title?: unknown; relations?: unknown }
    return { __node: true, uuid: n.uuid, kind: n.kind, title: n.title, relations: n.relations }
  }
  if (seen.has(v)) return '［循环引用］'
  seen.add(v)
  // seen 记的是「当前路径」而不是「见过的全部」：同一对象出现两次是重复，不是循环
  if (Array.isArray(v)) {
    const out = v.map((x) => foldNodes(x, seen, false))
    seen.delete(v)
    return out
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as Record<string, unknown>)) {
    out[k] = foldNodes((v as Record<string, unknown>)[k], seen, false)
  }
  seen.delete(v)
  return out
}
