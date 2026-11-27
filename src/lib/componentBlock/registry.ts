/**
 * 文档排版配方组件注册中心 (Document Component Registry)
 *
 * 内置 9 个出版级配方 + 用户目录里的外部 TSX 组件（`users/<uid>/doc-design/*.tsx`）。
 * 外部组件不再存 localStorage：注册 / 更新 = 新建或改写一个外部 TSX 文件，加载器动态编译，
 * 保存后热更新。提供：
 * 1. listDocumentComponents: 简洁清单（供 api.design.component.list）
 * 2. getDocumentComponent: 完整签名（供 api.design.component.get / 渲染器）
 * 3. register / update / delete: 管理外部 TSX 文件
 */
import {
  deleteExternalModuleFile,
  externalModuleFileName,
  getExternalModule,
  listExternalModules,
  subscribeExternalModules,
  writeExternalModuleFile,
  type ExternalDocComponentDef,
} from '../externalModules'
import { docComponentTemplate, externalModuleSeed } from '../externalModules/templates'

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
  /** 外部组件：真正被渲染的 React 组件 */
  component?: ExternalDocComponentDef['component']
  /** 外部组件所在的 TSX 文件（相对当前用户目录），内置组件没有 */
  file?: string
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
      { name: 'left', description: '左栏卡片（属性支持 title, badge, type；也可嵌套 #title / #content）' },
      { name: 'right', description: '右栏卡片（属性支持 title, badge, type；也可嵌套 #title / #content）' },
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

/* ---------- 外部 TSX 组件：从 doc-design/ 动态加载 ---------- */

type Listener = () => void

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {}
  }
}

const listeners = new Set<Listener>()
subscribeExternalModules(notify)

