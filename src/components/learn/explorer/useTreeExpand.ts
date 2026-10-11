/**
 * 这个文件负责：知识树的展开状态——用户的手动开关（manual）优先，没手动指定过的节点看
 * 自动展开的累积记忆（autoOpen）；箭头要的 isOpen / toggle 由这里出去。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import { ancestors } from '../../../learn/graph'
import { subscribeReveal } from './reveal'

export function useTreeExpand(store: LearnStore, activeNodeId: string | null) {
  // 展开状态：用户手动开关优先；未手动指定的节点，默认展开当前节点的祖先
  const [manual, setManual] = useState<Map<string, boolean>>(new Map())
  const autoOpenRef = useRef<Set<string>>(new Set())

  // 当前节点的祖先链：累积至 autoOpenRef，保证只加不减，且不触发渲染期 setState 级联重跑
  const activeChain = useMemo(() => {
    if (!activeNodeId) return new Set<string>()
    const chain = ancestors(store, activeNodeId)
    for (const id of chain) {
      autoOpenRef.current.add(id)
    }
    return new Set(chain)
  }, [store, activeNodeId])

  const isOpen = useCallback(
    (id: string) => {
      const m = manual.get(id)
      if (m !== undefined) return m
      return autoOpenRef.current.has(id) || activeChain.has(id)
    },
    [manual, activeChain],
  )

  const toggle = useCallback(
    (id: string) =>
      setManual((prev) => {
        const next = new Map(prev)
        const currentOpen = prev.get(id) ?? (autoOpenRef.current.has(id) || activeChain.has(id))
        next.set(id, !currentOpen)
        return next
      }),
    [activeChain],
  )

  useEffect(
    () =>
      subscribeReveal((req) => {
        if (!req.nodes.length) return
        setManual((prev) => {
          let next: Map<string, boolean> | null = null
          for (const id of req.nodes) {
            autoOpenRef.current.add(id)
            if (prev.get(id) === true) continue
            if (!next) next = new Map(prev)
            next.set(id, true)
          }
          return next ?? prev
        })
      }),
    [],
  )

  return { isOpen, toggle }
}
