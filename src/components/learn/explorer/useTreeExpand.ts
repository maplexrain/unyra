/**
 * 这个文件负责：知识树的展开状态——用户的手动开关（manual）优先，没手动指定过的节点看
 * 自动展开的累积记忆（autoOpen）；箭头要的 isOpen / toggle 由这里出去。
 */
import { useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import { ancestors } from '../../../learn/graph'

export function useTreeExpand(store: LearnStore, activeNodeId: string | null) {
  // 展开状态：用户手动开关优先；未手动指定的节点，默认展开当前节点的祖先，
  // 保证当前层级始终可见。渲染期派生，不用 effect 二次 setState。
  const [manual, setManual] = useState<Map<string, boolean>>(new Map())

  /**
   * 自动展开过的节点：**只加不减**（用户定的）。
   *
   * 先前这里是「当前节点的祖先链」当场派生出来的，于是选中态一挪，原来那条链就不再展开——
   * 用户刚展开、刚看过的东西会自己收起来，树在眼皮底下动。现在它是一条**累积的记忆**：
   * 走到哪儿就把沿路展开，之后一直保持（要收起得自己点那根箭头）。
   */
  const [autoOpen, setAutoOpen] = useState<Set<string>>(new Set())
  /*
   * 累积靠的是**渲染期调整 state**（React 认可的那一种：渲染同一个组件时 set 自己的 state，
   * 它会立刻用新值重渲染，不额外提交一帧）。放 effect 里就成了「渲染完再改」，
   * 树要多闪一次，而且这一条也正是 lint 会拦的写法。
   */
  if (activeNodeId) {
    const chain = ancestors(store, activeNodeId)
    if (chain.some((id) => !autoOpen.has(id))) setAutoOpen(new Set([...autoOpen, ...chain]))
  }
  const isOpen = (id: string) => manual.get(id) ?? autoOpen.has(id)
  const toggle = (id: string) =>
    setManual((prev) => {
      const next = new Map(prev)
      next.set(id, !(prev.get(id) ?? autoOpen.has(id)))
      return next
    })
  return { isOpen, toggle }
}
