import { useState } from 'react'
import { Check, FileCode, Star } from 'lucide-react'
import {
  NOTE_FORMATS,
  NOTE_FORMAT_META,
  type NoteFormat,
  getDefaultNoteFormat,
  setDefaultNoteFormat,
} from '../../learn/noteFormat'
import { t } from '../../i18n'

interface Props {
  currentFormat: NoteFormat
  onSelectFormat: (format: NoteFormat) => void
}

/**
 * 笔记源码类型浮层：
 * - 切换当前笔记的格式（普通文本 / Markdown / HTML / Typst）
 * - 允许选择其中一个作为默认格式（之后新建笔记都使用默认格式）
 */
export default function NoteFormatTip({ currentFormat, onSelectFormat }: Props) {
  const [defaultFormat, setDefaultFmt] = useState<NoteFormat>(getDefaultNoteFormat)

  const handleSetDefault = (e: React.MouseEvent, fmt: NoteFormat) => {
    e.stopPropagation()
    setDefaultNoteFormat(fmt)
    setDefaultFmt(fmt)
  }

  return (
    <div
      role="tooltip"
      className="absolute left-full top-0 ml-2 z-30 w-72 rounded-none border border-line-strong/80 bg-card/95 p-3 shadow-xl backdrop-blur select-none animate-in fade-in zoom-in-95 duration-150"
    >
      {/* 头部：标题与图标 */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-line/60">
        <div className="flex items-center gap-1.5">
          <FileCode size={15} className="text-seal" />
          <span className="text-[12px] font-semibold text-ink-strong tracking-wide">
            {t('笔记源码类型')}
          </span>
        </div>
        <span className="text-[10.5px] text-ink-faint">
          {t('默认: {0}', NOTE_FORMAT_META[defaultFormat].label)}
        </span>
      </div>

      {/* 4 种类型列表 */}
      <div className="flex flex-col gap-1">
        {NOTE_FORMATS.map((fmt) => {
          const meta = NOTE_FORMAT_META[fmt]
          const isCurrent = currentFormat === fmt
          const isDefault = defaultFormat === fmt

          return (
            <div
              key={fmt}
              role="button"
              tabIndex={0}
              onClick={() => onSelectFormat(fmt)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectFormat(fmt)
                }
              }}
              className={`group flex items-center justify-between px-2 py-1.5 rounded-none border text-left transition-colors cursor-pointer ${
                isCurrent
                  ? 'border-seal/50 bg-seal/10 text-ink-strong'
                  : 'border-transparent text-ink hover:bg-line/40 hover:border-line/60'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`flex h-5 w-7 shrink-0 items-center justify-center font-mono text-[10px] font-bold tracking-tight rounded-none border ${
                    isCurrent
                      ? 'border-seal/50 bg-seal/20 text-seal'
                      : 'border-line/60 bg-paper text-ink-soft group-hover:text-ink'
                  }`}
                >
                  {meta.badge}
                </span>

                <div className="min-w-0 flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-medium leading-none">{meta.label}</span>
                    {isCurrent && <Check size={12} className="text-seal shrink-0" />}
                  </div>
                  <span className="text-[10.5px] text-ink-faint truncate leading-tight mt-0.5">
                    {meta.desc}
                  </span>
                </div>
              </div>

              {/* 设为默认操作 */}
              <div className="shrink-0 ml-2">
                {isDefault ? (
                  <span
                    title={t('当前默认格式')}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9.5px] font-semibold text-seal bg-seal/15 border border-seal/30"
                  >
                    <Star size={10} className="fill-seal text-seal" />
                    {t('默认')}
                  </span>
                ) : (
                  <button
                    type="button"
                    title={t('设为新建笔记的默认格式')}
                    onClick={(e) => handleSetDefault(e, fmt)}
                    className="px-1.5 py-0.5 text-[10px] text-ink-faint opacity-60 hover:opacity-100 hover:text-seal hover:bg-line/60 border border-transparent hover:border-line transition-all"
                  >
                    {t('设为默认')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部提示 */}
      <div className="mt-2.5 pt-2 border-t border-line/40 text-[10.5px] text-ink-faint flex items-center justify-between">
        <span>{t('新建笔记将采用当前设置的默认格式')}</span>
      </div>
    </div>
  )
}
