import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Italic, Strikethrough, StickyNote, Trash2, Underline, X } from 'lucide-react'
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

const EXIT_MS = 180

/**
 * 现代精致卡片式「注解」编辑输入框：
 * 悬浮于文档底部，具备现代毛玻璃质感、圆角光泽与丝滑交互。
 * 支持丰富 Markdown 内容与正文实时样式预览（粗体/斜体/下划线/删除线/字色/底色）。
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
  const { leaving, close, leaveThen } = useLeaving(onCancel, EXIT_MS)
  const [value, setValue] = useState(initial)
  const [style, setStyle] = useState<AnnotationStyle>(initialStyle ?? {})
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  const previewCss = useMemo(() => annotationCss(style), [style])

  // 聚焦输入框并将光标置于末尾
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // 样式变化就地预览
  useEffect(() => {
    onStylePreview?.(style)
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
    leaveThen(() => onSubmit(value.trim(), cleaned))
  }

  const btnFmt =
    'flex h-7 w-7 items-center justify-center rounded-md transition text-xs font-semibold'
  const activeFmt = 'bg-seal/18 text-seal-deep dark:text-seal font-bold shadow-2xs'
  const idleFmt = 'text-ink-soft hover:bg-card hover:text-ink'

  return (
    <div
      className={`no-print shrink-0 w-full px-4 pb-4 pt-2 transition-all duration-200 ease-out flex justify-center ${
        leaving ? 'opacity-0 translate-y-3 pointer-events-none' : 'opacity-100 translate-y-0'
      }`}
    >
      <div
        role="dialog"
        aria-label={t('注解：{0}', term)}
        className="relative flex w-[min(740px,100%)] flex-col rounded-2xl border border-line-strong/60 bg-[color-mix(in_srgb,var(--color-card,#1a1b26)_95%,transparent)] backdrop-blur-2xl shadow-[0_20px_50px_rgba(0,0,0,0.32),0_0_0_1px_rgba(255,255,255,0.06)] overflow-hidden transition-all duration-150"
      >
        {/* 顶部标题行与操作区 */}
        <div className="flex items-center justify-between gap-3 px-4.5 pt-3.5 pb-2.5 border-b border-line/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-seal/12 text-seal ring-1 ring-seal/25 shadow-2xs">
              <StickyNote size={14} />
            </span>
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-[13.5px] font-semibold text-ink tracking-tight whitespace-nowrap">
                {editing ? t('修改注解') : t('添加注解')}
              </h2>
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-medium bg-seal/10 text-seal border border-seal/20 max-w-[200px] truncate"
                title={term}
              >
                {term}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {editing && onDelete && (
              <button
                type="button"
                onClick={() => leaveThen(onDelete)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-rose-500/90 hover:bg-rose-500/10 hover:text-rose-500 transition"
              >
                <Trash2 size={12} />
                <span>{t('删除')}</span>
              </button>
            )}
            <span className="text-[10px] font-mono text-ink-faint select-none hidden sm:inline-block">
              Ctrl+Enter
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-2.5 py-1 text-[12px] text-ink-soft hover:bg-line/50 hover:text-ink transition"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-seal px-3.5 py-1 text-[12px] font-medium text-white shadow-sm hover:brightness-105 active:scale-95 transition disabled:pointer-events-none disabled:opacity-40"
            >
              {editing ? t('保存') : t('添加')}
            </button>
            <button
              type="button"
              title={t('关闭（Esc）')}
              onClick={close}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint hover:bg-line/60 hover:text-ink transition"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 文本输入区 */}
        <div className="px-4.5 pt-2.5 pb-2">
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
            rows={3}
            placeholder={t('写下你的批注与思考…支持 Markdown 语法与 $LaTeX$ 公式')}
            className="w-full resize-none rounded-xl border border-line/60 bg-paper/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:bg-paper/90 focus:ring-2 focus:ring-seal/15"
            {...NO_AUTOFILL}
          />
        </div>

        {/* 底部样式工具条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4.5 pb-3 pt-0.5 text-[11.5px]">
          <div className="flex flex-wrap items-center gap-2">
            {/* 字符修饰 */}
            <div className="flex items-center gap-0.5 rounded-lg border border-line/50 bg-paper/50 p-0.5">
              <button
                type="button"
                title={t('粗体')}
                onClick={() => toggle('bold')}
                className={`${btnFmt} ${style.bold ? activeFmt : idleFmt}`}
              >
                <Bold size={12} />
              </button>
              <button
                type="button"
                title={t('斜体')}
                onClick={() => toggle('italic')}
                className={`${btnFmt} ${style.italic ? activeFmt : idleFmt}`}
              >
                <Italic size={12} />
              </button>
              <button
                type="button"
                title={t('下划线')}
                onClick={() => toggle('underline')}
                className={`${btnFmt} ${style.underline ? activeFmt : idleFmt}`}
              >
                <Underline size={12} />
              </button>
              <button
                type="button"
                title={t('删除线')}
                onClick={() => toggle('strike')}
                className={`${btnFmt} ${style.strike ? activeFmt : idleFmt}`}
              >
                <Strikethrough size={12} />
              </button>
            </div>

            {/* 字色选择器 */}
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-[11px] text-ink-faint">{t('字色')}</span>
              <div className="flex items-center gap-1">
                {ANNO_COLORS.map((c) => (
                  <button
                    key={`fg-${c.key}`}
                    type="button"
                    title={t('字色：{0}', t(c.label))}
                    onClick={() => setColor('fg', c.key)}
                    className={`h-4.5 w-4.5 rounded-full border transition hover:scale-110 ${
                      style.fg === c.key
                        ? 'ring-2 ring-seal ring-offset-1 dark:ring-offset-black'
                        : 'border-line-strong/60'
                    }`}
                    style={{ backgroundColor: c.fg }}
                  />
                ))}
                {style.fg && (
                  <button
                    type="button"
                    title={t('清除字色')}
                    onClick={() => setStyle((s) => { const n = { ...s }; delete n.fg; return n })}
                    className="text-[10.5px] text-ink-faint hover:text-ink ml-0.5 transition"
                  >
                    {t('重置')}
                  </button>
                )}
              </div>
            </div>

            {/* 底色选择器 */}
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-[11px] text-ink-faint">{t('底色')}</span>
              <div className="flex items-center gap-1">
                {ANNO_COLORS.map((c) => (
                  <button
                    key={`bg-${c.key}`}
                    type="button"
                    title={t('底色：{0}', t(c.label))}
                    onClick={() => setColor('bg', c.key)}
                    className={`h-4.5 w-4.5 rounded-md border transition hover:scale-110 ${
                      style.bg === c.key
                        ? 'ring-2 ring-seal ring-offset-1 dark:ring-offset-black'
                        : 'border-line-strong/60'
                    }`}
                    style={{ backgroundColor: c.bg }}
                  />
                ))}
                {style.bg && (
                  <button
                    type="button"
                    title={t('清除底色')}
                    onClick={() => setStyle((s) => { const n = { ...s }; delete n.bg; return n })}
                    className="text-[10.5px] text-ink-faint hover:text-ink ml-0.5 transition"
                  >
                    {t('重置')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 正文效果预览 */}
          <div className="flex items-center gap-1.5 text-ink-faint ml-auto">
            <span className="text-[11px]">{t('效果：')}</span>
            <span
              className="rounded px-1.5 py-0.5 text-ink border border-line/40 font-medium max-w-[140px] truncate"
              style={previewCss as React.CSSProperties}
            >
              {term}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
