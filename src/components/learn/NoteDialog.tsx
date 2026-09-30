import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bold, Italic, Strikethrough, StickyNote, Underline, X } from 'lucide-react'
import type { AnnotationStyle } from '../../learn/types'
import { ANNO_COLORS, annotationCss } from '../../lib/annotationStyle'
import { NO_AUTOFILL } from '../../lib/autofill'
import { useLeaving } from '../../lib/presence'
import { useEscapeKey } from '../../lib/useEscape'
import { t } from '../../i18n'

interface Props {
  /** 被注解的词，显示在标题里 */
  term: string
  /** 已有内容（修改时传入；新建为空串） */
  initial: string
  /** 已有样式 */
  initialStyle?: AnnotationStyle
  /** 是否处于修改模式（决定标题与按钮文案） */
  editing: boolean
  /** 返回 false 表示没存成（父组件会拦下，例如词条已不在正文里）：输入区留在原地 */
  onSubmit: (body: string, style: AnnotationStyle | undefined) => boolean | void
  onCancel: () => void
  /** 修改模式下可直接删除该注解 */
  onDelete?: () => void
  /** 样式一变就回调：正文里那段文字立刻按新样式渲染（就地预览，见 lib/annotation） */
  onStylePreview?: (style: AnnotationStyle) => void
}

/** 退场时长，与 index.css 的 .moji-sheet-out 对齐（略长一点，动画播完才卸载） */
const SHEET_EXIT_MS = 210
/** 升起时长，与 index.css 的 .moji-sheet-up-in / 占位高度的过渡对齐（略长一点） */
const SHEET_RISE_MS = 260
/** 输入区宽度；窄窗口下不超出所在列（见 max-w-full） */
const SHEET_W = 768
/** 默认高度：一屏里既够写几行，又不至于把正文挤没 */
const SHEET_MIN_H = 250
/** 高度上限：内容再多也到这里为止，超出部分在输入框内滚动 */
const SHEET_MAX_H = 400

/**
 * 「注解」输入区：给选中文字写一段自己的批注，支持 Markdown，并可设置该文字的样式。
 *
 * 形态是**从文档列底部升起的满宽输入区**，而不是一个浮窗：
 * - 它是**占位**的：升起时把正文区顶上去，而不是盖在正文上——否则正读着的那几行
 *   会被自己的输入框挡住；
 * - 满宽一行，输入时视线不必来回移动；升起/降下交代了「它从哪儿来、到哪儿去」；
 * - 因此没有遮罩（用户要求）：正文仍可阅读与选中，想对照着原文写就对照着写。
 *
 * 定位由父级（NodeNote 那一列，flex-col）决定：本组件就待在列底，占住自己那份高度。
 */
