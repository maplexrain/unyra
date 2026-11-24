import { describe, expect, it } from 'vitest'
import { parseScreenshotHotkey, HOTKEY_MOD_ALT, HOTKEY_MOD_CTRL, HOTKEY_MOD_SHIFT, HOTKEY_MOD_WIN } from '../electron/app/screenshotHotkey'

describe('截图全局热键解析', () => {
  it('F1 默认键', () => {
    expect(parseScreenshotHotkey('F1')).toEqual({ vk: 0x70, mods: 0 })
  })

  it('Ctrl+Shift+S 同时带 Ctrl 与 Shift', () => {
    expect(parseScreenshotHotkey('Ctrl+Shift+S')).toEqual({
      vk: 0x53,
      mods: HOTKEY_MOD_CTRL | HOTKEY_MOD_SHIFT,
    })
  })

  it('Alt / Win 修饰位', () => {
    expect(parseScreenshotHotkey('Alt+F4')).toEqual({ vk: 0x73, mods: HOTKEY_MOD_ALT })
    expect(parseScreenshotHotkey('Win+PrintScreen')).toEqual({ vk: 0x2c, mods: HOTKEY_MOD_WIN })
  })

  it('Ctrl++ 与 Ctrl+= 是同一个 VK，但加号额外要求 Shift', () => {
    expect(parseScreenshotHotkey('Ctrl++')).toEqual({
      vk: 0xbb,
      mods: HOTKEY_MOD_CTRL | HOTKEY_MOD_SHIFT,
    })
    expect(parseScreenshotHotkey('Ctrl+=')).toEqual({ vk: 0xbb, mods: HOTKEY_MOD_CTRL })
    expect(parseScreenshotHotkey('Ctrl+!')).toEqual({
      vk: 0x31,
      mods: HOTKEY_MOD_CTRL | HOTKEY_MOD_SHIFT,
    })
  })

  it('坏串拒绝，交给主进程保留上一条热键', () => {
    expect(parseScreenshotHotkey('Ctrl+Shift')).toBeNull()
    expect(parseScreenshotHotkey('Ctrl+Unknown')).toBeNull()
    expect(parseScreenshotHotkey('')).toBeNull()
  })
})
