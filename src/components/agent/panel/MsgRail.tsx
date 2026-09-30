/**
 * 消息定位条那一块 DOM：一条用户消息一个点，悬停出预览，点一下跳过去。
 *
 * 量位置、算命中区、判显示与否都在 useMsgRail.ts，这里只照着数据画。
 * 它挂在**整块面板**上而不是消息列里：点的 y 已经把表头那一段算进去了（见 measureAnchors），
 * 消息列有 768px 的上限、还可能居中，挂在它里面的话面板一宽点就跑到中间去了。
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
    <div className="no-print pointer-events-none absolute inset-y-0 right-3 z-10 w-5">
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
            // 一整条轨道都是 pointer-events-none（它压着消息列，别去截滚轮），
            // 只有按钮自己收回指针事件。高度取间距 a.h：相邻两项首尾相接，没有缝
            style={{ top: a.y + 'px', height: a.h + 'px' }}
            className={
              // 那道看得见的线交给伪元素画：3px 的线自己当按钮太细，绕着它的那圈空白
              // 才是要点的东西（按钮比线高得多）——「看着分开、摸着连着」，中间不踩空。
              // cursor-pointer 得手写：Tailwind 4 的预置样式把按钮的光标改回了默认箭头。
              'pointer-events-auto absolute right-0 flex w-5 -translate-y-1/2 cursor-pointer items-center justify-end ' +
              "before:block before:h-[3px] before:rounded-full before:transition-all before:duration-150 before:content-[''] " +
              (active
                ? 'before:w-[18px] before:bg-seal'
                : hover
                  ? 'before:w-4 before:bg-seal/60'
                  : 'before:w-3 before:bg-line-strong/70')
            }
          />
        )
      })}

      {/*
        悬停预览：跟着点走，停在哪一条就显示哪一条。
        定位的外层与做动画的内层分开：moji-in-soft 的 keyframes 收在 transform: none 上，
        而动画里的 transform 会盖掉同一元素上的 -translate-y-1/2——
        挤在一层的话浮层就会比点低半截。
      */}
      {hoverAnchor && (
        <div
          style={{ top: hoverAnchor.y + 'px' }}
          className="pointer-events-none absolute right-6 z-20 w-56 -translate-y-1/2"
        >
          <div className="moji-in-soft rounded-lg border border-line-strong bg-card/95 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink shadow-[0_6px_20px_rgba(31,27,23,0.14)]">
            <span className="line-clamp-2 break-words">{hoverAnchor.text}</span>
          </div>
        </div>
      )}
    </div>
  )
}
