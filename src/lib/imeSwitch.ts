/**
 * Vim 模式的**输入法自动切换**：进普通模式（Esc / 可视）时把输入法切回英文直通，
 * 回插入模式时恢复之前那套（通常就是拼音）。没有它，忘了切输入法的用户在普通模式里
 * 按 j / k / dd 会被输入法整段吃掉去组词——看起来就像 vim 失灵了。
 *
 * 换布局走常驻的 screenHelper（WM_INPUTLANGCHANGEREQUEST，认**前台窗口**的 HKL——
 * 就是宿主窗口自己）：进普通模式先读回当前布局，不是英文键盘就记住它并切 en-US；
 * 回到插入模式把记住的那枚投递回去。WebUI 模式 / 非 win32 / 助手不在场一律静默跳过。
 */
import { useCallback, useEffect, useState } from 'react'
import { isVimEnabled } from './vimSettings'
import { native } from './native'

/** 英文（美国）键盘布局的 HKL：系统装了它，普通模式才有「直通」可言 */
const EN_US_HKL = 0x04090409
/** 英文布局的语言 id（HKL 低 16 位）：它就是 0x0409 时说明已经是英文，不必动 */
const LANG_ID_EN = 0x0409

/* ---------- 开关（与 vimSettings 同一套 localStorage + 窗口广播口径） ---------- */

const IME_SWITCH_KEY = 'learn.editor.vim.imeSwitch'
const IME_SWITCH_EVENT = 'unyra:vim-ime-switch'

/** 缺省开启：装了 vim 的用户多半在中文系统上写中文文档，这正是他们要的那句话 */
export function isVimImeSwitchEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(IME_SWITCH_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setVimImeSwitchEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(IME_SWITCH_KEY, enabled ? 'true' : 'false')
    }
  } catch {
    // 忽略 localStorage 写入异常
  }
  if (typeof window !== 'undefined') {
    // queueMicrotask 脱离 React 渲染栈再广播（同 vimSettings 的做法）
    queueMicrotask(() => {
      try {
        window.dispatchEvent(new CustomEvent(IME_SWITCH_EVENT, { detail: { enabled } }))
      } catch {
        // 忽略宿主环境窗口已被卸载的情况
      }
    })
  }
}

export function subscribeVimImeSwitch(onChange: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ enabled: boolean }>
    onChange(typeof custom?.detail?.enabled === 'boolean' ? custom.detail.enabled : isVimImeSwitchEnabled())
  }
  window.addEventListener(IME_SWITCH_EVENT, handler)
  return () => window.removeEventListener(IME_SWITCH_EVENT, handler)
}

/* ---------- 模式驱动的切换 ---------- */

/** 进普通模式前记下的那套输入法（HKL）；null = 没记（本来就英文 / 没切换过） */
let savedHkl: number | null = null

/**
 * vim 模式变化（insert = 此刻在插入模式）。
 * 只在 vim 开启且自动切换开启时才动作；布局切换失败静默（输入法是系统侧的状态，
 * 切不动就保持现状，不该在编辑器里报错打断用户）。
 */
export function onVimModeChanged(insert: boolean): void {
  if (!isVimEnabled() || !isVimImeSwitchEnabled()) return
  const tools = native()?.tools
  if (!tools?.imeGetActive || !tools?.imeSetActive) return

  if (insert) {
    // 回插入模式：把进普通模式前的那套输入法换回来
    const restore = savedHkl
    savedHkl = null
    if (restore !== null) {
      void tools.imeSetActive(restore).catch(() => {})
    }
    return
  }

  // 进普通/可视模式：先记住当前输入法，再切到英文直通
  void tools
    .imeGetActive()
    .then((hkl) => {
      if (!hkl || !tools.imeSetActive) return
      if ((hkl & 0xffff) === LANG_ID_EN) return
      savedHkl = hkl
      return tools.imeSetActive(EN_US_HKL)
    })
    .catch(() => {})
}

/* ---------- React Hook（VimFloatTip 的开关用） ---------- */

/** 响应式获取与设置「输入法自动切换」开关（形状与 useVimEnabled 一致） */
export function useVimImeSwitch(): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => isVimImeSwitchEnabled())

  useEffect(() => {
    return subscribeVimImeSwitch((next) => {
      setEnabled(next)
    })
  }, [])

  const update = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setEnabled((prev) => {
      const val = typeof next === 'function' ? next(prev) : next
      queueMicrotask(() => {
        setVimImeSwitchEnabled(val)
      })
      return val
    })
  }, [])

  return [enabled, update]
}
