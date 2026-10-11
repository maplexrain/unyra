import { useEffect, useRef } from 'react'
import { isDarkTheme, useAppearance } from '../../lib/appearance'

interface StarNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  baseRadius: number
  isCore: boolean
  alpha: number
  pulseSpeed: number
  pulsePhase: number
  colorIndex: number
}

interface Stardust {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  alpha: number
  maxAlpha: number
  wobbleSpeed: number
  wobblePhase: number
}

interface Pointer {
  x: number
  y: number
  active: boolean
  radius: number
}

/**
 * 登录界面专属背景动画：
 *
 * 融合「归一 · 逆向回溯」与「古代浑天星盘 × 现代知识网络」的沉浸式动态画布：
 * 1. 【逆行浑天仪星盘 (Retro Astrolabe)】：中心三层同心几何刻度环缓缓反向啮合旋转，代表回溯求本、格物致知的学术意象。
 * 2. 【知识星络引力网 (Constellation Lattice)】：数十个知识节点在二维空间漫游，邻近时自动生成微光引力丝，部分核心节点带有呼吸光晕。
 * 3. 【光标交互涟漪 (Interactive Gravity & Dust)】：鼠标滑过时引起微小引力潮汐，拖出细微发光星尘粒子。
 * 4. 【升腾知识火种 (Ascending Embers)】：自下而上缓缓升起的微亮浮尘，营造深邃静谧的探索氛围。
 * 5. 【自适应纸墨色彩】：深色模式展现星空深邃与琥珀朱砂微光，浅色模式展现宣纸水墨与古金朱印质感。
 */
