import { describe, expect, it } from 'vitest'
import {
  dropQueued,
  enqueueQueued,
  queueOf,
  shouldEnqueue,
  takeQueued,
  type QueuedMessage,
} from '../src/learn/agentQueue'

/** 造一条排队消息：只填这个文件关心的字段（附件为空数组，够用） */
const msg = (id: string, text = id, conversationId = 'c1'): QueuedMessage => ({
  id,
  conversationId,
  text,
  images: [],
  files: [],
  at: 0,
})

describe('等待队列（learn/agentQueue）', () => {
  describe('queueOf', () => {
    it('没有这一段会话时给空数组（调用方少一层判空）', () => {
      expect(queueOf({}, 'c1')).toEqual([])
      expect(queueOf({ c1: [msg('a')] }, 'c2')).toEqual([])
      expect(queueOf(undefined, 'c1')).toEqual([])
    })

    it('会话 id 为 null 时也给空数组（面板还没绑上会话）', () => {
      expect(queueOf({ c1: [msg('a')] }, null)).toEqual([])
    })

    it('有就原样交出来', () => {
      const list = [msg('a'), msg('b')]
      expect(queueOf({ c1: list }, 'c1')).toBe(list)
    })
  })

  describe('enqueueQueued / dropQueued', () => {
    it('排进队尾：顺序就是用户按下发送的先后', () => {
      let q: QueuedMessage[] = []
      q = enqueueQueued(q, msg('a'))
      q = enqueueQueued(q, msg('b'))
      q = enqueueQueued(q, msg('c'))
      expect(q.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    })

    it('不改原数组（每次都给新的一份）', () => {
      const before = [msg('a')]
      const after = enqueueQueued(before, msg('b'))
      expect(before).toHaveLength(1)
      expect(after).toHaveLength(2)
      expect(after).not.toBe(before)
    })

    it('撤回只摘掉那一条，别的不动', () => {
      const q = [msg('a'), msg('b'), msg('c')]
      expect(dropQueued(q, 'b').map((m) => m.id)).toEqual(['a', 'c'])
    })

    it('撤回一个不在队里的 id：原样返回同一个数组（不给下游造无谓的重渲染）', () => {
      const q = [msg('a')]
      expect(dropQueued(q, 'zzz')).toBe(q)
    })
  })

  describe('takeQueued（立即发送走它）', () => {
    it('取出指定的一条，剩下的顺序不变', () => {
      const q = [msg('a'), msg('b'), msg('c')]
      const { item, rest } = takeQueued(q, 'b')
      expect(item?.id).toBe('b')
      expect(rest.map((m) => m.id)).toEqual(['a', 'c'])
    })

    it('取出的是**任意一条**：点第 3 条立即发送，就先跑它，1、2 留在队里', () => {
      const q = [msg('a'), msg('b'), msg('c')]
      const { item, rest } = takeQueued(q, 'c')
      expect(item?.id).toBe('c')
      expect(rest.map((m) => m.id)).toEqual(['a', 'b'])
    })

    it('id 不在队里：item 为 null、队列原样（不会顺手吞掉一条）', () => {
      const q = [msg('a')]
      const { item, rest } = takeQueued(q, 'zzz')
      expect(item).toBeNull()
      expect(rest).toBe(q)
    })
  })

  describe('shouldEnqueue（这条该排队还是直接发）', () => {
    it('导师正在跑 → 排队（不能挤进正在跑的那一轮）', () => {
      expect(shouldEnqueue(0, true)).toBe(true)
    })

    it('空闲但队列里还排着人 → 也得排（先来后到，不能插到队首）', () => {
      expect(shouldEnqueue(1, false)).toBe(true)
      expect(shouldEnqueue(3, false)).toBe(true)
    })

    it('空闲且无人排队 → 直接发（排队只会让它白等一瞬）', () => {
      expect(shouldEnqueue(0, false)).toBe(false)
    })

    it('正在跑且队里有人 → 照样排（两条判据都成立）', () => {
      expect(shouldEnqueue(2, true)).toBe(true)
    })
  })
})
