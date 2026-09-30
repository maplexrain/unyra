/**
 * 文档区查找的单元用例。
 *
 * 钉的是「算出来几处、在哪」与「全部替换之后剩下什么」。这两件事错了界面不会报错：
 * 计数多一个少一个、替换把没命中的部分也动了——用户只会觉得「查找不太准」，
 * 而正文已经被改坏了（学习数据是实时落盘的）。
 */
import { describe, expect, it } from 'vitest'

import { replaceAllIn, scanMatches } from '../src/lib/findText'

describe('命中的位置与个数', () => {
  it('按顺序给出每一处，区间是左闭右开', () => {
    expect(scanMatches('hello world hello', 'hello', false)).toEqual([
      [0, 5],
      [12, 17],
    ])
  })

  it('大小写：默认不敏感，开了敏感就只认原样', () => {
    expect(scanMatches('Cat cat CAT', 'cat', false)).toHaveLength(3)
    expect(scanMatches('Cat cat CAT', 'cat', true)).toEqual([[4, 7]])
  })

  it('不重叠：aaa 里找 aa 只有一处（重叠的高亮看不出边界）', () => {
    expect(scanMatches('aaa', 'aa', false)).toEqual([[0, 2]])
    expect(scanMatches('aaaa', 'aa', false)).toEqual([
      [0, 2],
      [2, 4],
    ])
  })

  it('空查询词、查不到时都是空数组（不是 null，调用方不必再判）', () => {
    expect(scanMatches('abc', '', false)).toEqual([])
    expect(scanMatches('abc', 'zz', false)).toEqual([])
    expect(scanMatches('', 'a', false)).toEqual([])
  })

  it('中文与 emoji：下标按 UTF-16 码元算，切片能原样取回来', () => {
    const text = '极限的定义：极限就是无穷逼近'
    const hits = scanMatches(text, '极限', false)
    expect(hits).toHaveLength(2)
    for (const [s, e] of hits) expect(text.slice(s, e)).toBe('极限')
  })
})

describe('全部替换', () => {
  it('只动命中的那几段', () => {
    const text = 'a cat and a cat'
    const hits = scanMatches(text, 'cat', false)
    expect(replaceAllIn(text, hits, 'dog')).toBe('a dog and a dog')
  })

  it('替换成空串等于删掉', () => {
    const text = 'x--y--z'
    expect(replaceAllIn(text, scanMatches(text, '--', false), '')).toBe('xyz')
  })

  it('替换词里含查询词也不会被反复替换（一遍过，不看自己写的）', () => {
    const text = 'a b a'
    expect(replaceAllIn(text, scanMatches(text, 'a', false), 'aa')).toBe('aa b aa')
  })

  it('没有命中时原样返回', () => {
    expect(replaceAllIn('abc', [], 'x')).toBe('abc')
  })
})
