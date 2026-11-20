import { useEffect, useRef, useState, useMemo } from 'react'
import katex from 'katex'
import { expandClassroomComponents } from '../../../learn/classroom/components'
import { mountComponentAnimations, runAnimeAnimation } from '../../../learn/classroom/animations'
import { Sparkles } from 'lucide-react'

export type PreviewStageTheme = 'dark' | 'light' | 'paper' | 'acrylic'

export interface ClassroomComponentPreviewProps {
  html: string
  mode?: 'thumbnail' | 'stage'
  theme?: PreviewStageTheme
  interactive?: boolean
  targetAnim?: string
  animateKey?: number | string
  className?: string
}

/** 将 HTML 片段内的 LaTeX 公式 ($...$ 和 $$...$$) 编译为 KaTeX 节点 */
function renderMath(rawHtml: string): string {
  let res = rawHtml.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })
    } catch {
      return tex
    }
  })

  res = res.replace(/(^|[^\\])\$([^\$\n]+?)\$/g, (_, prefix, tex) => {
    try {
      const rendered = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })
      return `${prefix}${rendered}`
    } catch {
      return `${prefix}$${tex}$`
    }
  })

  return res
}

export default function ClassroomComponentPreview({
  html,
  mode = 'thumbnail',
  theme = 'dark',
  interactive = false,
  targetAnim,
  animateKey,
  className = '',
}: ClassroomComponentPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  const renderedHtml = useMemo(() => {
    try {
      const expanded = expandClassroomComponents(html)
      return renderMath(expanded)
    } catch {
      return html
    }
  }, [html])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateScale = () => {
      const { clientWidth, clientHeight } = container
      if (!clientWidth || !clientHeight) return

      if (mode === 'thumbnail') {
        const baseWidth = 720
        const calculatedScale = Math.min(clientWidth / baseWidth, 0.58)
        setScale(Math.max(calculatedScale, 0.28))
      } else {
        const scaleX = clientWidth / 1920
        const scaleY = clientHeight / 1080
        setScale(Math.min(scaleX, scaleY))
      }
    }

    updateScale()

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateScale)
      ro.observe(container)
      return () => ro.disconnect()
    }
  }, [mode])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const cleanup = mountComponentAnimations(canvas)

    if (targetAnim) {
      const animTarget =
        canvas.querySelector<HTMLElement>('[data-anim]') ||
        canvas.querySelector<HTMLElement>('.card-glass') ||
        canvas.querySelector<HTMLElement>('.stage-banner') ||
        canvas.querySelector<HTMLElement>('.concept-card') ||
        canvas.querySelector<HTMLElement>('.formula-card') ||
        (canvas.firstElementChild as HTMLElement)

      if (animTarget) {
        runAnimeAnimation(animTarget, targetAnim)
      }
    }

    return () => {
      cleanup?.()
    }
  }, [renderedHtml, targetAnim, animateKey])

  const themeVars = useMemo(() => {
    if (theme === 'paper') {
      return {
        '--bg-stage': '#f5f2eb',
        '--bg-card': '#fcfbf7',
        '--bg-sunken': '#f2ede2',
        '--bg-inset': '#e8e0cf',
        '--border-subtle': '#e0d7c5',
        '--border-strong': '#cbbda3',
        '--text-primary': '#1f1b17',
        '--text-body': '#2e2a25',
        '--text-secondary': '#6e665b',
        '--text-muted': '#9c9284',
        '--accent-primary': '#a8432f',
        '--accent-sky': '#2f6ea8',
        '--accent-success': '#5c7a3f',
        '--accent-warn': '#c08a2d',
        '--accent-purple': '#7a4fa8',
      } as React.CSSProperties
    }
    if (theme === 'light') {
      return {
        '--bg-stage': '#f8fafc',
        '--bg-card': '#ffffff',
        '--bg-sunken': '#f1f5f9',
        '--bg-inset': '#e2e8f0',
        '--border-subtle': 'rgba(148, 163, 184, 0.35)',
        '--border-strong': 'rgba(100, 116, 139, 0.45)',
        '--text-primary': '#0f172a',
        '--text-body': '#1e293b',
        '--text-secondary': '#475569',
        '--text-muted': '#64748b',
        '--accent-primary': '#0284c7',
        '--accent-sky': '#0284c7',
        '--accent-success': '#059669',
        '--accent-warn': '#d97706',
        '--accent-purple': '#7c3aed',
      } as React.CSSProperties
    }
    if (theme === 'acrylic') {
      return {
        '--bg-stage': 'rgba(15, 20, 32, 0.72)',
        '--bg-card': 'rgba(26, 34, 52, 0.65)',
        '--bg-sunken': 'rgba(15, 20, 32, 0.48)',
        '--bg-inset': 'rgba(30, 41, 59, 0.55)',
        '--border-subtle': 'rgba(255, 255, 255, 0.16)',
        '--border-strong': 'rgba(255, 255, 255, 0.3)',
        '--text-primary': '#f8fafc',
        '--text-body': '#e2e8f0',
        '--text-secondary': '#cbd5e1',
        '--text-muted': '#94a3b8',
        '--accent-primary': '#d0705a',
        '--accent-sky': '#38bdf8',
        '--accent-success': '#34d399',
        '--accent-warn': '#fbbf24',
        '--accent-purple': '#a78bfa',
      } as React.CSSProperties
    }
    // 默认深色墨砚黑板
    return {
      '--bg-stage': '#13151b',
      '--bg-card': '#1c1f28',
      '--bg-sunken': '#161920',
      '--bg-inset': '#242834',
      '--border-subtle': 'rgba(148, 163, 184, 0.18)',
      '--border-strong': 'rgba(148, 163, 184, 0.32)',
      '--text-primary': '#f4f2ec',
      '--text-body': '#dcd9d0',
      '--text-secondary': '#9aa0ac',
      '--text-muted': '#6c7380',
      '--accent-primary': '#d0705a',
      '--accent-sky': '#58b4e6',
      '--accent-success': '#87a86b',
      '--accent-warn': '#e0a943',
      '--accent-purple': '#b79ae0',
    } as React.CSSProperties
  }, [theme])

  if (mode === 'thumbnail') {
    return (
      <div
        ref={containerRef}
        className={`relative w-full h-44 rounded-xl overflow-hidden bg-gradient-to-b from-[#111319] to-[#171a22] border border-line/60 select-none flex items-center justify-center group/preview ${className}`}
      >
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.38) 1px, transparent 0)',
            backgroundSize: '16px 16px',
          }}
        />

        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-[10px] font-medium text-slate-300">
          <Sparkles size={10} className="text-seal" />
          <span>实时预览</span>
        </div>

        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            width: '720px',
          }}
          className="shrink-0 transition-transform duration-150"
        >
          <div
            ref={canvasRef}
            style={themeVars}
            className={`lesson-stage-canvas !p-6 !rounded-2xl !shadow-none !border-0 !bg-none ${
              interactive ? '' : 'pointer-events-none'
            }`}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>

        <div className="absolute inset-0 bg-seal/5 opacity-0 group-hover/preview:opacity-100 transition-opacity pointer-events-none" />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[360px] rounded-2xl overflow-hidden bg-paper-deep border border-line flex items-center justify-center select-none shadow-xl ${className}`}
    >
      <div
        style={{
          width: '1920px',
          height: '1080px',
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <div
          ref={canvasRef}
          style={themeVars}
          className="lesson-stage-canvas w-full h-full flex flex-col justify-center items-center"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>
    </div>
  )
}
