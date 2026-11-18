/**
 * 互动课堂组件与动效注册中心 (Classroom Registry)
 *
 * 统一管理内置与外部动态注册的教学组件 (UI Components) 与动效 (Anime.js Animations)。
 * 支持：
 * 1. 查询全部组件与动效（供卡牌展示页面与 Agent execute api 动态检索）；
 * 2. 外部注册组件与动效（支持持久化存储在 localStorage 中）；
 * 3. 供 components.ts 与 animations.ts 在渲染与播放时无缝调度。
 */

export interface ClassroomComponentDef {
  tag: string
  name: string
  description: string
  category: 'layout' | 'content' | 'interactive' | 'visual' | 'custom'
  source: 'builtin' | 'external'
  template?: string
  defaultProps?: Record<string, string>
  example: string
  createdAt?: number
}

export interface ClassroomAnimationDef {
  verb: string
  name: string
  description: string
  source: 'builtin' | 'external'
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  example: string
  createdAt?: number
}

/** 内置组件清单 */
export const BUILTIN_COMPONENTS: ClassroomComponentDef[] = [
  {
    tag: 'ui-card',
    name: '通用容器卡片',
    description: '主题感卡片容器，支持 title 属性、padding 配置及微妙毛玻璃边框。',
    category: 'layout',
    source: 'builtin',
    example: '<ui-card title="核心结论" padding="md">\n  <p>这是卡片正文内容</p>\n</ui-card>',
  },
  {
    tag: 'ui-split',
    name: '左右双栏分立',
    description: '左右双栏对称拆分布局，ratio 可配置 1:1、1:2、2:1。',
    category: 'layout',
    source: 'builtin',
    example: '<ui-split ratio="1:1">\n  <div>左侧直观现象</div>\n  <div>右侧内在机制</div>\n</ui-split>',
  },
  {
    tag: 'ui-concept',
    name: '核心概念提炼卡',
    description: '突出关键术语或定理，包含显眼标题与递进阐释正文。',
    category: 'content',
    source: 'builtin',
    example: '<ui-concept term="夹逼定理" summary="若 f(x) ≤ g(x) ≤ h(x) 且两端极限为 L，则中间函数极限亦必为 L"></ui-concept>',
  },
  {
    tag: 'ui-formula',
    name: '数理公式显要卡',
    description: '专为数学公式定制的置中卡片，自动配合 KaTeX 渲染，支持 note 附注。',
    category: 'content',
    source: 'builtin',
    example: '<ui-formula note="欧拉恒等式">\n  $$e^{i\\pi} + 1 = 0$$\n</ui-formula>',
  },
  {
    tag: 'ui-code',
    name: '代码与算法卡',
    description: '语法高亮代码块展示卡片，支持 title、lang 与行号。',
    category: 'content',
    source: 'builtin',
    example: '<ui-code lang="python" title="梯度下降核心迭代">\nw = w - lr * grad\n</ui-code>',
  },
  {
    tag: 'ui-compare',
    name: '二元正误/对照卡',
    description: '清晰对比正确与错误做法，或两种方案的优劣。',
    category: 'content',
    source: 'builtin',
    example: '<ui-compare left-title="常见误区" right-title="正确认知">\n  <div>误区：直接代入 0</div>\n  <div>正解：先化简因式再求极限</div>\n</ui-compare>',
  },
  {
    tag: 'ui-steps',
    name: '步骤流程指示卡',
    description: '横向/纵向步骤流程图，有序拆解解题与推导脉络。',
    category: 'layout',
    source: 'builtin',
    example: '<ui-steps>\n  <div data-step="1">观察式子特征</div>\n  <div data-step="2">分子有理化</div>\n  <div data-step="3">消去零因子</div>\n</ui-steps>',
  },
  {
    tag: 'ui-stat',
    name: '数据统计指示卡',
    description: '突出显示关键量化指标、统计数值或百分比。',
    category: 'visual',
    source: 'builtin',
    example: '<ui-stat value="99.4%" label="测试集准确率" note="相比基线提升 14.2%"></ui-stat>',
  },
  {
    tag: 'ui-callout',
    name: '强调避坑提示卡',
    description: '突出强调重点信息、边界条件或警示避坑项。',
    category: 'content',
    source: 'builtin',
    example: '<ui-callout type="warning" title="注意前提条件">\n  此处要求分母不为 0，否则公式不成立。\n</ui-callout>',
  },
  {
    tag: 'ui-quote',
    name: '名师引言与金句卡',
    description: '展示教学格言、经典语录或学术引言。',
    category: 'content',
    source: 'builtin',
    example: '<ui-quote author="理查德·费曼">\n  如果你不能用简单的语言解释它，说明你还没有真正理解它。\n</ui-quote>',
  },
  {
    tag: 'ui-quiz',
    name: '思考与测验卡',
    description: '提出思考问题与选项，可结合 checkpoint 动作进行互动答题。',
    category: 'interactive',
    source: 'builtin',
    example: '<ui-quiz question="当 x 趋近于 0 时，sin(x)/x 的极限是多少？">\n  <div data-option="A">0</div>\n  <div data-option="B" data-correct>1</div>\n  <div data-option="C">不存在</div>\n</ui-quiz>',
  },
  {
    tag: 'ui-badge',
    name: '概念分类标签',
    description: '轻量行内概念指示小标，标明类型、难度或所属模块。',
    category: 'visual',
    source: 'builtin',
    example: '<ui-badge variant="seal">重点定理</ui-badge>',
  },
]

