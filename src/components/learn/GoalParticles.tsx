import { useEffect, useRef } from 'react'

/**
 * 目标创建页的“归一”螺旋分形与回溯背景动画：
 *
 * 核心哲学表达与完整生命周期（Recursive Spiral Convergence - 5/4/3/2 四层分形）：
 * 1. 【一之初始 (0.00~0.04)】：正中根节点素白安坐，伴随微弱星尘平静呼吸。
 * 2. 【Phase 1 根节点转动甩出 5 枝藤蔓 (0.04~0.16)】：平分 360° (每 72°)，沿固定曲线像藤蔓般生长出 5 个一级节点。
 * 3. 【Phase 2 一级各转甩出 4 枝藤蔓 (0.16~0.28)】：平分 360° (每 90°)，沿固定曲线生长出 20 个二级节点。
 * 4. 【Phase 3 二级各转甩出 3 枝藤蔓 (0.28~0.40)】：平分 360° (每 120°)，沿固定曲线生长出 60 个三级节点。
 * 5. 【Phase 4 三级各转甩出 2 枝叶梢 (0.40~0.51)】：平分 360° (每 180° 对称)，沿固定曲线生长出 120 个四级叶子节点（共 206 节点曼陀罗全域展开）。
 * 6. 【Phase 5 叶子色彩觉醒绽放 (0.51~0.60)】：120 个叶子节点显化 120 种高饱和璀璨光谱宝石色，全景展开呼吸。
 * 7. 【Phase 6 三级倒转收回·双色合成 (0.60~0.69)】：60 个三级节点沿固定藤蔓原路收回 120 个叶子，双色计算合成新颜色赋给三级节点。
 * 8. 【Phase 7 二级倒转收回·三色合成 (0.69~0.77)】：20 个二级节点沿固定藤蔓原路收回 60 个三级节点，三色计算合成新颜色赋给二级节点。
 * 9. 【Phase 8 一级倒转收回·四色合成 (0.77~0.84)】：5 个一级节点沿固定藤蔓原路收回 20 个二级节点，四色计算合成新颜色赋给一级节点。
 * 10.【Phase 9 根节点倒转·五色归一 (0.84~0.91)】：根节点沿固定藤蔓收回 5 个一级节点，五色汇入正中，爆发出同心归一光晕。
 * 11.【Phase 10 两秒纯白过渡·周而复始 (0.91~1.00)】：根节点在最后整整两秒（2000ms）内匀滑过渡恢复为纯白，随后无缝循环。
 *
 * 视觉优化关键点：
 * - 整体不透明度降低为 40% (opacity: 0.4)，柔和融入卡片背景。
 * - 连接曲线采用 de Casteljau 截取固定贝塞尔路径，绝无整体等比放大/变形的缩放感，而是如真实藤蔓般从根基静止扎根、末梢向前推进延伸。
 */

interface RGB {
  r: number
  g: number
  b: number
}

interface Point {
  x: number
  y: number
}

interface BezierCurve {
  p0: Point
  p1: Point
  p2: Point
  p3: Point
}

// 120 种璀璨光谱色彩（高饱和度宝石色系，象征万千不同知识点）
const LEAF_COLORS: RGB[] = Array.from({ length: 120 }, (_, i) => {
  const hue = ((i * 137.508) % 360 + 360) % 360
  const s = 0.88
  const l = 0.62
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r1 = 0,
    g1 = 0,
    b1 = 0
  if (hue < 60) {
    r1 = c
    g1 = x
  } else if (hue < 120) {
    r1 = x
    g1 = c
  } else if (hue < 180) {
    g1 = c
    b1 = x
  } else if (hue < 240) {
    r1 = x
    b1 = c
  } else if (hue < 300) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
})

// 初始素白与纯白
const NEUTRAL_COLOR: RGB = { r: 235, g: 242, b: 255 }
const PURE_WHITE: RGB = { r: 255, g: 255, b: 255 }

