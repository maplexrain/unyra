// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  refreshShortcuts,
  resetShortcut,
  setShortcut,
  subscribeShortcut,
} from '../src/lib/shortcuts'

function press(combo: { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: combo.key,
      ctrlKey: Boolean(combo.ctrl),
      shiftKey: Boolean(combo.shift),
      altKey: Boolean(combo.alt),
      metaKey: Boolean(combo.meta),
      bubbles: true,
      cancelable: true,
    }),
  )
  document.dispatchEvent(
    new KeyboardEvent('keyup', {
      key: combo.key,
      ctrlKey: Boolean(combo.ctrl),
      shiftKey: Boolean(combo.shift),
      altKey: Boolean(combo.alt),
      metaKey: Boolean(combo.meta),
      bubbles: true,
      cancelable: true,
    }),
  )
}

describe('快捷键改键后旧组合失效', () => {
  beforeEach(() => {
    localStorage.clear()
    refreshShortcuts()
  })

  it('setShortcut 之后旧组合不再触发，新组合触发', () => {
    let fired = 0
    const unsubscribe = subscribeShortcut('doc.find', { down: () => (fired += 1) })
    try {
      press({ key: 'f', ctrl: true })
      expect(fired).toBe(1)

      expect(setShortcut('doc.find', 'Ctrl+Shift+F').ok).toBe(true)
      press({ key: 'f', ctrl: true })
      expect(fired).toBe(1)
      press({ key: 'f', ctrl: true, shift: true })
      expect(fired).toBe(2)
    } finally {
      unsubscribe()
      resetShortcut('doc.find')
    }
  })

  it('其他 id 改键后，原本属于它的旧组合不会被误触发', () => {
    let fired = 0
    const unsubscribe = subscribeShortcut('doc.find', { down: () => (fired += 1) })
    try {
      expect(setShortcut('agent.focus', 'Ctrl+Shift+Q').ok).toBe(true)
      press({ key: 'f', ctrl: true })
      expect(fired).toBe(1)
    } finally {
      unsubscribe()
      resetShortcut('agent.focus')
    }
  })
})