/** 内置动效清单 */
export const BUILTIN_ANIMATIONS: ClassroomAnimationDef[] = [
  {
    verb: 'popIn',
    name: '弹性弹出登场',
    description: '由小到大带回弹效果的弹出登场动画，适合新概念或核心卡片登场。',
    source: 'builtin',
    duration: 650,
    easing: 'spring(1, 80, 10, 0)',
    example: '<ui-card data-anim="popIn">\n  <h3>核心结论</h3>\n</ui-card>',
  },
  {
    verb: 'zoomIn',
    name: '平滑放大聚焦',
    description: '从 85% 比例平滑缩放至 100%，温和聚焦视线。',
    source: 'builtin',
    duration: 600,
    easing: 'easeOutBack',
    example: '<ui-concept term="..." data-anim="zoomIn"></ui-concept>',
  },
  {
    verb: 'slideInLeft',
    name: '自左滑入',
    description: '从左侧位移并淡入，适合流程推进或左栏出场。',
    source: 'builtin',
    duration: 500,
    easing: 'easeOutCubic',
    example: '<div data-anim="slideInLeft">步骤一</div>',
  },
  {
    verb: 'slideInRight',
    name: '自右滑入',
    description: '从右侧位移并淡入，适合对比右栏或反例出场。',
    source: 'builtin',
    duration: 500,
    easing: 'easeOutCubic',
    example: '<div data-anim="slideInRight">对比方案</div>',
  },
  {
    verb: 'slideInUp',
    name: '自下浮现',
    description: '从下方向上浮现，适合结论揭晓或底部总结卡片。',
    source: 'builtin',
    duration: 550,
    easing: 'easeOutCubic',
    example: '<ui-callout data-anim="slideInUp" title="总结"></ui-callout>',
  },
  {
    verb: 'slideInDown',
    name: '自上降落',
    description: '从上方降落到位，适合主标题或顶层概念。',
    source: 'builtin',
    duration: 550,
    easing: 'easeOutCubic',
    example: '<h2 data-anim="slideInDown">本课主题</h2>',
  },
  {
    verb: 'bounce',
    name: '活力弹跳',
    description: '上下跳跃强调，用于引导学员关注某个特定元素。',
    source: 'builtin',
    duration: 700,
    easing: 'easeOutQuad',
    example: '<ui-badge data-anim="bounce { loop: true }">注意</ui-badge>',
  },
  {
    verb: 'shake',
    name: '警戒晃动',
    description: '左右快速震颤，适合指出易错点、警示或反驳误区。',
    source: 'builtin',
    duration: 500,
    easing: 'easeInOutQuad',
    example: '<div data-anim="shake">常见误解：直接相除</div>',
  },
  {
    verb: 'wobble',
    name: '俏皮摆动',
    description: '角度微倾摆动，增加教学画面的生动人情味。',
    source: 'builtin',
    duration: 600,
    easing: 'easeInOutBack',
    example: '<span data-anim="wobble">💡</span>',
  },
  {
    verb: 'pulse',
    name: '心跳缩放',
    description: '节奏感微幅缩放，适合常驻高亮重点项。',
    source: 'builtin',
    duration: 800,
    easing: 'easeInOutSine',
    example: '<ui-stat data-anim="pulse" value="99.4%"></ui-stat>',
  },
  {
    verb: 'float',
    name: '悬浮起伏',
    description: '慢速上下漂浮感，营造舒适的呼吸态。',
    source: 'builtin',
    duration: 1800,
    easing: 'easeInOutSine',
    example: '<div data-anim="float">漂浮示意图</div>',
  },
  {
    verb: 'rotate',
    name: '完整旋转',
    description: '360 度平滑旋转，适合时钟、齿轮或循环过程。',
    source: 'builtin',
    duration: 1000,
    easing: 'linear',
    example: '<div data-anim="rotate">⚙️</div>',
  },
  {
    verb: 'flip',
    name: '立体翻转',
    description: '沿 Y 轴进行 3D 翻转呈现，适合卡片揭晓反面或对比揭示。',
    source: 'builtin',
    duration: 700,
    easing: 'easeInOutBack',
    example: '<ui-card data-anim="flip">答案揭晓</ui-card>',
  },
  {
    verb: 'glow',
    name: '呼吸发光',
    description: '光晕呼吸渐变扩散，强调关键公式或结论。',
    source: 'builtin',
    duration: 1200,
    easing: 'easeInOutSine',
    example: '<ui-formula data-anim="glow" ...></ui-formula>',
  },
  {
    verb: 'countUp',
    name: '数字滚动递增',
    description: '数字从 0 平滑滚动增加至目标数值。',
    source: 'builtin',
    duration: 1200,
    easing: 'easeOutExpo',
    example: '<span data-anim="countUp" data-target="100">0</span>',
  },
  {
    verb: 'typewriter',
    name: '逐字打字机',
    description: '文字逐字符流式显现，生动逼真。',
    source: 'builtin',
    duration: 1200,
    easing: 'linear',
    example: '<p data-anim="typewriter">这是一段逐步显现的思考过程</p>',
  },
]

