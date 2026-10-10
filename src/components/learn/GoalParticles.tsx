import { useEffect, useRef } from 'react'

/**
 * 目标创建页的“归一”螺旋分形与回溯背景动画：
 *
 * 核心哲学表达与完整生命周期（Recursive Spiral Convergence - 5/4/3/2 四层分形）：
 * 1. 【一之初始 (0.00~0.04)】：正中根节点素白安坐，伴随微弱星尘平静呼吸。
 * 2. 【Phase 1 根节点转一圈甩出 5 节点 (0.04~0.16)】：平分 360° (每 72°)，生长 5 个一级节点。
 * 3. 【Phase 2 一级各转甩出 4 节点 (0.16~0.28)】：平分 360° (每 90°)，衍生 20 个二级节点。
 * 4. 【Phase 3 二级各转甩出 3 节点 (0.28~0.40)】：平分 360° (每 120°)，衍生 60 个三级节点。
 * 5. 【Phase 4 三级各转甩出 2 叶子 (0.40~0.51)】：平分 360° (每 180° 对称)，衍生 120 个四级叶子节点（共 206 节点曼陀罗全域展开）。
 * 6. 【Phase 5 叶子色彩觉醒绽放 (0.51~0.60)】：120 个叶子节点显化 120 种高饱和璀璨光谱宝石色，全景展开呼吸。
 * 7. 【Phase 6 三级倒转收回·双色合成 (0.60~0.69)】：60 个三级节点倒转，收回 120 个叶子，双色计算合成新颜色赋给三级节点。
 * 8. 【Phase 7 二级倒转收回·三色合成 (0.69~0.77)】：20 个二级节点倒转，收回 60 个三级节点，三色计算合成新颜色赋给二级节点。
 * 9. 【Phase 8 一级倒转收回·四色合成 (0.77~0.84)】：5 个一级节点倒转，收回 20 个二级节点，四色计算合成新颜色赋给一级节点。
 * 10.【Phase 9 根节点倒转·五色归一 (0.84~0.91)】：根节点倒转，收回 5 个一级节点，五色汇入正中，爆发出同心归一光晕。
 * 11.【Phase 10 两秒纯白过渡·周而复始 (0.91~1.00)】：根节点在最后整整两秒（2000ms）内匀滑过渡恢复为纯白，随后无缝循环。
 */

interface RGB {
  r: number
  g: number
  b: number
}