// 平方根光度保真色彩融合（防止简单线性平均导致的暗淡混浊）
function blendRGB(c1: RGB, c2: RGB, weight1 = 0.5): RGB {
  const w1 = weight1
  const w2 = 1 - weight1
  return {
    r: Math.round(Math.sqrt(Math.max(0, w1 * c1.r * c1.r + w2 * c2.r * c2.r))),
    g: Math.round(Math.sqrt(Math.max(0, w1 * c1.g * c1.g + w2 * c2.g * c2.g))),
    b: Math.round(Math.sqrt(Math.max(0, w1 * c1.b * c1.b + w2 * c2.b * c2.b))),
  }
}

function blendColorList(colors: RGB[]): RGB {
  if (colors.length === 0) return NEUTRAL_COLOR
  let r2 = 0,
    g2 = 0,
    b2 = 0
  for (const c of colors) {
    r2 += c.r * c.r
    g2 += c.g * c.g
    b2 += c.b * c.b
  }
  const n = colors.length
  return {
    r: Math.round(Math.sqrt(r2 / n)),
    g: Math.round(Math.sqrt(g2 / n)),
    b: Math.round(Math.sqrt(b2 / n)),
  }
}

// 缓动函数
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

function clamp(v: number, min = 0, max = 1): number {
  return Math.min(Math.max(v, min), max)
}

// 沿固定贝塞尔曲线截取 [0, t] 段（de Casteljau 算法：已生长的曲线部分在空间中绝对固定，藤蔓末梢向前延伸）
function trimBezier(c: BezierCurve, t: number): BezierCurve {
  if (t >= 0.999) return c
  if (t <= 0.001) {
    return { p0: c.p0, p1: c.p0, p2: c.p0, p3: c.p0 }
  }
  const { p0, p1, p2, p3 } = c
  const mt = 1 - t
  const p01 = { x: mt * p0.x + t * p1.x, y: mt * p0.y + t * p1.y }
  const p12 = { x: mt * p1.x + t * p2.x, y: mt * p1.y + t * p2.y }
  const p23 = { x: mt * p2.x + t * p3.x, y: mt * p2.y + t * p3.y }
  const p012 = { x: mt * p01.x + t * p12.x, y: mt * p01.y + t * p12.y }
  const p123 = { x: mt * p12.x + t * p23.x, y: mt * p12.y + t * p23.y }
  const p0123 = { x: mt * p012.x + t * p123.x, y: mt * p012.y + t * p123.y }
  return { p0, p1: p01, p2: p012, p3: p0123 }
}

// 创建起点到终点的固定螺旋贝塞尔曲线（曲率手性固定）
function createBranchCurve(pStart: Point, pEnd: Point, curlFactor: number): BezierCurve {
  const dx = pEnd.x - pStart.x
  const dy = pEnd.y - pStart.y
  const dist = Math.hypot(dx, dy)
  if (dist < 0.001) {
    return { p0: pStart, p1: pStart, p2: pEnd, p3: pEnd }
  }
  const nx = -dy / dist
  const ny = dx / dist
  const arcOffset = dist * curlFactor

  const p1 = {
    x: pStart.x + dx * 0.35 + nx * arcOffset,
    y: pStart.y + dy * 0.35 + ny * arcOffset,
  }
  const p2 = {
    x: pStart.x + dx * 0.75 + nx * (arcOffset * 0.65),
    y: pStart.y + dy * 0.75 + ny * (arcOffset * 0.65),
  }
  return { p0: pStart, p1, p2, p3: pEnd }
}

// ==========================================
// 严格逐层自底向上递归色彩合成（5 / 4 / 3 / 2）
// ==========================================
// Level 3 (60 个节点)：每个父节点对应 2 个叶子子节点
const L3_FUSED_COLORS: RGB[] = Array.from({ length: 60 }, (_, i) => {
  return blendColorList([LEAF_COLORS[i * 2], LEAF_COLORS[i * 2 + 1]])
})