/** 订阅配方组件变更事件（内置不变；外部文件保存 / 删除后触发） */
export function onDocumentComponentsChange(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function toDocumentComponent(record: {
  id: string
  file: string
  loadedAt: number
  def: Record<string, unknown>
}): DocumentComponentDef {
  const raw = record.def as unknown as ExternalDocComponentDef
  const category = raw.category as DocumentComponentDef['category'] | undefined
  return {
    id: record.id,
    tag: String(raw.tag ?? record.id),
    name: String(raw.name ?? raw.tag ?? record.id),
    description: String(raw.description ?? '外部注册教学组件'),
    category: category && ['callout', 'layout', 'formula', 'timeline', 'data', 'quiz', 'custom'].includes(category)
      ? category
      : 'custom',
    source: 'external',
    slots: (raw.slots ?? []) as ComponentSlotMeta[],
    attrs: (raw.attrs ?? []) as ComponentAttrMeta[],
    example: String(raw.example ?? `<${String(raw.tag ?? record.id)}>\n  <div #describe>外部组件内容</div>\n</${String(raw.tag ?? record.id)}>`),
    component: typeof raw.component === 'function' ? raw.component : undefined,
    file: record.file,
    createdAt: record.loadedAt,
    updatedAt: record.loadedAt,
  }
}

function externalDocumentComponents(): DocumentComponentDef[] {
  return listExternalModules('doc-component').map(toDocumentComponent)
}

/** 查询全部已注册的文档组件（内置 + 外部 TSX） */
export function listDocumentComponents(opts: {
  source?: 'builtin' | 'external'
  query?: string
} = {}): DocumentComponentDef[] {
  const custom = externalDocumentComponents()
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

export interface RegisterDocumentComponentInput {
  id?: string
  tag: string
  name: string
  description: string
  category?: DocumentComponentDef['category']
  slots?: ComponentSlotMeta[]
  attrs?: ComponentAttrMeta[]
  example?: string
  /** 直接提供完整 TSX 源码（外部组件以文件为源；给了就忽略上面其它字段生成的模板） */
  source?: string
}

/** 注册 / 覆盖一个外部文档组件：写 doc-design/<kind>--<id>.tsx，随后热更新 */
export async function registerDocumentComponent(
  def: RegisterDocumentComponentInput,
): Promise<{ ok: boolean; component?: DocumentComponentDef; file?: string; error?: string }> {
  const tag = def.tag.trim()
  if (!tag) return { ok: false, error: '组件标签 tag 不能为空' }
  const id = (def.id?.trim() || tag.toLowerCase()).replace(/[^a-zA-Z0-9_-]/g, '_')

  if (BUILTIN_DOC_COMPONENTS.some((b) => b.id === id || b.tag.toLowerCase() === tag.toLowerCase())) {
    return { ok: false, error: `不能覆盖内置组件: ${id}` }
  }

  const existing = getDocumentComponent(id)
  const merged = {
    id,
    tag,
    name: def.name.trim() || tag,
    description: def.description.trim() || '外部注册教学组件',
    category: def.category || 'custom',
    slots: def.slots ?? existing?.slots,
    attrs: def.attrs || existing?.attrs || [],
    example: def.example?.trim() || existing?.example,
  }

  const source = def.source ?? docComponentTemplate(merged)
  const fileName = externalModuleFileName('doc-component', id)
  const written = await writeExternalModuleFile(fileName, source)
  if (!written.ok) return { ok: false, error: written.error, file: written.file }

  const record = listExternalModules('doc-component').find((r) => r.id === id)
  const component = record ? toDocumentComponent(record) : undefined
  return { ok: true, component, file: written.file }
}

export interface UpdateDocumentComponentPatch extends Partial<Omit<DocumentComponentDef, 'id' | 'source' | 'createdAt' | 'file' | 'component'>> {
  /** 直接替换外部 TSX 源码；不传则按元数据重新生成模板（会丢失自定义组件） */
  source?: string
}

/** 更新外部文档组件。以 TSX 文件为源：自定义 component 的组件必须传 source。 */
export async function updateDocumentComponent(
  id: string,
  patch: UpdateDocumentComponentPatch,
): Promise<{ ok: boolean; component?: DocumentComponentDef; file?: string; error?: string }> {
  if (!id) return { ok: false, error: '缺少组件 id' }
  if (BUILTIN_DOC_COMPONENTS.some((b) => b.id === id)) {
    return { ok: false, error: '内置组件不允许直接修改' }
  }

  const current = getDocumentComponent(id)
  if (!current || current.source !== 'external') {
    return { ok: false, error: `未找到外部组件: ${id}` }
  }
  if (!patch.source && current.component) {
    return { ok: false, error: '这个组件使用 React component，更新请直接传 source（TSX 源码）' }
  }

  const merged = {
    id: current.id,
    tag: patch.tag ?? current.tag,
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    category: patch.category ?? current.category,
    slots: patch.slots ?? current.slots ?? [],
    attrs: patch.attrs ?? current.attrs ?? [],
    example: patch.example ?? current.example,
  }
  const source = patch.source ?? docComponentTemplate(merged)
  const fileName = externalModuleFileName('doc-component', current.id)
  const written = await writeExternalModuleFile(fileName, source)
  if (!written.ok) return { ok: false, error: written.error, file: written.file }

  const record = listExternalModules('doc-component').find((r) => r.id === current.id)
  return { ok: true, component: record ? toDocumentComponent(record) : undefined, file: written.file }
}

/** 删除外部文档组件：删 doc-design/ 下对应的 TSX 文件 */
export async function deleteDocumentComponent(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!id) return { ok: false, error: '缺少组件 id' }
  if (BUILTIN_DOC_COMPONENTS.some((b) => b.id === id)) {
    return { ok: false, error: '内置组件不允许删除' }
  }
  const record = getExternalModule('doc-component', id)
  if (!record) return { ok: false, error: `未找到外部组件: ${id}` }
  return deleteExternalModuleFile(record.fileName)
}

/**
 * 直接新建一个带完整模板的外部组件 TSX 文件。
 *
 * 设置面板的「新建」不再弹表单：这里生成唯一 id / tag，写入可运行的 TSX 模板；
 * 调用方拿到 file 后直接用应用内文件页签打开编辑。文件保存后由 loader 热更新。
 */
export async function createDocumentComponentFile(): Promise<{
  ok: boolean
  component?: DocumentComponentDef
  file?: string
  error?: string
}> {
  const seed = externalModuleSeed('custom')
  const suffix = seed.replace(/^custom-/, '').replace(/-/g, '').toUpperCase()
  return registerDocumentComponent({
    id: seed,
    tag: `Custom${suffix}`,
    name: '未命名文档组件',
    description: '直接编辑这个 TSX 文件里的 tag / name / description / component；保存后自动热更新。',
  })
}
