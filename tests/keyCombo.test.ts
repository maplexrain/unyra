/**
 * keyCombo 的单元用例（vitest 的示范：往后的新用例照这份写）。
 *
 * 钉的是「字符串 ↔ 组合键」那一层：用户按下什么、存进 setting.yaml 的是什么、设置面板上显示的
 * 是什么。这一层错了界面不会报错——按 Ctrl+T 什么都不发生，或者改完键存进去再读回来变成另一个
 * 键，用户只看到「这软件坏了」，所以往返与规范形写在这里。
 *
 * 用例放 tests/ 而不是 src/lib 旁边：tsconfig.app.json 的 include 是 ["src"]、vite 构建也扫
 * 那一头，用例混进去会被打进产物（见 docs/development.md 的「测试」一节）。
 */
import { describe, expect, it } from 'vitest'

import {
  canonicalCombo,
  comboFromEvent,
  comboLabel,
  formatCombo,
  keyLabel,
  normalizeKeyName,
  parseCombo,
} from '../src/lib/keyCombo'

/**
 * comboFromEvent 只读事件上的五个字段，于是 Node 里给个普通对象就够——
 * 这套用例因此不需要 jsdom（也没有真的 KeyboardEvent 可造）。
 */
function keyEvent(init: {
  key: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}): KeyboardEvent {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init } as unknown as KeyboardEvent
}

/** 事件 → 规范串；转换不出来就直接失败（断言里就不必到处写非空断言了） */
function comboOf(e: KeyboardEvent): string {
  const combo = comboFromEvent(e)
  if (!combo) throw new Error('这个事件里没有组合键：' + e.key)
  return formatCombo(combo)
}

describe('组合串的规范形', () => {
  it('大小写与修饰键顺序都收敛成一种写法', () => {
    // 用户怎么敲都行，落到 setting.yaml 的只有一种：Ctrl / Alt / Shift / Win 依次排
    expect(canonicalCombo('ctrl+shift+k')).toBe('Ctrl+Shift+K')
    expect(canonicalCombo('Shift+Ctrl+K')).toBe('Ctrl+Shift+K')
  })

  it('mac 的符号修饰键也认，但存下来仍是 Win 那一套', () => {
    // ⌘ 折成 Win 是刻意的：存储格式只有一种，平台差异留在界面与事件那一层
    expect(canonicalCombo('⌘+K')).toBe('Win+K')
    expect(canonicalCombo('⌃+⌥+⇧+⌘+K')).toBe('Ctrl+Alt+Shift+Win+K')
  })

  it('规范化是幂等的（设置文件被反复读写也不会越写越歪）', () => {
    for (const raw of ['ctrl+shift+k', '⌘+K', 'Alt+Enter', 'Ctrl+ ']) {
      const once = canonicalCombo(raw)
      expect(once === null ? null : canonicalCombo(once)).toBe(once)
    }
  })

  it('认不出来就回 null，不猜一个（设置文件被手改坏了也不该炸）', () => {
    expect(canonicalCombo('Ctrl+')).toBeNull() // 只有修饰键，没有主键
    expect(canonicalCombo('Ctrl+K+L')).toBeNull() // 两个主键
    expect(canonicalCombo('')).toBeNull()
  })
})

describe('主键与显示名', () => {
  it('e.key 与用户写的字面量都往同一组规范名上收', () => {
    expect(normalizeKeyName(' ')).toBe('Space') // 空格键的 e.key 就是一个空格
    expect(normalizeKeyName('esc')).toBe('Escape')
    expect(normalizeKeyName('k')).toBe('K')
    expect(normalizeKeyName('F5')).toBe('F5')
  })

  it('纯修饰键不算主键（按住 Ctrl 不是一次组合键，是半截）', () => {
    expect(normalizeKeyName('Control')).toBeNull()
    expect(normalizeKeyName('Shift')).toBeNull()
    expect(comboFromEvent(keyEvent({ key: 'Control', ctrlKey: true }))).toBeNull()
  })

  it('给人看的那一份：符号键与空格换成看得懂的写法', () => {
    // 存的是 Space（一个看不见的空格写进文件没人读得懂），显示的是「空格」
    expect(formatCombo({ ctrl: true, alt: false, shift: false, meta: false, key: 'Space' })).toBe('Ctrl+Space')
    expect(comboLabel('Ctrl+Space')).toBe('Ctrl + 空格')
    expect(comboLabel('Ctrl+ArrowUp')).toBe('Ctrl + ↑')
    expect(keyLabel('Escape')).toBe('Esc')
  })
})

describe('键盘事件 → 组合键', () => {
  it('Ctrl+K：四个修饰位取事件上的，主键取规范名', () => {
    expect(comboOf(keyEvent({ key: 'k', ctrlKey: true }))).toBe('Ctrl+K')
  })

  it('按住 Shift 时 e.key 变大写，规范名仍是同一个键', () => {
    // 同一个物理键，Shift 按下前后 e.key 从 'k' 变 'K'：归一之后必须是同一条绑定
    expect(normalizeKeyName('k')).toBe(normalizeKeyName('K'))
    expect(comboOf(keyEvent({ key: 'K', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K')
  })

  it('空格键：e.key 是一个空格，照样认出来并落成 Ctrl+Space', () => {
    // 落盘那一头要是漏了这一步，用户存下来的就是 'Ctrl+ '——下次解析直接回 null，绑定悄悄没了
    expect(canonicalCombo(comboOf(keyEvent({ key: ' ', ctrlKey: true })))).toBe('Ctrl+Space')
  })

  it('mac 上按 Cmd+K：事件里是 metaKey，存下来是 Win+K', () => {
    // 一份 setting.yaml 两个平台通用：写到文件里的从来不是「⌘」，也不是「Cmd」
    expect(comboOf(keyEvent({ key: 'k', metaKey: true }))).toBe('Win+K')
    expect(parseCombo('Win+K')?.meta).toBe(true)
  })
})

describe('解析回来的组合', () => {
  it('四个修饰位与主键各就各位，没按的位是 false', () => {
    const combo = parseCombo('Alt+S')
    expect(combo?.alt).toBe(true)
    expect(combo?.key).toBe('S')
    expect(combo?.ctrl).toBe(false)
  })
})
