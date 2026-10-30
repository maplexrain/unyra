/**
 * 消息列表 / 定位入口：输入框底部的按钮，点击弹出消息列表 tip 浮层。
 *
 * 点击列表中的任意一条消息可快速跳转定位至该消息处，并高亮闪烁提示；
 * 浮层支持当前阅读位置高亮、外点/Esc 自动收起、自动滚到当前阅读项。
 */

import { useEffect, useRef, useState } from 'react'
import { List } from 'lucide-react'
import type { MsgAnchor } from './types'
import { t } from '../../../i18n'

export function MsgRail({
  anchors,
  railActive,
  onJump,
}: {
  anchors: MsgAnchor[]
  /** 现在读到哪一个（高亮那一个） */
  railActive: string | null
  onJump: (id: string) => void
  /** 兼容旧签名（可选） */
  railHover?: string | null
  setRailHover?: (next: string | null | ((prev: string | null) => string | null)) => void
  hoverAnchor?: MsgAnchor | null
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const activeItemRef = useRef<HTMLButtonElement | null>(null)

  // 外点与 Esc 自动收起
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // 打开时自动把当前正在阅读的项滚动到可视区域内
  useEffect(() => {
    if (open && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [open])

  if (!anchors.length) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={t('消息列表')}
        aria-expanded={open}
        title={t('消息列表（共 {0} 条）', String(anchors.length))}
        onClick={() => setOpen((v) => !v)}
        className={
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ' +
          (open ? 'bg-line/60 text-ink' : 'text-ink-soft hover:bg-line/60 hover:text-ink')
        }
      >
        <List size={16} />
      </button>

      {open && (
        <div className="moji-bloom-up-in absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-line-strong bg-card/95 shadow-[0_16px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-line/60 bg-paper-deep/40 px-3 py-2 text-[11.5px] font-medium text-ink-soft">
            <div className="flex items-center gap-1.5">
              <List size={13} className="text-seal" />
              <span>{t('消息列表')}</span>
            </div>
            <span className="text-[10.5px] tabular-nums text-ink-faint">
              {t('{0} 条消息', String(anchors.length))}
            </span>
          </div>

          <div className="moji-scroll-thin max-h-72 space-y-0.5 overflow-y-auto p-1.5">
            {anchors.map((a, idx) => {
              const isActive = a.id === railActive
              return (
                <button
                  key={a.id}
                  ref={isActive ? activeItemRef : undefined}
                  type="button"
                  title={a.text}
                  onClick={() => {
                    onJump(a.id)
                    setOpen(false)
                  }}
                  className={
                    'group flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left transition ' +
                    (isActive
                      ? 'bg-seal/10 font-medium text-seal-deep'
                      : 'text-ink-soft hover:bg-line/50 hover:text-ink')
                  }
                >
                  <span
                    className={
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] tabular-nums ' +
                      (isActive
                        ? 'bg-seal font-semibold text-paper'
                        : 'bg-line/60 text-ink-faint group-hover:bg-line-strong/60 group-hover:text-ink')
                    }
                  >
                    {idx + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-[12px] leading-snug line-clamp-2 break-words">
                    {a.text}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
