/**
 * 文档排版配方组件注册中心 (Document Component Registry)
 *
 * 统一管理内置 9 个精装出版级排版配方组件与外部注册的自定义文档组件。
 * 提供：
 * 1. listDocumentComponents: 支持仅返回简短描述与 id (供 api.design.component.list)
 * 2. getDocumentComponent: 获取组件完整签名 (供 api.design.component.get)
 * 3. register / update / delete: 管理外部注册组件并持久化到 localStorage
 */

export interface ComponentSlotMeta {
  name: string
  description: string
  required?: boolean
}

export interface ComponentAttrMeta {
  name: string
  description: string
  type?: string
  default?: string
}

export interface DocumentComponentDef {
  id: string
  tag: string
  name: string
  description: string
  category: 'callout' | 'layout' | 'formula' | 'timeline' | 'data' | 'quiz' | 'custom'
  source: 'builtin' | 'external'
  slots?: ComponentSlotMeta[]
  attrs?: ComponentAttrMeta[]
  example: string
  template?: string
  createdAt?: number
  updatedAt?: number
}

/** 9 个内置出版级排版配方组件 */
export const BUILTIN_DOC_COMPONENTS: DocumentComponentDef[] = [
  {
    id: 'notice',
    tag: 'Notice',
    name: '带眉标的提示框',
    description: '核心结论 / 易错警示 / 思考锚点（支持 warn|seal|ok|sky 语义色）',
    category: 'callout',
    source: 'builtin',
    attrs: [
      { name: 'type', description: '色系：warn(警示/易错) | seal(强调/核心) | ok(正确/定理) | sky(说明/思考)', default: 'seal' },
      { name: 'title', description: '顶部眉标标题（亦可用 #title 插槽传递）' },
    ],
    slots: [
      { name: 'title', description: '顶部状态圆点右侧的眉标标题' },
      { name: 'describe', description: '卡片正文说明（支持内联 Markdown 与 LaTeX 公式）' },
    ],
    example: `<Notice type="warn">
  <div #title>易错陷阱 · 边界条件</div>
  <div #describe>当分母趋近于 0 时，**不能直接代入求值**，必须先通过因式分解消去零因子。</div>
</Notice>`,
  },
  {
    id: 'compare',
    tag: 'Compare',
    name: '双栏概念交锋 / 正误辨析',
    description: '左右双栏网格对比，直观辨析常见直觉误区与严谨定义',
    category: 'layout',
    source: 'builtin',
    slots: [
      { name: 'left', description: '左栏卡片（属性支持 title, badge, type）' },
      { name: 'right', description: '右栏卡片（属性支持 title, badge, type）' },
    ],
    example: `<Compare>
  <div #left title="直觉误区" badge="常见错误" type="warn">认为导数等于 0 的点一定是极值点。</div>
  <div #right title="严格定义" badge="正确认知" type="ok">驻点只是极值点的候选人，需检验两侧是否变号。</div>
</Compare>`,
  },
  {
    id: 'formula',
    tag: 'Formula',
    name: '定理 / 核心公式解剖卡',
    description: '上半部居中大号公式表达式，下半部多栏拆解每项物理/数学含义',
    category: 'formula',
    source: 'builtin',
    attrs: [
      { name: 'title', description: '公式或定理名称' },
      { name: 'expr', description: '核心数学表达式' },
    ],
    slots: [
      { name: 'title', description: '公式名称' },
      { name: 'expr', description: '核心表达式' },
      { name: 'item', description: '拆解项（属性 name 表示项名称，tone 表示强调色）' },
    ],
    example: `<Formula title="贝叶斯定理" expr="P(A|B) = [ P(B|A) · P(A) ] / P(B)">
  <div #item name="P(A|B) 后验概率" tone="seal">看到新证据 B 后对事件 A 发生概率的修正认知。</div>
  <div #item name="P(B|A) 似然度">假定 A 成立前提下观察到现象 B 的可能性。</div>
  <div #item name="P(A) 先验概率">在未见新证据前对 A 的历史初始判断。</div>
</Formula>`,
  },
  {
    id: 'steps',
    tag: 'Steps',
    name: '带贯穿引导线的步骤轴',
    description: '纵向推导过程 / 解题 SOP / 演进阶段，序号圆圈压在线上',
    category: 'timeline',
    source: 'builtin',
    slots: [
      { name: 'step', description: '步骤项（属性 title 为步骤标题，num 为序号）' },
    ],
    example: `<Steps>
  <div #step title="定位系统边界与研究对象">明确把哪个物体隔离出来，圈出所有受力来源。</div>
  <div #step title="建立正交坐标系并正交分解">沿加速度方向建立 x 轴并投影受力。</div>
  <div #step title="联立平衡方程或牛二定律求解">分别列出 ΣFx = ma 与 ΣFy = 0 求解。</div>
</Steps>`,
  },
  {
    id: 'pipeline',
    tag: 'Pipeline',
    name: '横向机制推导链',
    description: '横向机制推导流与状态机转化序列，卡片之间带推进箭头',
    category: 'timeline',
    source: 'builtin',
    slots: [
      { name: 'stage', description: '阶段卡片（属性 label 为阶段标号，title 为标题，tone 为状态色）' },
    ],
    example: `<Pipeline>
  <div #stage label="STAGE 01" title="源码输入">字符流读入内存</div>
  <div #stage label="STAGE 02" title="词法与语法分析" tone="seal">生成抽象语法树 AST</div>
  <div #stage label="STAGE 03" title="目标代码生成" tone="ok">输出机器指令序列</div>
</Pipeline>`,
  },
  {
    id: 'stat',
    tag: 'Stat',
    name: '关键指标 / 参数看板',
    description: '顶栏分类标签，中间大号 tabular-nums 数据，底栏一句话解读',
    category: 'data',
    source: 'builtin',
    slots: [
      { name: 'item', description: '指标卡片（属性 label 为分类名称，value 为数值，tone 为强调色）' },
    ],
    example: `<Stat>
  <div #item label="时间复杂度（平均）" value="O(n log n)" tone="seal">分治递归的最优平衡点</div>
  <div #item label="最坏退化情况" value="O(n²)" tone="warn">基准值每次选到极值</div>
  <div #item label="原地空间开销" value="O(log n)" tone="ok">仅消耗递归调用栈深度</div>
</Stat>`,
  },
  {
    id: 'concept',
    tag: 'Concept',
    name: '词典式术语名片',
    description: '词条名 + 英文对照 + 领域标签 + 一句话本质定义',
    category: 'callout',
    source: 'builtin',
    slots: [
      { name: 'term', description: '概念词条名' },
      { name: 'en', description: '英文对照或外文原名' },
      { name: 'tag', description: '所属学科或领域徽章' },
      { name: 'describe', description: '本质定义与核心特征阐述' },
    ],
    example: `<Concept>
  <div #term>熵增定律</div>
  <div #en>Law of Increasing Entropy · ΔS ≥ 0</div>
  <div #tag>热力学第二定律</div>
  <div #describe>在孤立系统中，热量总是自发地从高温流向低温，系统的微观无序度永远不会自发减少。</div>
</Concept>`,
  },
  {
    id: 'breakdown',
    tag: 'Breakdown',
    name: '分段式构成条',
    description: '比例拆解 / 时间分配 / 内存布局（彩色拼接进度条 + 底部图例）',
    category: 'data',
    source: 'builtin',
    attrs: [
      { name: 'title', description: '构成条标题' },
      { name: 'total', description: '总量标注文案，如「总计 100%」' },
    ],
    slots: [
      { name: 'item', description: '构成项（属性 label 为分类名，value 为百分比，tone 为色调）' },
    ],
    example: `<Breakdown title="训练显存占用构成" total="总计 100%">
  <div #item label="优化器状态" value="55%" tone="seal"></div>
  <div #item label="激活值缓存" value="25%" tone="ok"></div>
  <div #item label="模型权重" value="20%" tone="warn"></div>
</Breakdown>`,
  },
  {
    id: 'quiz',
    tag: 'Quiz',
    name: '随堂微测 / 自检折叠卡',
    description: '上方设问，下方带可交互点击展开的思路与答案解析',
    category: 'quiz',
    source: 'builtin',
    slots: [
      { name: 'title', description: '小测标题（默认「快问快答 · 概念自检」）' },
      { name: 'question', description: '设问题目正文' },
      { name: 'answer', description: '答案与推导思路揭晓' },
    ],
    example: `<Quiz>
  <div #title>快问快答 · 概念自检</div>
  <div #question>如果将单摆的摆球质量增加一倍，其固有周期 T 会如何变化？</div>
  <div #answer>保持不变。周期 T = 2π√(L/g) 仅由摆长与重力加速度决定，与摆球质量无关。</div>
</Quiz>`,
  },
]