// Level 2 (20 个节点)：每个父节点对应 3 个 Level 3 节点
const L2_FUSED_COLORS: RGB[] = Array.from({ length: 20 }, (_, i) => {
  return blendColorList([
    L3_FUSED_COLORS[i * 3],
    L3_FUSED_COLORS[i * 3 + 1],
    L3_FUSED_COLORS[i * 3 + 2],
  ])
})

// Level 1 (5 个节点)：每个父节点对应 4 个 Level 2 节点
const L1_FUSED_COLORS: RGB[] = Array.from({ length: 5 }, (_, i) => {
  return blendColorList([
    L2_FUSED_COLORS[i * 4],
    L2_FUSED_COLORS[i * 4 + 1],
    L2_FUSED_COLORS[i * 4 + 2],
    L2_FUSED_COLORS[i * 4 + 3],
  ])
})

// Root (1 个根节点)：融合所有 5 个 Level 1 节点
const ROOT_FUSED_COLOR: RGB = blendColorList(L1_FUSED_COLORS)

interface Stardust {
  x: number
  y: number
  r: number
  speed: number
  angle: number
  orbitR: number
  alpha: number
}

const TOTAL_CYCLE_MS = 22000 // 完整周期 22 秒
const RESET_DURATION_MS = 2000 // 最后整整 2 秒根节点平滑过渡为纯白色

