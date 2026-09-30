/**
 * 函数表达式里分数次幂改写的单元用例。
 *
 * 钉的是「哪些写法会被改成 nthRoot、哪些必须原样留着」。改写错了界面不会报错：
 * 轻则曲线画不出来（这正是要修的那个 bug），重则把 `x^(1/3)^2` 这种右结合的意思改掉，
 * 图看着正常但讲的是另一回事。
 */
import { describe, expect, it } from 'vitest'

import { normalizePlotData, rewritePowers } from '../src/lib/plotExpr'

describe('分数次幂改写成 nthRoot', () => {
  const cases: Array<[string, string]> = [
    // 用户文档里出问题的那两处
    ['x^(1/3)-x', 'nthRoot(x,3)-x'],
    ['1.25-x+x^(1/3)', '1.25-x+nthRoot(x,3)'],
    // 指数带分子与负号
    ['x^(2/3)', 'nthRoot(x,3)^(2)'],
    ['x^(-1/3)', 'nthRoot(x,3)^(-1)'],
    ['x^(3/2)', 'nthRoot(x,2)^(3)'],
    // 小数指数：常见的 0.5 要认出来
    ['x^0.5', 'nthRoot(x,2)'],
    ['x^1.5', 'nthRoot(x,2)^(3)'],
    ['x^0.25', 'nthRoot(x,4)'],
    // 底的各种形态
    ['(1+x)^(1/3)', 'nthRoot((1+x),3)'],
    ['sin(x)^(1/3)', 'nthRoot(sin(x),3)'],
    ['2^(1/3)', 'nthRoot(2,3)'],
    ['2*x^(1/3)/(1+x)', '2*nthRoot(x,3)/(1+x)'],
    ['x^(1/3)*y^(1/3)', 'nthRoot(x,3)*nthRoot(y,3)'],
    // 空白
    ['x ^ ( 1 / 3 )', 'nthRoot(x,3)'],
    // 分母到上限为止
    ['x^(1/64)', 'nthRoot(x,64)'],
  ]

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(rewritePowers(input)).toBe(expected)
    })
  }

  it('改写是幂等的：改完再过一遍不变', () => {
    for (const [input] of cases) {
      const once = rewritePowers(input)
      expect(rewritePowers(once)).toBe(once)
    }
  })

  it('整数次幂不动：库自己算得了', () => {
    for (const expr of ['x^2', 'x^0', 'x^(-1)', 'x^(4/2)', 'x^1', 'sqrt(x)-x', 'exp(x)+log(x)']) {
      expect(rewritePowers(expr)).toBe(expr)
    }
  })

  it('认不出「就是要那个分数」时不动：宁可变不出来也不改错', () => {
    for (const expr of [
      'x^0.333', // 3.3e-4 的误差，谁也不知道他想写的是不是 1/3
      'x^(1/100)', // 分母超过上限
      'x^y', // 指数是变量
      'x^(1/n)',
      'x^(1/3)^2', // 乘方链：右结合，改写会改掉意思
      'x^2^(1/3)', // 同上：这个 1/3 是 2 的指数之底
    ]) {
      expect(rewritePowers(expr)).toBe(expr)
    }
  })

  it('没有 ^ 的表达式原样返回', () => {
    for (const expr of ['', 'sqrt(x)', 'sin(2*x)+1', 'x']) {
      expect(rewritePowers(expr)).toBe(expr)
    }
  })
})

describe('归一化 data 里的表达式字段', () => {
  it('fn / x / y / r 与 derivative.fn 都改写', () => {
    const data = [
      { fn: 'x^(1/3)', derivative: { fn: 'x^(1/3)', x0: 1 } },
      { graphType: 'polyline', fnType: 'parametric', x: 't^(1/2)', y: 't^(2/3)' },
      { graphType: 'polyline', fnType: 'polar', r: '1+theta^(1/2)' },
    ]
    expect(normalizePlotData(data)).toEqual([
      { fn: 'nthRoot(x,3)', derivative: { fn: 'nthRoot(x,3)', x0: 1 } },
      { graphType: 'polyline', fnType: 'parametric', x: 'nthRoot(t,2)', y: 'nthRoot(t,3)^(2)' },
      { graphType: 'polyline', fnType: 'polar', r: '1+nthRoot(theta,2)' },
    ])
  })

  it('不改动传进来的对象（同一份文档可能被反复渲染）', () => {
    const data = [{ fn: 'x^(1/3)' }]
    normalizePlotData(data)
    expect(data[0].fn).toBe('x^(1/3)')
  })

  it('非对象项、散点、颜色等字段原样带过', () => {
    const data = [
      null,
      { graphType: 'scatter', fnType: 'points', points: [[1, 1], [2, 4]], color: '#a8432f' },
      { fn: 'x^2', range: [0, 1], nSamples: 100 },
    ]
    expect(normalizePlotData(data)).toEqual(data)
  })

  it('data 不是数组时原样返回（脏文档不该在这里炸）', () => {
    expect(normalizePlotData(undefined)).toBeUndefined()
    expect(normalizePlotData('x^(1/3)')).toBe('x^(1/3)')
  })
})
