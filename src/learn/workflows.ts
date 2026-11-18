import type { PromptModule } from './ai/promptModules'
import type { LearnStore, WorkflowEntry } from './types'

/**
 * 工作流：**不由某条用户消息直接驱动**的任务模板（开讲、回忆、出卷、超级实验室……）。
 *
 * 与 method（learn/methods）是两类东西：method 存的是**可执行代码**，由沙箱当场执行；
 * 工作流存的是**指令文本**——它被触发时才以一条 user 消息整段进入上下文（隐藏消息、
 * 界面上是一条分界条），**绝不进系统提示词**。这样两件事同时成立：
 * - 系统提示词保持只与目标相关（前缀缓存稳定，见 buildTeacherSystem 的说明）；
 * - 每个工作流的指令可以长、可以随时改，代价只落在触发的那一轮。
 *
 * 三级分级：**内置**（随应用提供，指令在本文件里）/ **全局**（跨目标、跟着用户走，
 * 存在 state.json）/ **目标级**（只当前目标可用，存在目标目录的 workflow.json）。
 * 同名同级的登记即覆盖——那是「更新一个工作流」，与 method 同一条规矩。
 */

/** 名字的上限：够写「课前摸底开讲」，防手滑把整段指令粘进名字 */
export const WORKFLOW_NAME_MAX = 64
/** 单条指令的上限：与 method 的函数体同量级（触发时它整段进上下文，不能再大） */
export const WORKFLOW_TEXT_MAX = 60_000

export type WorkflowTier = 'builtin' | 'global' | 'goal'

/**
 * 一条工作流在列表里露出的完整面目。内置条目比登记条目多三样：
 * 触发前的宿主准备（prep）、指令里的占位符清单（params）、能否从列表直接跑（runnable）。
 */
export interface WorkflowRow extends WorkflowEntry {
  tier: WorkflowTier
  /**
   * 触发前的宿主准备，两种：
   * - 'ask'：响一声铃。问询类工作流的第一步是一张压在输入框上方的表单，
   *   用户盯着文档时听不见——这一声让它被看见。
   * - 'show'：也响铃。交付物在对话里（如「伪编译」），用户此刻正盯着自己点的地方
   *   （代码块上的转圈，随后亮起来的「运行」按钮），响一声就够，别的不做。
   *
   * 两档现在**行为相同**（都是响铃）——分开只是标注这条工作流的交互形态：
   * 会弹表单等用户动作（ask）还是只把东西摆出来（show）。原来的另一种做法
   * （'ask' 额外把对话栏切到主位）随 api.ui.switchMain 一起撤了：主栏归用户自己管。
   */
  prep?: 'ask' | 'show'
  /** instruction 里的 {{占位符}} 清单：触发方必须把这些参数补齐 */
  params?: string[]
  /** 能不能从工作流列表直接跑：出卷/阅卷要专用入口（选类型等级 / 先交卷），列表里不给他们按钮 */
  runnable: boolean
}

/* ---------- 内置工作流的指令 ---------- */

/**
 * 「开讲」：空节点的内容填充（画布上空文档卡点「生成」、或新建节点后的自动开讲）。
 *
 * **指令只写「做什么」与参数**（函数调用）：完整流程（列前置、检索、摸底、写法、
 * 记账）在系统提示词的「内置工作流与任务规程」一节里。
 * 指令里不重复步骤，只给这轮特有的参数与边界。
 */
