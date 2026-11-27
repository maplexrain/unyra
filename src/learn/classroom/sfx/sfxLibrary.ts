/**
 * 课堂音效库 (sfxLibrary.ts)：22 个实时合成音效的配方与元数据。
 *
 * 审美原则：纸墨触感 + 木质讲堂声学 + 克制温和的音乐性。
 * 每个配方只描述「这个声音怎么长出来」；音量、混响、去重、开关统一由 sfxEngine 管。
 * 元数据（name / label / category / mood / use）供 api.classroom.sounds() 使用。
 */
import type { SfxVoice } from './sfxEngine'
import { listExternalClassroomSounds } from '../registry'

export type SfxCategory = 'transition' | 'accent' | 'rhythm' | 'feedback'

export interface SfxRecipe {
  name: string
  label: string
  category: SfxCategory
  /** 听感一句话 */
  mood: string
  /** 推荐用法——给提示词与组件作者看的 */
  use: string
  /** 时长型音效的默认时长（毫秒） */
  defaultDuration?: number
  play: (v: SfxVoice) => void
}

export interface SfxMeta {
  name: string
  label: string
  category: SfxCategory
  mood: string
  use: string
  /** 外部 TSX 音效的源文件（相对当前用户）；内置音效没有 */
  file?: string
  source?: 'builtin' | 'external'
}

interface ToneOpts {
  f: number
  f2?: number
  type?: OscillatorType
  at?: number
  a?: number
  d: number
  peak: number
  wet?: number
  detune?: number
}

interface NoiseOpts {
  at?: number
  a?: number
  d: number
  peak: number
  filter: BiquadFilterType
  f: number
  f2?: number
  q?: number
  wet?: number
}

/** 外部音效文件拿到的合成原语：tone / noise 已绑定当前声部 */
export interface SfxKit {
  tone(opts: unknown): void
  noise(opts: unknown): void
}

export function createSfxKit(v: SfxVoice): SfxKit {
  return {
    tone: (opts) => tone(v, opts as ToneOpts),
    noise: (opts) => noise(v, opts as NoiseOpts),
  }
}

function envelope(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack))
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, attack) + Math.max(0.005, decay))
}

function route(v: SfxVoice, g: GainNode, wet?: number): void {
  g.connect(v.dry)
  if (wet) {
    const send = v.ctx.createGain()
    send.gain.value = wet
    g.connect(send)
    send.connect(v.wet)
  }
}

function tone(v: SfxVoice, o: ToneOpts): void {
  const t = v.t + (o.at ?? 0)
  const a = o.a ?? 0.005
  const osc = v.ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.f, t)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + o.d)
  if (o.detune) osc.detune.value = o.detune
  const g = v.ctx.createGain()
  envelope(g, t, o.peak * v.vol, a, o.d)
  osc.connect(g)
  route(v, g, o.wet)
  osc.start(t)
  osc.stop(t + a + o.d + 0.06)
}

const noiseCache = new WeakMap<AudioContext, AudioBuffer>()
function noiseBuffer(c: AudioContext): AudioBuffer {
  let buf = noiseCache.get(c)
  if (!buf) {
    buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseCache.set(c, buf)
  }
  return buf
}

function noise(v: SfxVoice, o: NoiseOpts): void {
  const t = v.t + (o.at ?? 0)
  const a = o.a ?? 0.005
  const src = v.ctx.createBufferSource()
  src.buffer = noiseBuffer(v.ctx)
  const filter = v.ctx.createBiquadFilter()
  filter.type = o.filter
  filter.frequency.setValueAtTime(o.f, t)
  if (o.f2) filter.frequency.exponentialRampToValueAtTime(o.f2, t + a + o.d)
  filter.Q.value = o.q ?? 0.8
  const g = v.ctx.createGain()
  envelope(g, t, o.peak * v.vol, a, o.d)
  src.connect(filter)
  filter.connect(g)
  route(v, g, o.wet)
  src.start(t, Math.random() * 1.4)
  src.stop(t + a + o.d + 0.06)
}

