/**
 * 本文件负责：节点正文里那些注解（词条 + 讲解）的增、改、删。
 */
import type { AnnotationKind, AnnotationStyle, LearnStore } from '../types'
import { nodeById, updateNode } from './nodes'

/**
 * 添加/更新注解。一个词只保留一条（term 相同即视为同一条）。已存在则覆盖正文与来源——
 * 这样「了解」之后再写「笔记」可以自然接管同一条，「笔记」改完再次保存也是同一条。
 *
 * occurrence 是词条在正文里的第几次出现（从 0 起，见 types 的 Annotation）：
 * 用户在哪一处划的词就记哪一处，渲染时据此标到同一处，而不是永远标第一次出现。
 * 同一条注解在这处重新保存时，序号会一并更新——等于把标记挪到新位置。
 */
export function addAnnotation(
  store: LearnStore,
  nodeId: string,
  term: string,
  body: string,
  kind: AnnotationKind = 'understand',
  style?: AnnotationStyle,
  occurrence?: number,
): LearnStore {
  const node = nodeById(store, nodeId)
  if (!node) return store
  const t = term.trim()
  const b = body.trim()
  if (!t || !b) return store
  const exists = node.annotations.some((a) => a.term === t)
  const at =
    typeof occurrence === 'number' && Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 0
  const entry = { term: t, body: b, kind, ...(style ? { style } : {}), ...(at ? { occurrence: at } : {}) }
  const annotations = exists
    ? node.annotations.map((a) => (a.term === t ? entry : a))
    : [...node.annotations, entry]
  return updateNode(store, nodeId, { annotations })
}

/** 只改正文/样式（或来源），词条本身不动 */
export function updateAnnotation(
  store: LearnStore,
  nodeId: string,
  term: string,
  patch: { body?: string; kind?: AnnotationKind; style?: AnnotationStyle },
): LearnStore {
  const node = nodeById(store, nodeId)
  if (!node) return store
  const t = term.trim()
  const target = node.annotations.find((a) => a.term === t)
  if (!target) return store
  const body = patch.body !== undefined ? patch.body.trim() : target.body
  if (!body) return store
  const style = patch.style !== undefined ? patch.style : target.style
  const annotations = node.annotations.map((a) =>
    a.term === t
      ? { ...a, body, kind: patch.kind ?? a.kind ?? 'understand', ...(style ? { style } : { style: undefined }) }
      : a,
  )
  return updateNode(store, nodeId, { annotations })
}

export function removeAnnotation(store: LearnStore, nodeId: string, term: string): LearnStore {
  const node = nodeById(store, nodeId)
  if (!node) return store
  return updateNode(store, nodeId, { annotations: node.annotations.filter((a) => a.term !== term) })
}

