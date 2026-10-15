import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Blend, Check, ChevronRight, Drama, FileCode2, FileText, SlidersHorizontal } from 'lucide-react'
import { PERSONAS, personaOf, type PersonaId } from '../../agent/persona'
import { DOC_FORMATS, docFormatOf, type DocFormatId } from '../../agent/docFormat'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'

/**
 * 「写作策略」选择器：输入框底行的那颗按钮（子代理按钮右侧），两件事一处管——
 *
 *   一级 导师人格 / 文档格式   —— 两个入口，各带当前值
 *   二级 人格列表 或 格式列表 —— 选完即收
 *
 * 交互与层级过渡照搬 ModelPicker（点击开合、两级滑动、面包屑返回）：两处菜单
 * 在输入框同一排，长得一样、用着一样，用户不必学两套。
 *
 * 按钮只画一枚图标（SlidersHorizontal，无文字标签）——底行已有「提供商 · 模型」
 * 那枚长按钮，这一枚再长下去会把输入框挤没；当前值点开就看到（一级行的右侧），
 * 悬停 title 里也带着。
 *
 * 人格与格式的切换都**从下一轮开始生效**（各自以一条隐藏 user 消息进入上下文，
 * 见 agent/persona 与 agent/docFormat）——所以这里只写设置，不动历史。
 */

/** 菜单层：两个入口在 root，各进一层 */
type Level = 'root' | 'persona' | 'format'
/** 1 = 往里走一层，-1 = 退回上一层；决定滑动方向 */
type Dir = 1 | -1

/** 滑动时长，与 ModelPicker 对齐（略短于动画，播完才卸载旧层） */
const SLIDE_MS = 260
/** 退场时长，与 index.css 的 .moji-bloom-up-out 对齐（略长一点，动画播完才卸载） */
const PANEL_EXIT_MS = 170
/** 面板内容最高这么高，再高就在面板内部滚动（与 ModelPicker 同一条线） */
const PANEL_MAX_H = 300

interface Props {
  persona: PersonaId
  onPickPersona: (id: PersonaId) => void
  docFormat: DocFormatId
  onPickDocFormat: (id: DocFormatId) => void
}

/** 三种格式在菜单里的图标（人格沿用 Drama：面具——「现在跟谁在说话」） */
const FORMAT_ICON = { hybrid: Blend, markdown: FileText, html: FileCode2 } as const

