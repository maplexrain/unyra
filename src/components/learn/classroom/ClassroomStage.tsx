import { useEffect, useRef } from 'react'
import { StageViewport } from '../../../learn/classroom/StageViewport'
import type { PlaybackStatus } from '../../../learn/classroom/types'
import { Sparkles, ArrowRight } from 'lucide-react'
import { t } from '../../../i18n'
import katex from 'katex'

export interface ClassroomStageProps {
  onViewportReady: (viewport: StageViewport) => void
  subtitle?: string
  checkpointTitle?: string
  status: PlaybackStatus
  onContinueCheckpoint: () => void
}

/** 渲染带 LaTeX 公式支持的字幕文本 */
function renderSubtitleHtml(text: string): string {
  // 转换 $...$
  return text.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, prefix, tex) => {
    try {
      const rendered = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })
      return `${prefix}${rendered}`
    } catch {
      return `${prefix}$${tex}$`
    }
  })
}

export default function ClassroomStage({
  onViewportReady,
  subtitle,
  checkpointTitle,
  status,
  onContinueCheckpoint,
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

  return (
    <div className="relative flex-1 w-full h-full min-h-0 bg-[#07090e] overflow-hidden select-none flex items-center justify-center">
      {/* 16:9 画布宿主容器 */}
      <div ref={containerRef} className="w-full h-full" />

      {/* 底部动态字幕胶囊（带公式渲染） */}
      {subtitle && status !== 'ended' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 max-w-[85%] px-6 py-2.5 rounded-2xl bg-black/80 border border-white/15 text-white shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div
            className="text-[16px] md:text-[18px] font-medium text-center tracking-wide leading-relaxed text-slate-100"
            dangerouslySetInnerHTML={{ __html: renderSubtitleHtml(subtitle) }}
          />
        </div>
      )}

      {/* 交互思考/确认检查点浮层 */}
      {status === 'waiting_checkpoint' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="flex flex-col items-center gap-5 p-8 max-w-lg rounded-3xl border border-sky-400/40 bg-slate-900/95 text-white shadow-[0_20px_60px_rgba(56,189,248,0.25)] text-center animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-400/30">
              <Sparkles size={28} className="animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="text-[13px] font-bold tracking-wider text-sky-400 uppercase">
                {t('思考检查点')}
              </div>
              <div className="text-[20px] font-bold text-slate-100">
                {checkpointTitle || t('请思考并点击继续下一步')}
              </div>
            </div>
            <button
              type="button"
              onClick={onContinueCheckpoint}
              className="mt-2 flex items-center gap-2.5 px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-[15px] shadow-lg shadow-sky-500/30 transition active:scale-95 cursor-pointer"
            >
              <span>{t('继续课堂')}</span>
              <ArrowRight size={18} />
            </button>
            <div className="text-[12px] text-slate-400">
              {t('提示：按空格键也可直接推进')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
