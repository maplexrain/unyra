/**
 * 课堂组件规范契约详表 (componentSpecs.ts)
 * 记录 16 种内置组件及外部自定义组件的属性参数类型、插槽、默认值与推荐动效搭配
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

export const BUILTIN_COMPONENT_SPECS: Record<string, ClassroomComponentSpec> = {
  'ui-card': {
    tag: 'ui-card',
    name: '通用容器卡片',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '标准毛玻璃拟态容器卡片，提供标题组、矢量图标、右上角分类胶囊与正文插槽，适合作为绝大多数教学内容的视觉底座。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符，便于时间轴动作精准寻址定位' },
      { name: 'title', type: 'string', required: false, description: '卡片主标题文字' },
      { name: 'subtitle', type: 'string', required: false, description: '主标题下方的辅助副标题说明' },
      { name: 'badge', type: 'string', required: false, description: '右上角状态标签文字' },
      {
        name: 'badge-color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '右上角标签主题配色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'icon',
        type: 'enum',
        required: false,
        defaultValue: 'bulb',
        description: '卡片左上角内置矢量图标名',
        options: ['sparkles', 'bulb', 'code', 'check', 'star', 'info', 'warn', 'target', 'chart', 'book'],
      },
    ],
    slots: [{ name: 'default', description: '卡片正文主体内容，支持任意文本、段落与行内富文本' }],
    recommendedAnimations: ['popIn', 'zoomIn', 'slideInLeft', 'pulse'],
    bestPractices: '作为独立知识模块的卡片容器，搭配 icon="bulb" 或 "sparkles" 能显著增强视线聚焦；标题尽量言简意赅。',
    examples: [
      {
        title: '基础要点卡片',
        description: '展示核心结论与标签',
        code: '<ui-card id="c1" title="核心结论" badge="重点" badge-color="seal" icon="bulb">\n  <p>极限保号性：若 f(x) 在点 x0 的极限大于零，则在其去心邻域内函数值恒大于零。</p>\n</ui-card>',
      },
      {
        title: '带副标题的知识卡片',
        description: '带有详细副标题说明与渐变强调',
        code: '<ui-card id="c2" title="洛必达法则" subtitle="不定式极限求法" badge="重要公式" badge-color="sky" icon="target">\n  <p>在 0/0 或 ∞/∞ 型未定式中，分子分母分别求导后极限不变。</p>\n</ui-card>',
      },
    ],
  },

  'ui-concept': {
    tag: 'ui-concept',
    name: '核心概念提炼卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '核心概念与术语提炼卡，包含醒目的术语大字、右上角胶囊、详细概念定义及带主题色高亮条的「核心要点」横幅。',
    props: [
      { name: 'term', type: 'string', required: true, description: '核心概念或术语名称（大字突出显示）' },
      { name: 'tag', type: 'string', required: false, description: '右上角概念分类标签（如：高等数学、定理、物理学）' },
      { name: 'definition', type: 'string', required: false, description: '概念标准定义文本（若不传则读取标签内主体文本）' },
      { name: 'keypoint', type: 'string', required: false, description: '底部核心要点高亮横幅文本' },
    ],
    recommendedAnimations: ['zoomIn', 'popIn', 'glow', 'slideInLeft'],
    bestPractices: '每堂课引出首个重难点定义时优先使用；keypoint 适合写一句话记忆口诀或易错总结。',
    examples: [
      {
        title: '夹逼定理定义卡',
        description: '经典的数理概念提炼',
        code: '<ui-concept term="夹逼定理" tag="重要定理" keypoint="两端极限相等，中间夹逼必收敛">\n  若在 x0 附近有 f(x) ≤ g(x) ≤ h(x)，且两侧函数极限同为 L，则中间函数 g(x) 的极限亦必为 L。\n</ui-concept>',
      },
    ],
  },

  'ui-formula': {
    tag: 'ui-formula',
    name: '数理公式显要卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '数理公式专用居中展示卡，自动调用内置 KaTeX 引擎将 LaTeX 代码编译为高质量矢量数学符号排版。',
    props: [
      { name: 'latex', type: 'string', required: true, description: 'LaTeX 格式数学公式代码（无需手写 $$ 定界符）' },
      { name: 'title', type: 'string', required: false, description: '公式名或定理标题（如：欧拉恒等式）' },
      { name: 'desc', type: 'string', required: false, description: '公式下方的几何意义或参数补充说明' },
    ],
    recommendedAnimations: ['zoomIn', 'popIn', 'pulse', 'glow'],
    bestPractices: '输入 latex 字符串时反斜杠写成标准 LaTeX 语法（例如 \\int, \\frac{a}{b}），系统会自动精准渲染。',
    examples: [
      {
        title: '欧拉恒等式',
        description: '数学物理经典公式',
        code: '<ui-formula latex="e^{i\\pi} + 1 = 0" title="欧拉恒等式" desc="将自然常数、虚数单位、圆周率与基础整数完美统一"></ui-formula>',
      },
      {
        title: '重要极限',
        description: '极限计算基础公式',
        code: '<ui-formula latex="\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1" title="第一重要极限" desc="三角函数求导与极限推导的核心基石"></ui-formula>',
      },
    ],
  },

  'ui-code': {
    tag: 'ui-code',
    name: '代码与算法卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '深色终端风格代码展示卡，自带 macOS 红黄绿窗口控制三点、语言胶囊标识及等宽字体排版。',
    props: [
      { name: 'lang', type: 'string', required: false, defaultValue: 'code', description: '编程语言类型（如：python, js, c++, rust）' },
      { name: 'title', type: 'string', required: false, description: '顶部窗口标题（缺省时自动显示大写语言名）' },
    ],
    slots: [{ name: 'default', description: '代码原文文本，保留换行与缩进' }],
    recommendedAnimations: ['slideInBottom', 'zoomIn', 'popIn'],
    bestPractices: '适合演示算法实现、伪代码或核心 API 签名，内容保持在 10 行以内最佳。',
    examples: [
      {
        title: 'Python 梯度下降',
        description: '机器学习核心迭代步',
        code: '<ui-code lang="python" title="梯度下降核心迭代">\n# 沿负梯度方向更新权重\nw = w - learning_rate * grad\nloss = compute_loss(w, x, y)\n</ui-code>',
      },
    ],
  },

  'ui-compare': {
    tag: 'ui-compare',
    name: '二元正误/对照卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '双栏对照分析卡片，左右对称排布，中间带有环形 VS 标识。常用于方案优劣对比、常见误区 vs 正确解法。',
    props: [
      { name: 'left-title', type: 'string', required: false, defaultValue: '方案 A', description: '左栏标题' },
      { name: 'left-badge', type: 'string', required: false, description: '左栏角标（如：常见误区、传统做法）' },
      { name: 'right-title', type: 'string', required: false, defaultValue: '方案 B', description: '右栏标题' },
      { name: 'right-badge', type: 'string', required: false, description: '右栏角标（如：正确解法、现代优化）' },
      { name: 'vs', type: 'string', required: false, defaultValue: 'VS', description: '中缝分隔徽标文字' },
    ],
    slots: [
      { name: 'left', description: 'slot="left" 槽位放置左侧内容' },
      { name: 'right', description: 'slot="right" 槽位放置右侧内容' },
    ],
    recommendedAnimations: ['slideInLeft', 'slideInRight', 'popIn'],
    bestPractices: '使用 <div slot="left"> 和 <div slot="right"> 明确划分两栏内容，左右内容高度尽量平衡。',
    examples: [
      {
        title: '解法对照',
        description: '典型误区与正确认知对比',
        code: '<ui-compare left-title="常见误区" left-badge="易错" right-title="正确解法" right-badge="规范">\n  <div slot="left">分母为 0 直接代入得 0</div>\n  <div slot="right">先因式分解约去零因子，再求极限</div>\n</ui-compare>',
      },
    ],
  },

  'ui-steps': {
    tag: 'ui-steps',
    name: '步骤流程指示卡',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '步骤流纵向容器，带有流程总标题，配合子项 <ui-step> 清晰呈现解题步骤或算法操作路线。',
    props: [{ name: 'title', type: 'string', required: false, description: '流程大标题' }],
    slots: [{ name: 'default', description: '包含一个或多个 <ui-step> 子组件' }],
    recommendedAnimations: ['slideInLeft', 'zoomIn', 'popIn'],
    bestPractices: '每个流程建议包含 2~4 个步骤，每一步搭配清晰的数字序号与核心动作。',
    examples: [
      {
        title: '三步解极限',
        description: '典型的解题方法指引',
        code: '<ui-steps title="极限计算三步法">\n  <ui-step num="1" title="判断型别">代入观察是否为 0/0 或 ∞/∞ 不定式</ui-step>\n  <ui-step num="2" title="化简变形">利用等价无穷小代换或有理化消去零点</ui-step>\n  <ui-step num="3" title="代入求值">将极限值直接代入得到最终确定解</ui-step>\n</ui-steps>',
      },
    ],
  },

  'ui-step': {
    tag: 'ui-step',
    name: '单步流程项',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '步骤流程指示卡 <ui-steps> 的子项，包含圆形序号徽章、步骤标题与说明正文。',
    props: [
      { name: 'num', type: 'string', required: false, defaultValue: '1', description: '数字序号或字母标识' },
      { name: 'title', type: 'string', required: false, description: '单步操作名称' },
    ],
    slots: [{ name: 'default', description: '步骤描述文本' }],
    recommendedAnimations: ['popIn', 'slideInLeft'],
    bestPractices: '必须置于 <ui-steps> 容器内使用，保持 num 连续递增。',
    examples: [
      {
        title: '单步示例',
        description: '单一步骤条目',
        code: '<ui-step num="2" title="分子有理化">分子分母同时乘共轭式消去根号因子</ui-step>',
      },
    ],
  },

  'ui-stat': {
    tag: 'ui-stat',
    name: '数据统计指示卡',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '核心指标卡，支持自动 countUp 数字递增动画、单位后缀、趋势说明及主题图标。',
    props: [
      { name: 'value', type: 'string', required: true, description: '指标核心数值（纯数字自动激活滚动动画）' },
      { name: 'suffix', type: 'string', required: false, description: '数值后缀单位（如：%, ms, GB, 次）' },
      { name: 'label', type: 'string', required: false, description: '指标名称描述' },
      { name: 'subtext', type: 'string', required: false, description: '底部补充说明或对比增幅' },
      {
        name: 'icon',
        type: 'enum',
        required: false,
        defaultValue: 'chart',
        description: '图标标识',
        options: ['chart', 'target', 'sparkles', 'star'],
      },
    ],
    recommendedAnimations: ['countUp', 'popIn', 'bounce', 'glow'],
    bestPractices: '适合实验数据、模型评估结果或性能提升对比，让课堂更具说服力。',
    examples: [
      {
        title: '准确率指标',
        description: '带滚动动效与增幅说明',
        code: '<ui-stat value="99.4" suffix="%" label="测试集准确率" subtext="相比基线模型提升 14.2 个百分点" icon="chart"></ui-stat>',
      },
    ],
  },

  'ui-callout': {
    tag: 'ui-callout',
    name: '强调避坑提示卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '重点提醒与避坑警示卡片，按类型自带专用语义图标与警示强调色。',
    props: [
      {
        name: 'type',
        type: 'enum',
        required: false,
        defaultValue: 'tip',
        description: '提示类型，对应不同颜色与图标',
        options: ['tip', 'warn', 'info', 'danger'],
      },
      { name: 'title', type: 'string', required: false, description: '提示卡标题（缺省时自动根据 type 生成）' },
    ],
    slots: [{ name: 'default', description: '提示具体说明文本' }],
    recommendedAnimations: ['shake', 'popIn', 'pulse'],
    bestPractices: '指出常见做题易错点或定理成立前提条件时使用，极易引发学员重视。',
    examples: [
      {
        title: '警告提示',
        description: '避坑高能提醒',
        code: '<ui-callout type="warn" title="注意前提条件">\n  此处要求分母极限不为 0，否则商的极限法则不适用，需改用其他方法！\n</ui-callout>',
      },
    ],
  },

  'ui-quote': {
    tag: 'ui-quote',
    name: '名师引言与金句卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '名师引言与学术金句展示卡，自带大号晶体引号、加粗引言正文及学者出处署名。',
    props: [
      { name: 'quote', type: 'string', required: false, description: '引言正文（若不传则读取标签内主体文本）' },
      { name: 'author', type: 'string', required: false, description: '名师或学者姓名' },
      { name: 'source', type: 'string', required: false, description: '出处书名或讲义名（自动加《》）' },
    ],
    recommendedAnimations: ['zoomIn', 'float', 'popIn'],
    bestPractices: '常用于课程开头引入思考或课程结尾升华主旨。',
    examples: [
      {
        title: '费曼金句',
        description: '大师教学启迪',
        code: '<ui-quote author="理查德·费曼" source="费曼物理学讲义">\n  如果你不能用简单的语言向外行解释清楚一个概念，说明你还没有真正理解它。\n</ui-quote>',
      },
    ],
  },

  'ui-quiz': {
    tag: 'ui-quiz',
    name: '思考与测验卡',
    category: 'interactive',
    categoryLabel: '交互测验',
    description: '课堂随堂思考卡片，包含醒目的「随堂思考」徽标、问题题干及若干 <ui-option> 选项。',
    props: [{ name: 'question', type: 'string', required: true, description: '随堂问题题干文本' }],
    slots: [{ name: 'default', description: '包含若干个 <ui-option> 选项组件' }],
    recommendedAnimations: ['popIn', 'zoomIn', 'wobble'],
    bestPractices: '纯视觉卡片，搭配课程 DSL 里的 checkpoint 动作即可暂停等待学员思考互动。',
    examples: [
      {
        title: '随堂选择题',
        description: '单选题思考题',
        code: '<ui-quiz question="当 x 趋近于 0 时，sin(x)/x 的极限是多少？">\n  <ui-option label="A">0</ui-option>\n  <ui-option label="B">1</ui-option>\n  <ui-option label="C">不存在</ui-option>\n</ui-quiz>',
      },
    ],
  },

  'ui-option': {
    tag: 'ui-option',
    name: '测验选项条目',
    category: 'interactive',
    categoryLabel: '交互测验',
    description: '随堂思考卡 <ui-quiz> 的子项，展示选项代号（A/B/C/D）与选项答案文本。',
    props: [{ name: 'label', type: 'string', required: false, defaultValue: 'A', description: '选项代号字母' }],
    slots: [{ name: 'default', description: '选项文字内容' }],
    recommendedAnimations: ['popIn', 'bounce'],
    bestPractices: '置于 <ui-quiz> 内使用，选项文字保持简练。',
    examples: [
      {
        title: '选项示例',
        description: '单个选项项',
        code: '<ui-option label="B">1（重要极限公式）</ui-option>',
      },
    ],
  },

  'ui-badge': {
    tag: 'ui-badge',
    name: '概念分类标签',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '轻量行内胶囊徽章，支持 5 种主题色，用于在标题或段落旁标注文档分类或重要级别。',
    props: [
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '胶囊徽章主题色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    slots: [{ name: 'default', description: '徽章内部文本' }],
    recommendedAnimations: ['popIn', 'pulse', 'glow'],
    bestPractices: '可嵌入任何文本或卡片中，避免文字过长（2~6 字为宜）。',
    examples: [
      {
        title: '徽章标签',
        description: '主题胶囊标签',
        code: '<ui-badge color="seal">考研常考</ui-badge>\n<ui-badge color="sky">基础必备</ui-badge>',
      },
    ],
  },

  'ui-split': {
    tag: 'ui-split',
    name: '左右双栏分立',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '等宽双栏布局栅格（1fr 1fr），自动将两直接子元素并排分立，间距可调。',
    props: [{ name: 'gap', type: 'string', required: false, defaultValue: '48', description: '两栏之间的间距（像素值）' }],
    slots: [{ name: 'default', description: '恰好包含两个直接子元素，分别落入左栏与右栏' }],
    recommendedAnimations: ['slideInLeft', 'slideInRight', 'zoomIn'],
    bestPractices: '双栏适合「图文对照」、「推导与结论并列」等横向宽屏画面。',
    examples: [
      {
        title: '双栏分立布局',
        description: '左右内容对称并排',
        code: '<ui-split gap="48">\n  <ui-card title="左侧几何直观"><p>切线斜率随着割线逼近</p></ui-card>\n  <ui-card title="右侧代数形式"><p>导数等于增量比的极限</p></ui-card>\n</ui-split>',
      },
    ],
  },

  'ui-split-3': {
    tag: 'ui-split-3',
    name: '三等分栏',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '三栏等分布局栅格（1fr 1fr 1fr），适合并列展示三个平级知识点或三阶段演进。',
    props: [{ name: 'gap', type: 'string', required: false, defaultValue: '36', description: '各栏之间的间距（像素值）' }],
    slots: [{ name: 'default', description: '包含三个直接子元素，依次落入三栏' }],
    recommendedAnimations: ['popIn', 'zoomIn', 'slideInLeft'],
    bestPractices: '三个子项高度尽量保持一致，避免参差不齐。',
    examples: [
      {
        title: '三栏并排',
        description: '三项平行展示',
        code: '<ui-split-3 gap="36">\n  <ui-card title="初等数学"><p>几何直观</p></ui-card>\n  <ui-card title="微积分"><p>动态极限</p></ui-card>\n  <ui-card title="泛函分析"><p>无穷维拓扑</p></ui-card>\n</ui-split-3>',
      },
    ],
  },

  'ui-grid-2x2': {
    tag: 'ui-grid-2x2',
    name: '2×2 网格',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '两行两列四宫格布局，适合矩阵分类、四象限分析或四大核心特征盘点。',
    props: [{ name: 'gap', type: 'string', required: false, defaultValue: '36', description: '网格行列间距（像素值）' }],
    slots: [{ name: 'default', description: '包含四个直接子元素，按行序填入四宫格' }],
    recommendedAnimations: ['popIn', 'zoomIn', 'bounce'],
    bestPractices: '四格内容平衡对称，可以分别结合不同 icon 与 badge 丰富画面视觉。',
    examples: [
      {
        title: '四宫格矩阵',
        description: '四象限内容呈现',
        code: '<ui-grid-2x2 gap="36">\n  <ui-card title="第一象限" badge="++"><p>正向收益</p></ui-card>\n  <ui-card title="第二象限" badge="-+"><p>潜在机会</p></ui-card>\n  <ui-card title="第三象限" badge="--"><p>风险警惕</p></ui-card>\n  <ui-card title="第四象限" badge="+-"><p>战略防守</p></ui-card>\n</ui-grid-2x2>',
      },
    ],
  },
}

/** 取得指定组件的规范详表，若为外部组件则动态生成适配规范 */
export function getComponentSpec(tag: string, externalDef?: { name: string; description: string; template?: string; example?: string }): ClassroomComponentSpec {
  if (BUILTIN_COMPONENT_SPECS[tag]) {
    return BUILTIN_COMPONENT_SPECS[tag]
  }

  // 外部动态注册组件生成兜底规范
  return {
    tag,
    name: externalDef?.name || tag,
    category: 'custom',
    categoryLabel: '外部自定义',
    description: externalDef?.description || '用户或 Agent 自主动态注册扩展的课堂教学语义组件。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'data-anim', type: 'string', required: false, description: '入场动效动词' },
    ],
    recommendedAnimations: ['popIn', 'zoomIn', 'pulse'],
    bestPractices: '遵循 Web Components 规范命名（以 ui- 或 x- 开头），内部模板支持 {{props}} 动态替换。',
    examples: [
      {
        title: '默认调用示例',
        description: '标准注册示例',
        code: externalDef?.example || `<${tag}>自定义组件示例内容</${tag}>`,
      },
    ],
  }
}
