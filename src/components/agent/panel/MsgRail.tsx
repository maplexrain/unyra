/**
 * 消息定位条：一条用户消息一个点，悬停出预览，点一下跳过去。
 *
 * 迁移为横向悬浮组件，居中悬浮在输入框正上方，不占文档流空间（不占位），
 * 层级在更多菜单或斜杠命令菜单（z-30）之下。
 */

import type { MsgAnchor } from './types'
import { t } from '../../../i18n'

export function MsgRail({
  anchors,
  railActive,
  railHover,
  setRailHover,
  hoverAnchor,
  onJump,
}: {
  anchors: MsgAnchor[]
  /** 现在读到哪一个（高亮那一个） */
  railActive: string | null
  /** 鼠标停在哪一个点上（浮层跟着它） */
  railHover: string | null
  setRailHover: (next: string | null | ((prev: string | null) => string | null)) => void
  /** 浮层正在显示的那一条（没有悬停就是 null） */
  hoverAnchor: MsgAnchor | null
  onJump: (id: string) => void
}) {
  return (
    <div className="no-print pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-1.5 flex justify-center px-3.5">
      <div className="pointer-events-auto relative flex max-w-full items-center gap-1.5 overflow-x-auto rounded-full border border-line-strong/60 bg-card/85 px-3 py-1 shadow-sm backdrop-blur-md moji-scroll-none">
        {anchors.map((a) => {
          const active = a.id === railActive
          const hover = a.id === railHover
          return (
            <button
              key={a.id}
              type="button"
              aria-label={t('跳到：{0}', a.text)}
              onMouseEnter={() => setRailHover(a.id)}
              onMouseLeave={() => setRailHover((v) => (v === a.id ? null : v))}
              onClick={() => onJump(a.id)}
              className="group relative flex h-5 cursor-pointer items-center justify-center px-0.5"
            >
              <span
                className={
                  'block h-[3px] rounded-full transition-all duration-150 ' +
                  (active
                    ? 'w-6 bg-seal'
                    : hover
                      ? 'w-4 bg-seal/70'
                      : 'w-3 bg-line-strong/80 group-hover:bg-seal/60')
                }
              />
            </button>
          )
        })}

        {/* 悬停预览浮层：居中悬浮在定位条上方 */}
        {hoverAnchor && (
          <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2">
            <div className="moji-in-soft rounded-lg border border-line-strong bg-card/95 px-2.5 py-1.5 text-center text-[11.5px] leading-snug text-ink shadow-[0_6px_20px_rgba(31,27,23,0.14)]">
              <span className="line-clamp-2 break-words">{hoverAnchor.text}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