// 120 种璀璨光谱色彩（高饱和度、高辨识度宝石色系，象征万千不同知识点）
const LEAF_COLORS: RGB[] = Array.from({ length: 120 }, (_, i) => {
  // 采用黄金角分布确保相邻分支的叶子色差分明，融合时产生惊艳渐变
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
    g1 = x
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

    // 绘制具有自然螺旋扭曲的平滑三次贝塞尔曲线（曲率手性始终保持正向一致）
    const drawSpiralArm = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      curlFactor: number,
      color: RGB,
      alpha: number,
      lineWidth = 1.4,
    ) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const dist = Math.hypot(dx, dy)
      if (dist < 0.5 || alpha <= 0.001) return

      // 法向量与切线旋转偏移形成优雅螺旋弧度
      const nx = -dy / dist
      const ny = dx / dist
      const arcOffset = dist * curlFactor

      const cp1x = x1 + dx * 0.35 + nx * arcOffset
      const cp1y = y1 + dy * 0.35 + ny * arcOffset
      const cp2x = x1 + dx * 0.75 + nx * (arcOffset * 0.65)
      const cp2y = y1 + dy * 0.75 + ny * (arcOffset * 0.65)

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2)
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
      // 1. 各阶段进度与伸展/自转解算
      // ==========================
      // Phase 1 (0.04 ~ 0.16): 根节点转一圈甩出 5 个 L1 节点 (平分 360°)
      // Phase 2 (0.16 ~ 0.28): 5 个 L1 节点各甩出 4 个 L2 节点 (平分 360°)
      // Phase 3 (0.28 ~ 0.40): 20 个 L2 节点各甩出 3 个 L3 节点 (平分 360°)
      // Phase 4 (0.40 ~ 0.51): 60 个 L3 节点各甩出 2 个 L4 叶子节点 (平分 360°)
      // Phase 5 (0.51 ~ 0.60): 120 个叶子节点色彩觉醒绽放
      // Phase 6 (0.60 ~ 0.69): L3 倒转收回 L4，合成双色赋给 L3
      // Phase 7 (0.69 ~ 0.77): L2 倒转收回 L3，合成三色赋给 L2
      // Phase 8 (0.77 ~ 0.84): L1 倒转收回 L2，合成四色赋给 L1
      // Phase 9 (0.84 ~ 0.909): 根节点倒转收回 L1，合成五色归一
      // Phase 10 (0.909 ~ 1.00): 最后整整两秒 (2000ms) 根节点过渡回纯白

      // Level 1 伸展与自转
      let scale1 = 0
      let rot1 = 0
      if (progress < 0.04) {
        scale1 = 0
        rot1 = 0
      } else if (progress < 0.16) {
        const t = easeInOutCubic((progress - 0.04) / 0.12)
        scale1 = t
        rot1 = t * Math.PI * 2
      } else if (progress < 0.84) {
        scale1 = 1
        rot1 = Math.PI * 2
      } else if (progress < 0.909) {
        const t = 1 - easeInOutCubic((progress - 0.84) / 0.069)
        scale1 = t
        rot1 = t * Math.PI * 2
      } else {
        scale1 = 0
        rot1 = 0
      }

      // Level 2 伸展与自转
      let scale2 = 0
      let rot2 = 0
      if (progress < 0.16) {
        scale2 = 0
        rot2 = 0
      } else if (progress < 0.28) {
        const t = easeInOutCubic((progress - 0.16) / 0.12)
        scale2 = t
        rot2 = t * Math.PI * 2
      } else if (progress < 0.77) {
        scale2 = 1
        rot2 = Math.PI * 2
      } else if (progress < 0.84) {
        const t = 1 - easeInOutCubic((progress - 0.77) / 0.07)
        scale2 = t
        rot2 = t * Math.PI * 2
      } else {
        scale2 = 0
        rot2 = 0
      }

      // Level 3 伸展与自转
      let scale3 = 0
      let rot3 = 0
      if (progress < 0.28) {
        scale3 = 0
        rot3 = 0
      } else if (progress < 0.40) {
        const t = easeInOutCubic((progress - 0.28) / 0.12)
        scale3 = t
        rot3 = t * Math.PI * 2
      } else if (progress < 0.69) {
        scale3 = 1
        rot3 = Math.PI * 2
      } else if (progress < 0.77) {
        const t = 1 - easeInOutCubic((progress - 0.69) / 0.08)
        scale3 = t
        rot3 = t * Math.PI * 2
      } else {
        scale3 = 0
        rot3 = 0
      }

      // Level 4 叶子伸展与自转
      let scale4 = 0
      let rot4 = 0
      if (progress < 0.40) {
        scale4 = 0
        rot4 = 0
      } else if (progress < 0.51) {
        const t = easeInOutCubic((progress - 0.4) / 0.11)
        scale4 = t
        rot4 = t * Math.PI * 2
      } else if (progress < 0.60) {
        scale4 = 1
        rot4 = Math.PI * 2
      } else if (progress < 0.69) {
        const t = 1 - easeInOutCubic((progress - 0.6) / 0.09)
        scale4 = t
        rot4 = t * Math.PI * 2
      } else {
        scale4 = 0
        rot4 = 0
      }

      // ==========================
      // 2. 递归色彩合成与变色解算
      // ==========================
      // 叶子绽放
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
      // 3. 几何拓扑解算与分层绘制
      // ==========================
      // 螺旋弯曲系数（曲率恒为正值，倒转收回绝不翻转圆弧朝向）
      const spiralCurl1 = 0.25
      const spiralCurl2 = 0.25
      const spiralCurl3 = 0.26
      const spiralCurl4 = 0.26

      interface NodePos {
        x: number
        y: number
        color: RGB
        alpha: number
      }

      const l1Nodes: NodePos[] = []
      const l2Nodes: NodePos[] = []
      const l3Nodes: NodePos[] = []
      const l4Nodes: NodePos[] = []

      // --- 计算 Level 1 (5 个节点，平分 360 度，每 72 度) ---
      const l1AngleStep = (Math.PI * 2) / 5
      for (let i = 0; i < 5; i++) {
        const baseAngle = globalAmbientRot + rot1 + i * l1AngleStep
        const dist = d1 * scale1
        const x = cx + Math.cos(baseAngle) * dist
        const y = cy + Math.sin(baseAngle) * dist
        const alpha = clamp(scale1 * 1.5)
        l1Nodes.push({ x, y, color: currentL1Colors[i], alpha })
      }

      // --- 计算 Level 2 (20 个节点，每个父节点甩出 4 个，平分 360 度，每 90 度) ---
      const l2AngleStep = (Math.PI * 2) / 4
      for (let i = 0; i < 5; i++) {
        const parent = l1Nodes[i]
        const l1Angle = globalAmbientRot + rot1 + i * l1AngleStep
        const l1SelfRot = l1Angle + rot2

        for (let j = 0; j < 4; j++) {
          const l2Idx = i * 4 + j
          const branchAngle = l1SelfRot + j * l2AngleStep
          const dist = d2 * scale2
          const x = parent.x + Math.cos(branchAngle) * dist
          const y = parent.y + Math.sin(branchAngle) * dist
          const alpha = clamp(scale2 * 1.5) * parent.alpha
          l2Nodes.push({ x, y, color: currentL2Colors[l2Idx], alpha })
        }
      }

      // --- 计算 Level 3 (60 个节点，每个父节点甩出 3 个，平分 360 度，每 120 度) ---
      const l3AngleStep = (Math.PI * 2) / 3
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 4; j++) {
          const l2Idx = i * 4 + j
          const parent = l2Nodes[l2Idx]
          const l1Angle = globalAmbientRot + rot1 + i * l1AngleStep
          const branchAngle = l1Angle + rot2 + j * l2AngleStep
          const l2SelfRot = branchAngle + rot3

          for (let k = 0; k < 3; k++) {
            const l3Idx = l2Idx * 3 + k
            const subAngle = l2SelfRot + k * l3AngleStep
            const dist = d3 * scale3
            const x = parent.x + Math.cos(subAngle) * dist
            const y = parent.y + Math.sin(subAngle) * dist
            const alpha = clamp(scale3 * 1.5) * parent.alpha
            l3Nodes.push({ x, y, color: currentL3Colors[l3Idx], alpha })
          }
        }
      }

      // --- 计算 Level 4 (120 个叶子节点，每个父节点甩出 2 个，平分 360 度，每 180 度对称) ---
      const l4AngleStep = (Math.PI * 2) / 2
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 4; j++) {
          for (let k = 0; k < 3; k++) {
            const l2Idx = i * 4 + j
            const l3Idx = l2Idx * 3 + k
            const parent = l3Nodes[l3Idx]
            const l1Angle = globalAmbientRot + rot1 + i * l1AngleStep
            const branchAngle = l1Angle + rot2 + j * l2AngleStep
            const subAngle = branchAngle + rot3 + k * l3AngleStep
            const l3SelfRot = subAngle + rot4

            for (let m = 0; m < 2; m++) {
              const l4Idx = l3Idx * 2 + m
              const leafAngle = l3SelfRot + m * l4AngleStep
              const dist = d4 * scale4
              const x = parent.x + Math.cos(leafAngle) * dist
              const y = parent.y + Math.sin(leafAngle) * dist
              const alpha = clamp(scale4 * 1.5) * parent.alpha
              l4Nodes.push({ x, y, color: currentLeafColors[l4Idx], alpha })
            }
          }
        }
      }

      // ==========================
      // 4. 绘制连线 (由外向内逐层绘制贝塞尔螺旋分支)
      // ==========================
      // L3 -> L4 (120 条微螺旋分支)
      if (scale4 > 0.01) {
        for (let i = 0; i < 120; i++) {
          const pIdx = Math.floor(i / 2)
          const p = l3Nodes[pIdx]
          const c = l4Nodes[i]
          const armAlpha = c.alpha * 0.55
          drawSpiralArm(p.x, p.y, c.x, c.y, spiralCurl4, c.color, armAlpha, 0.8)
        }
      }

      // L2 -> L3 (60 条螺旋分支)
      if (scale3 > 0.01) {
        for (let i = 0; i < 60; i++) {
          const pIdx = Math.floor(i / 3)
          const p = l2Nodes[pIdx]
          const c = l3Nodes[i]
          const armAlpha = c.alpha * 0.65
          drawSpiralArm(p.x, p.y, c.x, c.y, spiralCurl3, c.color, armAlpha, 1.05)
        }
      }

      // L1 -> L2 (20 条螺旋分支)
      if (scale2 > 0.01) {
        for (let i = 0; i < 20; i++) {
          const pIdx = Math.floor(i / 4)
          const p = l1Nodes[pIdx]
          const c = l2Nodes[i]
          const armAlpha = c.alpha * 0.75
          drawSpiralArm(p.x, p.y, c.x, c.y, spiralCurl2, c.color, armAlpha, 1.35)
        }
      }

      // Root -> L1 (5 条主螺旋臂)
      if (scale1 > 0.01) {
        for (let i = 0; i < 5; i++) {
          const c = l1Nodes[i]
          const armAlpha = c.alpha * 0.85
          drawSpiralArm(cx, cy, c.x, c.y, spiralCurl1, c.color, armAlpha, 1.8)
        }
      }

      // ==========================
      // 5. 绘制所有实体节点
      // ==========================
      // L4 叶子节点 (120 个)
      if (scale4 > 0.01) {
        for (let i = 0; i < 120; i++) {
          const node = l4Nodes[i]
          drawNode(node.x, node.y, 2.0, node.color, node.alpha, 1.1)
        }
      }

      // L3 节点 (60 个)
      if (scale3 > 0.01) {
        for (let i = 0; i < 60; i++) {
          const node = l3Nodes[i]
          drawNode(node.x, node.y, 2.8, node.color, node.alpha, 1.2)
        }
      }

      // L2 节点 (20 个)
      if (scale2 > 0.01) {
        for (let i = 0; i < 20; i++) {
          const node = l2Nodes[i]
          drawNode(node.x, node.y, 4.0, node.color, node.alpha, 1.3)
        }
      }

      // L1 节点 (5 个)
      if (scale1 > 0.01) {
        for (let i = 0; i < 5; i++) {
          const node = l1Nodes[i]
          drawNode(node.x, node.y, 5.8, node.color, node.alpha, 1.4)
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
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
