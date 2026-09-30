/**
 * 按键浮层（教学模式）：把用户按下的键实时显示在左下角。
 *
 * 为什么要有它：录屏讲课的时候，观众只看得到结果在变，看不到「我刚才按了 Ctrl+K」。
 * 这个浮层就是给镜头看的那只手——它不参与任何交互（pointer-events-none），
 * 也绝不改按键行为（监听挂在 window 的捕获阶段，只读不拦）。
 *
 * 显示规则：按住期间显示当前这串（Ctrl + K），主键一松开就把这串记进历史；
 * 上面留最近几条，讲课时能看出「刚才连着做了哪几步」，全松开 1.5 秒后整块淡出。
 * 开关在设置 → 外观（appearance.teachingMode），改完立刻生效（见 useAppearance）。
 */

import { useEffect, useRef, useState } from 'react'
import { useAppearance } from '../lib/appearance'
import { t } from '../i18n'

/** 松开之后这一块还留多久 */
const KEEP_MS = 1500
/** 历史最多显示几条 */
const MAX_ROWS = 3

/** 一份「按着的键」：code 用于配对 keydown / keyup，label 用于显示 */
interface HeldKey {
  code: string
  label: string
}

/** 修饰键：e.key 是 Control / Meta 这种，屏幕上该写 Ctrl / Win */
const MOD_LABEL: Record<string, string> = {
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'Win',
}
/** 主键的显示名：单字符给大写，其余走这张表（与设置面板里的写法一致） */
const KEY_LABEL: Record<string, string> = {
  ' ': '空格',
  Escape: 'Esc',
  Backspace: '退格',
  Delete: 'Del',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

/** 按下的键 → 显示名；认不出来（输入法合成、未知键）返回 null，那种不显示 */
function labelOf(e: KeyboardEvent): string | null {
  const mod = MOD_LABEL[e.key]
  if (mod) return mod
  if (e.isComposing || e.key === 'Dead' || e.key === 'Unidentified') return null
  if (e.key.length === 1) return e.key === ' ' ? t('空格') : e.key.toUpperCase()
  const label = KEY_LABEL[e.key]
  return label ? t(label) : e.key
}

/**
 * 开关：不开教学模式时整块不挂载。
 * 这样「关掉再打开」天然是干净的——状态跟着组件一起没了，不必写一个
 * 「enabled 变 false 就清空」的 effect（那种 effect 只会多一轮渲染）。
 */
export default function KeyCast() {
  const enabled = useAppearance().teachingMode
  return enabled ? <KeyCastBody /> : null
}

function KeyCastBody() {
  /** 现在按着的（按按下顺序） */
  const [held, setHeld] = useState<HeldKey[]>([])
  /** 最近的几条组合，最后一条最新 */
  const [rows, setRows] = useState<string[]>([])
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    /** 已经按着的键；用闭包里的变量而不是读 state，免得每次按键都要重建监听 */
    let down: HeldKey[] = []

    const armHide = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => setVisible(false), KEEP_MS)
    }

    const push = (text: string) => {
      if (!text) return
      setRows((prev) => (prev[prev.length - 1] === text ? prev : [...prev, text].slice(-MAX_ROWS)))
      setVisible(true)
    }

    /** 当前这一串（按住的全部键，按按下顺序） */
    const liveText = (list: HeldKey[]) => list.map((k) => k.label).join(' + ')

    const onDown = (e: KeyboardEvent) => {
      const label = labelOf(e)
      if (!label) return
      const code = e.code || e.key
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      setVisible(true)
      if (down.some((k) => k.code === code)) return
      down = [...down, { code, label }]
      setHeld(down)
    }

    const onUp = (e: KeyboardEvent) => {
      const code = e.code || e.key
      if (!down.some((k) => k.code === code)) return
      const text = liveText(down)
      const wasModifier = MOD_LABEL[e.key] !== undefined
      down = down.filter((k) => k.code !== code)
      setHeld(down)
      // 主键一松开，这一串就算做完了：记进历史（修饰键单独松开不算一回事）
      if (!wasModifier) push(text)
      if (!down.length) armHide()
    }

    /** 窗口失焦收不到 keyup，键会一直「按着」——切走时清干净 */
    const onBlur = () => {
      down = []
      setHeld([])
      armHide()
    }

    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  const live = held.map((k) => k.label).join(' + ')
  // 正在按的那串已经显示在下面了，历史里那条就不再重复
  const history = live ? rows.slice(0, -1) : rows

  return (
    <div
      aria-hidden
      className={
        'no-print pointer-events-none fixed bottom-4 left-4 z-40 flex flex-col items-start gap-1 transition-opacity duration-300 ' +
        (visible || live ? 'opacity-100' : 'opacity-0')
      }
    >
      {history.map((text, i) => (
        <div
          key={text + '-' + i}
          className="rounded-lg border border-line-strong/60 bg-ink/70 px-2.5 py-1 text-[12px] font-medium text-paper/70 shadow-sm"
        >
          {text}
        </div>
      ))}
      {live && (
        <div className="rounded-lg border border-seal/50 bg-ink/90 px-3 py-1.5 text-[15px] font-semibold tracking-wide text-paper shadow-[0_8px_24px_rgba(0,0,0,0.28)]">
          {live}
        </div>
      )}
    </div>
  )
}