const TEACH_NODE_INSTRUCTION = ['## 使用「开讲」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 「学习大纲」：新目标的**第一轮**——先判断这次是「长期学习」还是「一次性任务」，
 * 再决定要不要一棵知识树。
 *
 * 为什么要有这条分叉：用户新建目标不总是为了系统学一门课。让导师读一个代码项目、
 * 精读一篇论文、弄懂一份报错，这些事**没有长期路线**——硬造一棵大纲树，只会得到
 * 一堆永远不会被点开的空节点，还把真正的交付物（根节点文档）推到第二位。
 * 任务型因此只建根节点与根节点文档，大纲保持空白。
 *
 * 形态**不靠用户勾选**，由导师从首条消息与附件里判断；只有在「长期 / 一次性」两种信号
 * 同时成立、且两种走法交付物差别很大时才值得问一次——反复确认比偶尔走错更烦人，
 * 而且走错也容易补救（任务型随时能补大纲，学习型多出来的空节点用户自己能删）。
 *
 * 学习型的交付物仍是大纲页（路线住在大纲文件里，教学文档只写总述）。
 */

/**
 * 「生成大纲」：给任意一个节点规划或重写它这一层的大纲（手动触发——大纲页上的
 * 「请导师生成大纲」，或工作流列表）。与「学习大纲」的分工：那条只管刚新建的总目标，
 * 这一条管所有节点（阶段目标要拆下一层、或者计划变了要重排）。
 *
 * 指令只写「做什么」：写法与规矩在系统提示词的「内置工作流与任务规程」一节里。
 */
const OUTLINE_INSTRUCTION = ['## 使用「生成大纲」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 「生成大纲导读」：大纲卡右键菜单的「生成大纲导读」触发——导读生在**大纲本体**上，
 * 给已经写成的大纲补一段对它本身的讲解（guide）。规矩在系统提示词的
 * 「内置工作流与任务规程」一节里：只写 guide、不动 intro 与 children。
 */
const OUTLINE_GUIDE_INSTRUCTION = ['## 使用「生成大纲导读」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 「前置知识大纲」：文档卡右键菜单的「生成前置知识大纲」触发
 * （旧入口「画布拖一张空大纲卡接上游」已随占位卡一起退役）。
 *
 * 与「生成大纲」的分工：那条给**方向已定**的节点规划「往下怎么学」；
 * 这条给**还没拆过的文档**定「学它之前要先会什么」。写法的通用规矩在系统提示词的
 * 「内置工作流与任务规程」一节里，指令只写本轮特有的任务与边界。
 */

/**
 * 「视频总览」：分析视频选集结构并规划语义分类总览文档（挂在视频节点子级）。
 */
const VIDEO_OVERVIEW_INSTRUCTION = ['## 使用「视频总览」工作流。', '- 目标节点: {{target}}', '- 视频资源: {{videoId}}'].join('\n')

/**
 * 「生成互动课堂」：为课堂节点生成 16:9 画布课件（画面 + DOM 动作流 + 讲解语音）。
 */
const CLASSROOM_INSTRUCTION = [
  '## 使用「生成互动课堂」工作流。',
  '- 目标课堂节点: {{target}}',
  '',
  '### 【核心教学理念：这是名师在授课，绝不是念 PPT！】',
  '1. 【严禁照念画面文字】：',
  '   - 画面上展示的是结构提纲（供眼睛阅读），嘴里讲的是**核心直觉、生活类比、痛点本质、为什么以及顿悟时刻**（供耳朵领悟）！',
  '   - 严禁把卡片上的标题或正文字面复读一遍！如果画面上写了定义，嘴里就要讲大白话或举生动例子。',
  '   - ❌ 错误（念PPT）："慢指针每次前进一步，快指针每次前进两步，若相遇则存在环。"',
  '   - ✓ 正确（名师教学）："想象操场跑步，两人速度不同，只要跑道是环形的，就一定会套圈相遇！"',
  '2. 【富有温度的人情味与对话感】：',
  '   - 像一位坐在学生身边的风趣导师，多用设问、启发、提醒与感叹：',
  '   - 常用句式："注意看这里"、"其实有个绝妙的直觉"、"别被公式吓到了"、"你发现了吗？"、"关键就在这一处！"',
  '3. 【严禁使用句号（铁律）】：',
  '   - 所有讲解词（speak text）中**绝对禁止出现中文句号「。」和英文句号「.」**！',
  '   - 停顿或断句时，使用空格、逗号「，」、感叹号「！」、问号「？」或直接自然分段，末尾绝不加句号！',
  '4. 【每句话严格不超过 20 字】：',
  '   - speak text 每一句字数严格控制在 **8-16 字**（上限 20 字），短小精悍，节奏轻快，杜绝长难句！',
  '5. 【TTS 与字幕唯一源】：speak 中的 text 即是口语朗读与字幕，不要填写与 text 不一致的 subtitle 字段！',
  '',
  '### 【密集视觉动效：讲解必须多用动画联动！】',
  '严禁连续多句讲解而画面静止不动！**几乎每一句 speak 都要伴随 1-2 个精准的 visual 动画动作**，让学生的视线被动态紧紧抓住：',
  '1. 逐层揭晓：初始隐藏元素标记 `data-hidden`，讲解到时用 `{ type: "visual", verb: "appear", target: "id" }` 配合 `popIn` / `slideInRight` 登场。',
  '2. 强调聚焦：讲到核心结论或亮点时，调用 `bounce`（弹性弹跳）或 `glow`（光晕闪烁）。',
  '3. 警示避坑：讲到常见误区、易错点时，调用 `shake`（左右震颤警示）。',
  '4. 核心共振：讲到核心名词或公式时，调用 `pulse`（脉冲放大回缩）或 `zoomIn`。',
  '5. 数据攀升：讲到指标、复杂度或统计数值时，调用 `countUp`（数字平滑滚动，参数 `{ end: 100, suffix: "%" }`）。',
  '6. 视线聚焦：对比讲解时用 `dimOthers` 压暗其他项，讲完用 `resetFocus` 恢复。',
  '',
  '### 【预置课堂组件库（直接组合，严禁手写繁重底层 HTML/CSS）】',
  '课堂画布内置声明式语义组件，直接组合以下标签：',
  '1. 根容器与标题栏：',
  '   `<div class="stage-top-title"><div class="stage-header"><h1 class="stage-title">课件标题</h1><ui-badge color="seal">核心主题</ui-badge></div>...主体内容...</div>`',
  '2. 布局组件：',
  '   - 双栏对比/并排：`<ui-split gap="48">...</ui-split>`',
  '   - 三栏并排：`<ui-split-3 gap="36">...</ui-split-3>`',
  '   - 2×2 网格：`<ui-grid-2x2 gap="36">...</ui-grid-2x2>`',
  '3. 常用教学卡片（受控元素必须带唯一 id，需登场动画的声明 anim 或初始隐藏加 data-hidden）：',
  '   - 通用教学卡：`<ui-card id="c1" title="标题" subtitle="副标" badge="核心" badge-color="seal|sky|ok|warn|purple" icon="bulb|code|check|star|info|warn|target|chart|book" anim="popIn">卡片正文</ui-card>`',
  '   - 核心概念卡：`<ui-concept id="cp1" term="名词" tag="领域" definition="精准大白话定义" keypoint="直觉记忆口诀" anim="popIn"></ui-concept>`',
  '   - 公式聚焦卡：`<ui-formula id="f1" latex="E = mc^2" title="质能方程" desc="质量与能量转换关系" anim="zoomIn"></ui-formula>`',
  '   - 代码演示卡：`<ui-code id="cd1" lang="python|javascript|ts|rust" title="实现代码">def solve():\n    pass</ui-code>`',
  '   - 方案对比卡：`<ui-compare id="cmp1" left-title="传统方案" left-badge="劣势" right-title="现代方案" right-badge="优势" vs="VS"><div slot="left">...</div><div slot="right">...</div></ui-compare>`',
  '   - 演进步进卡：`<ui-steps id="st1" title="演进推导"><ui-step id="s1" num="1" title="初始化">步骤说明</ui-step><ui-step id="s2" num="2" title="前进" data-hidden>步骤说明</ui-step></ui-steps>`',
  '   - 核心指标卡：`<ui-stat id="st1" value="O(N)" label="时间复杂度" subtext="线性扫一遍" icon="chart" anim="countUp"></ui-stat>`',
  '   - 重点避坑卡：`<ui-callout id="co1" type="tip|warn|danger|info" title="关键陷阱">提示正文</ui-callout>`',
  '   - 名言金句卡：`<ui-quote id="q1" quote="金句正文" author="大师" source="书籍"></ui-quote>`',
  '   - 随堂思考题：`<ui-quiz id="qz1" question="思考问题？" answer="B"><ui-option id="o1" label="A">选项A</ui-option><ui-option id="o2" label="B">选项B</ui-option></ui-quiz>`',
  '',
  '### 【五幕式丰富教案规划策略】',
  '整堂课设计 4-5 个循序渐进的 Scene，构建完整心智模型：',
  '- Scene 1（痛点引入）：用 `<ui-concept>` + `<ui-callout>` 引发好奇心，抛出灵魂拷问，卡片 `anim="popIn"`。',
  '- Scene 2（原理拆解）：用 `<ui-split>`，左侧 `<ui-formula>`，右侧 `<ui-steps>` 逐步 appear 步骤，每一步配合 `bounce` 动效。',
  '- Scene 3（实战对比）：用 `<ui-compare>` 对比正反方案，讲解时用 `glow` 点亮优势项，用 `shake` 警示反例缺陷。',
  '- Scene 4（效能升华）：用 `<ui-stat>` 数据滚动展示优势，配合 `<ui-quote>` 总结规律。',
  '- Scene 5（互动思考）：用 `<ui-quiz>` 抛出经典测试题，调用 `{ type: "checkpoint", title: "独立思考：你选哪一个？" }` 等待学生互动。',
  '',
  '### 【交付方式】',
  '分析上游教学文档或根据主题生成课件，直接调用：',
  'api.node.get("{{target}}").editContent({ title: "...", course: { courseId: "...", title: "...", scenes: [...] } })',
].join('\n')

/**
 * 「出卷」：类型与难度由 Agent 问用户，出题后直接保存试卷文件。
 *
 * 出卷流程与题目 JSON 契约在系统提示词的「内置工作流与任务规程」一节里（读写边界
 * 在 api.exam 组速查）；指令只写本轮的决策内容：考什么、问什么、怎么定时限。
 */
const EXAM_INSTRUCTION = ['## 使用「出卷」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 「阅卷」：交卷后自动触发，判分并写错题讲解。
 */
const GRADE_INSTRUCTION = [
  '## 使用「阅卷」工作流。',
  '- 目标节点: {{target}}',
  '- 作答记录: {{attemptId}}（判分与错题讲解时都带上这个 attemptId——判分进行中学习者可能又交了别的卷子，不带它就可能判错对象）',
].join('\n')

/**
 * 「超级实验室」：问清用户要什么实验/功能，然后生成一份可交互的超级文档。
 */
const SUPERLAB_INSTRUCTION = ['## 使用「超级实验室」工作流。', '- 目标节点: {{target}}', '- 超级文档: {{shell}}'].join('\n')

/**
 * 「压缩上下文」：把这段对话折成一份交接摘要（见 learn/compact）。
 *
 * 关键差别：**摘要由你（导师）自己写**，不是宿主另起一次「把历史重发一遍再总结」的请求——
 * 你本来就看得到整段上下文，直接写就行。写完调 api.compact 落进会话；
 * **本轮结束后**它才生效：那之前的消息全部失活，只剩这份摘要 + 之后的新消息进上下文。
 *
 * 因此这份指令的重点全在两件事上：**未做完的事要高保真**，以及**别做别的**。
 */
const COMPACT_INSTRUCTION = ['## 使用「压缩上下文」工作流。'].join('\n')

/**
 * 「了解」：用户在正文里划了一个词、点了「了解」。
 */
const EXPLAIN_INSTRUCTION = ['## 使用「了解」工作流。', '- 目标节点: {{target}}', '- 词条: {{term}}', '- 出现序号: {{occurrence}}', '- 选中原文: {{snippet}}'].join('\n')

const CODE_COMPILE_INSTRUCTION = ['## 使用「伪编译」工作流。', '- 代码块: {{key}}', '- 语言: {{language}}', '- 目标节点: {{target}}', '', '待编译代码（原文）：', '```{{language}}', '{{code}}', '```'].join('\n')

/**
 * 「浏览器操作」：替用户驱动内置浏览器完成任务。之所以特化成工作流：网页是
 * **看图干活**的场景，普通对话里模型容易去猜页面内容、或想找条「读文字」的近路——
 * 这里把「看 = 截图、动手 = 模拟鼠标键盘」钉成唯一的路子，并把连招塞进同一次
 * execute（连招才是浏览效率的主要来源），推理档位给 low（识别与决策都轻）。
 */
const BROWSER_USE_INSTRUCTION = ['## 使用「浏览器操作」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 内置条目的定义形：没有时间戳（它们不是「登记」出来的），runnable 可以不给（默认能跑）。
 * 思考档位曾经有逐条推荐（effort）与用户的三态配置，2026-10-25 整体删除：
 * 档位全应用只有全局滑条一份（见 learn/effortGuard）。
 */
type BuiltinDef = Omit<WorkflowRow, 'tier' | 'runnable' | 'createdAt' | 'updatedAt'> & {
  runnable?: boolean
}


/**
 * 「修复函数图像」：文档里一个 ```plot 渲染失败，点错误卡片上的扳手触发。
 *
 * 报错原因、字符区间与围栏原文都由触发方（LearnWorkspace 的 plotFixHandler）算好带来：
 * 区间与 doc.replace 的参数同语义，agent 一次替换就改完——**不需要读文档**，
 * 也不存在「渲染验证」这件事（它没有渲染通道），验收标准就是下面列的几条硬要求。
 */
const PLOT_FIX_INSTRUCTION = ['## 使用「修复函数图像」工作流。', '- 目标节点: {{target}}', '- 文档标题: {{nodeTitle}}', '- 报错原因: {{reason}}', '- 字符区间: {{range}}', '- 起止偏移: {{start}} 到 {{end}}', '', '失败围栏原文（原样，含首尾 ``` 标记）：', '```plot', '{{source}}', '```'].join('\n')

/**
 * 「项目与文章解读」：当用户需要导师带着解读文章或代码项目时，将材料下载/保存至本地，
 * 创建项目节点挂在相应文档节点之下（或游离），并在生成的解读文档中用 quote 块精准引用原文。
 */
const PROJECT_INTERPRET_INSTRUCTION = ['## 使用「项目与文章解读」工作流。', '- 目标节点: {{target}}'].join('\n')

const BUILTIN_DEFS: BuiltinDef[] = [  {
    id: 'teach-node',
    name: '开讲',
    description: '摸底前置知识盲点后，生成针对性的教学文档',
    instruction: TEACH_NODE_INSTRUCTION,
    // 方法流程在系统提示词的「内置工作流与任务规程」一节里；排版配方（doc-html）
    // 随系统提示词静态在场——首份文档就不是纯文本草稿（v0.5.8 踩过）。
    params: ['target'],
    prep: 'ask',
    // 核心交付物是教学文档：要深，但 max 的等待不值
  },
  {
    id: 'outline',
    name: '生成大纲',
    description: '为当前知识点规划或重写大纲（只列直接子层级一层）',
    instruction: OUTLINE_INSTRUCTION,
    // 写法与规矩在系统提示词的「内置工作流与任务规程」一节里
    params: ['target'],
    // 交付物长在大纲页里（用户多半正盯着它）：只响一声铃、不抢主位
    prep: 'show',
    // 大纲规划要全局权衡层级
  },
  {
    id: 'outline-guide',
    name: '生成大纲导读',
    description: '为一份已经写成的大纲补一段对它本身的讲解（guide，只写导读不动计划）',
    instruction: OUTLINE_GUIDE_INSTRUCTION,
    params: ['target'],
    // 与生成大纲同一待遇：交付物长在导读页签里，只响铃不抢主位
    prep: 'show',
    // 只有画布菜单的触发口，不出现在导师的工作流清单里
    runnable: false,
  },
  {
    id: 'video-overview',
    name: '视频总览',
    description: '分析视频选集结构并规划语义分类总览文档（挂在视频节点子级）',
    instruction: VIDEO_OVERVIEW_INSTRUCTION,
    params: ['target', 'videoId'],
    prep: 'show',
    runnable: false,
  },
  {
    id: 'classroom',
    name: '生成互动课堂',
    description: '为课堂节点生成 16:9 画布动态课件（画面、DOM 视觉动作与语音讲解流）',
    instruction: CLASSROOM_INSTRUCTION,
    params: ['target'],
    prep: 'show',
    runnable: true,
  },
  {
    id: 'exam',
    name: '出卷',
    description: '先问清类型与难度，再出一份带时限的试卷',
    instruction: EXAM_INSTRUCTION,
    params: ['target'],
    // 它自己会先 ask 一次（类型 / 难度），所以没有占位符、也从列表里可跑
    prep: 'ask',
    // 题干与干扰项质量直接影响学习；卷子的章法主要靠指令模板，high 是质量与等待的平衡点
  },
  {
    id: 'exam-grade',
    name: '阅卷',
    description: '判分 + 针对错题写讲解（交卷后自动跑）',
    instruction: GRADE_INSTRUCTION,
    params: ['target'],
    // 必须先有人交卷：从列表里空跑只会得到「没有需要讲解的考试」
    runnable: false,
    // 判分要准、讲解要质量；判分对照本身偏机械，max 的边际收益不值多等的
  },
  {
    id: 'explain',
    name: '了解',
    description: '就正文里选中的那段文字写一条两三句的注解，划在正文上（选中文字 →「了解」触发）',
    instruction: EXPLAIN_INSTRUCTION,
    // 词条、序号与选段都由触发方补齐；从工作流列表里空跑没有词条可讲
    params: ['target', 'term', 'occurrence', 'snippet'],
    runnable: false,
    // 只响一声铃、不切主位：交付物就画在用户盯着的那段文字旁边（同「伪编译」）
    prep: 'show',
    // 选中即出的两三句注解，等待感最明显
  },
  {
    id: 'superlab',
    name: '超级实验室',
    description: '问清想做什么实验，生成一份可交互的超级文档',
    instruction: SUPERLAB_INSTRUCTION,
    // 问需求与落盘的规程在系统提示词的「内置工作流与任务规程」一节里；壳 uuid 由触发方带（画布空壳卡）
    params: ['target'],
    prep: 'ask',
    // 生成可交互 HTML/JS：复杂代码合成是 max 收益最大的场景，失败代价最高、也等得起
  },
  {
    id: 'code-compile',
    name: '伪编译',
    description: '把文档里这段代码转译成可运行的 JS，产物交给它运行',
    instruction: CODE_COMPILE_INSTRUCTION,
    // 产物交付的 api 口径（save / silent）与转译环境在系统提示词的「伪编译」规程里
    // 代码、语言与 key 由代码块菜单补齐；从工作流列表里空跑没有意义
    params: ['target', 'language', 'key', 'code'],
    runnable: false,
    // 响一声铃就够：用户点的是代码块，回执也在那儿（转圈 → 运行亮起），见 WorkflowRow.prep
    prep: 'show',
    // 转译规则明确、代码块通常短
  },
  {
    id: 'plot-fix',
    name: '修复函数图像',
    description: '文档里一个函数图像渲染失败时，按报错与区间一次改完（点错误卡片触发）',
    instruction: PLOT_FIX_INSTRUCTION,
    // 报错、区间与原文都由触发方算好带来；从列表里空跑没有可修的图
    params: ['target', 'nodeTitle', 'reason', 'range', 'start', 'end', 'source'],
    runnable: false,
    // 响一声铃就够：用户点的是错误卡片，修复结果直接落在文档里
    prep: 'show',
    // 区间与原文都已给全，照着替换即可；JSON 合法性靠验收清单而不是思考深度
  },
  {
    id: 'compact',
    name: '压缩上下文',
    description: '把前面的对话折成一份交接摘要（旧消息随即失活）',
    instruction: COMPACT_INSTRUCTION,
    // api.compact 的生效时机与参数口径在系统提示词的「压缩上下文」规程里
    // 压缩是摘录式改写：材料全在上下文里，不需要额外推理
  },
  {
    id: 'browser-use',
    name: '浏览器操作',
    description: '替用户操作内置浏览器：截图看页面、模拟鼠标键盘完成任务',
    instruction: BROWSER_USE_INSTRUCTION,
    // 操作规程与安全纪律在系统提示词的 api.browser 组速查里
    params: ['target'],
    // 全程看图干活：识别与决策都轻——快才是浏览效率
  },
  {
    id: 'project-interpret',
    name: '项目与文章解读',
    description: '为文章建立文件节点（在线网页直接引用阅读无需下载）或小型项目建立项目节点，并在教学文档中精准引用逐段精读',
    instruction: PROJECT_INTERPRET_INSTRUCTION,
    params: ['target'],
    prep: 'ask',
    runnable: true,
  },
]

/** 内置工作流的 id 集：normalize 校验登记键、UI 判「是不是内置」都认它 */
export const BUILTIN_WORKFLOW_IDS: ReadonlySet<string> = new Set(BUILTIN_DEFS.map((d) => d.id))

/* ---------- 触发前的宿主准备 ---------- */

/**
 * 一条工作流触发前，宿主该做什么。
 *
 * 规则只有一条：**带 prep 的响一声铃**（问询类的表单要用户抬眼、展示类的交付要他知道
 * 结果在对话里），没带 prep 的（了解 / 大纲 / 压缩 / 阅卷）连铃都不响——
 * 那些是用户自己点出来的，他本来就在看着。
 *
 * 这里**不再切主位**（原先是 'ask' 才切）：主栏归用户管，页签化之后「眼前看哪一边」
 * 是他自己的选择，从手里把视线抢走这件事不值得由一次工作流触发来做。
 *
 * 抽成纯函数是为了让这条规矩有个能被钉住的地方（见 tests/workflows.test.ts）：
 * 它写在 useAgent 的回调里时，只有真跑一轮才验证得了。
 */
export function workflowPrep(prep: WorkflowRow['prep']): { beep: boolean } {
  return { beep: !!prep }
}

/**
 * 一条工作流触发时要注入哪些提示词模块：
 * 登记条目的 prompt 是自己的规程文本，按 wf:<id> 作键动态成模块（同上下文只注一次，
 * 去重在宿主那边做）。内置条目的规程全在系统提示词的 WORKFLOWS_GUIDE 里，不再注入
 * （2026-11 全量静态提示词重构：内置 promptModule 字段已随按需注入机制退役）。
 * 没有登记 prompt 就是空。
 */
export function workflowModules(
  row: Pick<WorkflowRow, 'id' | 'name' | 'prompt'>,
): PromptModule[] {
  const out: PromptModule[] = []
  if (typeof row.prompt === 'string' && row.prompt.trim()) {
    out.push({ key: 'wf:' + row.id, title: row.name, text: row.prompt })
  }
  return out
}

/** 内置工作流列表（顺序即设置里的展示顺序；时间戳为 0——它们不是登记出来的） */
export function builtinWorkflowRows(): WorkflowRow[] {
  return BUILTIN_DEFS.map((d) => ({
    ...d,
    tier: 'builtin' as const,
    runnable: d.runnable ?? true,
    createdAt: 0,
    updatedAt: 0,
  }))
}

/* ---------- 登记表的纯逻辑 ---------- */

const globalOf = (store: LearnStore): WorkflowEntry[] => store.workflows?.global ?? []
const goalOf = (store: LearnStore, goalId: string): WorkflowEntry[] =>
  goalId ? (store.workflows?.byGoal?.[goalId] ?? []) : []

/** 三级并成一张列表：内置在前，全局次之，目标级最后（同名的不会有——登记时就按名去重） */
export function listWorkflowRows(store: LearnStore, goalId: string | null): WorkflowRow[] {
  const rows: WorkflowRow[] = builtinWorkflowRows()
  for (const e of globalOf(store)) rows.push({ ...e, tier: 'global', runnable: true })
  if (goalId) for (const e of goalOf(store, goalId)) rows.push({ ...e, tier: 'goal', runnable: true })
  return rows
}

/**
 * 按 id 或名字找一条工作流（大小写不敏感——触发方抄写时大小写会飘，与 method 同一条宽容）。
 * 三级顺序查找：内置优先，全局次之，目标级最后。
 */
export function findWorkflow(store: LearnStore, goalId: string | null, ref: string): WorkflowRow | null {
  const key = (ref ?? '').trim().toLowerCase()
  if (!key) return null
  return listWorkflowRows(store, goalId).find((r) => r.id.toLowerCase() === key || r.name.toLowerCase() === key) ?? null
}

/**
 * 新建 / 覆盖一条登记工作流（global 或 goal 级；内置的不可造也不可覆）。
 * 同名同级覆盖（那是更新）；返回新 store 与最终条目，校验不过时带原因。
 */
export function upsertWorkflow(
  store: LearnStore,
  tier: 'global' | 'goal',
  goalId: string,
  input: { name?: unknown; instruction?: unknown; description?: unknown; prompt?: unknown },
  at: number,
): { ok: true; store: LearnStore; entry: WorkflowEntry; updated: boolean } | { ok: false; error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!name) return { ok: false, error: 'wf.create 需要 name（工作流名，列表与触发都靠它指名）' }
  if (name.length > WORKFLOW_NAME_MAX) {
    return { ok: false, error: `工作流名最长 ${WORKFLOW_NAME_MAX} 字（收到 ${name.length} 字）` }
  }
  if (!instruction) {
    return { ok: false, error: 'wf.create 需要 instruction（触发时以 user 消息发出去的完整任务指令）' }
  }
  if (instruction.length > WORKFLOW_TEXT_MAX) {
    return { ok: false, error: `instruction 最长 ${WORKFLOW_TEXT_MAX} 字符（收到 ${instruction.length}），把步骤写精` }
  }
  // 规程提示词（可选）：给了就校验长度；没给就保留原有的（更新时不传 prompt ≠ 清空）
  let prompt: string | undefined
  if (typeof input.prompt === 'string' && input.prompt.trim()) {
    prompt = input.prompt.trim()
    if (prompt.length > WORKFLOW_TEXT_MAX) {
      return { ok: false, error: `prompt 最长 ${WORKFLOW_TEXT_MAX} 字符（收到 ${prompt.length}）` }
    }
  }
  const list = tier === 'global' ? globalOf(store) : goalOf(store, goalId)
  const existing = list.find((w) => w.name.toLowerCase() === name.toLowerCase())
  const entry: WorkflowEntry = existing
    ? {
        ...existing,
        instruction,
        description: description || existing.description,
        ...(prompt !== undefined ? { prompt } : {}),
        updatedAt: at,
      }
    : {
        id: 'wf_' + at.toString(36) + Math.random().toString(36).slice(2, 8),
        name,
        description,
        instruction,
        ...(prompt !== undefined ? { prompt } : {}),
        createdAt: at,
        updatedAt: at,
      }
  const nextList = existing ? list.map((w) => (w === existing ? entry : w)) : [...list, entry]
  const book = {
    global: tier === 'global' ? nextList : (store.workflows?.global ?? []),
    byGoal: tier === 'goal' ? { ...(store.workflows?.byGoal ?? {}), [goalId]: nextList } : (store.workflows?.byGoal ?? {}),
  }
  return { ok: true, store: { ...store, workflows: book }, entry, updated: !!existing }
}

/** 按 id 删一条登记工作流（全局与各级目标里都找一遍）；没有就原样返回 store */
export function removeWorkflow(store: LearnStore, id: string): LearnStore {
  const key = (id ?? '').trim().toLowerCase()
  if (!key) return store
  const global = globalOf(store)
  const byGoal = { ...(store.workflows?.byGoal ?? {}) }
  let removedId: string | null = null
  let nextGlobal = global
  const hitGlobal = global.find((w) => w.id.toLowerCase() === key)
  if (hitGlobal) {
    removedId = hitGlobal.id
    nextGlobal = global.filter((w) => w.id.toLowerCase() !== key)
  }
  for (const [goalId, list] of Object.entries(byGoal)) {
    const hitGoal = list.find((w) => w.id.toLowerCase() === key)
    if (!hitGoal) continue
    if (!removedId) removedId = hitGoal.id
    const rest = list.filter((w) => w.id.toLowerCase() !== key)
    if (rest.length) byGoal[goalId] = rest
    else delete byGoal[goalId]
  }
  if (!removedId) return store
  return { ...store, workflows: { global: nextGlobal, byGoal } }
}

/**
 * 把指令里的 {{占位符}} 换成实参；没给到的占位符原样留下——
 * 那是登记时写漏了参数，触发方（与用户）看得见比静默替换成空串好。
 */
export function renderWorkflowInstruction(text: string, params?: Record<string, string | number>): string {
  /*
   * 可选参数的标准语义是「没给就整行省略」：一行里出现**参数表里没有的**占位符 =
   * 它等的参数没来，这行就不进指令（参数缺失由提示词模块教模型凭上下文判断，而不是
   * 揣着一行占位符发愣）。判据按占位符的名字查表，先于填值——参数值里就算真有
   * 双大括号也不会误伤。
   * 参数表整个没来（params 缺省）= 每个占位符都没等到，照样逐行省——**绝不把
   * {{占位符}} 原样发给模型**（调用方忘了传参，指令退化成光秃秃的标准标题）。
   */
  const table = params ?? {}
  const lines = text.split('\n').filter((line) => {
    for (const m of line.matchAll(/\{\{(\w+)\}\}/g)) if (!(m[1] in table)) return false
    return true
  })
  return lines.join('\n').replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in table ? String(table[key]) : whole))
}

/**
 * 读回时校验一段登记清单：字段形状不对的丢掉、同名的只认第一份（手改出来的重复
 * 会在列表里出现两行一样的，触发时指不清是哪一个）。
 */
export function normalizeWorkflowEntries(raw: unknown): WorkflowEntry[] {
  if (!Array.isArray(raw)) return []
  const out: WorkflowEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const name = typeof m.name === 'string' ? m.name.trim().slice(0, WORKFLOW_NAME_MAX) : ''
    const instruction = typeof m.instruction === 'string' ? m.instruction : ''
    if (!name || !instruction) continue
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue
    out.push({
      id: typeof m.id === 'string' && m.id.trim() ? m.id : 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
      description: typeof m.description === 'string' ? m.description : '',
      instruction,
      // 规程提示词（动态注入用，见 workflowModules）：形状不对就不带这一块
      ...(typeof m.prompt === 'string' && m.prompt.trim() ? { prompt: m.prompt } : {}),
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
    })
  }
  return out
}
