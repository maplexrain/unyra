import { useEffect, useRef, useState, useMemo } from 'react'
import katex from 'katex'
import { expandClassroomComponents } from '../../../learn/classroom/components'
import { mountComponentAnimations, runAnimeAnimation } from '../../../learn/classroom/animations'
import { Sparkles } from 'lucide-react'

export interface ClassroomComponentPreviewProps {
  html: string
  mode?: 'thumbnail' | 'stage'
  theme?: 'dark' | 'light' | 'acrylic'
  interactive?: boolean
  targetAnim?: string
  animateKey?: number | string
  className?: string
}

/** 将 HTML 片段内的 LaTeX 公式 ($...$ 和 $$...$$) 编译为 KaTeX 节点 */
function renderMath(rawHtml: string): string {
  // 块级公式 $$...$$
  let res = rawHtml.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    try {
      return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })
    } catch {
      return tex
    }
  })

  // 行内公式 $...$
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

  // 展开语义组件与公式
  const renderedHtml = useMemo(() => {
    try {
      const expanded = expandClassroomComponents(html)
      return renderMath(expanded)
    } catch {
      return html
    }
  }, [html])

  // 监听容器尺寸等比缩放
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateScale = () => {
      const { clientWidth, clientHeight } = container
      if (!clientWidth || !clientHeight) return

      if (mode === 'thumbnail') {
        // 缩略图模式基准虚拟宽度 720px
        const baseWidth = 720
        const calculatedScale = Math.min(clientWidth / baseWidth, 0.6)
        setScale(Math.max(calculatedScale, 0.28))
      } else {
        // 舞台模式基准分辨率 1920x1080
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

  // 挂载动画与指定动效播放
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const cleanup = mountComponentAnimations(canvas)

    if (targetAnim) {
      const animTarget =
        canvas.querySelector<HTMLElement>('[data-anim]') ||
        canvas.querySelector<HTMLElement>('.card-glass') ||
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

  // 主题变量样式
  const themeVars = useMemo(() => {
    if (theme === 'light') {
      return {
        '--bg-stage': '#f8fafc',
        '--bg-card': '#ffffff',
        '--border-subtle': 'rgba(148, 163, 184, 0.45)',
        '--text-primary': '#0f172a',
        '--text-secondary': '#475569',
        '--accent-primary': '#0284c7',
        '--accent-warn': '#e11d48',
        '--accent-success': '#059669',
      } as React.CSSProperties
    }
    if (theme === 'acrylic') {
      return {
        '--bg-stage': 'rgba(15, 23, 42, 0.65)',
        '--bg-card': 'rgba(30, 41, 59, 0.55)',
        '--border-subtle': 'rgba(255, 255, 255, 0.2)',
        '--text-primary': '#f8fafc',
        '--text-secondary': '#cbd5e1',
        '--accent-primary': '#38bdf8',
        '--accent-warn': '#fb7185',
        '--accent-success': '#34d399',
      } as React.CSSProperties
    }
    // 默认深色沉浸黑板
    return {
      '--bg-stage': '#0f172a',
      '--bg-card': 'rgba(30, 41, 59, 0.92)',
      '--border-subtle': 'rgba(148, 163, 184, 0.25)',
      '--text-primary': '#f8fafc',
      '--text-secondary': '#94a3b8',
      '--accent-primary': '#38bdf8',
      '--accent-warn': '#f43f5e',
      '--accent-success': '#10b981',
    } as React.CSSProperties
  }, [theme])

  if (mode === 'thumbnail') {
    return (
      <div
        ref={containerRef}
        className={`relative w-full h-44 rounded-xl overflow-hidden bg-gradient-to-b from-[#0b0e14] to-[#121722] border border-white/10 select-none flex items-center justify-center group/preview ${className}`}
      >
        {/* 背景微点阵纹理 */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)',
            backgroundSize: '16px 16px',
          }}
        />

        {/* 右上角微标签 */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10 text-[10px] font-medium text-ink-soft">
          <Sparkles size={10} className="text-seal" />
          <span>实时预览</span>
        </div>

        {/* 缩放渲染核心画布 */}
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
            className={`lesson-stage-canvas !p-6 !rounded-2xl !shadow-none !border-0 ${
              interactive ? '' : 'pointer-events-none'
            }`}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>

        {/* 悬停微高亮渐变遮罩 */}
        <div className="absolute inset-0 bg-seal/5 opacity-0 group-hover/preview:opacity-100 transition-opacity pointer-events-none" />
      </div>
    )
  }

  // 舞台全景模式
  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[360px] rounded-2xl overflow-hidden bg-paper-deep border border-line flex items-center justify-center select-none shadow-xl ${className}`}
    >
      {/* 舞台背景网格纹理 */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.3) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* 16:9 画布宿主容器 */}
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