export default function StrategyPicker({ persona, onPickPersona, docFormat, onPickDocFormat }: Props) {
  // 与 ModelPicker / 原 PersonaPicker 同款：外点 / Esc 监听挂在 document 上，按钮自己管开合
  const { open, setOpen, mounted, wrapProps, panelProps } = useHoverMenu({
    exitMs: PANEL_EXIT_MS,
    outsideClick: true,
    listenOn: 'document',
  })
  const [level, setLevel] = useState<Level>('root')
  /** 正在滑出的那一层；动画播完置空，期间与当前层叠在一起 */
  const [leaving, setLeaving] = useState<{ level: Level; dir: Dir } | null>(null)
  const [dir, setDir] = useState<Dir>(1)
  /** 面板区高度：内容随层级变，量出来做高度过渡，展开/收起才不会跳 */
  const [bodyH, setBodyH] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const leaveTimer = useRef<number | null>(null)
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)

  const currentPersona = personaOf(persona)
  const currentFormat = docFormatOf(docFormat)

  useLayoutEffect(() => {
    if (!mounted || !wrapProps.ref.current) return
    const rect = wrapProps.ref.current.getBoundingClientRect()
    setPos({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: Math.max(8, window.innerHeight - rect.top + 8),
    })
  }, [mounted, open, wrapProps.ref])

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    },
    [],
  )

  /**
   * 面板高度跟着内容走（与 ModelPicker 同一套：面板绝对定位，不给外层定高就会塌成 0）。
   * 用 ResizeObserver 盯住当前面板——换层、列表变化都会重新量到，只在真变了时写回。
   */
  useLayoutEffect(() => {
    const el = panelRef.current
    if (!mounted || !el) return
    const sync = () => {
      const h = Math.min(el.offsetHeight, PANEL_MAX_H)
      setBodyH((prev) => (prev === h ? prev : h))
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [mounted, level])

  /** 换层：记下方向与「正在离开的那一层」，动画结束后再把旧层丢掉（与 ModelPicker 同款） */
  const go = (next: Level) => {
    if (next === level) return
    const d: Dir = next === 'root' ? -1 : 1
    setDir(d)
    setLeaving({ level, dir: d })
    setLevel(next)
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setLeaving(null)
    }, SLIDE_MS)
  }

  /** 一层的内容。抽成函数是因为过渡期间要同时渲染「新来的」和「正走的」两层 */
  const renderPanel = (lv: Level) => {
    if (lv === 'root') {
      return (
        <>
          <button
            type="button"
            onClick={() => go('persona')}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-line/50"
          >
            <Drama size={13} className="shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-strong">{t('导师人格')}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">{t(currentPersona.label)}</span>
            <ChevronRight size={13} className="shrink-0 text-ink-faint" />
          </button>
          <button
            type="button"
            onClick={() => go('format')}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-line/50"
          >
            <FileText size={13} className="shrink-0 text-ink-faint" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-strong">{t('文档格式')}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">{t(currentFormat.short)}</span>
            <ChevronRight size={13} className="shrink-0 text-ink-faint" />
          </button>
          <div className="my-1 border-t border-line" />
          <p className="px-2.5 pb-2 pt-1 text-[10.5px] leading-relaxed text-ink-faint">
            {t('人格与格式都以一条隐藏指令进入上下文：切换从下一轮开始生效，不改系统提示词、不重发历史。')}
          </p>
        </>
      )
    }

    if (lv === 'persona') {
      return (
        <>
          <div className="px-2.5 pb-1 pt-2 text-[10.5px] tracking-wide text-ink-faint">{t('导师人格')}</div>
          {PERSONAS.map((p) => {
            const on = p.id === currentPersona.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (!on) onPickPersona(p.id)
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-line/50"
              >
                <Drama size={13} className="shrink-0 text-ink-faint" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={'block truncate text-[12.5px] ' + (on ? 'text-ink-strong' : 'text-ink')}>
                    {t(p.label)}
                  </span>
                  <span className="block truncate text-[10.5px] text-ink-faint">{t(p.role)}</span>
                </span>
                {on && <Check size={13} className="shrink-0 text-seal" />}
              </button>
            )
          })}
        </>
      )
    }

    return (
      <>
        <div className="px-2.5 pb-1 pt-2 text-[10.5px] tracking-wide text-ink-faint">{t('文档格式')}</div>
        {DOC_FORMATS.map((f) => {
          const on = f.id === currentFormat.id
          const Icon = FORMAT_ICON[f.id]
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setOpen(false)
                if (!on) onPickDocFormat(f.id)
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-line/50"
            >
              <Icon size={13} className="shrink-0 text-ink-faint" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={'block truncate text-[12.5px] ' + (on ? 'text-ink-strong' : 'text-ink')}>
                  {t(f.label)}
                  {f.id === 'hybrid' && <span className="ml-1.5 text-[10px] text-ink-faint">{t('默认')}</span>}
                </span>
                <span className="block truncate text-[10.5px] text-ink-faint">{t(f.desc)}</span>
              </span>
              {on && <Check size={13} className="shrink-0 text-seal" />}
            </button>
          )
        })}
      </>
    )
  }

  return (
    <div className="relative" {...wrapProps}>
      <button
        type="button"
        aria-label={t('写作策略：{0} · {1}，点击切换', t(currentPersona.short), t(currentFormat.short))}
        aria-expanded={open}
        title={t('写作策略') + '：' + t(currentPersona.label) + ' · ' + t(currentFormat.label)}
        onClick={() => {
          setOpen(!open)
          setLevel('root')
          setLeaving(null)
        }}
        className={
          'flex h-8 shrink-0 items-center justify-center rounded-lg px-2.5 transition ' +
          (open ? 'bg-line/60 text-ink' : 'text-ink-soft hover:text-ink')
        }
      >
        {/* 滑杆（SlidersHorizontal）：写作策略的隐喻——「这一篇怎么教、怎么写」的两个开关 */}
        <SlidersHorizontal size={14} className="shrink-0" aria-hidden="true" />
      </button>

      {mounted && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              right: pos.right,
              bottom: pos.bottom,
              zIndex: 90,
            }}
            className={`w-[290px] overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_16px_44px_rgba(31,27,23,0.22)] ${
              // 从面板底边中点向上、向左右展开（见 styles/motion.css 的 .moji-bloom-up-*）
              panelProps.className
            }`}
          >
            {/* 面包屑：点回上一层（滑动方向随之反向） */}
            <div className="flex items-center gap-1 border-b border-line bg-paper-deep/60 px-2.5 py-2 text-[11px]">
              <button
                type="button"
                onClick={() => go('root')}
                className={level === 'root' ? 'font-medium text-ink-strong' : 'text-ink-soft hover:text-ink'}
              >
                {t('写作策略')}
              </button>
              {level !== 'root' && (
                <>
                  <ChevronRight size={11} className="text-ink-faint" />
                  <span className="truncate font-medium text-ink-strong">
                    {level === 'persona' ? t('导师人格') : t('文档格式')}
                  </span>
                </>
              )}
            </div>

            {/*
              两层叠着做滑动（与 ModelPicker 同一套）：当前层在流内（撑出高度），
              离开的那层绝对定位盖在上面。外层 overflow-hidden 裁掉滑出去的部分，滑完再卸载。
            */}
            <div
              className="relative overflow-hidden transition-[height] duration-200 ease-out"
              style={bodyH === null ? undefined : { height: bodyH }}
            >
              {leaving && (
                <div
                  className={`absolute inset-x-0 top-0 ${
                    leaving.dir === 1 ? 'moji-slide-out-forward' : 'moji-slide-out-back'
                  }`}
                  aria-hidden="true"
                >
                  <div className="max-h-[300px] overflow-y-auto py-1">{renderPanel(leaving.level)}</div>
                </div>
              )}
              <div
                ref={panelRef}
                key={level}
                className={`relative ${
                  leaving ? (dir === 1 ? 'moji-slide-in-forward' : 'moji-slide-in-back') : ''
                }`}
              >
                <div className="max-h-[300px] overflow-y-auto py-1">{renderPanel(level)}</div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