const recipes: SfxRecipe[] = [
  /* ---------- 转场与空间运动 (transition) ---------- */
  {
    name: 'whoosh',
    label: '清风拂卷',
    category: 'transition',
    mood: '柔和丝滑的气流掠过，由沉转明',
    use: '大块内容横向滑入、换场过渡（slideInLeft / slideInRight）',
    play: (v) => {
      noise(v, { filter: 'bandpass', f: 340, f2: 2400, q: 1.0, a: 0.08, d: 0.28, peak: 0.36, wet: 0.32 })
      tone(v, { f: 140, f2: 260, a: 0.06, d: 0.22, peak: 0.06, wet: 0.25 })
    },
  },
  {
    name: 'swish',
    label: '轻羽掠影',
    category: 'transition',
    mood: '干净俐落的一抹轻响',
    use: '轻巧卡片、标签或列表项快速切入',
    play: (v) => noise(v, { filter: 'highpass', f: 1900, f2: 5000, a: 0.014, d: 0.11, peak: 0.22, wet: 0.15 }),
  },
  {
    name: 'paper',
    label: '展卷翻页',
    category: 'transition',
    mood: '纸纤维摩擦的细腻沙响',
    use: '书卷展开（unfold）、卡片翻转（flip）、折叠展开',
    play: (v) => {
      ;[0, 0.038, 0.088].forEach((at, i) =>
        noise(v, {
          filter: 'bandpass',
          f: 2100 + i * 520,
          q: 0.75,
          at,
          a: 0.008,
          d: 0.055,
          peak: 0.15 - i * 0.025,
          wet: 0.18,
        }),
      )
    },
  },
  {
    name: 'swell',
    label: '暮色铺陈',
    category: 'transition',
    mood: '温润饱满的纯五度暖垫缓缓推开',
    use: '章节横幅（ui-banner）登场、宏大主题序幕',
    play: (v) => {
      noise(v, { filter: 'lowpass', f: 360, f2: 1200, a: 0.36, d: 0.65, peak: 0.1, wet: 0.45 })
      tone(v, { f: 220, a: 0.36, d: 0.95, peak: 0.065, wet: 0.65 })
      tone(v, { f: 329.63, a: 0.42, d: 0.95, peak: 0.048, wet: 0.65, detune: 5 })
      tone(v, { f: 440, a: 0.48, d: 0.85, peak: 0.028, wet: 0.7, detune: -4 })
    },
  },
  {
    name: 'rise',
    label: '晨光渐升',
    category: 'transition',
    mood: '和声上滑带来的期待与蓄力感',
    use: '进度条推进、关键数据或推导结论揭晓前的铺垫（riseIn）',
    play: (v) => {
      tone(v, { f: 329.63, f2: 659.25, a: 0.025, d: 0.36, peak: 0.18, wet: 0.35 })
      tone(v, { f: 493.88, f2: 987.77, type: 'triangle', a: 0.03, d: 0.34, peak: 0.05, wet: 0.35 })
    },
  },
  {
    name: 'drop',
    label: '落定归位',
    category: 'transition',
    mood: '轻盈落入槽位的物理归位感',
    use: '自上降落（slideInTop）、下降趋势或元素归位',
    play: (v) => {
      tone(v, { f: 680, f2: 240, a: 0.008, d: 0.22, peak: 0.2, wet: 0.25 })
      tone(v, { f: 240, at: 0.09, d: 0.12, peak: 0.08, wet: 0.2 })
    },
  },

  /* ---------- 焦点与顿悟强调 (accent) ---------- */
  {
    name: 'pop',
    label: '露珠轻启',
    category: 'accent',
    mood: '圆润通透的一声轻啵，干净利落',
    use: '核心卡片弹出（popIn）、徽标标签（ui-badge）现身',
    play: (v) => {
      tone(v, { f: 380, f2: 880, a: 0.004, d: 0.085, peak: 0.42, wet: 0.18 })
      tone(v, { f: 1680, d: 0.025, peak: 0.055, wet: 0.2 })
    },
  },
  {
    name: 'chime',
    label: '清泉玉磬',
    category: 'accent',
    mood: '温润明澈的钢片琴泛音，余韵悠长',
    use: '顿悟时刻（Aha Moment）、核心概念与关键结论揭晓',
    play: (v) => {
      tone(v, { f: 1046.5, d: 1.2, peak: 0.18, wet: 0.55 })
      tone(v, { f: 1567.98, at: 0.055, d: 1.05, peak: 0.13, wet: 0.55 })
      tone(v, { f: 2093, at: 0.11, d: 0.8, peak: 0.045, wet: 0.5 })
    },
  },
  {
    name: 'sparkle',
    label: '星屑流光',
    category: 'accent',
    mood: '五声音阶轻灵上扬的细碎光点',
    use: '电影感景深揭示（blurIn）、灵感彩蛋与公式升华',
    play: (v) => {
      const notes = [1318.51, 1567.98, 1760, 2093, 2637.02]
      notes.forEach((f, i) =>
        tone(v, { f, at: i * 0.048, a: 0.006, d: 0.32, peak: 0.085, wet: 0.65 }),
      )
    },
  },
  {
    name: 'shimmer',
    label: '流光掠过',
    category: 'accent',
    mood: '如镜面高光扫过般晶透的泛音掠影',
    use: '流光扫面动效（shimmer）、公式高光（ui-formula）',
    play: (v) => {
      const notes = [880, 1318.51, 1975.53]
      notes.forEach((f, i) =>
        tone(v, { f, f2: f * 1.015, at: i * 0.04, a: 0.08, d: 0.45, peak: 0.075, wet: 0.65 }),
      )
      noise(v, { filter: 'bandpass', f: 3200, f2: 5600, q: 1.6, a: 0.06, d: 0.25, peak: 0.05, wet: 0.5 })
    },
  },
  {
    name: 'glass',
    label: '琉璃清叩',
    category: 'accent',
    mood: '清越不刺耳的高频晶点',
    use: '高亮聚焦（highlight）、涟漪波纹（ripple）',
    play: (v) => {
      tone(v, { f: 2093, d: 0.48, peak: 0.11, wet: 0.52 })
      tone(v, { f: 3135.96, at: 0.012, d: 0.34, peak: 0.045, wet: 0.52 })
    },
  },
  {
    name: 'focus',
    label: '聚光锁定',
    category: 'accent',
    mood: '沉稳精准的两声微上扬，引导视线聚焦',
    use: '聚光灯（spotlight）、周边暗化聚焦（dimOthers / zoomIn）',
    play: (v) => {
      tone(v, { f: 440, type: 'triangle', a: 0.008, d: 0.11, peak: 0.18, wet: 0.3 })
      tone(v, { f: 659.25, type: 'sine', at: 0.06, a: 0.01, d: 0.24, peak: 0.16, wet: 0.4 })
    },
  },
  {
    name: 'stamp',
    label: '朱印落定',
    category: 'accent',
    mood: '厚实沉稳的木印压纸落定声',
    use: '印章落定动效（stamp 自带）、核心定理或 Q.E.D. 盖章定论',
    play: (v) => {
      tone(v, { f: 145, f2: 46, a: 0.003, d: 0.22, peak: 0.88, wet: 0.18 })
      noise(v, { filter: 'lowpass', f: 850, a: 0.002, d: 0.07, peak: 0.34, wet: 0.18 })
    },
  },

  /* ---------- 节奏与拟音 (rhythm) ---------- */
  {
    name: 'tick',
    label: '木鱼轻叩',
    category: 'rhythm',
    mood: '温润的木质共鸣节拍点',
    use: '步骤（ui-step）、时间线（ui-timeline-item）与流水线节点逐条揭晓',
    play: (v) => {
      tone(v, { f: 880, f2: 760, type: 'triangle', a: 0.002, d: 0.045, peak: 0.22, wet: 0.2 })
      tone(v, { f: 1760, a: 0.002, d: 0.022, peak: 0.08, wet: 0.15 })
      noise(v, { filter: 'bandpass', f: 2400, q: 1.5, a: 0.001, d: 0.015, peak: 0.08 })
    },
  },
  {
    name: 'tap',
    label: '软键轻触',
    category: 'rhythm',
    mood: '带有毛毡阻尼的按键按压声',
    use: '快捷键卡片（ui-keyboard）、测验选项（ui-option）点亮',
    play: (v) => {
      tone(v, { f: 310, f2: 205, a: 0.003, d: 0.065, peak: 0.36, wet: 0.12 })
      noise(v, { filter: 'lowpass', f: 1500, d: 0.018, peak: 0.12 })
    },
  },
  {
    name: 'typing',
    label: '落笔板书',
    category: 'rhythm',
    mood: '轻柔自然的逐字书写与键入质感（随时长）',
    use: '打字机逐字显现（typewriter 自带）',
    defaultDuration: 1200,
    play: (v) => {
      const n = Math.min(36, Math.max(4, Math.round(v.dur / 0.08)))
      for (let i = 0; i < n; i++) {
        const at = i * (v.dur / n) + ((i * 37) % 13) / 1000
        noise(v, { filter: 'bandpass', f: 2600 + ((i * 53) % 7) * 140, q: 1.1, at, d: 0.018, peak: 0.1 })
        if (i % 3 === 0) {
          tone(v, { f: 1100 + ((i * 29) % 5) * 90, type: 'triangle', at, d: 0.016, peak: 0.045 })
        }
      }
    },
  },
  {
    name: 'count',
    label: '算珠滚动',
    category: 'rhythm',
    mood: '先密后疏、清脆上扬的计数滴答（随时长）',
    use: '数字滚动（countUp 自带）',
    defaultDuration: 1100,
    play: (v) => {
      const n = 13
      for (let i = 0; i < n; i++) {
        const p = i / (n - 1)
        const at = v.dur * (1 - Math.pow(1 - p, 0.45))
        tone(v, { f: 820 + p * 680, type: 'triangle', at, d: 0.028, peak: 0.11, wet: 0.22 })
      }
    },
  },

  /* ---------- 教学情绪与反馈 (feedback) ---------- */
  {
    name: 'bell',
    label: '雅致课铃',
    category: 'feedback',
    mood: '讲堂铜铃的温暖泛音余韵',
    use: '课程开篇、互动思考暂停（checkpoint 自带）',
    play: (v) => {
      tone(v, { f: 783.99, d: 1.75, peak: 0.18, wet: 0.58 })
      tone(v, { f: 1567.98, d: 0.9, peak: 0.065, wet: 0.55 })
      tone(v, { f: 2349.32, d: 0.42, peak: 0.025, wet: 0.45 })
    },
  },
  {
    name: 'heartbeat',
    label: '深沉双拍',
    category: 'feedback',
    mood: '低频沉稳的咚—咚双拍脉动',
    use: '灵魂拷问、最关键命题登场（heartbeat）',
    play: (v) => {
      tone(v, { f: 96, f2: 48, a: 0.01, d: 0.13, peak: 0.8, wet: 0.15 })
      tone(v, { f: 88, f2: 46, at: 0.2, a: 0.01, d: 0.14, peak: 0.56, wet: 0.15 })
    },
  },
  {
    name: 'tension',
    label: '悬念微颤',
    category: 'feedback',
    mood: '克制微妙的悬停张力感',
    use: '揭示悖论、反直觉问题与认知冲突铺垫',
    play: (v) => {
      tone(v, { f: 293.66, a: 0.08, d: 0.55, peak: 0.14, wet: 0.5 })
      tone(v, { f: 311.13, at: 0.03, a: 0.1, d: 0.52, peak: 0.11, wet: 0.5 })
    },
  },
  {
    name: 'success',
    label: '证毕和弦',
    category: 'feedback',
    mood: '温暖通透的大九和弦上行琶音',
    use: '证明完成、解题突破、礼花欢庆（tada 自带）',
    play: (v) => {
      ;[523.25, 659.25, 783.99, 987.77, 1174.66].forEach((f, i) =>
        tone(v, { f, type: 'triangle', at: i * 0.065, a: 0.008, d: 0.62, peak: 0.13, wet: 0.48 }),
      )
    },
  },
  {
    name: 'error',
    label: '克制警示',
    category: 'feedback',
    mood: '温和柔木的两声小三度下行，提醒而不刺耳',
    use: '易错误区警示（shake）、反例对照高亮',
    play: (v) => {
      tone(v, { f: 261.63, f2: 246.94, type: 'triangle', a: 0.006, d: 0.13, peak: 0.24, wet: 0.22 })
      tone(v, { f: 220.0, f2: 196.0, type: 'triangle', at: 0.13, a: 0.006, d: 0.22, peak: 0.24, wet: 0.25 })
    },
  },
]

export const SFX_RECIPES: Record<string, SfxRecipe> = Object.fromEntries(recipes.map((r) => [r.name, r]))

/** 音效清单（纯 JSON，供 api.classroom.sounds() 使用；内置 + 外部 TSX） */
export function listSfx(filter?: { category?: SfxCategory; query?: string }): SfxMeta[] {
  let list = recipes
  if (filter?.category) {
    list = list.filter((r) => r.category === filter.category)
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase()
    list = list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.mood.toLowerCase().includes(q) ||
        r.use.toLowerCase().includes(q),
    )
  }
  const builtin = list.map(({ name, label, category, mood, use }) => ({
    name,
    label,
    category,
    mood,
    use,
    source: 'builtin' as const,
  }))
  const external = listExternalClassroomSounds({ query: filter?.query }).filter(
    (sound) => !filter?.category || sound.category === filter.category,
  )
  return [
    ...builtin,
    ...external.map((sound) => ({
      name: sound.name,
      label: sound.label,
      category: sound.category,
      mood: sound.mood,
      use: sound.use,
      file: sound.file,
      source: 'external' as const,
    })),
  ]
}
