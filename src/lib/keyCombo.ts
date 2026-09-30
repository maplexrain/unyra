/**
 * 组合键的字符串表示：解析、规范化、显示。
 *
 * 单独一个文件、**不依赖 React 也不依赖任何状态**，有两个原因：
 *
 * 1. 它是纯函数，值得被单独测（`scripts/agent-ops.test.ts` 的 shortcutTests 就只 import 这一个文件，
 *    于是不必把 React 拖进 Node 探针里）；
 * 2. 「组合键长什么样」这件事在三个地方都要用：存储（setting.yaml 里那一行字符串）、
 *    键盘事件（翻译成组合）、界面（显示成 Ctrl + K）。放一处才不会各写各的。
 *
 * 存储格式是规范形：修饰键顺序固定 Ctrl / Alt / Shift / Win，主键取规范名。
 * 用户写 `ctrl+shift+k`、`Shift+Ctrl+K`、`⌘K` 都能读进来，写出去只有一种写法。
 */
import { t } from '../i18n'

/** 一个组合键：四个修饰位 + 一个主键（主键已归一，见 normalizeKeyName） */
export interface KeyCombo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

/** 主键的规范名：事件里的 e.key 与用户写的字面量都往这里收 */
const KEY_ALIAS: Record<string, string> = {
  ' ': 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  del: 'Delete',
  delete: 'Delete',
  backspace: 'Backspace',
  tab: 'Tab',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}

/** 显示用的短名（按键浮层与设置面板都读它） */
const KEY_LABEL: Record<string, string> = {
  Space: '空格',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: '退格',
  Delete: 'Del',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

const MOD_ALIAS: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  '⌃': 'ctrl',
  alt: 'alt',
  option: 'alt',
  '⌥': 'alt',
  shift: 'shift',
  '⇧': 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  super: 'meta',
  '⌘': 'meta',
}

/** e.key → 规范主键名；认不出来（纯修饰键、Dead 键）返回 null */
export function normalizeKeyName(raw: string): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  const alias = KEY_ALIAS[lower]
  if (alias) return alias
  if (lower === 'control' || lower === 'shift' || lower === 'alt' || lower === 'meta') return null
  if (raw.length === 1) return raw.toUpperCase()
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase()
  return raw
}

/** 主键的显示名：字母给大写、方向键给箭头、空格给「空格」（键名在这里过 t()，键已在 shell 分片登记） */
export function keyLabel(key: string): string {
  const label = KEY_LABEL[key]
  return label ? t(label) : key.length === 1 ? key.toUpperCase() : key
}

/** 规范化成存储用的字符串（修饰键顺序固定：Ctrl / Alt / Shift / Win） */
export function formatCombo(combo: KeyCombo): string {
  const parts: string[] = []
  if (combo.ctrl) parts.push('Ctrl')
  if (combo.alt) parts.push('Alt')
  if (combo.shift) parts.push('Shift')
  if (combo.meta) parts.push('Win')
  parts.push(combo.key)
  return parts.join('+')
}

/** 显示成给人看的样子：修饰键之间加空格，更好读 */
export function comboLabel(text: string): string {
  const combo = parseCombo(text)
  if (!combo) return text
  const parts: string[] = []
  if (combo.ctrl) parts.push('Ctrl')
  if (combo.alt) parts.push('Alt')
  if (combo.shift) parts.push('Shift')
  if (combo.meta) parts.push('Win')
  parts.push(keyLabel(combo.key))
  return parts.join(' + ')
}

/** 解析存储串；认不出来返回 null（设置文件被人手改坏了也不该炸） */
export function parseCombo(text: string): KeyCombo | null {
  if (typeof text !== 'string' || !text.trim()) return null
  const tokens = text.split('+').map((part) => part.trim()).filter(Boolean)
  if (!tokens.length) return null
  const combo: KeyCombo = { ctrl: false, alt: false, shift: false, meta: false, key: '' }
  for (const token of tokens) {
    const mod = MOD_ALIAS[token.toLowerCase()]
    if (mod) {
      combo[mod] = true
      continue
    }
    if (combo.key) return null
    const key = normalizeKeyName(token)
    if (!key) return null
    combo.key = key
  }
  return combo.key ? combo : null
}

/** 把规范化字符串收拾干净：解析一次再格式化，写进设置文件的一律是规范形 */
export function canonicalCombo(text: string): string | null {
  const combo = parseCombo(text)
  return combo ? formatCombo(combo) : null
}

/** 一次键盘事件 → 组合键；只按了修饰键返回 null（那不是组合键，是半截） */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const key = normalizeKeyName(e.key)
  if (!key) return null
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key }
}