/**
 * 截图全局热键的跨进程描述：渲染层只负责把组合串（`Ctrl+Shift+S` / `F1`）
 * 规范好，主进程把它翻成 Windows 虚拟键码 + 修饰位，再交给 screenHelper
 * 的低级键盘钩子。放成纯函数，避免主进程/原生助手各自再解释一遍组合语法。
 */

export const HOTKEY_MOD_CTRL = 1
export const HOTKEY_MOD_SHIFT = 2
export const HOTKEY_MOD_ALT = 4
export const HOTKEY_MOD_WIN = 8

export interface ScreenshotHotkey {
  /** Windows 虚拟键码（VK_*） */
  vk: number
  /** 修饰键位掩码：1 Ctrl / 2 Shift / 4 Alt / 8 Win */
  mods: number
}

const VK: Record<string, number> = {
  Space: 0x20,
  Escape: 0x1b,
  Enter: 0x0d,
  Tab: 0x09,
  Backspace: 0x08,
  Delete: 0x2e,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  ArrowUp: 0x26,
  ArrowDown: 0x28,
  ArrowLeft: 0x25,
  ArrowRight: 0x27,
  CapsLock: 0x14,
  NumLock: 0x90,
  ScrollLock: 0x91,
  PrintScreen: 0x2c,
}

/** 这些字符需要 Shift 才能从同一位 VK 打出来 */
const SYMBOL_VK: Record<string, { vk: number; shift: boolean }> = {
  '-': { vk: 0xbd, shift: false },
  _: { vk: 0xbd, shift: true },
  '=': { vk: 0xbb, shift: false },
  '+': { vk: 0xbb, shift: true },
  '[': { vk: 0xdb, shift: false },
  '{': { vk: 0xdb, shift: true },
  ']': { vk: 0xdd, shift: false },
  '}': { vk: 0xdd, shift: true },
  ';': { vk: 0xba, shift: false },
  ':': { vk: 0xba, shift: true },
  "'": { vk: 0xde, shift: false },
  '"': { vk: 0xde, shift: true },
  ',': { vk: 0xbc, shift: false },
  '<': { vk: 0xbc, shift: true },
  '.': { vk: 0xbe, shift: false },
  '>': { vk: 0xbe, shift: true },
  '/': { vk: 0xbf, shift: false },
  '?': { vk: 0xbf, shift: true },
  '\\': { vk: 0xdc, shift: false },
  '|': { vk: 0xdc, shift: true },
  '`': { vk: 0xc0, shift: false },
  '~': { vk: 0xc0, shift: true },
  '!': { vk: 0x31, shift: true },
  '@': { vk: 0x32, shift: true },
  '#': { vk: 0x33, shift: true },
  $: { vk: 0x34, shift: true },
  '%': { vk: 0x35, shift: true },
  '^': { vk: 0x36, shift: true },
  '&': { vk: 0x37, shift: true },
  '*': { vk: 0x38, shift: true },
  '(': { vk: 0x39, shift: true },
  ')': { vk: 0x30, shift: true },
}

function keyVk(key: string): { vk: number; shift: boolean } | null {
  if (/^[A-Z]$/.test(key)) return { vk: key.charCodeAt(0), shift: false }
  if (/^[0-9]$/.test(key)) return { vk: key.charCodeAt(0), shift: false }
  const f = /^F([1-9]|1[0-9]|2[0-4])$/.exec(key)
  if (f) return { vk: 0x70 + Number(f[1]) - 1, shift: false }
  const named = VK[key]
  if (named) return { vk: named, shift: false }
  return SYMBOL_VK[key] ?? null
}

/**
 * 解析规范组合串。解析失败返回 null——主进程会拒绝这次下发，
 * 保留上一条已经生效的热键，而不是悄悄退回 F1。
 */
export function parseScreenshotHotkey(combo: string): ScreenshotHotkey | null {
  if (typeof combo !== 'string' || !combo.trim()) return null
  const raw = combo.trim()
  // 主键本身是 `+` 时 formatCombo 会写成 `Ctrl++`；先把它从末尾摘出来，
  // 再按普通 `+` 分隔修饰键，避免 split 出空 token 后误判。
  const literalPlus = raw.endsWith('++')
  const head = literalPlus ? raw.slice(0, -2) : raw
  const tokens = head.split('+').map((t) => t.trim()).filter(Boolean)
  if (literalPlus) tokens.push('+')
  if (!tokens.length) return null

  let mods = 0
  for (const token of tokens.slice(0, -1)) {
    const lower = token.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') mods |= HOTKEY_MOD_CTRL
    else if (lower === 'shift') mods |= HOTKEY_MOD_SHIFT
    else if (lower === 'alt' || lower === 'option') mods |= HOTKEY_MOD_ALT
    else if (lower === 'win' || lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'super')
      mods |= HOTKEY_MOD_WIN
    else return null
  }

  const key = keyVk(tokens[tokens.length - 1])
  if (!key) return null
  return { vk: key.vk, mods: mods | (key.shift ? HOTKEY_MOD_SHIFT : 0) }
}