const STORAGE_KEY_COMPONENTS = 'moji:classroom:custom_components'
const STORAGE_KEY_ANIMATIONS = 'moji:classroom:custom_animations'

function safeReadStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeWriteStorage<T>(key: string, val: T): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch (e) {
    console.warn('[classroom registry] 存储失败:', e)
  }
}

/** 外部注册的组件表（内存镜像） */
let externalComponentsCache: ClassroomComponentDef[] | null = null
/** 外部注册的动效表（内存镜像） */
let externalAnimationsCache: ClassroomAnimationDef[] | null = null

function getExternalComponents(): ClassroomComponentDef[] {
  if (externalComponentsCache === null) {
    externalComponentsCache = safeReadStorage<ClassroomComponentDef[]>(STORAGE_KEY_COMPONENTS, [])
  }
  return externalComponentsCache
}

function getExternalAnimations(): ClassroomAnimationDef[] {
  if (externalAnimationsCache === null) {
    externalAnimationsCache = safeReadStorage<ClassroomAnimationDef[]>(STORAGE_KEY_ANIMATIONS, [])
  }
  return externalAnimationsCache
}

/** 查询所有已注册教学组件（包括内置与外部） */
export function listClassroomComponents(filter?: {
  source?: 'builtin' | 'external'
  query?: string
}): ClassroomComponentDef[] {
  const builtins = BUILTIN_COMPONENTS
  const externals = getExternalComponents()
  let list = [...builtins, ...externals]

  if (filter?.source) {
    list = list.filter((c) => c.source === filter.source)
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase()
    list = list.filter(
      (c) =>
        c.tag.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    )
  }
  return list
}

/** 查询所有已注册动效（包括内置与外部） */
export function listClassroomAnimations(filter?: {
  source?: 'builtin' | 'external'
  query?: string
}): ClassroomAnimationDef[] {
  const builtins = BUILTIN_ANIMATIONS
  const externals = getExternalAnimations()
  let list = [...builtins, ...externals]

  if (filter?.source) {
    list = list.filter((a) => a.source === filter.source)
  }
  if (filter?.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase()
    list = list.filter(
      (a) =>
        a.verb.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q),
    )
  }
  return list
}

/** 获取单项组件定义 */
export function getClassroomComponent(tag: string): ClassroomComponentDef | undefined {
  const cleanTag = tag.trim().toLowerCase()
  return (
    BUILTIN_COMPONENTS.find((c) => c.tag.toLowerCase() === cleanTag) ||
    getExternalComponents().find((c) => c.tag.toLowerCase() === cleanTag)
  )
}

