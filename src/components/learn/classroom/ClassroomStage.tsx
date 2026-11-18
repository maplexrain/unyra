import { useEffect, useRef } from 'react'
import { StageViewport } from '../../../learn/classroom/StageViewport'
import type { PlaybackStatus, SubtitleStyleConfig } from '../../../learn/classroom/types'
import { DEFAULT_SUBTITLE_SETTINGS } from '../../../learn/classroom/types'
import { Sparkles, ArrowRight } from 'lucide-react'
import { t } from '../../../i18n'
import katex from 'katex'

export interface ClassroomStageProps {
  onViewportReady: (viewport: StageViewport) => void
  subtitle?: string
  checkpointTitle?: string
  status: PlaybackStatus
  onContinueCheckpoint: () => void
  showSubtitle?: boolean
  subtitleStyle?: SubtitleStyleConfig
}

/** 渲染带 LaTeX 公式支持的字幕文本（严禁包含句号） */
function renderSubtitleHtml(text: string): string {
  // 严禁包含句号，一律清洗
  const clean = text.replace(/[。.]/g, '')
  // 转换 $...$
  const html = clean.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, prefix, tex) => {
    try {
      const rendered = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })
      return `${prefix}${rendered}`
    } catch {
      return `${prefix}$${tex}$`
    }
  })
  // 强制处理为单行，并去除多余空白
  return html.replace(/\s+/g, ' ').trim()
}

export default function ClassroomStage({
  onViewportReady,
  subtitle,
  checkpointTitle,
  status,
  onContinueCheckpoint,
  showSubtitle = true,
  subtitleStyle = DEFAULT_SUBTITLE_SETTINGS.style,
}: ClassroomStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<StageViewport | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const vp = new StageViewport(containerRef.current)
    viewportRef.current = vp
    onViewportReady(vp)

    return () => {
      vp.destroy()
      viewportRef.current = null
    }
  }, [onViewportReady])

  const strokeColor = subtitleStyle.strokeColor || '#000000'
  const strokeWidth = subtitleStyle.strokeWidth ?? 1.5

  return (
    <div className="relative flex-1 w-full h-full min-h-0 bg-paper-deep overflow-hidden select-none flex items-center justify-center">
      {/* 16:9 画布宿主容器 */}
      <div ref={containerRef} className="w-full h-full" />

      {/* 底部动态字幕（可配置开关与白字黑色描边样式，z-10 避免遮挡控制台弹窗与交互浮层） */}
      {showSubtitle && subtitle && status !== 'ended' && (
        <div
          className="absolute bottom-10 left-0 right-0 z-10 flex justify-center pointer-events-none px-6"
        >
          <div
            className={`max-w-[85%] px-7 py-3 rounded-2xl select-none transition-all duration-300 flex items-center justify-center ${
              subtitleStyle.bgMode === 'solid'
                ? 'bg-mask/90 border border-line-strong/40 shadow-2xl backdrop-blur-md'
                : subtitleStyle.bgMode === 'none'
                ? 'bg-transparent shadow-none'
                : 'bg-mask/50 backdrop-blur-md border border-white/10 shadow-xl'
            }`}
          >
            <div
              className="font-bold text-center tracking-wide leading-relaxed text-white"
              style={{
                fontSize: `${subtitleStyle.fontSize || 22}px`,
                color: subtitleStyle.color || '#ffffff',
                paintOrder: 'stroke fill',
                WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${strokeColor}` : 'none',
                textShadow:
                  strokeWidth > 0
                    ? `-1.5px -1.5px 0 ${strokeColor}, 1.5px -1.5px 0 ${strokeColor}, -1.5px 1.5px 0 ${strokeColor}, 1.5px 1.5px 0 ${strokeColor}, 0 2px 5px rgba(0,0,0,0.85)`
                    : '0 2px 4px rgba(0,0,0,0.8)',
              }}
              dangerouslySetInnerHTML={{ __html: renderSubtitleHtml(subtitle) }}
            />
          </div>
        </div>
      )}

      {/* 交互思考/确认检查点浮层 */}
      {status === 'waiting_checkpoint' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-mask/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="flex flex-col items-center gap-5 p-8 max-w-lg rounded-3xl border border-seal/30 bg-card/95 text-ink shadow-2xl text-center animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-seal/15 text-seal border border-seal/25">
              <Sparkles size={28} className="animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="text-[13px] font-bold tracking-wider text-seal uppercase">
                {t('思考检查点')}
              </div>
              <div className="text-[20px] font-bold text-ink-strong">
                {checkpointTitle || t('请思考并点击继续下一步')}
              </div>
            </div>
            <button
              type="button"
              onClick={onContinueCheckpoint}
              className="mt-2 flex items-center gap-2.5 px-6 py-3 rounded-xl bg-seal hover:bg-seal-deep text-white font-bold text-[15px] shadow-lg shadow-seal/25 transition active:scale-95 cursor-pointer"
            >
              <span>{t('继续课堂')}</span>
              <ArrowRight size={18} />
            </button>
            <div className="text-[12px] text-ink-faint">
              {t('提示：按空格键也可直接推进')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