export default function GoalParticles({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId = 0
    let width = 0
    let height = 0
    let dpr = 1
    const startTime = performance.now()

    // 背景星尘微粒 (围绕正中心漫游)
    const stardusts: Stardust[] = Array.from({ length: 48 }, () => ({
      x: 0,
      y: 0,
      r: 0.8 + Math.random() * 1.5,
      speed: (0.00012 + Math.random() * 0.00022) * (Math.random() < 0.5 ? 1 : -1),
      angle: Math.random() * Math.PI * 2,
      orbitR: 0.08 + Math.random() * 0.45,
      alpha: 0.15 + Math.random() * 0.45,
    }))

    const handleResize = () => {
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
    }

    handleResize()
    const ro = new ResizeObserver(handleResize)
    ro.observe(canvas)

    // 绘制沿固定路径生长的藤蔓分枝（绝不整体等比缩放）
    const drawGrowingVine = (
      curve: BezierCurve,
      growth: number,
      color: RGB,
      alpha: number,
      lineWidth = 1.4,
    ) => {
      if (growth <= 0.001 || alpha <= 0.001) return
      const sub = trimBezier(curve, growth)
      ctx.beginPath()
      ctx.moveTo(sub.p0.x, sub.p0.y)
      ctx.bezierCurveTo(sub.p1.x, sub.p1.y, sub.p2.x, sub.p2.y, sub.p3.x, sub.p3.y)
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`
      ctx.lineWidth = lineWidth * dpr
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    // 绘制节点本体（呼吸光晕 + 凝实核心 + 核心高光）
    const drawNode = (
      x: number,
      y: number,
      baseRadius: number,
      color: RGB,
      alpha: number,
      glowMultiplier = 1,
    ) => {
      if (alpha <= 0.001) return
      const r = baseRadius * dpr

      // 外层呼吸光晕
      const glowR = r * (2.2 * glowMultiplier)
      const grad = ctx.createRadialGradient(x, y, r * 0.3, x, y, glowR)
      grad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.45).toFixed(3)})`)
      grad.addColorStop(0.5, `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.15).toFixed(3)})`)
      grad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`)
      ctx.beginPath()
      ctx.arc(x, y, glowR, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      // 凝实核
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.9).toFixed(3)})`
      ctx.fill()

      // 核心明亮高光
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.8, r * 0.38), 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.95).toFixed(3)})`
      ctx.fill()
    }

    const render = (now: number) => {
      animId = requestAnimationFrame(render)
      if (width <= 0 || height <= 0) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const cx = (width / 2) * dpr
      const cy = (height / 2) * dpr
      const minDim = Math.min(width, height) * dpr

      // 5/4/3/2 分形尺度分布
      const d1 = minDim * 0.19
      const d2 = minDim * 0.095
      const d3 = minDim * 0.052
      const d4 = minDim * 0.028

      const elapsed = now - startTime
      const elapsedInCycle = elapsed % TOTAL_CYCLE_MS
      const progress = elapsedInCycle / TOTAL_CYCLE_MS // [0, 1)

      // 背景星系微旋
      const globalAmbientRot = elapsed * 0.00007

      // ==========================
      // 0. 绘制背景星尘
      // ==========================
      for (const p of stardusts) {
        p.angle += p.speed
        const orbitPix = p.orbitR * minDim
        const sx = cx + Math.cos(p.angle) * orbitPix
        const sy = cy + Math.sin(p.angle) * orbitPix
        ctx.beginPath()
        ctx.arc(sx, sy, p.r * dpr, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(195, 208, 225, ${p.alpha * 0.35})`
        ctx.fill()
      }

      // ==========================
      // 1. 各层藤蔓生长进度（顺次波浪推进与原路收回）
      // ==========================
      // Phase 1 (0.04 ~ 0.16): 根节点转动甩出 5 个 L1 节点 (平分 360°)
      // Phase 2 (0.16 ~ 0.28): 5 个 L1 节点各甩出 4 个 L2 节点 (平分 360°)
      // Phase 3 (0.28 ~ 0.40): 20 个 L2 节点各甩出 3 个 L3 节点 (平分 360°)
      // Phase 4 (0.40 ~ 0.51): 60 个 L3 节点各甩出 2 个 L4 叶子节点 (平分 360°)
      // Phase 5 (0.51 ~ 0.60): 120 个叶子节点色彩觉醒绽放
      // Phase 6 (0.60 ~ 0.69): L3 倒转收回 L4，合成双色赋给 L3
      // Phase 7 (0.69 ~ 0.77): L2 倒转收回 L3，合成三色赋给 L2
      // Phase 8 (0.77 ~ 0.84): L1 倒转收回 L2，合成四色赋给 L1
      // Phase 9 (0.84 ~ 0.909): 根节点倒转收回 L1，合成五色归一
      // Phase 10 (0.909 ~ 1.00): 最后整整两秒 (2000ms) 根节点过渡回纯白

      // 计算某一分支在指定时间区间的藤蔓生长率（带顺次相移，产生甩出波浪感）
      const calcGrowth = (
        p: number,
        growStart: number,
        growDur: number,
        holdEnd: number,
        retractStart: number,
        retractDur: number,
        itemIdx: number,
        totalItems: number,
      ): number => {
        if (p < growStart) return 0
        if (p < growStart + growDur) {
          const u = (p - growStart) / growDur
          const stagger = (itemIdx / totalItems) * 0.35
          const t = clamp((u - stagger) / 0.65)
          return easeInOutCubic(t)
        }
        if (p < holdEnd) return 1
        if (p < retractStart + retractDur) {
          const u = (p - retractStart) / retractDur
          const stagger = ((totalItems - 1 - itemIdx) / totalItems) * 0.35
          const t = clamp((u - stagger) / 0.65)
          return 1 - easeInOutCubic(t)
        }
        return 0
      }

      // ==========================
      // 2. 递归色彩合成与变色解算
      // ==========================
      const colorBloom = easeOutQuad(clamp((progress - 0.51) / 0.09))
      const currentLeafColors: RGB[] = LEAF_COLORS.map((target) =>
        blendRGB(NEUTRAL_COLOR, target, 1 - colorBloom),
      )

      // L3 递归合成变色 (收回 L4 时，双色合成赋给 L3)
      const fuseL3Weight = easeOutQuad(clamp((progress - 0.6) / 0.09))
      const currentL3Colors: RGB[] = L3_FUSED_COLORS.map((target) =>
        blendRGB(NEUTRAL_COLOR, target, 1 - fuseL3Weight),
      )

      // L2 递归合成变色 (收回 L3 时，三色合成赋给 L2)
      const fuseL2Weight = easeOutQuad(clamp((progress - 0.69) / 0.08))
      const currentL2Colors: RGB[] = L2_FUSED_COLORS.map((target) =>
        blendRGB(NEUTRAL_COLOR, target, 1 - fuseL2Weight),
      )

      // L1 递归合成变色 (收回 L2 时，四色合成赋给 L1)
      const fuseL1Weight = easeOutQuad(clamp((progress - 0.77) / 0.07))
      const currentL1Colors: RGB[] = L1_FUSED_COLORS.map((target) =>
        blendRGB(NEUTRAL_COLOR, target, 1 - fuseL1Weight),
      )

      // 根节点递归归一合成与最后两秒纯白过渡
      const fuseRootWeight = easeOutQuad(clamp((progress - 0.84) / 0.069))
      let currentRootColor = blendRGB(NEUTRAL_COLOR, ROOT_FUSED_COLOR, 1 - fuseRootWeight)

      // 根节点在最后整整两秒 (2000ms) 内重新过渡为纯白色
      const resetThreshold = TOTAL_CYCLE_MS - RESET_DURATION_MS
      if (elapsedInCycle >= resetThreshold) {
        const resetProgress = easeInOutCubic(
          clamp((elapsedInCycle - resetThreshold) / RESET_DURATION_MS),
        )
        currentRootColor = blendRGB(ROOT_FUSED_COLOR, PURE_WHITE, 1 - resetProgress)
      }

      // 根节点呼吸波动
      const breathe = Math.sin(elapsed * 0.0022) * 0.12 + 1
      const rootRadius = 8.5 * breathe

      // ==========================
      // 3. 固定藤蔓几何拓扑解算与分层绘制
      // ==========================
      // 螺旋弯曲系数（曲率恒为正值，倒转收回绝不翻转圆弧朝向）
      const spiralCurl1 = 0.28
      const spiralCurl2 = 0.28
      const spiralCurl3 = 0.30
      const spiralCurl4 = 0.30

      const pRoot: Point = { x: cx, y: cy }

      interface ResolvedNode {
        pos: Point
        color: RGB
        alpha: number
        growth: number
      }

      // --- Level 1 (5 枝藤蔓，平分 360 度，每 72 度) ---
      const l1Nodes: ResolvedNode[] = []
      const l1Curves: BezierCurve[] = []
      const l1AngleStep = (Math.PI * 2) / 5

      for (let i = 0; i < 5; i++) {
        const theta1 = globalAmbientRot + i * l1AngleStep
        const targetPos: Point = {
          x: cx + Math.cos(theta1) * d1,
          y: cy + Math.sin(theta1) * d1,
        }
        const curve = createBranchCurve(pRoot, targetPos, spiralCurl1)
        l1Curves.push(curve)

        const growth = calcGrowth(progress, 0.04, 0.12, 0.84, 0.84, 0.069, i, 5)
        const tipPos = growth <= 0.001 ? pRoot : trimBezier(curve, growth).p3
        const alpha = clamp(growth * 1.5)
        l1Nodes.push({ pos: tipPos, color: currentL1Colors[i], alpha, growth })
      }

      // --- Level 2 (20 枝藤蔓，每个 L1 节点甩出 4 个，平分 360 度，每 90 度) ---
      const l2Nodes: ResolvedNode[] = []
      const l2Curves: BezierCurve[] = []
      const l2AngleStep = (Math.PI * 2) / 4

      for (let i = 0; i < 5; i++) {
        const parentCurve = l1Curves[i]
        const parentTarget = parentCurve.p3
        const theta1 = globalAmbientRot + i * l1AngleStep

        for (let j = 0; j < 4; j++) {
          const l2Idx = i * 4 + j
          const theta2 = theta1 + j * l2AngleStep
          const targetPos: Point = {
            x: parentTarget.x + Math.cos(theta2) * d2,
            y: parentTarget.y + Math.sin(theta2) * d2,
          }
          const curve = createBranchCurve(parentTarget, targetPos, spiralCurl2)
          l2Curves.push(curve)

          const growth = calcGrowth(progress, 0.16, 0.12, 0.77, 0.77, 0.07, j, 4)
          const tipPos = growth <= 0.001 ? parentTarget : trimBezier(curve, growth).p3
          const alpha = clamp(growth * 1.5) * l1Nodes[i].alpha
          l2Nodes.push({ pos: tipPos, color: currentL2Colors[l2Idx], alpha, growth })
        }
      }

      // --- Level 3 (60 枝藤蔓，每个 L2 节点甩出 3 个，平分 360 度，每 120 度) ---
      const l3Nodes: ResolvedNode[] = []
      const l3Curves: BezierCurve[] = []
      const l3AngleStep = (Math.PI * 2) / 3

      for (let i = 0; i < 5; i++) {
        const theta1 = globalAmbientRot + i * l1AngleStep
        for (let j = 0; j < 4; j++) {
          const l2Idx = i * 4 + j
          const parentCurve = l2Curves[l2Idx]
          const parentTarget = parentCurve.p3
          const theta2 = theta1 + j * l2AngleStep

          for (let k = 0; k < 3; k++) {
            const l3Idx = l2Idx * 3 + k
            const theta3 = theta2 + k * l3AngleStep
            const targetPos: Point = {
              x: parentTarget.x + Math.cos(theta3) * d3,
              y: parentTarget.y + Math.sin(theta3) * d3,
            }
            const curve = createBranchCurve(parentTarget, targetPos, spiralCurl3)
            l3Curves.push(curve)

            const growth = calcGrowth(progress, 0.28, 0.12, 0.69, 0.69, 0.08, k, 3)
            const tipPos = growth <= 0.001 ? parentTarget : trimBezier(curve, growth).p3
            const alpha = clamp(growth * 1.5) * l2Nodes[l2Idx].alpha
            l3Nodes.push({ pos: tipPos, color: currentL3Colors[l3Idx], alpha, growth })
          }
        }
      }

      // --- Level 4 (120 枝叶梢藤蔓，每个 L3 节点甩出 2 个，平分 360 度，每 180 度对称) ---
      const l4Nodes: ResolvedNode[] = []
      const l4Curves: BezierCurve[] = []
      const l4AngleStep = (Math.PI * 2) / 2

      for (let i = 0; i < 5; i++) {
        const theta1 = globalAmbientRot + i * l1AngleStep
        for (let j = 0; j < 4; j++) {
          const l2Idx = i * 4 + j
          const theta2 = theta1 + j * l2AngleStep
          for (let k = 0; k < 3; k++) {
            const l3Idx = l2Idx * 3 + k
            const parentCurve = l3Curves[l3Idx]
            const parentTarget = parentCurve.p3
            const theta3 = theta2 + k * l3AngleStep

            for (let m = 0; m < 2; m++) {
              const l4Idx = l3Idx * 2 + m
              const theta4 = theta3 + m * l4AngleStep
              const targetPos: Point = {
                x: parentTarget.x + Math.cos(theta4) * d4,
                y: parentTarget.y + Math.sin(theta4) * d4,
              }
              const curve = createBranchCurve(parentTarget, targetPos, spiralCurl4)
              l4Curves.push(curve)

              const growth = calcGrowth(progress, 0.40, 0.11, 0.60, 0.60, 0.09, m, 2)
              const tipPos = growth <= 0.001 ? parentTarget : trimBezier(curve, growth).p3
              const alpha = clamp(growth * 1.5) * l3Nodes[l3Idx].alpha
              l4Nodes.push({ pos: tipPos, color: currentLeafColors[l4Idx], alpha, growth })
            }
          }
        }
      }

      // ==========================
      // 4. 绘制藤蔓曲线（沿固定贝塞尔路径伸长或缩回）
      // ==========================
      // L3 -> L4 (120 枝叶梢藤蔓)
      for (let i = 0; i < 120; i++) {
        const node = l4Nodes[i]
        if (node.growth > 0.001) {
          const armAlpha = node.alpha * 0.55
          drawGrowingVine(l4Curves[i], node.growth, node.color, armAlpha, 0.8)
        }
      }

      // L2 -> L3 (60 枝三级藤蔓)
      for (let i = 0; i < 60; i++) {
        const node = l3Nodes[i]
        if (node.growth > 0.001) {
          const armAlpha = node.alpha * 0.65
          drawGrowingVine(l3Curves[i], node.growth, node.color, armAlpha, 1.1)
        }
      }

      // L1 -> L2 (20 枝二级藤蔓)
      for (let i = 0; i < 20; i++) {
        const node = l2Nodes[i]
        if (node.growth > 0.001) {
          const armAlpha = node.alpha * 0.75
          drawGrowingVine(l2Curves[i], node.growth, node.color, armAlpha, 1.4)
        }
      }

      // Root -> L1 (5 枝主藤蔓)
      for (let i = 0; i < 5; i++) {
        const node = l1Nodes[i]
        if (node.growth > 0.001) {
          const armAlpha = node.alpha * 0.85
          drawGrowingVine(l1Curves[i], node.growth, node.color, armAlpha, 1.8)
        }
      }

      // ==========================
      // 5. 绘制所有实体节点（位于藤蔓生长末梢）
      // ==========================
      // L4 叶子节点 (120 个)
      for (let i = 0; i < 120; i++) {
        const node = l4Nodes[i]
        if (node.growth > 0.001) {
          drawNode(node.pos.x, node.pos.y, 2.0, node.color, node.alpha, 1.1)
        }
      }

      // L3 节点 (60 个)
      for (let i = 0; i < 60; i++) {
        const node = l3Nodes[i]
        if (node.growth > 0.001) {
          drawNode(node.pos.x, node.pos.y, 2.8, node.color, node.alpha, 1.2)
        }
      }

      // L2 节点 (20 个)
      for (let i = 0; i < 20; i++) {
        const node = l2Nodes[i]
        if (node.growth > 0.001) {
          drawNode(node.pos.x, node.pos.y, 4.0, node.color, node.alpha, 1.3)
        }
      }

      // L1 节点 (5 个)
      for (let i = 0; i < 5; i++) {
        const node = l1Nodes[i]
        if (node.growth > 0.001) {
          drawNode(node.pos.x, node.pos.y, 5.8, node.color, node.alpha, 1.4)
        }
      }

      // ==========================
      // 6. 绘制总目标根节点及归一能量涟漪
      // ==========================
      // 归一波纹荡漾 (在万象归一瞬间向外扩散)
      if (fuseRootWeight > 0.5 && elapsedInCycle < resetThreshold) {
        const ringProgress = (progress - 0.86) / 0.048
        if (ringProgress > 0 && ringProgress <= 1) {
          const ringR = minDim * 0.42 * ringProgress
          const ringAlpha = (1 - ringProgress) * 0.5
          ctx.beginPath()
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(${ROOT_FUSED_COLOR.r}, ${ROOT_FUSED_COLOR.g}, ${ROOT_FUSED_COLOR.b}, ${ringAlpha.toFixed(3)})`
          ctx.lineWidth = 2.0 * dpr * (1 - ringProgress * 0.5)
          ctx.stroke()
        }
      }

      // 绘制正中央根节点
      const rootGlow = 1.3 + (fuseRootWeight > 0.2 ? Math.sin(fuseRootWeight * Math.PI) * 1.5 : 0)
      drawNode(cx, cy, rootRadius, currentRootColor, 1.0, rootGlow)
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{ opacity: 0.4 }}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
