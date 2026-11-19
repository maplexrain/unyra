import type { ClassroomComponentSpec } from './componentSpecs'

export const EXTENDED_COMPONENT_SPECS: Record<string, ClassroomComponentSpec> = {
  'ui-timeline': {
    tag: 'ui-timeline',
    name: '时间线与演进流',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '垂直时间轴流式容器，自带左侧发光轨道线与节点圆环，适合呈现历史事件脉络、算法迭代步骤或项目里程碑。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '时间线总标题' },
    ],
    slots: [{ name: 'default', description: '包含若干个 <ui-timeline-item> 子项' }],
    recommendedAnimations: ['slideInLeft', 'popIn', 'zoomIn'],
    bestPractices: '每个节点代表一个关键时间点，配合 ui-timeline-item 的 time 与 title 属性清晰表达阶段。',
    examples: [
      {
        title: '基础时间线',
        description: '技术发展历史脉络',
        code: '<ui-timeline title="人工智能演进史">\n  <ui-timeline-item time="1956" title="达特茅斯会议">人工智能概念诞生</ui-timeline-item>\n  <ui-timeline-item time="2012" title="AlexNet 突破">深度学习迎来爆发</ui-timeline-item>\n  <ui-timeline-item time="2022" title="ChatGPT 问世">大语言模型引领通用智能</ui-timeline-item>\n</ui-timeline>',
      },
    ],
  },

  'ui-timeline-item': {
    tag: 'ui-timeline-item',
    name: '时间线节点项',
    category: 'layout',
    categoryLabel: '布局容器',
    description: '时间轴的单个节点，显示时间徽标、阶段标题与详细描述。',
    props: [
      { name: 'time', type: 'string', required: true, description: '时间节点文字，例如 2026、Step 1 或阶段名称' },
      { name: 'title', type: 'string', required: true, description: '节点主标题' },
    ],
    slots: [{ name: 'default', description: '节点说明正文内容' }],
    recommendedAnimations: ['slideInLeft', 'popIn'],
    bestPractices: '时间建议精简，正文说明突出该节点的核心突破或关键产出。',
    examples: [
      {
        title: '单节点示例',
        description: '单条里程碑记录',
        code: '<ui-timeline-item time="2026" title="模型突破">多模态具身智能全面实用化</ui-timeline-item>',
      },
    ],
  },

  'ui-progress': {
    tag: 'ui-progress',
    name: '进度与指标条',
    category: 'visual',
    categoryLabel: '视觉表现',
    description: '动态百分比进度指示条，支持进度数值、标题、颜色定制（seal|sky|ok|warn|purple）与光斑流动动效。',
    props: [
      { name: 'value', type: 'number', required: true, defaultValue: '0', description: '进度百分比数值（0 - 100）' },
      { name: 'max', type: 'number', required: false, defaultValue: '100', description: '最大值（默认 100）' },
      { name: 'label', type: 'string', required: false, description: '进度条左侧标签文字' },
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'sky',
        description: '进度条填充色彩主题',
        options: ['seal', 'sky', 'ok', 'warn', 'purple'],
      },
    ],
    recommendedAnimations: ['shimmer', 'pulse', 'popIn'],
    bestPractices: '适合表示掌握度、训练轮数完成比或能力评分；配合 label 直观醒目。',
    examples: [
      {
        title: '模型收敛进度',
        description: '展示带百分比标签的进度条',
        code: '<ui-progress value="85" label="Epoch 85/100 训练收敛度" color="sky"></ui-progress>',
      },
      {
        title: '警告进度状态',
        description: '达到临界阈值展示',
        code: '<ui-progress value="92" label="显存占用率" color="warn"></ui-progress>',
      },
    ],
  },

  'ui-dialogue': {
    tag: 'ui-dialogue',
    name: '师生对话/多角色辩析',
    category: 'interactive',
    categoryLabel: '交互导向',
    description: '师生问答或双人对话容器，自带角色头像胶囊、对话气泡与指向尖角，适合情境化教学与答疑解惑。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '对话场景或辩题标题' },
    ],
    slots: [{ name: 'default', description: '包含若干个 <ui-speech> 子元素' }],
    recommendedAnimations: ['popIn', 'slideInLeft', 'slideInRight'],
    bestPractices: '利用左右两侧角色气泡对比学生常见困惑与老师清晰点拨，增强沉浸感。',
    examples: [
      {
        title: '师生问答对话',
        description: '典型提问与解答场景',
        code: '<ui-dialogue title="关于泰勒展开的思考">\n  <ui-speech role="student" name="小明">为什么非要把函数展开成多项式？</ui-speech>\n  <ui-speech role="teacher" name="导师">因为多项式最容易计算、求导和在计算机中实现！</ui-speech>\n</ui-dialogue>',
      },
    ],
  },

  'ui-speech': {
    tag: 'ui-speech',
    name: '对话发言项',
    category: 'interactive',
    categoryLabel: '交互导向',
    description: '对话气泡单项，区分学生（左/右侧）与教师（突出侧）角色。',
    props: [
      {
        name: 'role',
        type: 'enum',
        required: false,
        defaultValue: 'teacher',
        description: '角色类型',
        options: ['teacher', 'student'],
      },
      { name: 'name', type: 'string', required: false, description: '发言者姓名或称号' },
    ],
    slots: [{ name: 'default', description: '发言台词内容' }],
    recommendedAnimations: ['popIn', 'slideInLeft', 'slideInRight'],
    bestPractices: '台词文本控制在 1-3 句话为宜，保持问答紧凑自然。',
    examples: [
      {
        title: '单句发言',
        description: '老师解答',
        code: '<ui-speech role="teacher" name="导师">抓住极限本质，很多初等技巧就会融会贯通。</ui-speech>',
      },
    ],
  },

  'ui-table': {
    tag: 'ui-table',
    name: '结构化教学对照表',
    category: 'content',
    categoryLabel: '内容呈现',
    description: '科技感玻璃拟态数据表格，支持表头高亮、隔行交替背景色与列居中微调，适合参数比对与方法选型。',
    props: [
      { name: 'title', type: 'string', required: false, description: '表格上方标题' },
      { name: 'headers', type: 'string', required: false, description: '表头列名，逗号分隔，例如："算法, 时间复杂度, 空间复杂度"' },
    ],
    slots: [{ name: 'default', description: '原生 <tr> 或数据行内容' }],
    recommendedAnimations: ['popIn', 'zoomIn', 'slideInBottom'],
    bestPractices: '列数控制在 2-5 列为宜，数据单元格简明扼要。',
    examples: [
      {
        title: '算法复杂度对比表',
        description: '快速比对三大经典算法',
        code: '<ui-table title="常用排序算法对比" headers="算法, 时间复杂度, 额外空间, 稳定性">\n  <tr><td>快速排序</td><td>O(n log n)</td><td>O(log n)</td><td>不稳定</td></tr>\n  <tr><td>归并排序</td><td>O(n log n)</td><td>O(n)</td><td>稳定</td></tr>\n  <tr><td>堆排序</td><td>O(n log n)</td><td>O(1)</td><td>不稳定</td></tr>\n</ui-table>',
      },
    ],
  },

  'ui-keyboard': {
    tag: 'ui-keyboard',
    name: '键盘按键与操作指南',
    category: 'visual',
    categoryLabel: '视觉表现',
    description: '拟真机械键盘按键胶囊，支持组合键（+ 自动连接）与操作说明提示，适合快捷键教学与交互提示。',
    props: [
      { name: 'keys', type: 'string', required: true, description: '按键组合，逗号分隔，例如 "Ctrl, K" 或 "Cmd, Shift, P"' },
      { name: 'desc', type: 'string', required: false, description: '该快捷键对应的操作动作描述' },
    ],
    recommendedAnimations: ['popIn', 'bounce', 'jello'],
    bestPractices: '按键名尽量标准（如 Ctrl, Shift, Alt, Enter, Esc），描述短小清晰。',
    examples: [
      {
        title: '命令面板快捷键',
        description: '展示常用系统快捷键',
        code: '<ui-keyboard keys="Ctrl, Shift, P" desc="唤出交互命令面板"></ui-keyboard>',
      },
      {
        title: '单键提示',
        description: '保存并编译',
        code: '<ui-keyboard keys="Ctrl, S" desc="快速保存并热重载"></ui-keyboard>',
      },
    ],
  },

  'ui-highlight': {
    tag: 'ui-highlight',
    name: '视觉聚光标记块',
    category: 'visual',
    categoryLabel: '视觉表现',
    description: '荧光笔高亮标注块，提供发光下划线或渐变微底色，突出核心概念词汇、关键推论或记忆钩子。',
    props: [
      {
        name: 'color',
        type: 'enum',
        required: false,
        defaultValue: 'sky',
        description: '高亮主题色彩',
        options: ['sky', 'seal', 'ok', 'warn', 'purple'],
      },
    ],
    slots: [{ name: 'default', description: '需要高亮强调的词语或句子' }],
    recommendedAnimations: ['pulse', 'glow', 'shimmer'],
    bestPractices: '内嵌在普通段落或卡片文本中，避免整段大面积标亮。',
    examples: [
      {
        title: '重点名词高亮',
        description: '强调核心术语',
        code: '<p>在连续可导的前提下，函数的一阶导数为零是极值存在的<ui-highlight color="sky">必要非充分条件</ui-highlight>。</p>',
      },
    ],
  },

  'ui-accordion': {
    tag: 'ui-accordion',
    name: '手风琴折叠展开器',
    category: 'interactive',
    categoryLabel: '交互导向',
    description: '折叠面板容器，支持多章节、拓展阅读或解答推导的折叠/展开，保持黑板画面简洁整齐。',
    props: [
      { name: 'id', type: 'string', required: false, description: '元素唯一标识符' },
      { name: 'title', type: 'string', required: false, description: '折叠组总标题' },
    ],
    slots: [{ name: 'default', description: '包含若干个 <ui-accordion-item> 子项' }],
    recommendedAnimations: ['popIn', 'slideInBottom', 'zoomIn'],
    bestPractices: '将推导细节、进阶习题或参考答案放入手风琴，避免一屏信息过载。',
    examples: [
      {
        title: '拓展证明手风琴',
        description: '折叠收纳证明推导过程',
        code: '<ui-accordion title="深入探讨与证明">\n  <ui-accordion-item title="为什么不用有限差分？" open="true">因为自动微分避免了数值精度截断误差。</ui-accordion-item>\n  <ui-accordion-item title="反向传播的核心瓶颈是什么？">显存中需要保留前向传播的所有激活值矩阵。</ui-accordion-item>\n</ui-accordion>',
      },
    ],
  },

  'ui-accordion-item': {
    tag: 'ui-accordion-item',
    name: '手风琴折叠单项',
    category: 'interactive',
    categoryLabel: '交互导向',
    description: '手风琴的单个折叠条目，自带旋转箭头指示与展开收起交互。',
    props: [
      { name: 'title', type: 'string', required: true, description: '折叠项标题' },
      { name: 'open', type: 'boolean', required: false, defaultValue: 'false', description: '是否默认展开' },
    ],
    slots: [{ name: 'default', description: '折叠项内部的详细展开内容' }],
    recommendedAnimations: ['slideInBottom', 'popIn'],
    bestPractices: '可通过设置 open="true" 默认展开核心第一条。',
    examples: [
      {
        title: '单折叠项',
        description: '默认展开的问答',
        code: '<ui-accordion-item title="常见陷阱分析" open="true">注意分母不可为零以及极限路径的对称性。</ui-accordion-item>',
      },
    ],
  },

  'ui-banner': {
    tag: 'ui-banner',
    name: '黑板顶部横幅告示',
    category: 'visual',
    categoryLabel: '视觉表现',
    description: '醒目的全宽顶部渐变彩带或通告栏，适合作为课节主题总起、考试重点倒计时或关键警示通告。',
    props: [
      { name: 'title', type: 'string', required: true, description: '横幅主标题' },
      { name: 'subtitle', type: 'string', required: false, description: '横幅辅助副标题' },
      {
        name: 'type',
        type: 'enum',
        required: false,
        defaultValue: 'info',
        description: '横幅类型与氛围配色',
        options: ['info', 'success', 'warning', 'danger'],
      },
    ],
    recommendedAnimations: ['slideInTop', 'glow', 'pulse'],
    bestPractices: '通常放置在黑板画布的最顶部作为导言或本课核心主题标语。',
    examples: [
      {
        title: '课程主题横幅',
        description: '总起横幅带副标题',
        code: '<ui-banner type="info" title="第 3 讲：多元函数微分学与梯度下降" subtitle="理论掌握 100% · 课后代码实战已就绪"></ui-banner>',
      },
      {
        title: '重点警示横幅',
        description: '警戒通知横幅',
        code: '<ui-banner type="warning" title="期末考试重点章节" subtitle="近三年真题占比超 35%，请务必掌握全部证明推导"></ui-banner>',
      },
    ],
  },
}