const STORAGE_KEY_DOC_COMPONENTS = 'moji:document:custom_components'

type Listener = () => void
const listeners = new Set<Listener>()

function safeReadStorage(): DocumentComponentDef[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DOC_COMPONENTS)
    if (!raw) return []
    return JSON.parse(raw) as DocumentComponentDef[]
  } catch {
    return []
  }
}

function safeWriteStorage(list: DocumentComponentDef[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    localStorage.setItem(STORAGE_KEY_DOC_COMPONENTS, JSON.stringify(list))
    notify()
  } catch (err) {
    console.warn('[docComponentRegistry] 存储失败:', err)
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

/** 订阅配方组件变更事件 */
export function onDocumentComponentsChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 查询全部已注册的文档组件 */
export function listDocumentComponents(opts: {
  source?: 'builtin' | 'external'
  query?: string
} = {}): DocumentComponentDef[] {
  const custom = safeReadStorage()
  let all: DocumentComponentDef[] = []

  if (opts.source === 'builtin') {
    all = [...BUILTIN_DOC_COMPONENTS]
  } else if (opts.source === 'external') {
    all = [...custom]
  } else {
    all = [...BUILTIN_DOC_COMPONENTS, ...custom]
  }

  if (opts.query?.trim()) {
    const q = opts.query.trim().toLowerCase()
    return all.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.tag.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    )
  }

  return all
}

/** 查特定组件（按 id 或 tag，不区分大小写） */
export function getDocumentComponent(idOrTag: string): DocumentComponentDef | undefined {
  if (!idOrTag) return undefined
  const target = idOrTag.trim().toLowerCase()
  const all = listDocumentComponents()
  return all.find((c) => c.id.toLowerCase() === target || c.tag.toLowerCase() === target)
}

/** 注册外部文档配方组件 */
export function registerDocumentComponent(def: {
  id?: string
  tag: string
  name: string
  description: string
  category?: DocumentComponentDef['category']
  slots?: ComponentSlotMeta[]
  attrs?: ComponentAttrMeta[]
  example?: string
  template?: string
}): { ok: boolean; component?: DocumentComponentDef; error?: string } {
  const tag = def.tag.trim()
  if (!tag) return { ok: false, error: '组件标签 tag 不能为空' }
  const id = (def.id?.trim() || tag.toLowerCase()).replace(/[^a-zA-Z0-9_-]/g, '_')

  // 内置组件禁止直接同名顶替
  if (BUILTIN_DOC_COMPONENTS.some((b) => b.id === id || b.tag.toLowerCase() === tag.toLowerCase())) {
    return { ok: false, error: `不能覆盖内置组件: ${id}` }
  }

  const custom = safeReadStorage()
  const existingIdx = custom.findIndex((c) => c.id === id)

  const newDef: DocumentComponentDef = {
    id,
    tag,
    name: def.name.trim() || tag,
    description: def.description.trim() || '外部注册教学组件',
    category: def.category || 'custom',
    source: 'external',
    slots: def.slots || [],
    attrs: def.attrs || [],
    example: def.example?.trim() || `<${tag}>\n  <div #describe>自定义组件内容</div>\n</${tag}>`,
    template: def.template?.trim(),
    createdAt: existingIdx >= 0 ? custom[existingIdx]!.createdAt : Date.now(),
    updatedAt: Date.now(),
  }

  if (existingIdx >= 0) {
    custom[existingIdx] = newDef
  } else {
    custom.push(newDef)
  }

  safeWriteStorage(custom)
  return { ok: true, component: newDef }
}

/** 更新外部文档配方组件 */
export function updateDocumentComponent(
  id: string,
  patch: Partial<Omit<DocumentComponentDef, 'id' | 'source' | 'createdAt'>>,
): { ok: boolean; component?: DocumentComponentDef; error?: string } {
  if (!id) return { ok: false, error: '缺少组件 id' }
  if (BUILTIN_DOC_COMPONENTS.some((b) => b.id === id)) {
    return { ok: false, error: '内置组件不允许直接修改' }
  }

  const custom = safeReadStorage()
  const idx = custom.findIndex((c) => c.id === id)
  if (idx < 0) {
    return { ok: false, error: `未找到外部组件: ${id}` }
  }

  const target = custom[idx]!
  const updated: DocumentComponentDef = {
    ...target,
    ...patch,
    id: target.id,
    source: 'external',
    createdAt: target.createdAt,
    updatedAt: Date.now(),
  }

  custom[idx] = updated
  safeWriteStorage(custom)
  return { ok: true, component: updated }
}

/** 删除外部文档配方组件 */
export function deleteDocumentComponent(id: string): { ok: boolean; error?: string } {
  if (!id) return { ok: false, error: '缺少组件 id' }
  if (BUILTIN_DOC_COMPONENTS.some((b) => b.id === id)) {
    return { ok: false, error: '内置组件不允许删除' }
  }

  const custom = safeReadStorage()
  const filtered = custom.filter((c) => c.id !== id)
  if (filtered.length === custom.length) {
    return { ok: false, error: `未找到外部组件: ${id}` }
  }

  safeWriteStorage(filtered)
  return { ok: true }
}
