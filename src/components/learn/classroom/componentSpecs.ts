import { EXTENDED_COMPONENT_SPECS } from './componentSpecsExtended'
/**
 * 课堂组件规范契约详表 (componentSpecs.ts)
 * 严格对齐 components.ts 与 builtinCatalog.ts 中的 31 种内置组件契约
 */

export interface ComponentPropSpec {
  name: string
  type: 'string' | 'number' | 'enum' | 'boolean' | 'html'
  required: boolean
  defaultValue?: string
  description: string
  options?: string[]
}

export interface ComponentSlotSpec {
  name: string
  description: string
  example?: string
}

export interface ComponentExampleSpec {
  title: string
  description: string
  code: string
}

export interface ClassroomComponentSpec {
  tag: string
  name: string
  category: 'layout' | 'content' | 'interactive' | 'visual' | 'custom'
  categoryLabel: string
  description: string
  props: ComponentPropSpec[]
  slots?: ComponentSlotSpec[]
  recommendedAnimations: string[]
  bestPractices: string
  examples: ComponentExampleSpec[]
}

const BASE_BUILTIN_SPECS: Record<string, ClassroomComponentSpec> = {
  'ui-card': {
    tag: 'ui-card',
    name: '通用容器卡片',
    category: 'layout',
    categoryLabel: '布局容器',
    description:
      '编辑级架构容器卡片，支持眉标 eyebrow、主副标题、18 种矢量图标、语义色顶栏 tone、右上角胶囊与底栏 footer。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符，用于时间轴动作精准寻址' },
      { name: 'eyebrow', type: 'string', required: false, description: '顶部全大写英文/分类眉标小字' },
      { name: 'title', type: 'string', required: false, description: '卡片主标题文字' },
      { name: 'subtitle', type: 'string', required: false, description: '主标题下方的辅助副标题' },
      { name: 'badge', type: 'string', required: false, description: '右上角胶囊标签文字' },
      {
        name: 'badge-color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '右上角标签主题色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'tone',
        type: 'enum',
        required: false,
        defaultValue: 'default',
        description: '卡片表面色调与顶边强调条（sunken 用作陪衬暗底）',
        options: ['default', 'seal', 'sky', 'ok', 'warn', 'purple', 'sunken'],
      },
      {
        name: 'icon',
        type: 'enum',
        required: false,
        defaultValue: 'bulb',
        description: '左上角内置矢量图标名',
        options: [
          'sparkles', 'bulb', 'code', 'check', 'star', 'info', 'warn', 'target', 'chart', 'book',
          'compass', 'layers', 'zap', 'atom', 'clock', 'flame', 'shield', 'cpu',
        ],
      },
      { name: 'footer', type: 'string', required: false, description: '底部细分隔线下方注脚文本' },
    ],
    slots: [{ name: 'default', description: '卡片正文主体内容，支持文本、段落与行内富文本' }],
    recommendedAnimations: ['riseIn', 'popIn', 'spotlight', 'shimmer'],
    bestPractices: '同屏多卡时只给主焦点卡设 tone="seal"，陪衬卡用 default 或 sunken 形成明暗层次。',
    examples: [
      {
        title: '核心结论卡片',
        description: '带眉标与语义顶条的主焦点卡',
        code: '<ui-card id="c1" eyebrow="CORE TAKEAWAY" title="极限保号性" badge="重点" badge-color="seal" tone="seal" icon="bulb">\n  <p>若 f(x) 在点 x₀ 的极限大于零，则在其去心邻域内函数值恒大于零。</p>\n</ui-card>',
      },
      {
        title: '陪衬对照卡片',
        description: '使用 sunken 沉静底衬托主卡',
        code: '<ui-card id="c2" title="常见直觉" subtitle="未经严格证明的猜测" tone="sunken" icon="compass" footer="需在下一幕引入反例校验">\n  <p>以为局部大就处处大，往往忽略了去心邻域的半径限制。</p>\n</ui-card>',
      },
    ],
  },

  'ui-concept': {
    tag: 'ui-concept',
    name: '核心概念提炼卡',
    category: 'content',
    categoryLabel: '核心内容',
    description:
      '辞典级概念定义卡，包含术语大字、斜体英文/符号副题 en、右上角分类标签、清晰定义文本与核心要点高亮横幅。',
    props: [
      { name: 'term', type: 'string', required: true, description: '核心概念或术语名称' },
      { name: 'en', type: 'string', required: false, description: '英文对照名或数学符号副标' },
      { name: 'tag', type: 'string', required: false, description: '右上角学科分类胶囊' },
      {
        name: 'tag-color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '分类胶囊配色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      { name: 'definition', type: 'string', required: false, description: '概念标准定义文本（不传则读子内容）' },
      { name: 'keypoint', type: 'string', required: false, description: '底部核心要点高亮横幅文本' },
    ],
    recommendedAnimations: ['blurIn', 'zoomIn', 'riseIn', 'shimmer'],
    bestPractices: '引入核心新概念时优先使用；en 填英文原词能建立跨文献辨识度，keypoint 凝练成一句话记忆钩子。',
    examples: [
      {
        title: '夹逼定理典藏卡',
        description: '带英文副题与核心要点',
        code: '<ui-concept term="夹逼定理" en="Squeeze Theorem" tag="重要定理" keypoint="两端极限相等，中间夹逼必收敛">\n  若在 x₀ 附近有 f(x) ≤ g(x) ≤ h(x)，且两侧函数极限同为 L，则中间函数 g(x) 的极限亦必为 L。\n</ui-concept>',
      },
    ],
  },

  'ui-formula': {
    tag: 'ui-formula',
    name: '数理公式显要卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '带蓝图点阵底纹与四角准星的 KaTeX 公式展示台，支持顶部眉标、标题、几何附注与下方变量拆解槽位。',
    props: [
      { name: 'latex', type: 'string', required: true, description: 'LaTeX 格式数学公式代码（无需手写 $$）' },
      { name: 'eyebrow', type: 'string', required: false, description: '顶部英文或编号眉标' },
      { name: 'title', type: 'string', required: false, description: '公式名或定理标题' },
      { name: 'desc', type: 'string', required: false, description: '公式下方的几何或物理意义说明' },
      {
        name: 'tone',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '准星与边框强调色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    slots: [{ name: 'default', description: '当显式传 latex 属性时，子节点可放变量释义或附注' }],
    recommendedAnimations: ['shimmer', 'blurIn', 'zoomIn', 'glow'],
    bestPractices: '用 shorthand 属性 latex 写公式时，可在标签内部再放简短的符号拆解，保持公式主体居中突出。',
    examples: [
      {
        title: '欧拉恒等式',
        description: '经典陈列台效果',
        code: '<ui-formula eyebrow="EULER IDENTITY" latex="e^{i\\pi} + 1 = 0" title="欧拉恒等式" desc="将自然常数、虚数单位、圆周率与基础整数统一在一行" tone="seal"></ui-formula>',
      },
    ],
  },

  'ui-code': {
    tag: 'ui-code',
    name: '工作室代码标本卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '深色高对比编辑器代码标本卡，适配任意浅/深色背景舞台，支持文件名标题、语言标签与底部注解 caption。',
    props: [
      { name: 'lang', type: 'string', required: false, defaultValue: 'code', description: '编程语言标签' },
      { name: 'title', type: 'string', required: false, description: '顶部文件名或代码片段名' },
      { name: 'caption', type: 'string', required: false, description: '代码底部的机制注解' },
    ],
    slots: [{ name: 'default', description: '代码原文文本，保留换行与缩进' }],
    recommendedAnimations: ['slideInBottom', 'riseIn', 'spotlight'],
    bestPractices: '控制代码在 8-10 行以内，用 caption 点出一句最核心的复杂度或算法不变量。',
    examples: [
      {
        title: '梯度下降核心迭代',
        description: '带底部注解的代码标本',
        code: '<ui-code lang="python" title="gradient_descent.py" caption="每次沿梯度反方向迈出步长 lr">\nw = w - lr * grad\nloss = compute_loss(w, x, y)\n</ui-code>',
      },
    ],
  },

  'ui-compare': {
    tag: 'ui-compare',
    name: '二元正误对照卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '高反差辩析双栏卡片，支持左右双栏独立色调（left-tone / right-tone）与中缝 VS 徽标。',
    props: [
      { name: 'left-title', type: 'string', required: false, defaultValue: '方案 A', description: '左栏标题' },
      { name: 'left-badge', type: 'string', required: false, description: '左栏角标' },
      {
        name: 'left-tone',
        type: 'enum',
        required: false,
        defaultValue: 'warn',
        description: '左栏语义色调',
        options: ['warn', 'muted', 'sky', 'seal', 'ok'],
      },
      { name: 'right-title', type: 'string', required: false, defaultValue: '方案 B', description: '右栏标题' },
      { name: 'right-badge', type: 'string', required: false, description: '右栏角标' },
      {
        name: 'right-tone',
        type: 'enum',
        required: false,
        defaultValue: 'ok',
        description: '右栏语义色调',
        options: ['ok', 'seal', 'sky', 'warn'],
      },
      { name: 'vs', type: 'string', required: false, defaultValue: 'VS', description: '中缝徽标文字' },
    ],
    slots: [
      { name: 'left', description: 'slot="left" 左侧内容' },
      { name: 'right', description: 'slot="right" 右侧内容' },
    ],
    recommendedAnimations: ['riseIn', 'popIn', 'flip'],
    bestPractices: '左栏用 left-tone="warn" 呈现易错直觉，右栏用 right-tone="ok" 呈现严格规范，反差一眼即明。',
    examples: [
      {
        title: '典型误区 vs 规范解法',
        description: '左警示右确认的对称对照',
        code: '<ui-compare left-title="常见误区" left-badge="易错" left-tone="warn" right-title="正确解法" right-badge="规范" right-tone="ok">\n  <div slot="left">分母为 0 直接代入得 0</div>\n  <div slot="right">先因式分解约去零因子，再求极限</div>\n</ui-compare>',
      },
    ],
  },

  'ui-steps': {
    tag: 'ui-steps',
    name: '纵向步骤导轨',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '带连续纵向脊柱导轨的步骤流容器，配合 <ui-step> 清晰展示推导路线与操作 SOP。',
    props: [
      { name: 'title', type: 'string', required: false, description: '流程大标题' },
      { name: 'subtitle', type: 'string', required: false, description: '副标题说明' },
    ],
    slots: [{ name: 'default', description: '包含 2~4 个 <ui-step> 子组件' }],
    recommendedAnimations: ['unfold', 'riseIn', 'slideInLeft'],
    bestPractices: '建议每幕控制在 3~4 步，可用 state="active" 点亮当前正在讲解的那一步。',
    examples: [
      {
        title: '三步解极限',
        description: '带激活态的步骤导轨',
        code: '<ui-steps title="极限计算三步法" subtitle="从识别型别到消零代入">\n  <ui-step num="1" title="判断型别" state="done">观察是否为 0/0 不定式</ui-step>\n  <ui-step num="2" title="化简变形" state="active" badge="核心">等价无穷小代换或有理化</ui-step>\n  <ui-step num="3" title="代入求值">直接代入得确定解</ui-step>\n</ui-steps>',
      },
    ],
  },

  'ui-step': {
    tag: 'ui-step',
    name: '步骤节点项',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '步骤导轨 <ui-steps> 的子项，支持序号、标题、徽标与步骤状态 state。',
    props: [
      { name: 'num', type: 'string', required: false, defaultValue: '1', description: '数字或字母序号' },
      { name: 'title', type: 'string', required: false, description: '步骤名称' },
      { name: 'badge', type: 'string', required: false, description: '右侧小角标' },
      {
        name: 'state',
        type: 'enum',
        required: false,
        defaultValue: 'default',
        description: '节点状态视觉样式',
        options: ['default', 'active', 'done', 'warn'],
      },
    ],
    slots: [{ name: 'default', description: '步骤说明文本' }],
    recommendedAnimations: ['slideInLeft', 'popIn', 'spotlight'],
    bestPractices: '置于 <ui-steps> 内部；需要逐条揭晓时给每个 <ui-step> 分配独立 id 与 data-hidden。',
    examples: [
      {
        title: '激活步骤项',
        description: '带角标高亮的当前步骤',
        code: '<ui-step num="2" title="分子有理化" state="active" badge="技巧">上下同乘共轭式消去根号零因子</ui-step>',
      },
    ],
  },

  'ui-stat': {
    tag: 'ui-stat',
    name: '精密遥测指标卡',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '大号 tabular-nums 数值指标卡，纯数值自动激活高精度 countUp 数字滚动，支持前后缀、变化幅度 delta 与主题色调。',
    props: [
      { name: 'value', type: 'string', required: true, description: '指标核心数值或符号（如 99.4 或 O(N)）' },
      { name: 'prefix', type: 'string', required: false, description: '数值前缀（如 ¥、+）' },
      { name: 'suffix', type: 'string', required: false, description: '数值后缀单位（如 %、ms）' },
      { name: 'label', type: 'string', required: false, description: '指标名称' },
      { name: 'delta', type: 'string', required: false, description: '右上角变化幅度胶囊（如 +14.2%）' },
      { name: 'subtext', type: 'string', required: false, description: '底部补充解释' },
      {
        name: 'tone',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '数值与图标强调色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'icon',
        type: 'enum',
        required: false,
        defaultValue: 'chart',
        description: '指标图标',
        options: ['chart', 'target', 'sparkles', 'star', 'zap', 'cpu'],
      },
    ],
    recommendedAnimations: ['countUp', 'popIn', 'spotlight'],
    bestPractices: '用 2~3 张不同指标并列放在 ui-split-3 中，只给关键突破指标设 delta 与 spotlight。',
    examples: [
      {
        title: '准确率跃迁卡',
        description: '带趋势徽标与滚动计数',
        code: '<ui-stat value="99.4" suffix="%" label="测试集准确率" delta="+14.2%" subtext="相比基线模型显著收敛" tone="seal" icon="chart"></ui-stat>',
      },
    ],
  },

  'ui-callout': {
    tag: 'ui-callout',
    name: '语义信号提示条',
    category: 'content',
    categoryLabel: '核心内容',
    description: '4px 锋利左刀标识卡，提供 tip / warn / info / danger / insight 五种语义配色与对应矢量图标。',
    props: [
      {
        name: 'type',
        type: 'enum',
        required: false,
        defaultValue: 'tip',
        description: '提示语义类型',
        options: ['tip', 'warn', 'info', 'danger', 'insight'],
      },
      { name: 'title', type: 'string', required: false, description: '提示标题（缺省按类型自动补全）' },
      { name: 'badge', type: 'string', required: false, description: '标题右侧可选胶囊' },
    ],
    slots: [{ name: 'default', description: '提示说明正文' }],
    recommendedAnimations: ['shake', 'riseIn', 'popIn'],
    bestPractices: '讲到易错前提条件时用 type="warn" 配 shake 动效，立刻建立警觉。',
    examples: [
      {
        title: '边界警示条',
        description: '强调定理前提条件',
        code: '<ui-callout type="warn" title="注意前提条件" badge="易错">\n  此处要求分母极限不为 0，否则商的极限法则不成立！\n</ui-callout>',
      },
    ],
  },

  'ui-quote': {
    tag: 'ui-quote',
    name: '大师引言碑文卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '杂志级大号引言排版卡，支持引言正文、学者署名 author、头衔 role 与出处 source。',
    props: [
      { name: 'quote', type: 'string', required: false, description: '引言正文（不传则读子内容）' },
      { name: 'author', type: 'string', required: false, description: '名师或学者姓名' },
      { name: 'role', type: 'string', required: false, description: '作者身份头衔' },
      { name: 'source', type: 'string', required: false, description: '出处书名（自动加书名号）' },
    ],
    recommendedAnimations: ['riseIn', 'blurIn', 'float'],
    bestPractices: '适合放在第 1 幕引出哲学追问，或第 4 幕结尾升华认知格局。',
    examples: [
      {
        title: '费曼金句卡',
        description: '带头衔与出处的引言碑文',
        code: '<ui-quote author="理查德·费曼" role="物理学家" source="费曼物理学讲义">\n  如果你不能用简单的语言把它讲给外行听，说明你还没有真正理解它。\n</ui-quote>',
      },
    ],
  },

  'ui-quiz': {
    tag: 'ui-quiz',
    name: '随堂思辨提问卡',
    category: 'interactive',
    categoryLabel: '交互测验',
    description: '课堂随堂思考卡，仅作结构化展示（与 checkpoint 动作搭配暂停思考，无自动判分回路）。',
    props: [
      { name: 'question', type: 'string', required: true, description: '问题题干文本' },
      { name: 'badge', type: 'string', required: false, defaultValue: '随堂思辨', description: '左上角问题徽标' },
      { name: 'hint', type: 'string', required: false, description: '底部提示语' },
    ],
    slots: [{ name: 'default', description: '包含若干 <ui-option> 子组件' }],
    recommendedAnimations: ['riseIn', 'popIn', 'zoomIn'],
    bestPractices: '配合 checkpoint 动作暂停让学生主动思考，不要设计成「答对才能继续」。',
    examples: [
      {
        title: '极限随堂思辨',
        description: '带提示语的思辨选择题',
        code: '<ui-quiz question="当 x 趋近于 0 时，sin(x)/x 的极限是多少？" hint="提示：利用夹逼定理">\n  <ui-option label="A">0</ui-option>\n  <ui-option label="B" state="focus">1</ui-option>\n  <ui-option label="C">不存在</ui-option>\n</ui-quiz>',
      },
    ],
  },

  'ui-option': {
    tag: 'ui-option',
    name: '思辨选项条目',
    category: 'interactive',
    categoryLabel: '交互测验',
    description: '提问卡 <ui-quiz> 内的键帽风格选项条目，支持聚焦/揭晓状态 state。',
    props: [
      { name: 'label', type: 'string', required: false, defaultValue: 'A', description: '选项字母代号' },
      {
        name: 'state',
        type: 'enum',
        required: false,
        defaultValue: 'default',
        description: '选项视觉状态',
        options: ['default', 'focus', 'correct', 'wrong'],
      },
    ],
    slots: [{ name: 'default', description: '选项文字内容' }],
    recommendedAnimations: ['popIn', 'spotlight'],
    bestPractices: '置于 <ui-quiz> 内；选项文字保持 1 行精简。',
    examples: [
      {
        title: '揭晓选项',
        description: '标为正确视觉状态的选项',
        code: '<ui-option label="B" state="correct">1（重要极限公式）</ui-option>',
      },
    ],
  },

  'ui-badge': {
    tag: 'ui-badge',
    name: '语义胶囊徽标',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '行内胶囊徽标，支持 5 种主题色与 soft / solid / outline 三种填充变体。',
    props: [
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '徽标主题色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'variant',
        type: 'enum',
        required: false,
        defaultValue: 'soft',
        description: '填充风格变体',
        options: ['soft', 'solid', 'outline'],
      },
    ],
    slots: [{ name: 'default', description: '徽标内部文字（2~6 字为宜）' }],
    recommendedAnimations: ['stamp', 'popIn', 'pulse'],
    bestPractices: '用作标题角标或结论定音印章，避免滥用造成画面碎片化。',
    examples: [
      {
        title: '双变体徽标',
        description: '柔和与实心徽标示例',
        code: '<ui-badge color="seal" variant="solid">核心定理</ui-badge>\n<ui-badge color="sky" variant="outline">前置概念</ui-badge>',
      },
    ],
  },

  'ui-split': {
    tag: 'ui-split',
    name: '双栏对称与黄金分割',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '双栏横向网格布局，支持多种不对称美学比例（ratio）与可调栏间距（gap）。',
    props: [
      { name: 'gap', type: 'string', required: false, defaultValue: '44', description: '两栏之间的间距（像素）' },
      {
        name: 'ratio',
        type: 'enum',
        required: false,
        defaultValue: '1:1',
        description: '左右栏宽比例（3:2 或 2:3 适合主次分明的图文布局）',
        options: ['1:1', '3:2', '2:3', '1:2', '2:1'],
      },
    ],
    slots: [{ name: 'default', description: '包含两个直接子元素，分别落入左栏与右栏' }],
    recommendedAnimations: ['slideInLeft', 'slideInRight', 'riseIn'],
    bestPractices: '图文/公式配合解说时用 ratio="3:2" 或 "2:3"，打破千篇一律的 50/50 呆板感。',
    examples: [
      {
        title: '3:2 主次双栏',
        description: '左侧宽幅主图、右侧精炼注解',
        code: '<ui-split gap="44" ratio="3:2">\n  <ui-formula title="泰勒展开" latex="f(x) \\approx f(x_0) + f\'(x_0)(x-x_0)"></ui-formula>\n  <ui-card title="局部线性化" tone="sunken"><p>用切线在邻域内代替曲线</p></ui-card>\n</ui-split>',
      },
    ],
  },

  'ui-split-3': {
    tag: 'ui-split-3',
    name: '三等分栏',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '三栏等分布局栅格（1fr 1fr 1fr），适合并列展示三项指标、三类模型或三步演进。',
    props: [{ name: 'gap', type: 'string', required: false, defaultValue: '32', description: '各栏间距（像素）' }],
    slots: [{ name: 'default', description: '包含三个直接子元素' }],
    recommendedAnimations: ['popIn', 'riseIn', 'slideInBottom'],
    bestPractices: '三栏各自正文控制在 2 行以内，保持视觉水平基线齐整。',
    examples: [
      {
        title: '三栏演进对比',
        description: '三项平行卡片',
        code: '<ui-split-3 gap="32">\n  <ui-card title="初等代数"><p>静态常量关系</p></ui-card>\n  <ui-card title="微积分" tone="seal"><p>动态逼近变化</p></ui-card>\n  <ui-card title="泛函分析"><p>无穷维算子</p></ui-card>\n</ui-split-3>',
      },
    ],
  },

  'ui-grid-2x2': {
    tag: 'ui-grid-2x2',
    name: '2×2 四象限网格',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '两行两列四宫格布局，适合四象限对比、四大特征盘点或分类矩阵。',
    props: [{ name: 'gap', type: 'string', required: false, defaultValue: '32', description: '行列间距（像素）' }],
    slots: [{ name: 'default', description: '包含四个直接子元素' }],
    recommendedAnimations: ['popIn', 'zoomIn', 'riseIn'],
    bestPractices: '四个格子保持字数体量相近，突出其中 1 格设为 tone="seal" 避免平铺直叙。',
    examples: [
      {
        title: '四象限矩阵',
        description: '四宫格结构展示',
        code: '<ui-grid-2x2 gap="28">\n  <ui-card title="象限一" badge="++"><p>高收益高确定</p></ui-card>\n  <ui-card title="象限二" badge="-+"><p>潜在机会区</p></ui-card>\n  <ui-card title="象限三" badge="--"><p>风险警惕区</p></ui-card>\n  <ui-card title="象限四" badge="+-"><p>防御稳健区</p></ui-card>\n</ui-grid-2x2>',
      },
    ],
  },
}

/** 取得指定组件的规范详表，若为外部组件则动态生成适配规范 */
export const BUILTIN_COMPONENT_SPECS: Record<string, ClassroomComponentSpec> = {
  ...BASE_BUILTIN_SPECS,
  ...EXTENDED_COMPONENT_SPECS,
}

export function getComponentSpec(
  tag: string,
  externalDef?: { name: string; description: string; template?: string; example?: string },
): ClassroomComponentSpec {
  if (BUILTIN_COMPONENT_SPECS[tag]) {
    return BUILTIN_COMPONENT_SPECS[tag]
  }

  return {
    tag,
    name: externalDef?.name || tag,
    category: 'custom',
    categoryLabel: '外部自定义',
    description: externalDef?.description || '用户或 Agent 自主动态注册扩展的课堂教学语义组件。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'data-anim', type: 'string', required: false, description: '挂载入场动效' },
      { name: 'data-sfx', type: 'string', required: false, description: '唤醒时触发音效' },
    ],
    recommendedAnimations: ['riseIn', 'popIn', 'zoomIn'],
    bestPractices: '遵循 Web Components 规范命名（以 ui- 或 x- 开头），模板内支持 {{props}} 动态替换。',
    examples: [
      {
        title: '默认调用示例',
        description: '标准注册示例',
        code: externalDef?.example || `<${tag}>自定义组件示例内容</${tag}>`,
      },
    ],
  }
}