export default function LoginBackgroundAnimation() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const appearance = useAppearance()
  const dark = isDarkTheme(appearance.theme)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    const onResize = () => {
      if (!canvas) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    onResize()
    window.addEventListener('resize', onResize)

    const pointer: Pointer = { x: -1000, y: -1000, active: false, radius: 140 }
    const onPointerMove = (e: MouseEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.active = true
    }
    const onPointerLeave = () => {
      pointer.active = false
      pointer.x = -1000
      pointer.y = -1000
    }
    window.addEventListener('mousemove', onPointerMove, { passive: true })
    window.addEventListener('mouseleave', onPointerLeave, { passive: true })

    // 初始化星络节点
    const nodeCount = Math.floor(Math.min(55, Math.max(30, (width * height) / 25000)))
    const nodes: StarNode[] = []
    for (let i = 0; i < nodeCount; i++) {
      const isCore = i % 7 === 0
      const radius = isCore ? Math.random() * 2 + 3 : Math.random() * 1.5 + 1.2
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius,
        baseRadius: radius,
        isCore,
        alpha: Math.random() * 0.5 + 0.35,
        pulseSpeed: Math.random() * 0.02 + 0.015,
        pulsePhase: Math.random() * Math.PI * 2,
        colorIndex: i % 4,
      })
    }

    // 初始化上升浮游光尘
    const dustCount = 32
    const dusts: Stardust[] = []
    for (let i = 0; i < dustCount; i++) {
      dusts.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -(Math.random() * 0.45 + 0.2),
        radius: Math.random() * 1.2 + 0.6,
        alpha: Math.random() * 0.4 + 0.1,
        maxAlpha: Math.random() * 0.5 + 0.3,
        wobbleSpeed: Math.random() * 0.02 + 0.01,
        wobblePhase: Math.random() * Math.PI * 2,
      })
    }

    // 浑天星盘旋转角度与交互平滑
    let astrolabeAngle1 = 0
    let astrolabeAngle2 = 0
    let astrolabeAngle3 = 0

    const render = () => {
      ctx.clearRect(0, 0, width, height)

      const cx = width / 2
      const cy = height / 2

      // 色彩系统（深浅自适应）
      const colors = dark
        ? {
            astrolabeRing: 'rgba(215, 145, 95, 0.08)',
            astrolabeTick: 'rgba(235, 180, 130, 0.14)',
            astrolabeAccent: 'rgba(195, 80, 55, 0.18)',
            line: 'rgba(200, 160, 130, ',
            nodeColors: [
              'rgba(235, 95, 65, ',   // 印章红
              'rgba(240, 180, 90, ',  // 琥珀金
              'rgba(125, 185, 245, ', // 霁蓝
              'rgba(240, 240, 245, ', // 素白
            ],
            emberColor: 'rgba(240, 175, 105, ',
          }
        : {
            astrolabeRing: 'rgba(160, 90, 60, 0.07)',
            astrolabeTick: 'rgba(140, 75, 50, 0.12)',
            astrolabeAccent: 'rgba(180, 50, 40, 0.14)',
            line: 'rgba(130, 80, 55, ',
            nodeColors: [
              'rgba(195, 60, 45, ',   // 印章朱砂
              'rgba(185, 120, 50, ',  // 赭石金
              'rgba(70, 120, 185, ',  // 晴山蓝
              'rgba(70, 60, 55, ',    // 墨黑
            ],
            emberColor: 'rgba(200, 95, 50, ',
          }

      /* ---------- 1. 浑天星盘 (Retro Astrolabe) 慢速回溯旋转 ---------- */
      astrolabeAngle1 += 0.00028
      astrolabeAngle2 -= 0.00038
      astrolabeAngle3 += 0.00018

      const baseR = Math.min(width, height) * 0.38

      ctx.save()
      ctx.translate(cx, cy)

      // 外环 1
      ctx.beginPath()
      ctx.arc(0, 0, baseR, 0, Math.PI * 2)
      ctx.strokeStyle = colors.astrolabeRing
      ctx.lineWidth = 1.2
      ctx.stroke()

      // 外环带刻度（顺转）
      ctx.save()
      ctx.rotate(astrolabeAngle1)
      ctx.beginPath()
      ctx.setLineDash([6, 14])
      ctx.arc(0, 0, baseR * 0.94, 0, Math.PI * 2)
      ctx.strokeStyle = colors.astrolabeTick
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])

      // 4 颗外象天体微点
      for (let k = 0; k < 4; k++) {
        const theta = (k * Math.PI) / 2
        const ox = Math.cos(theta) * baseR * 0.94
        const oy = Math.sin(theta) * baseR * 0.94
        ctx.beginPath()
        ctx.arc(ox, oy, 2.5, 0, Math.PI * 2)
        ctx.fillStyle = colors.astrolabeAccent
        ctx.fill()
      }
      ctx.restore()

      // 中环（逆行回溯星弧）
      ctx.save()
      ctx.rotate(astrolabeAngle2)
      ctx.beginPath()
      ctx.arc(0, 0, baseR * 0.72, 0, Math.PI * 2)
      ctx.strokeStyle = colors.astrolabeRing
      ctx.lineWidth = 1
      ctx.stroke()

      // 12 等分星位刻度线（象征十二时辰/知识周期）
      for (let i = 0; i < 12; i++) {
        const ang = (i * Math.PI * 2) / 12
        const r1 = baseR * 0.69
        const r2 = baseR * (i % 3 === 0 ? 0.75 : 0.72)
        ctx.beginPath()
        ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1)
        ctx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2)
        ctx.strokeStyle = colors.astrolabeTick
        ctx.lineWidth = i % 3 === 0 ? 1.5 : 0.8
        ctx.stroke()
      }
      ctx.restore()

      // 内环（细密虚线几何方格与正切角）
      ctx.save()
      ctx.rotate(astrolabeAngle3)
      ctx.beginPath()
      ctx.setLineDash([3, 8])
      ctx.arc(0, 0, baseR * 0.48, 0, Math.PI * 2)
      ctx.strokeStyle = colors.astrolabeAccent
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()

      ctx.restore()

      /* ---------- 2. 升腾浮游光尘 (Ascending Embers) ---------- */
      for (let i = 0; i < dusts.length; i++) {
        const d = dusts[i]
        d.wobblePhase += d.wobbleSpeed
        d.x += d.vx + Math.sin(d.wobblePhase) * 0.35
        d.y += d.vy

        if (d.y < -10) {
          d.y = height + 10
          d.x = Math.random() * width
        }
        if (d.x < -10) d.x = width + 10
        if (d.x > width + 10) d.x = -10

        // 呼吸闪烁
        const pulse = Math.sin(d.wobblePhase) * 0.5 + 0.5
        const curAlpha = d.alpha + pulse * (d.maxAlpha - d.alpha)

        ctx.beginPath()
        ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2)
        ctx.fillStyle = `${colors.emberColor}${curAlpha.toFixed(3)})`
        ctx.fill()
      }

      /* ---------- 3. 知识星络节点运动与互联 (Constellation Lattice) ---------- */
      const maxConnectDist = 135
      const connectDistSq = maxConnectDist * maxConnectDist

      // 位置更新 & 光标引力潮汐
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        n.x += n.vx
        n.y += n.vy

        // 柔和边界反弹
        if (n.x < 10) {
          n.x = 10
          n.vx *= -1
        } else if (n.x > width - 10) {
          n.x = width - 10
          n.vx *= -1
        }
        if (n.y < 10) {
          n.y = 10
          n.vy *= -1
        } else if (n.y > height - 10) {
          n.y = height - 10
          n.vy *= -1
        }

        // 光标吸引与推移微动
        if (pointer.active) {
          const pdx = pointer.x - n.x
          const pdy = pointer.y - n.y
          const pDist = Math.sqrt(pdx * pdx + pdy * pdy)
          if (pDist < pointer.radius && pDist > 5) {
            const force = (1 - pDist / pointer.radius) * 0.5
            n.x += (pdx / pDist) * force
            n.y += (pdy / pDist) * force
          }
        }

        // 呼吸脉动
        n.pulsePhase += n.pulseSpeed
      }

      // 绘制星络连接线（空间距离平方快速剪枝）
      for (let i = 0; i < nodes.length; i++) {
        const na = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          const nb = nodes[j]
          const dx = nb.x - na.x
          const dy = nb.y - na.y
          const dSq = dx * dx + dy * dy
          if (dSq < connectDistSq) {
            const dist = Math.sqrt(dSq)
            const alpha = (1 - dist / maxConnectDist) * 0.22
            ctx.beginPath()
            ctx.moveTo(na.x, na.y)
            ctx.lineTo(nb.x, nb.y)
            ctx.strokeStyle = `${colors.line}${alpha.toFixed(3)})`
            ctx.lineWidth = 0.9
            ctx.stroke()
          }
        }
      }

      // 绘制节点自身与核心光晕
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]
        const pulse = Math.sin(n.pulsePhase) * 0.35 + 0.65
        const curAlpha = Math.min(1, n.alpha * pulse)
        const curRadius = n.baseRadius * (1 + (pulse - 0.65) * 0.3)
        const colPrefix = colors.nodeColors[n.colorIndex]

        // 核心节点带有柔和外光晕
        if (n.isCore) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, curRadius * 2.8, 0, Math.PI * 2)
          ctx.fillStyle = `${colPrefix}${(curAlpha * 0.18).toFixed(3)})`
          ctx.fill()
        }

        // 实体核心
        ctx.beginPath()
        ctx.arc(n.x, n.y, curRadius, 0, Math.PI * 2)
        ctx.fillStyle = `${colPrefix}${curAlpha.toFixed(3)})`
        ctx.fill()
      }

      // 光标处的微妙探索光晕
      if (pointer.active) {
        const grad = ctx.createRadialGradient(
          pointer.x,
          pointer.y,
          0,
          pointer.x,
          pointer.y,
          pointer.radius,
        )
        grad.addColorStop(0, dark ? 'rgba(215, 120, 80, 0.08)' : 'rgba(180, 60, 45, 0.06)')
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.beginPath()
        ctx.arc(pointer.x, pointer.y, pointer.radius, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
      }

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onPointerMove)
      window.removeEventListener('mouseleave', onPointerLeave)
    }
  }, [dark])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full select-none"
    />
  )
}
