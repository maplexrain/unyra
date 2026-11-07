/*
 * 本文件负责：思维导图里**右键弹出的节点改色菜单**（TintMenu）。
 * 原样搬自 MindmapView.tsx，注释一并带走。
 */
import { Palette } from 'lucide-react'
import type { LearnStore } from '../../../learn/types'
import { t } from '../../../i18n'
import { TINT_PALETTE, type TintSwatch } from './mindmapTint'

/**
 * 右键弹出的改色菜单。
 *
 * 定位用 `fixed` + 视口坐标（指针在哪儿就贴哪儿），所以它**不受画布缩放影响**——
 * 菜单是操作界面的东西，字必须始终是那个字号。右侧/下侧贴边时往回夹，
 * 不让它跑出窗口。
 */
export function TintMenu({
  state,
  store,
  onSet,
  onClose,
}: {
  state: { id: string; x: number; y: number }
  store: LearnStore
  onSet: (nodeId: string, tint: string | null) => void
  onClose: () => void
}) {
  const node = store.nodes.find((n) => n.id === state.id)
  const current = node?.tint ?? 'default'
  // 菜单尺寸（夹到视口里用）：宽 8 格 + 内边距
  const W = 208
  const H = 132
  const left = Math.min(state.x, Math.max(8, window.innerWidth - W - 8))
  const top = Math.min(state.y, Math.max(8, window.innerHeight - H - 8))

  const pick = (sw: TintSwatch) => {
    onSet(state.id, sw.name === 'default' ? null : sw.name)
    onClose()
  }

  return (
    <div
      // 菜单内部的点击不该触发 window 上的「点哪儿都关」（挂在 mousedown 上）
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left, top, width: W }}
      className="fixed z-50 rounded-xl border-2 border-line-strong bg-paper p-2 shadow-2xl dark:bg-card"
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <Palette size={12} className="text-ink-soft" />
        <span className="text-[11px] font-semibold text-ink-soft">{t('节点颜色')}</span>
        {node && <span className="truncate text-[10.5px] text-ink-faint">· {node.title}</span>}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {TINT_PALETTE.map((sw) => {
          const on = sw.name === current
          return (
            <button
              key={sw.name}
              type="button"
              title={sw.name === 'default' ? t('默认（随分支）') : sw.label}
              onClick={() => pick(sw)}
              className={
                'flex h-7 items-center justify-center rounded-lg border-2 transition ' +
                (on ? 'border-seal' : 'border-transparent hover:border-line-strong')
              }
            >
              {sw.name === 'default' ? (
                // 「默认」画成一圈斜线：它不是一个颜色，是「不定颜色」
                <span
                  className="h-4 w-4 rounded-full border border-ink-faint"
                  style={{
                    background:
                      'repeating-linear-gradient(45deg, transparent 0 3px, var(--color-ink-faint) 3px 4.5px)',
                  }}
                />
              ) : (
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: sw.light }}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
