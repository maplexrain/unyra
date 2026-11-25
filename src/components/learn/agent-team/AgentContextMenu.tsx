/**
 * 智能体卡片右键菜单（AgentContextMenu）
 *
 * 功能选项：
 * 1. 置顶 / 取消置顶（经理龟默认置顶且不可撤销）
 * 2. 打开设置
 */

import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pin, PinOff, Settings2 } from 'lucide-react'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import { t } from '../../../i18n'
import type { AgentTeamMode } from './conversationList'

const ROW =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-ink transition hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-40 select-none cursor-pointer disabled:hover:bg-transparent'
const ICON = 'flex h-3.5 w-3.5 shrink-0 items-center justify-center'

export interface AgentContextMenuProps {
  menu: { agentId: AgentTeamMode; x: number; y: number } | null
  isPinned: boolean
  isLocked: boolean
  onTogglePin: (agentId: AgentTeamMode) => void
  onOpenSettings?: (agentId: AgentTeamMode) => void
  onClose: () => void
}

export function AgentContextMenu({
  menu,
  isPinned,
  isLocked,
  onTogglePin,
  onOpenSettings,
  onClose,
}: AgentContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)

  if (!menu) return null

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[9999] min-w-[170px] max-w-[220px] rounded-xl border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.22)]"
    >
      {/* 置顶 / 取消置顶 */}
      {isLocked ? (
        <button
          type="button"
          role="menuitem"
          disabled
          title={t('经理龟是团队任务入口，默认置顶不可撤销')}
          className={ROW}
        >
          <span className={ICON}>
            <Pin size={13} className="text-ink-faint" />
          </span>
          <span className="flex-1">{t('已置顶（默认）')}</span>
        </button>
      ) : isPinned ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onTogglePin(menu.agentId)
            onClose()
          }}
          className={ROW}
        >
          <span className={ICON}>
            <PinOff size={13} className="text-ink-soft" />
          </span>
          <span className="flex-1">{t('取消置顶')}</span>
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onTogglePin(menu.agentId)
            onClose()
          }}
          className={ROW}
        >
          <span className={ICON}>
            <Pin size={13} className="text-seal" />
          </span>
          <span className="flex-1">{t('置顶')}</span>
        </button>
      )}

      {/* 打开设置 */}
      {onOpenSettings && (
        <>
          <span aria-hidden="true" className="my-1 block h-px bg-line/60" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenSettings(menu.agentId)
              onClose()
            }}
            className={ROW}
          >
            <span className={ICON}>
              <Settings2 size={13} className="text-ink-soft" />
            </span>
            <span className="flex-1">{t('打开设置')}</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