/** 获取单项动效定义 */
export function getClassroomAnimation(verb: string): ClassroomAnimationDef | undefined {
  const cleanVerb = verb.trim().toLowerCase()
  return (
    BUILTIN_ANIMATIONS.find((a) => a.verb.toLowerCase() === cleanVerb) ||
    getExternalAnimations().find((a) => a.verb.toLowerCase() === cleanVerb)
  )
}

/** 注册外部自定义教学组件 */
export function registerClassroomComponent(def: {
  tag: string
  name: string
  description: string
  template?: string
  category?: 'layout' | 'content' | 'interactive' | 'visual' | 'custom'
  defaultProps?: Record<string, string>
  example?: string
}): { ok: boolean; message?: string } {
  const cleanTag = def.tag.trim().toLowerCase()
  if (!cleanTag.startsWith('ui-') && !cleanTag.startsWith('x-')) {
    return { ok: false, message: '组件标签必须以 ui- 或 x- 开头，例如 ui-experiment' }
  }
  if (BUILTIN_COMPONENTS.some((c) => c.tag.toLowerCase() === cleanTag)) {
    return { ok: false, message: `无法覆盖内置组件: <${cleanTag}>` }
  }

  const current = getExternalComponents()
  const nextItem: ClassroomComponentDef = {
    tag: cleanTag,
    name: def.name.trim() || cleanTag,
    description: def.description.trim() || '外部注册组件',
    category: def.category || 'custom',
    source: 'external',
    template: def.template,
    defaultProps: def.defaultProps,
    example: def.example || `<${cleanTag}>\n  <div>内容</div>\n</${cleanTag}>`,
    createdAt: Date.now(),
  }

  const filtered = current.filter((c) => c.tag.toLowerCase() !== cleanTag)
  const next = [...filtered, nextItem]
  externalComponentsCache = next
  safeWriteStorage(STORAGE_KEY_COMPONENTS, next)
  return { ok: true, message: `成功注册组件 <${cleanTag}>` }
}

/** 注册外部自定义动效 */
export function registerClassroomAnimation(def: {
  verb: string
  name: string
  description: string
  keyframes?: Record<string, unknown> | Array<Record<string, unknown>>
  duration?: number
  easing?: string
  example?: string
}): { ok: boolean; message?: string } {
  const cleanVerb = def.verb.trim()
  if (!cleanVerb) {
    return { ok: false, message: '动效名称 (verb) 不能为空' }
  }
  if (BUILTIN_ANIMATIONS.some((a) => a.verb.toLowerCase() === cleanVerb.toLowerCase())) {
    return { ok: false, message: `无法覆盖内置动效: ${cleanVerb}` }
  }

  const current = getExternalAnimations()
  const nextItem: ClassroomAnimationDef = {
    verb: cleanVerb,
    name: def.name.trim() || cleanVerb,
    description: def.description.trim() || '外部注册动效',
    source: 'external',
    keyframes: def.keyframes,
    duration: def.duration || 600,
    easing: def.easing || 'easeOutQuad',
    example: def.example || `data-anim="${cleanVerb}"`,
    createdAt: Date.now(),
  }

  const filtered = current.filter((a) => a.verb.toLowerCase() !== cleanVerb.toLowerCase())
  const next = [...filtered, nextItem]
  externalAnimationsCache = next
  safeWriteStorage(STORAGE_KEY_ANIMATIONS, next)
  return { ok: true, message: `成功注册动效 ${cleanVerb}` }
}

/** 注销外部自定义组件 */
export function unregisterClassroomComponent(tag: string): boolean {
  const cleanTag = tag.trim().toLowerCase()
  const current = getExternalComponents()
  const next = current.filter((c) => c.tag.toLowerCase() !== cleanTag)
  if (next.length === current.length) return false
  externalComponentsCache = next
  safeWriteStorage(STORAGE_KEY_COMPONENTS, next)
  return true
}

/** 注销外部自定义动效 */
export function unregisterClassroomAnimation(verb: string): boolean {
  const cleanVerb = verb.trim().toLowerCase()
  const current = getExternalAnimations()
  const next = current.filter((a) => a.verb.toLowerCase() !== cleanVerb)
  if (next.length === current.length) return false
  externalAnimationsCache = next
  safeWriteStorage(STORAGE_KEY_ANIMATIONS, next)
  return true
}
