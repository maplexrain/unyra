import { promptModuleByKey, type PromptModule } from './ai/promptModules'
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
  /**
   * 触发时随指令注入的**内置提示词模块**（learn/ai/promptModules；只有内置条目用——
   * 登记的走 WorkflowEntry.prompt）。规程类知识（如超级文档规范）按模块 key 注入，
   * 同一上下文只注一次；之后再次触发只发 instruction。
   */
  promptModule?: string
  /** 能不能从工作流列表直接跑：出卷/阅卷要专用入口（选类型等级 / 先交卷），列表里不给他们按钮 */
  runnable: boolean
}

/* ---------- 内置工作流的指令 ---------- */

/**
 * 「开讲」：空节点的内容填充（画布上空文档卡点「生成」、或新建节点后的自动开讲）。
 *
 * **指令只写「做什么」与参数**（函数调用）：完整流程（列前置、检索、摸底、写法、
 * 记账）在「教学文档生成」提示词模块里（assistant 声明一次，随本工作流注入、
 * 同上下文不重复——提示词与指令的分工见 personaMessage 与 promptModuleMessage 的说明）。
 * 指令里不再重复步骤，只给这轮特有的参数与边界。
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
 * 指令只写「做什么」：写法与规矩在「大纲编写」提示词模块里（随本工作流注入、
 * 同上下文只注一次）。
 */
