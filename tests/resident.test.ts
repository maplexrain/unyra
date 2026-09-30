/**
 * 页签常驻的取舍规则（见 learn/resident.ts）。
 *
 * 为什么这几条规则值得单独测：它们决定「哪几篇文档的 DOM 留在内存里」。写错一条的表现
 * 都不是报错，而是——切回来还是慢（该常驻的没常驻）、或者内存一直涨（关掉的页签还在留）、
 * 或者当前页签被卸掉又重建（最不该发生的那一种）。
 */
import { describe, expect, it } from 'vitest'
import { RESIDENT_MAX, markActive, residentIds } from '../src/learn/resident'

describe('markActive（最近激活过的页签）', () => {
  it('最新的排最前，重复激活只是把它提上来', () => {
    expect(markActive(['b', 'a'], 'c')).toEqual(['c', 'b', 'a'])
    expect(markActive(['c', 'b', 'a'], 'a')).toEqual(['a', 'c', 'b'])
    expect(markActive(['a'], 'a')).toEqual(['a'])
  })

  it('超出上限的丢掉（上限是内存的闸门）', () => {
    const many = ['a', 'b', 'c', 'd', 'e']
    expect(markActive(many, 'f')).toEqual(['f', 'a', 'b', 'c'])
    expect(markActive(many, 'f').length).toBe(RESIDENT_MAX)
  })

  it('上限为 0 就什么都不记（关掉这个特性的开关）', () => {
    expect(markActive(['a', 'b'], 'c', 0)).toEqual([])
  })
})

describe('residentIds（这一轮常驻哪几片）', () => {
  const open = ['t1', 't2', 't3', 't4', 't5', 't6']

  it('当前显示的那几片一定在，而且排在页签栏顺序上', () => {
    expect(residentIds(open, ['t3'], ['t3'])).toEqual(['t3'])
    // 最近用过 t5、t2：三片都常驻，但顺序照页签栏来（DOM 位置不跟着「最近」跳）
    expect(residentIds(open, ['t3'], ['t3', 't5', 't2'])).toEqual(['t2', 't3', 't5'])
  })

  it('分割之后每一格显示的那一片都常驻（少一片就要在切回来时重建整片 DOM）', () => {
    expect(residentIds(open, ['t4', 't1'], ['t4'])).toEqual(['t1', 't4'])
    // 刚拆出来、还没放东西的空格子（id 为空）不会带出任何东西
    expect(residentIds(open, ['t2', ''], ['t2'])).toEqual(['t2'])
  })

  it('名额用完就不再往下拿', () => {
    expect(residentIds(open, ['t1'], ['t1', 't2', 't3', 't4', 't5'])).toEqual(['t1', 't2', 't3', 't4'])
    expect(residentIds(open, ['t1'], ['t1', 't2', 't3', 't4', 't5'], 2)).toEqual(['t1', 't2'])
  })

  it('已关掉的页签不再常驻（否则内存一直涨）', () => {
    // t2 已经从页签栏关掉了，虽然它还在「最近用过」里
    expect(residentIds(['t1', 't3'], ['t3'], ['t3', 't2', 't1'])).toEqual(['t1', 't3'])
  })

  it('当前页签自己都不在打开的列表里（切换的那一帧）：这一轮谁都不常驻', () => {
    expect(residentIds(open, ['gone'], ['gone'])).toEqual([])
    expect(residentIds(open, [], ['t1'])).toEqual([])
  })

  it('上限为 0 时整个特性关掉', () => {
    expect(residentIds(open, ['t1'], ['t1', 't2'], 0)).toEqual([])
  })
})
