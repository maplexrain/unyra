import type { ClassroomComponentSpec } from './componentSpecs'

export const EXTENDED_COMPONENT_SPECS: Record<string, ClassroomComponentSpec> = {
  'ui-banner': {
    tag: 'ui-banner',
    name: '章节序幕横幅',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '全宽章节开篇或总结幕横幅，内置柔光晕 backdrop 与眉标/徽标组合，可切换居中或左对齐。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: true, description: '横幅主标题' },
      { name: 'subtitle', type: 'string', required: false, description: '辅助副标题说明' },
      { name: 'eyebrow', type: 'string', required: false, description: '顶部全大写英文/章节编号眉标' },
      { name: 'badge', type: 'string', required: false, description: '徽标文字' },
      {
        name: 'badge-color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '徽标配色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'tone',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '氛围光晕色调',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'align',
        type: 'enum',
        required: false,
        defaultValue: 'center',
        description: '对齐排版方式',
        options: ['center', 'left'],
      },
    ],
    recommendedAnimations: ['riseIn', 'blurIn', 'slideInTop'],
    bestPractices: '作为第 1 幕序幕或章节转折幕的视觉重心，配合 swell 音效营造仪式感。',
    examples: [
      {
        title: '章节序幕横幅',
        description: '带眉标与徽标的居中横幅',
        code: '<ui-banner eyebrow="CHAPTER 03 · 微分中值" title="罗尔定理与拉格朗日中值定理" subtitle="连接局部瞬时斜率与全局平均变化率" badge="核心定理" badge-color="seal"></ui-banner>',
      },
    ],
  },

  'ui-pipeline': {
    tag: 'ui-pipeline',
    name: '因果机制流水线',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '因果流与系统管线容器（自动在节点间绘制方向箭头，子节点带 data-hidden 时箭头随节点同步现身）。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '流水线标题' },
      { name: 'subtitle', type: 'string', required: false, description: '副标题说明' },
      {
        name: 'direction',
        type: 'enum',
        required: false,
        defaultValue: 'row',
        description: '流向排布方向',
        options: ['row', 'column'],
      },
    ],
    slots: [{ name: 'default', description: '包含 2~4 个 <ui-node> 子节点' }],
    recommendedAnimations: ['riseIn', 'slideInLeft', 'unfold'],
    bestPractices: '讲「A 导致 B 导致 C」或编译/信号/算法管线时优先使用，配合 tick 音效逐个点亮节点。',
    examples: [
      {
        title: '编译前端三阶段',
        description: '带聚焦态节点的横向流水线',
        code: '<ui-pipeline title="编译器前端流水线" direction="row">\n  <ui-node id="n1" step="01" title="词法分析" icon="code">切分 Token 序列</ui-node>\n  <ui-node id="n2" step="02" title="语法树 AST" tone="seal" badge="焦点" icon="layers">构建抽象语法树</ui-node>\n  <ui-node id="n3" step="03" title="语义校验" tone="ok" icon="check">类型推导与绑定</ui-node>\n</ui-pipeline>',
      },
    ],
  },

  'ui-node': {
    tag: 'ui-node',
    name: '流水线机制节点',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '因果流水线 <ui-pipeline> 内的单步机制节点，自带阶段编号、矢量图标、状态色调与徽标。',
    props: [
      { name: 'step', type: 'string', required: false, description: '阶段编号（如 01、STAGE 1）' },
      { name: 'title', type: 'string', required: false, description: '节点名称' },
      { name: 'badge', type: 'string', required: false, description: '角标文字' },
      {
        name: 'tone',
        type: 'enum',
        required: false,
        defaultValue: 'default',
        description: '节点强调色调',
        options: ['default', 'seal', 'sky', 'ok', 'warn', 'purple'],
      },
      {
        name: 'icon',
        type: 'enum',
        required: false,
        description: '节点图标名',
        options: ['code', 'layers', 'zap', 'check', 'cpu', 'target', 'sparkles', 'atom'],
      },
    ],
    slots: [{ name: 'default', description: '节点内部精简说明' }],
    recommendedAnimations: ['popIn', 'spotlight', 'ripple'],
    bestPractices: '置于 <ui-pipeline> 内，单个节点正文控制在 15 字以内。',
    examples: [
      {
        title: '高光机制节点',
        description: '带编号与图标的机制节点',
        code: '<ui-node step="02" title="注意力加权" tone="seal" badge="关键" icon="zap">根据相似权重聚合上下文特征</ui-node>',
      },
    ],
  },

  'ui-diagram': {
    tag: 'ui-diagram',
    name: '蓝图插画视窗框',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '专为内联 <svg> 几何图形、物理示意图或结构框图打造的博物馆级画框，提供点阵/网格底纹与图题图注。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'eyebrow', type: 'string', required: false, description: '顶部英文/分类眉标' },
      { name: 'title', type: 'string', required: false, description: '图标题' },
      { name: 'caption', type: 'string', required: false, description: '底部图注说明' },
      {
        name: 'grid',
        type: 'enum',
        required: false,
        defaultValue: 'dots',
        description: '画框背景辅助底纹',
        options: ['dots', 'lines', 'none'],
      },
      {
        name: 'tone',
        type: 'enum',
        required: false,
        defaultValue: 'default',
        description: '外框顶边强调色',
        options: ['default', 'seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    slots: [{ name: 'default', description: '内联 <svg> 图形或直观示意图' }],
    recommendedAnimations: ['blurIn', 'riseIn', 'zoomIn'],
    bestPractices: 'SVG 内线条颜色用 currentColor 或 var(--accent-primary)，在浅纸与深墨主题下皆可清晰阅读；关键路径可配 drawSvg 描边动画。',
    examples: [
      {
        title: '几何逼近示意图',
        description: '点阵底纹与 SVG 矢量图联动',
        code: '<ui-diagram eyebrow="GEOMETRIC INTUITION" title="圆内接正多边形逼近圆周" caption="边数翻倍时，周长趋近 2πr" grid="dots">\n  <svg viewBox="0 0 360 180" class="w-full max-w-[360px] h-auto" fill="none" stroke="currentColor" stroke-width="2"><circle cx="180" cy="90" r="64" opacity="0.35"/><polygon points="180,26 235,58 235,122 180,154 125,122 125,58" stroke="var(--accent-primary)" stroke-width="2.5"/></svg>\n</ui-diagram>',
      },
    ],
  },

  'ui-breakdown': {
    tag: 'ui-breakdown',
    name: '分段比例构成条',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '紧凑的多段式比例拆解组件，自动根据各分段数值计算占比宽度并生成圆点图例。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '构成标题' },
      { name: 'subtitle', type: 'string', required: false, description: '副标题说明' },
      { name: 'total', type: 'string', required: false, description: '右上角总量文本' },
      {
        name: 'items',
        type: 'string',
        required: true,
        description: '逗号分隔的 名称:数值:颜色 三元组（颜色可选 seal|sky|ok|warn|purple）',
      },
    ],
    recommendedAnimations: ['unfold', 'riseIn', 'shimmer'],
    bestPractices: '2~4 个分段最佳；用 seal 给占比最大或最关键的一项，其余用 sky / ok 区分。',
    examples: [
      {
        title: '显存占用分布',
        description: '三段式比例构成条',
        code: '<ui-breakdown title="训练显存占用构成" total="总计 100%" items="优化器状态:55:seal, 激活值缓存:25:sky, 模型权重:20:ok"></ui-breakdown>',
      },
    ],
  },

  'ui-timeline': {
    tag: 'ui-timeline',
    name: '演进脉络时间轴',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '纵向发展里程碑容器，配合 <ui-timeline-item> 呈现历史脉络、版本演进或推导顺序。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '时间轴标题' },
      { name: 'subtitle', type: 'string', required: false, description: '副标题说明' },
    ],
    slots: [{ name: 'default', description: '包含 2~4 个 <ui-timeline-item> 子项' }],
    recommendedAnimations: ['slideInLeft', 'unfold', 'riseIn'],
    bestPractices: '每个节点用 time 写简洁年代或阶段标签，配 badge 注明代表人物或里程碑关键词。',
    examples: [
      {
        title: '微积分思想演进',
        description: '三节点历史演进脉络',
        code: '<ui-timeline title="微积分演进脉络">\n  <ui-timeline-item time="1666" title="流数术" badge="牛顿" color="sky">运动学瞬时速度视角</ui-timeline-item>\n  <ui-timeline-item time="1684" title="微分符号" badge="莱布尼茨" color="seal">确立 dy/dx 与 ∫ 记号</ui-timeline-item>\n  <ui-timeline-item time="1821" title="ε-δ 严格化" badge="柯西" color="ok">极限严格分析学定义</ui-timeline-item>\n</ui-timeline>',
      },
    ],
  },

  'ui-timeline-item': {
    tag: 'ui-timeline-item',
    name: '时间轴里程碑项',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '时间轴单条节点，包含等宽时间标、节点标题、颜色语义徽标与详细说明。',
    props: [
      { name: 'time', type: 'string', required: true, description: '时间点或阶段文字' },
      { name: 'title', type: 'string', required: true, description: '节点标题' },
      { name: 'badge', type: 'string', required: false, description: '徽标文字' },
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '节点与徽标主题色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    slots: [{ name: 'default', description: '节点说明文本' }],
    recommendedAnimations: ['slideInLeft', 'popIn'],
    bestPractices: '置于 <ui-timeline> 内使用，节点之间尽量按时间升序排列。',
    examples: [
      {
        title: '单节点示例',
        description: '带徽标与主题色的节点',
        code: '<ui-timeline-item time="1684" title="微分符号体系" badge="莱布尼茨" color="seal">确立现代通用的 dy/dx 记号与积分号 ∫</ui-timeline-item>',
      },
    ],
  },

  'ui-progress': {
    tag: 'ui-progress',
    name: '定量进度指示条',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '带语义主题色与发光填充的量化进度条，支持 value、max、label、desc 与 color。',
    props: [
      { name: 'value', type: 'number', required: true, defaultValue: '0', description: '当前数值' },
      { name: 'max', type: 'number', required: false, defaultValue: '100', description: '上限数值（默认 100）' },
      { name: 'label', type: 'string', required: false, description: '左侧标签名称' },
      { name: 'desc', type: 'string', required: false, description: '底部补充说明' },
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'seal',
        description: '进度条填充配色',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    recommendedAnimations: ['riseIn', 'shimmer', 'spotlight'],
    bestPractices: '适合展示模型收敛度、风险阈值占比或学习完成进度，desc 一句话点明百分比背后的意义。',
    examples: [
      {
        title: '训练收敛度',
        description: '带底部说明的进度条',
        code: '<ui-progress value="84" max="100" label="Epoch 84/100 训练收敛度" desc="验证损失已稳定在阈值下方" color="ok"></ui-progress>',
      },
    ],
  },

  'ui-dialogue': {
    tag: 'ui-dialogue',
    name: '苏格拉底问答剧场',
    category: 'interactive',
    categoryLabel: '交互测验',
    description: '师生启发式问答对话流容器，左右错落呈现困惑与点拨。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '对话辩题标题' },
    ],
    slots: [{ name: 'default', description: '包含若干 <ui-speech> 子组件' }],
    recommendedAnimations: ['riseIn', 'unfold'],
    bestPractices: '以学生的一个直觉误区发问开场，再用导师的一句话点破迷津。',
    examples: [
      {
        title: '师生辨析问答',
        description: '关于连续与可导的对话',
        code: '<ui-dialogue title="为什么连续不一定可导？">\n  <ui-speech role="student" name="探索者">图像一笔画不断开，不就处处光滑吗？</ui-speech>\n  <ui-speech role="teacher" name="导师">折纸的折痕也没断开，但尖点处左右斜率突然跳变了！</ui-speech>\n</ui-dialogue>',
      },
    ],
  },

  'ui-speech': {
    tag: 'ui-speech',
    name: '对话角色气泡',
    category: 'interactive',
    categoryLabel: '交互测验',
    description: '苏格拉底对话流中的单个发言气泡，自动区分教师/探索者排版朝向与徽章头像。',
    props: [
      {
        name: 'role',
        type: 'enum',
        required: false,
        defaultValue: 'teacher',
        description: '发言者角色',
        options: ['teacher', 'student'],
      },
      { name: 'name', type: 'string', required: false, description: '称谓名称' },
      { name: 'avatar', type: 'string', required: false, description: '单字头像文字覆盖' },
    ],
    slots: [{ name: 'default', description: '发言内容' }],
    recommendedAnimations: ['slideInLeft', 'slideInRight', 'popIn'],
    bestPractices: '每条气泡保持 1~2 句简练口语，给每个 <ui-speech> 配独立 id 可逐轮出场。',
    examples: [
      {
        title: '导师点拨气泡',
        description: '教师视角回复',
        code: '<ui-speech role="teacher" name="导师">把放大镜凑近折尖，它永远不会拉直成切线。</ui-speech>',
      },
    ],
  },

  'ui-table': {
    tag: 'ui-table',
    name: '精密数据对照表',
    category: 'content',
    categoryLabel: '核心内容',
    description: '带等宽数值对齐的编辑级数据对照表，支持表题、逗号分隔表头与底部注释 caption。',
    props: [
      { name: 'title', type: 'string', required: false, description: '表格主标题' },
      { name: 'headers', type: 'string', required: false, description: '逗号分隔的列名字符串' },
      { name: 'caption', type: 'string', required: false, description: '表格底部注释' },
    ],
    slots: [{ name: 'default', description: '原生 <tr><td>...</td></tr> 行内容' }],
    recommendedAnimations: ['riseIn', 'unfold', 'blurIn'],
    bestPractices: '列数 2~4 列、行数 3~4 行在 1080p 课堂画布上阅读体验最舒服。',
    examples: [
      {
        title: '排序算法对比',
        description: '简洁明了的复杂度对照表',
        code: '<ui-table title="常用排序算法对照" headers="算法,平均时间,空间开销,稳定性">\n  <tr><td>快速排序</td><td>O(n log n)</td><td>O(log n)</td><td>不稳定</td></tr>\n  <tr><td>归并排序</td><td>O(n log n)</td><td>O(n)</td><td>稳定</td></tr>\n</ui-table>',
      },
    ],
  },

  'ui-keyboard': {
    tag: 'ui-keyboard',
    name: '机械键帽快捷键卡',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '带立体底座阴影的键帽快捷键卡片，兼容 + 或 , 分隔组合键，展示操作名与说明。',
    props: [
      { name: 'keys', type: 'string', required: true, description: '按键组合（以 + 或 , 隔开）' },
      { name: 'action', type: 'string', required: false, description: '触发的操作名称' },
      { name: 'desc', type: 'string', required: false, description: '补充功能说明' },
    ],
    recommendedAnimations: ['popIn', 'jello', 'spotlight'],
    bestPractices: '适合编程、快捷键或工作流效率演示，搭配 tap 音效手感绝佳。',
    examples: [
      {
        title: '命令面板快捷键',
        description: '组合键与动作说明',
        code: '<ui-keyboard keys="Ctrl + Shift + P" action="唤出全局指令面板" desc="瞬时检索全部功能"></ui-keyboard>',
      },
    ],
  },

  'ui-highlight': {
    tag: 'ui-highlight',
    name: '双色适配荧光笔触',
    category: 'visual',
    categoryLabel: '数据视觉',
    description: '行内荧光笔触高亮标签，兼顾浅纸与深墨背景的超高文字对比度。',
    props: [
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'yellow',
        description: '荧光底色（支持标准色与语义色）',
        options: ['yellow', 'pink', 'cyan', 'green', 'seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    slots: [{ name: 'default', description: '需高亮强调的核心词组' }],
    recommendedAnimations: ['pulse', 'shimmer', 'glow'],
    bestPractices: '一句正文里只高亮 1~2 个关键词眼，不要整段全涂。',
    examples: [
      {
        title: '关键词荧光标记',
        description: '句子内的主题色高光',
        code: '<p>一阶导数为零只是极值存在的<ui-highlight color="seal">必要非充分条件</ui-highlight>。</p>',
      },
    ],
  },

  'ui-accordion': {
    tag: 'ui-accordion',
    name: '层叠问答解析卡',
    category: 'content',
    categoryLabel: '核心内容',
    description: '层叠式问答与疑难剖析容器，保持课堂视觉整洁有序。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '问答组标题' },
    ],
    slots: [{ name: 'default', description: '包含 2~3 个 <ui-accordion-item> 子项' }],
    recommendedAnimations: ['unfold', 'riseIn'],
    bestPractices: '适合汇总本课 2~3 个高频疑难解答。',
    examples: [
      {
        title: '疑难辨析组',
        description: '双条展开解析',
        code: '<ui-accordion title="疑难解析">\n  <ui-accordion-item title="为什么 0/0 不能直接写 0？" tag="重点" open="true">0/0 是未定式，实际取决于趋零速率比。</ui-accordion-item>\n  <ui-accordion-item title="无穷大是一个定值吗？" tag="辨析">不是，它代表无界增大的动态趋势。</ui-accordion-item>\n</ui-accordion>',
      },
    ],
  },

  'ui-accordion-item': {
    tag: 'ui-accordion-item',
    name: '层叠解析条目',
    category: 'content',
    categoryLabel: '核心内容',
    description: '问答解析组单项，支持题目、角标 tag 与是否展开 open。',
    props: [
      { name: 'title', type: 'string', required: true, description: '问题或条目名称' },
      { name: 'tag', type: 'string', required: false, description: '右侧分类徽标' },
      { name: 'open', type: 'boolean', required: false, defaultValue: 'true', description: '是否展开显示正文' },
    ],
    slots: [{ name: 'default', description: '展开的正文内容' }],
    recommendedAnimations: ['unfold', 'slideInBottom'],
    bestPractices: '需要隐藏某项正文只露标题时可传 open="false"。',
    examples: [
      {
        title: '单条解析项',
        description: '带徽标与展开内容的问答项',
        code: '<ui-accordion-item title="为什么需要 ε-δ 语言？" tag="本质" open="true">因为自然语言中的“无限接近”无法支撑严格演绎证明。</ui-accordion-item>',
      },
    ],
  },
}