const OUTLINE_INSTRUCTION = ['## 使用「生成大纲」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 「前置知识大纲」：文档卡右键菜单的「生成前置知识大纲」触发
 * （旧入口「画布拖一张空大纲卡接上游」已随占位卡一起退役）。
 *
 * 与「生成大纲」的分工：那条给**方向已定**的节点规划「往下怎么学」；
 * 这条给**还没拆过的文档**定「学它之前要先会什么」。写法的通用规矩在「大纲编写」
 * 提示词模块里（随本工作流注入），指令只写本轮特有的任务与边界。
 */

/**
 * 「视频总览」：分析视频选集结构并规划语义分类总览文档（挂在视频节点子级）。
 */
const VIDEO_OVERVIEW_INSTRUCTION = ['## 使用「视频总览」工作流。', '- 目标节点: {{target}}', '- 视频资源: {{videoId}}'].join('\n')

/**
 * 「出卷」：类型与难度由 Agent 问用户，出题后直接保存试卷文件。
 *
 * 题目 JSON 契约、两阶段读写与篡改禁令都在「试卷与考试」提示词模块里（随本工作流
 * 注入、同上下文只注一次）；指令只写本轮的决策内容：考什么、问什么、怎么定时限。
 */
const EXAM_INSTRUCTION = ['## 使用「出卷」工作流。', '- 目标节点: {{target}}'].join('\n')

/**
 * 「阅卷」：交卷后自动触发，判分并写错题讲解。
 */
const GRADE_INSTRUCTION = ['## 使用「阅卷」工作流。', '- 目标节点: {{target}}', '- 作答记录: {{attemptId}}'].join('\n')

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

/** 内置工作流的定义：id 稳定（触发与校验都靠它），名字就是对话里的分界条文案。 */
/**
 * 「随笔整理」：一次随笔提交之后，把**全部随笔**（按与上次的差异）统一整理进知识树的笔记。
 * 提交方（EssayDock 的提交按钮）已经把「提交历史 + 全部随笔相对上次的新增 / 修改 / 删除 /
 * 未变化清单」渲染进 {{feed}}——它不面向工作流列表。
 */
const ESSAY_COMMIT_INSTRUCTION = ['## 使用「随笔整理」工作流。', '- 提交说明: {{message}}', '- 目标节点: {{target}}', '', '提交内容与历史（完整快照；与上次相比的增量标注在里面）：', '{{feed}}'].join('\n')

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
    // 方法流程在「教学文档生成」模块里（assistant 声明一次，同上下文不重复）——
    // 指令只写本轮任务与参数（提示词与指令的分工，见 TEACH_NODE_INSTRUCTION 的说明）。
    // 这一次的交付物就是一份讲义：排版配方（doc-html）也必须**动笔之前**在场——
    // 靠 doc.* 写入触发只会晚一轮，第一份文档就永远是纯 HTML 草稿（v0.5.8 踩过）。
    // 纯 Markdown 策略下这些会被格式过滤拦掉（见 runTurnUnchecked 的 effectiveModules）
    promptModule: 'teach-method doc-html',
    params: ['target'],
    prep: 'ask',
    // 核心交付物是教学文档：要深，但 max 的等待不值
  },
  {
    id: 'outline',
    name: '生成大纲',
    description: '为当前知识点规划或重写大纲（只列直接子层级一层）',
    instruction: OUTLINE_INSTRUCTION,
    // 写法与规矩在「大纲编写」模块里（assistant 声明一次，同上下文不重复）
    promptModule: 'outline-method',
    params: ['target'],
    // 交付物长在大纲页里（用户多半正盯着它）：只响一声铃、不抢主位
    prep: 'show',
    // 大纲规划要全局权衡层级
  },
  {
    id: 'video-overview',
    name: '视频总览',
    description: '分析视频选集结构并规划语义分类总览文档（挂在视频节点子级）',
    instruction: VIDEO_OVERVIEW_INSTRUCTION,
    promptModule: 'video-overview',
    params: ['target', 'videoId'],
    prep: 'show',
    runnable: false,
  },
  {
    id: 'exam',
    name: '出卷',
    description: '先问清类型与难度，再出一份带时限的试卷',
    instruction: EXAM_INSTRUCTION,
    promptModule: 'exam',
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
    promptModule: 'exam',
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
    promptModule: 'explain',
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
    // 问需求与落盘的规程在自己那份模块里；壳 uuid 由触发方带（画布空壳卡）
    promptModule: 'superlab',
    params: ['target'],
    prep: 'ask',
    // 生成可交互 HTML/JS：复杂代码合成是 max 收益最大的场景，失败代价最高、也等得起
  },
  {
    id: 'code-compile',
    name: '伪编译',
    description: '把文档里这段代码转译成可运行的 JS，产物交给它运行',
    instruction: CODE_COMPILE_INSTRUCTION,
    // 产物交付的 api 口径（save / silent）与转译环境随这条工作流注入一次
    promptModule: 'code',
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
    promptModule: 'plot-fix',
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
    // api.compact 的生效时机与参数口径随这条工作流注入一次
    promptModule: 'compact',
    // 压缩是摘录式改写：材料全在上下文里，不需要额外推理
  },
  {
    id: 'browser-use',
    name: '浏览器操作',
    description: '替用户操作内置浏览器：截图看页面、模拟鼠标键盘完成任务',
    instruction: BROWSER_USE_INSTRUCTION,
    // 操作规程与安全纪律都在「内置浏览器」模块里
    promptModule: 'browser',
    params: ['target'],
    // 全程看图干活：识别与决策都轻——快才是浏览效率
  },
  {
    id: 'essay-commit',
    name: '随笔整理',
    description: '每次带上全部随笔，按与上次的差异（新增 / 修改 / 删除）统一整理进知识树对应节点的笔记',
    instruction: ESSAY_COMMIT_INSTRUCTION,
    // 历史与本次材料由「随笔」窗口的提交按钮补齐；从工作流列表空跑没有意义
    promptModule: 'essay-commit',
    params: ['target', 'message', 'feed'],
    runnable: false,
    // 归类、合并、改写都要判断，值得多想一会儿
  },
  {
    id: 'project-interpret',
    name: '项目与文章解读',
    description: '下载文章/小型项目至本地建立项目节点，并在生成的教学文档中用 quote 块精准引用原文进行逐段精读',
    instruction: PROJECT_INTERPRET_INSTRUCTION,
    promptModule: 'project-interpret doc-html',
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
 * 一条工作流触发时要注入哪些提示词模块（动态提示词注入，见 learn/ai/promptModules）：
 * - 内置条目的 promptModule 指到注册表里的内置模块；**空格分隔可给多个**（如开讲同时
 *   要「教学文档生成」方法与「文档排版与视觉呈现」配方——方法与配方都是声明，声明一次）；
 * - 登记条目的 prompt 是自己的规程文本，按 wf:<id> 作键动态成模块。
 * 两者都有就都注入（去重在宿主那边做：同一 key 只注一次）。都没有就是空。
 */
export function workflowModules(
  row: Pick<WorkflowRow, 'id' | 'name' | 'prompt' | 'promptModule'>,
): PromptModule[] {
  const out: PromptModule[] = []
  if (row.promptModule) {
    for (const key of row.promptModule.trim().split(/\s+/)) {
      const m = promptModuleByKey(key)
      if (m) out.push(m)
    }
  }
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