export default function NoteDialog({
  term,
  initial,
  initialStyle,
  editing,
  onSubmit,
  onCancel,
  onDelete,
  onStylePreview,
}: Props) {
  // 取消/Esc/关闭按钮走 close；保存与删除会让父组件卸载本输入区，走 leaveThen
  const { leaving, close, leaveThen } = useLeaving(onCancel, SHEET_EXIT_MS)
  const [value, setValue] = useState(initial)
  const [style, setStyle] = useState<AnnotationStyle>(initialStyle ?? {})
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  /** 「正文效果」那一小段的内联样式：与套在正文上的样式同一套实现 */
  const previewCss = useMemo(() => annotationCss(style), [style])
  /**
   * 占位高度：外层容器按它撑开，正文区因此被顶上去。
   *
   * 基准是 SHEET_MIN_H（默认就这么高），内容多到装不下时再往上长，封顶 SHEET_MAX_H；
   * 到顶之后超出的部分由输入框自己滚动。升起的动画是「容器从 0 长到自身高度」+
   * 「面板自己从下方平移进来」：前者让正文平滑让位，后者才是「升起来」的观感。
   */
  const [height, setHeight] = useState(SHEET_MIN_H)
  /**
   * 升起动画是否已经播完。
   *
   * 需要它是因为「存不下就留在原地」那条路径：保存被父组件拦下时（词条已不在正文里），
   * useLeaving 会把 leaving 撤回，若此时类名落回 moji-sheet-in，动画会从头再播一遍——
   * 面板先掉下去、再升上来，看着像闪了一下。播完就摘掉动画类，撤回时它只是回到静止态。
   *
   * 用定时器而不是 animationend：动效被系统「减少动态效果」关掉时不会有 animationend，
   * 那时也得算播完（面板本来就该停在静止位置）。时长与 CSS 对齐，和退场同一套做法。
   */
  const [settled, setSettled] = useState(false)

  /**
   * 量高度：需要多高 = 输入框的内容高度 + 面板里除输入框以外的部分（标题行、工具条、内边距），
   * 再夹到 [SHEET_MIN_H, SHEET_MAX_H] 之间。
   *
   * 触发时机有两处：value 变了（换行、增删内容）与输入框自身尺寸变了（窗口缩放导致重排）。
   * 不能在依赖里带 height——那是本 effect 的结果，写进去就成了自激循环。
   * 收起动画期间不量（那时占位层高度是 0，量出来的 chrome 是错的），撤回退场后会重新量。
   */
  useLayoutEffect(() => {
    if (leaving) return
    const area = areaRef.current
    const sheet = sheetRef.current
    if (!area || !sheet) return
    const sync = () => {
      const chrome = sheet.offsetHeight - area.clientHeight
      // 量「内容需要多高」时必须先把输入框压扁：它平时撑满面板，
      // scrollHeight 永远不会小于自己的高度，直接读会让高度只涨不落。
      // 压成 0 再读，拿到的才是内容的真实高度（宽度没变，换行结果也不变）。
      const prev = area.style.height
      area.style.height = '0px'
      const need = area.scrollHeight
      area.style.height = prev
      const want = Math.min(SHEET_MAX_H, Math.max(SHEET_MIN_H, need + chrome))
      setHeight((h) => (h === want ? h : want))
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(area)
    return () => ro.disconnect()
  }, [value, leaving])

  useEffect(() => {
    const t = window.setTimeout(() => setSettled(true), SHEET_RISE_MS)
    return () => window.clearTimeout(t)
  }, [])

  /**
   * 聚焦输入框。preventScroll 是必须的：升起动画期间面板还在视口下方，
   * 浏览器为「把焦点滚进视野」会去滚最近的可滚动祖先——而 overflow:hidden 的容器
   * 同样能被程序化滚动，结果整个工作区被滚上去再滚回来，看着就是页面抖一下。
   */
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // （输入框本身不再单独设高：它撑满面板剩余空间，改由上面的 effect 决定面板多高）

  // 样式一变就同步到正文（就地预览）；卸载时由父组件负责收拾
  useEffect(() => {
    onStylePreview?.(style)
    // onStylePreview 每次渲染都是新函数，不入依赖；这里只认 style 的变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style])

  useEscapeKey(close)

  const toggle = (key: keyof AnnotationStyle) => {
    setStyle((s) => {
      const next = { ...s }
      if (next[key]) delete next[key]
      else (next as Record<string, unknown>)[key] = true
      return next
    })
  }
  const setColor = (field: 'fg' | 'bg', key: string) => {
    setStyle((s) => {
      const next = { ...s }
      if (next[field] === key) delete next[field]
      else next[field] = key
      return next
    })
  }

  const canSubmit = value.trim().length > 0
  const submit = () => {
    if (!canSubmit || leaving) return
    const cleaned = Object.keys(style).length ? style : undefined
    // 保存/删除都会让父组件卸载这个输入区，所以先播退场动画再动数据；
    // 父组件返回 false 说明没存成，useLeaving 会把退场撤回、输入区留着
    leaveThen(() => onSubmit(value.trim(), cleaned))
  }

  const styleBox =
    'flex h-7 w-7 items-center justify-center rounded-md border transition disabled:pointer-events-none disabled:opacity-40'
  const activeBox = 'border-seal/50 bg-seal/12 text-seal-deep'
  const idleBox = 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'

  return (
    /*
      外层是「占位层」：高度从 0 长到面板自身高度，正文区随之被顶上去；
      同时它把面板裁在框内——面板在动画里是从下方移进来的，不裁的话
      这一段会变成祖先容器的可滚动溢出（overflow:hidden 照样能被滚），
      焦点一进来整个工作区就被滚走了，看着像页面抖了一下。
      用 overflow: clip 而不是 hidden：clip 干脆不生成滚动容器，从根上不给滚的机会。
    */
    <div
      className="shrink-0 overflow-clip transition-[height] duration-200 ease-out"
      style={{ height: leaving ? 0 : height }}
    >
      {/*
        面板按 w-[768px] 居中：这是当初定下的尺寸，**不跟着正文列一起变**——它是一块
        升起来的输入区，比正文列（850，见 index.css 的 .doc-measure）窄一档，又不
        像满宽那样把整列都盖住。max-w-full 兜住窄窗口：列宽不够时先缩，不撑破列。
        高度铺满占位层（h-full），占位层多高由上面那个 effect 决定。
      */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={t('注解：{0}', term)}
        style={{ width: SHEET_W }}
        className={`no-print mx-auto flex h-full max-w-full flex-col rounded-t-xl border border-b-0 border-line-strong bg-paper shadow-[0_-18px_44px_rgba(31,27,23,0.20)] ${
          leaving ? 'moji-sheet-out pointer-events-none' : settled ? '' : 'moji-sheet-in'
        }`}
      >
        {/* 顶行：这是什么注解 + 所有动作（输入区不高，按钮跟标题挤一行最省地方） */}
        <div className="flex items-center gap-2.5 px-4 pb-1 pt-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal">
            <StickyNote size={13} />
          </span>
          <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-strong">
            {editing ? t('修改注解') : t('添加注解')}
            <span className="ml-2 text-[11.5px] font-normal text-ink-faint">
              {t('选中：')}<span className="text-seal-deep">{term}</span>
            </span>
          </h2>

          {editing && onDelete && (
            <button
              type="button"
              onClick={() => leaveThen(onDelete)}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] text-seal transition hover:bg-seal/10"
            >
              {t('删除注解')}
            </button>
          )}
          <span className="shrink-0 text-[10.5px] text-ink-faint">Ctrl/⌘ + Enter</span>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-40"
          >
            {editing ? t('保存') : t('添加')}
          </button>
          <button
            type="button"
            title={t('关闭（Esc）')}
            onClick={close}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {/* 样式工具条 */}
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
          <div className="flex items-center gap-1">
            <button type="button" title={t('粗体')} onClick={() => toggle('bold')} className={`${styleBox} ${style.bold ? activeBox : idleBox}`}>
              <Bold size={13} />
            </button>
            <button type="button" title={t('斜体')} onClick={() => toggle('italic')} className={`${styleBox} ${style.italic ? activeBox : idleBox}`}>
              <Italic size={13} />
            </button>
            <button type="button" title={t('下划线')} onClick={() => toggle('underline')} className={`${styleBox} ${style.underline ? activeBox : idleBox}`}>
              <Underline size={13} />
            </button>
            <button type="button" title={t('删除线')} onClick={() => toggle('strike')} className={`${styleBox} ${style.strike ? activeBox : idleBox}`}>
              <Strikethrough size={13} />
            </button>
          </div>

          <span className="mx-1 h-5 w-px bg-line" />

          <span className="text-[11.5px] text-ink-faint">{t('字色')}</span>
          <div className="flex items-center gap-1">
            {ANNO_COLORS.map((c) => (
              <button
                key={`fg-${c.key}`}
                type="button"
                title={t('字色：{0}', t(c.label))}
                onClick={() => setColor('fg', c.key)}
                className={`h-5 w-5 rounded-full border transition ${
                  style.fg === c.key ? 'ring-2 ring-seal/50 ring-offset-1' : 'border-line-strong/60'
                }`}
                style={{ backgroundColor: c.fg }}
              />
            ))}
            {style.fg && (
              <button
                type="button"
                title={t('清除字色')}
                onClick={() => setStyle((s) => { const n = { ...s }; delete n.fg; return n })}
                className="ml-0.5 text-[11px] text-ink-faint transition hover:text-ink"
              >
                {t('清除')}
              </button>
            )}
          </div>

          <span className="mx-1 h-5 w-px bg-line" />

          <span className="text-[11.5px] text-ink-faint">{t('底色')}</span>
          <div className="flex items-center gap-1">
            {ANNO_COLORS.map((c) => (
              <button
                key={`bg-${c.key}`}
                type="button"
                title={t('底色：{0}', t(c.label))}
                onClick={() => setColor('bg', c.key)}
                className={`h-5 w-5 rounded border transition ${
                  style.bg === c.key ? 'ring-2 ring-seal/50 ring-offset-1' : 'border-line-strong/60'
                }`}
                style={{ backgroundColor: c.bg, backgroundImage: 'none' }}
              />
            ))}
            {style.bg && (
              <button
                type="button"
                title={t('清除底色')}
                onClick={() => setStyle((s) => { const n = { ...s }; delete n.bg; return n })}
                className="ml-0.5 text-[11px] text-ink-faint transition hover:text-ink"
              >
                {t('清除')}
              </button>
            )}
          </div>

          {/* 这里就是「正文效果」的实样：样式一改，正文里那段文字同步变（见 onStylePreview） */}
          <span className="ml-2 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
            {t('正文效果：')}
            <span className="rounded px-1 text-ink" style={previewCss as React.CSSProperties}>
              {term}
            </span>
            <span className="text-[10.5px]">{t('（正文里同步可见）')}</span>
          </span>
        </div>

        {/* 输入区本体：撑满面板剩余高度（面板多高由上面的 effect 定），内容多到装不下就在框内滚动 */}
        <div className="min-h-0 flex-1 px-4 pb-3">
          <textarea
            ref={areaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={t('写点什么…支持 Markdown 与 $LaTeX$ 公式')}
            className="h-full w-full resize-none overflow-y-auto rounded-lg border border-line bg-card px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:ring-2 focus:ring-seal/15"
            {...NO_AUTOFILL}
          />
        </div>
      </div>
    </div>
  )
}
