// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  EASE_SNAPPY,
  EASE_BOUNCY,
  EASE_NATURAL,
  EASE_EXIT,
  EASE_SPIN,
  spawnInkRipple,
  spinIcon,
  popScale,
  shakeSubtle,
  pulseAura,
  animateStagger,
} from '../src/lib/motion'

describe('motion 动效物理预设与微交互', () => {
  it('预设曲线参数符合 anime.js v4 格式规范', () => {
    expect(typeof EASE_NATURAL).toBe('function')
    expect(typeof EASE_EXIT).toBe('function')
    expect(EASE_SNAPPY).toBe('out(3)')
    expect(EASE_BOUNCY).toBe('outBack(1.4)')
    expect(EASE_SPIN).toBe('out(3)')
  })

  it('spawnInkRipple 在目标元素上正确派发微水墨涟漪节点', () => {
    const parent = document.createElement('button')
    parent.getBoundingClientRect = vi.fn(() => ({
      left: 10,
      top: 10,
      width: 100,
      height: 40,
      right: 110,
      bottom: 50,
      x: 10,
      y: 10,
      toJSON: () => {},
    }))
    document.body.appendChild(parent)

    const fakeEvent = {
      clientX: 50,
      clientY: 30,
      currentTarget: parent,
      target: parent,
    } as unknown as MouseEvent

    spawnInkRipple(fakeEvent, { duration: 200 })

    const ripple = parent.querySelector('.moji-ink-ripple') as HTMLElement | null
    expect(ripple).not.toBeNull()
    expect(ripple?.style.position).toBe('absolute')

    parent.remove()
  })

  it('微交互辅助方法 spinIcon / popScale / shakeSubtle / pulseAura 空安全且不抛错', () => {
    expect(() => spinIcon(null)).not.toThrow()
    expect(() => popScale(null)).not.toThrow()
    expect(() => shakeSubtle(null)).not.toThrow()
    expect(() => pulseAura(null)).not.toThrow()

    const el = document.createElement('div')
    document.body.appendChild(el)

    expect(() => spinIcon(el)).not.toThrow()
    expect(() => popScale(el)).not.toThrow()
    expect(() => shakeSubtle(el)).not.toThrow()
    expect(() => pulseAura(el, 0.8)).not.toThrow()

    el.remove()
  })

  it('animateStagger 支持为匹配子节点批量播放错峰入场动效', () => {
    const container = document.createElement('div')
    for (let i = 0; i < 3; i++) {
      const child = document.createElement('div')
      child.className = 'test-item'
      container.appendChild(child)
    }
    document.body.appendChild(container)

    expect(() => animateStagger(container, '.test-item', { delayStep: 30 })).not.toThrow()
    container.remove()
  })
})
