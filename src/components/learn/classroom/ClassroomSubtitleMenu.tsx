import { useState, useRef, useEffect } from 'react'
import type { SubtitleStyleConfig } from '../../../learn/classroom/types'
import { Subtitles, SlidersHorizontal, Check } from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomSubtitleMenuProps {
  showSubtitle: boolean
  onToggleSubtitle: () => void
  subtitleStyle: SubtitleStyleConfig
  onChangeSubtitleStyle: (patch: Partial<SubtitleStyleConfig>) => void
}

const FONT_SIZE_OPTIONS = [
  { label: '小', size: 18 },
  { label: '中', size: 22 },
  { label: '大', size: 26 },
  { label: '特大', size: 32 },
]

const STROKE_OPTIONS = [
  { label: '无', width: 0 },
  { label: '细描边', width: 0.8 },
  { label: '标准', width: 1.2 },
]

const BG_OPTIONS: Array<{ label: string; mode: 'none' | 'translucent' | 'solid' }> = [
  { label: '胶囊半透明 (推荐)', mode: 'translucent' },
  { label: '纯描边无底', mode: 'none' },
  { label: '深黑实底', mode: 'solid' },
]

const COLOR_OPTIONS = [
  { label: '纯白', value: '#ffffff' },
  { label: '明黄', value: '#facc15' },
  { label: '青蓝', value: '#38bdf8' },
]

export default function ClassroomSubtitleMenu({
  showSubtitle,
  onToggleSubtitle,
  subtitleStyle,
  onChangeSubtitleStyle,
}: ClassroomSubtitleMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={menuRef} className="relative flex items-center">
      {/* 字幕主开关按钮 */}
      <button
        type="button"
        onClick={onToggleSubtitle}
        title={showSubtitle ? t('关闭字幕') : t('开启字幕')}
        className={`flex h-8 items-center gap-1.5 px-2 rounded-l-lg border border-r-0 border-line/40 text-[12px] font-medium transition cursor-pointer ${
          showSubtitle
            ? 'bg-seal/15 border-seal text-seal font-bold'
            : 'text-ink-faint hover:bg-line/50 hover:text-ink'
        }`}
      >
        <Subtitles size={15} />
        <span>{t('字幕')}</span>
      </button>

      {/* 字幕样式配置下拉触发按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        title={t('字幕样式配置')}
        className={`flex h-8 w-6 items-center justify-center rounded-r-lg border border-line/40 text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer ${
          isOpen ? 'bg-line/60 text-ink' : ''
        }`}
      >
        <SlidersHorizontal size={12} />
      </button>

      {/* 样式弹窗 */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-72 p-3.5 rounded-2xl bg-card/95 border border-line/80 shadow-2xl backdrop-blur-md text-ink select-none z-50 animate-in fade-in zoom-in-95 duration-150 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line/40 pb-2">
            <span className="text-[13px] font-bold text-ink-strong">{t('字幕显示与样式')}</span>
            <button
              type="button"
              onClick={onToggleSubtitle}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer ${
                showSubtitle ? 'bg-seal text-white' : 'bg-line text-ink-soft'
              }`}
            >
              {showSubtitle ? t('已开启') : t('已关闭')}
            </button>
          </div>

          {/* 实时效果预览 */}
          <div className="flex items-center justify-center p-3 rounded-xl bg-slate-950 text-center overflow-hidden border border-white/10">
            <span
              style={{
                fontSize: `${subtitleStyle.fontSize}px`,
                color: subtitleStyle.color || '#ffffff',
                paintOrder: 'stroke fill',
                WebkitTextStroke:
                  subtitleStyle.strokeWidth > 0
                    ? `${Math.min(subtitleStyle.strokeWidth, 1.2)}px ${subtitleStyle.strokeColor || '#000'}`
                    : 'none',
                textShadow:
                  subtitleStyle.bgMode === 'none'
                    ? '0 0 2px #000, 0 1px 3px #000, 0 2px 6px rgba(0,0,0,0.95)'
                    : '0 1px 3px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.8)',
              }}
              className="font-bold tracking-wide"
            >
              Aa 白字清晰字幕预览
            </span>
          </div>

          {/* 字号选择 */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-ink-faint font-medium">{t('字号大小')}</span>
            <div className="grid grid-cols-4 gap-1.5">
              {FONT_SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.size}
                  type="button"
                  onClick={() => onChangeSubtitleStyle({ fontSize: opt.size })}
                  className={`py-1 text-[11px] font-semibold rounded-lg border transition cursor-pointer ${
                    subtitleStyle.fontSize === opt.size
                      ? 'border-seal bg-seal/15 text-seal'
                      : 'border-line/50 text-ink-soft hover:bg-line/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 描边粗细 */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-ink-faint font-medium">{t('文字描边')}</span>
            <div className="grid grid-cols-3 gap-1.5">
              {STROKE_OPTIONS.map((opt) => (
                <button
                  key={opt.width}
                  type="button"
                  onClick={() => onChangeSubtitleStyle({ strokeWidth: opt.width })}
                  className={`py-1 text-[11px] font-semibold rounded-lg border transition cursor-pointer ${
                    subtitleStyle.strokeWidth === opt.width
                      ? 'border-seal bg-seal/15 text-seal'
                      : 'border-line/50 text-ink-soft hover:bg-line/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 底色模式 */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-ink-faint font-medium">{t('背景模式')}</span>
            <div className="grid grid-cols-3 gap-1.5">
              {BG_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => onChangeSubtitleStyle({ bgMode: opt.mode })}
                  className={`py-1 text-[10.5px] font-semibold rounded-lg border transition cursor-pointer ${
                    subtitleStyle.bgMode === opt.mode
                      ? 'border-seal bg-seal/15 text-seal'
                      : 'border-line/50 text-ink-soft hover:bg-line/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 文字颜色 */}
          <div className="space-y-1.5">
            <span className="text-[11px] text-ink-faint font-medium">{t('文字颜色')}</span>
            <div className="flex items-center gap-2">
              {COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChangeSubtitleStyle({ color: opt.value })}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition cursor-pointer ${
                    subtitleStyle.color === opt.value
                      ? 'border-seal bg-seal/15 text-seal font-bold'
                      : 'border-line/50 text-ink-soft hover:bg-line/40'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-black/30 shrink-0"
                    style={{ backgroundColor: opt.value }}
                  />
                  <span>{opt.label}</span>
                  {subtitleStyle.color === opt.value && <Check size={11} className="ml-0.5" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
