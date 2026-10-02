import { REASONING_EFFORTS, type ReasoningEffort } from '../ai/types'
import type { LearnStore, WorkflowEntry, WorkflowEffortSetting } from './types'

export type { WorkflowEffortSetting }

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
   * - 'ask'：响一声铃 + 把对话栏切到主位。问询类工作流的第一步是一张压在输入框上方的表单，
   *   用户盯着文档时既听不见也看不见——这两下让它被看见。
   *   **这是唯一会切主位的一档**：切主位等于从用户手里把视线抢走，只有「不回答就走不下去」
   *   才值得这么干。
   * - 'show'：只响铃，**不切主位**。交付物虽然在对话里（如「伪编译」），但用户此刻正盯着
   *   自己点的那个地方（代码块上的转圈，随后亮起来的「运行」按钮），把面板拽到眼前
   *   反而打断了他手上正在读的东西。
   */
  prep?: 'ask' | 'show'
  /** instruction 里的 {{占位符}} 清单：触发方必须把这些参数补齐 */
  params?: string[]
  /** 能不能从工作流列表直接跑：出卷/阅卷要专用入口（选类型等级 / 先交卷），列表里不给他们按钮 */
  runnable: boolean
  /**
   * 思考档位的三态设置（见 WorkflowEffortSetting）。这是**用户的配置**，不是推荐值——
   * 列表合成时从 store.workflows.efforts 按 id 挂上（见 listWorkflowRows）；
   * 内置的推荐档在 BUILTIN_DEFS.effort，用户没配时经 resolveWorkflowEffort 的 'default' 兜住。
   */
  effort?: WorkflowEffortSetting
}

/* ---------- 内置工作流的指令 ---------- */

/**
 * 「开讲」：新节点创建后的教学文档生成。**不许直接开写**——先整理前置知识、
 * 用 ask 摸清用户哪些不会，再按盲点定详略写文档。这是需求明确的顺序：
 * 摸底（宿主已先响铃并把对话栏切到主位）→ 思考 → 生成针对性教学文档。
 */
const TEACH_NODE_INSTRUCTION = [
  '这个节点刚被创建，标题、描述、文档多半还是占位或空的。你要为它创建教学文档，但**不许直接开写**——先摸底再动笔。严格按下面的顺序：',
  '第一步｜整理前置知识：结合节点标题、上级节点的文档（api.node.read / api.doc.read 只读需要的部分）与你的学科判断，列出学会这个主题**绕不开的前置知识点**（一般 3~6 条：太少说明没拆开，太多说明没抓住主干）。',
  '第二步｜摸底提问：用 api.ask 出一张表单，每条前置知识一道单选题「这个我已经掌握 / 会一点 / 完全不会」。表单会压在输入框上方，用户答完你才会继续——不要自问自答，也不要跳过这一步。（响铃提醒与切到对话主位已由系统在你这一轮开始前做好，不必再调 tiktok / ui.switchMain。）',
  '第三步｜想清楚再动笔：按摸底结果定详略——「完全不会」的前置要先补讲，「会一点」的点到为止，「已掌握」的直接用；再想好文档结构：先讲什么、后讲什么、在哪衔接补讲的内容。',
  '第四步｜生成：',
  '1. 标题是用户选中的原词、不够准确的先 api.node.rename；描述空着就 api.description.update 写 150~300 字。',
  '2. 按第三步的构思 api.doc.write 教学文档（path 省略写的就是这个节点的教学文档，见本轮上下文的【写入目标】）：循序渐进、先直觉与例子再定义与推导，对摸底暴露的盲点**正面讲解**。',
  '3. 大纲：这个节点下面还会展开子层级的（教学路线里确实分阶段），用 api.outline.write 把**直接子层级**列进大纲' +
    '（children 每项 { title, summary }，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」，' +
    '孙辈的大纲由那些子目标自己的 outline 负责）；确定是叶子知识点的就不调它，大纲保持空白即可。',
  '4. 用 api.state.read() 看学习状态：有错误记忆的，这次讲解要正面处理那个错法；把摸底结果用 api.state.update(当前节点, { self, by: "user" }) 记下——每条前置按用户的答案从「已掌握」到「完全不会」挑最接近的一档。',
  '用户留空的题当作「会一点」处理，不要追问。先 api.node.read() 看一眼现状再开工，不要整篇读文档，也不要再找用户要确认。',
  '写完文档后用 api.ui.switchMain("doc") 把文档区切回主位，请用户看刚生成的教学文档。',
].join('\n')

/**
 * 「学习大纲」：新目标的系统性规划。交付物是**大纲页**（结构化的大纲 + 交互页），
 * 不再是把大纲整篇塞进教学文档——教学文档只写总述，路线住在大纲文件里
 * （见 learn/outline 的 OutlineDoc：创建节点时两份文件同时生成，导师往里写内容）。
 */
const GOAL_OUTLINE_INSTRUCTION =
  '这是用户刚新建的学习目标，用户的原话是这条消息上面那句。当前根节点的标题还是用户原话的临时形态。' +
  '请按顺序做四件事：\n' +
  '1. 用 api.node.rename(path, 新标题) 给这个目标起一个准确的标题（它会长成数据目录名，' +
  '要短、要具体，别把「请问」「怎么理解」这类问句成分带进去）。\n' +
  '2. 用 api.description.update 写一段 150~300 字的目标描述：要解决什么问题、学完应具备什么能力、边界在哪。\n' +
  '3. 用 api.doc.write 给教学文档写一篇「目标与边界」总述（path 省略写的就是根节点的教学文档，见本轮上下文的【写入目标】）：这个目标是什么、整体路线怎么走、' +
  '建议从哪个阶段开始（几百字即可）。**不要把整份大纲写进教学文档**，也不要堆学习链接——' +
  '路线的呈现是大纲页的事，那里会带着每个阶段的学习情况。\n' +
  '4. 用 api.outline.write 写根节点的大纲：intro 一两段（按什么路线分阶段、为什么这么分），' +
  'children 列出**直接子层级**的阶段目标，每项 { title, summary }——summary 两三句，' +
  '说清它学什么、为什么排在这个位置。\n' +
  '**深度规矩（硬性）**：大纲只写直接子层级，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」；' +
  '孙辈的大纲由那些子目标自己的 outline 负责，不要替它们写，也不要在 summary 里替孙辈规划。\n' +
  '先读再写，不要只写一段引入性讲解。写完用 api.ui.switchMain("doc") 把文档区切回主位——' +
  '大纲页已经开在那里（大纲是逐层长出来的：展开任何一个阶段目标，读到的就是它自己的大纲）。'

/**
 * 「生成大纲」：给任意一个节点规划或重写它这一层的大纲（手动触发——大纲页上的
 * 「请导师生成大纲」，或工作流列表）。与「学习大纲」的分工：那条只管刚新建的总目标，
 * 这一条管所有节点（阶段目标要拆下一层、或者计划变了要重排）。
 */
const OUTLINE_INSTRUCTION = [
  '请为当前知识点**规划或重写它这一层的大纲**（api.outline.write，整份覆盖）。严格按顺序：',
  '第一步｜先看现状：api.outline.read() 看已有大纲（有就整份重写，不要追加），api.node.read() 看标题、描述与现有下级节点，api.doc.readRange() 扫一眼教学文档的开头与标题结构（不要整篇读）。',
  '第二步｜规划直接子层级：这一层往下拆成哪几个**阶段目标**（一般 3~8 个，每个都能独立成篇、有明确的「学完会什么」）。已经有下级节点的，计划要与它们对齐——同一个人同一层不该有两套说法。',
  '第三步｜api.outline.write({ intro, children })：intro 一两段（这一层按什么路线走、为什么这么分）；children 每项 { title, summary }，summary 两三句——学什么、为什么排在这个位置。key 由标题自动生成，不要自己编。',
  '深度规矩（硬性）：只写**直接子层级**，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」。孙辈的大纲由那些子目标自己的 outline 负责；children 里不要出现「1.1.1」这类两层以下的东西，summary 里也不要替孙辈规划。',
  '写完用 api.ui.switchMain("doc")，让用户在大纲页里看这一层的路线。',
].join('\n')

/** 「回忆」：{{title}} 由触发方用当前节点标题补上。 */
const RECALL_INSTRUCTION =
  '请带用户做一次主动回忆（针对当前知识点「{{title}}」）：' +
  '**这一轮不要复述文档内容，也不要贴任何讲解**，只用一两句话请他合上文档、用自己的话讲一遍' +
  '（可以点明该讲哪几点，但别把答案摆出来）。等他把话说完，你要给出三样东西并当场纠正错误：' +
  '① 讲到了的要点；② 没讲到但本该讲的；③ 说错或说歪的地方——第三样最要紧，要具体指出错在哪、为什么。' +
  '不要只回一句「说得不错」。然后用 api.state.check({ kind: "recall", question, answer, mentioned, missed, misconceptions }) ' +
  '把这一次记下来，按表现用 api.state.update({ mastery, note }) 修正掌握度，' +
  '把说错的地方用 api.state.mistake 记进错误记忆。'

/** 「探针」：一两道极短的问题当场验证。 */
const PROBE_INSTRUCTION =
  '请对当前知识点做一次**极短**的探针，用来验证用户是不是真的会：' +
  '先用 api.state.read() 看一眼它的自评、掌握度与错误记忆，然后出 1~2 个不用计算、能当场回答的问题——' +
  '优先戳「他自评会但掌握度不高」和「他反复错的那个地方」，例如' +
  '「不用计算，简单解释一下为什么复合函数求导要乘上内部函数的导数」。' +
  '不要出成一整张卷（那是 exam.* 的事），**现在也不要给答案**，等他回答。' +
  '等他答完，用 api.state.check({ kind: "probe", question, answer, score }) 记下结果，' +
  '按回答用 api.state.update({ mastery, note }) 修正掌握度，答错的地方用 api.state.mistake 记进错误记忆。'

/**
 * 「出卷」：类型与难度**由 Agent 问用户**（这次重构把它从界面上拿掉了），
 * 题目对象的 schema 必须内嵌在指令里——沙箱那侧没有 schema 可查，而 exam.create 的入参是自由对象；
 * 早先只写「questions」，模型猜字段猜了 55 次。
 */
const EXAM_INSTRUCTION = [
  '用户要在这个知识点出一份试卷。**类型与难度由你问用户**，不要替他决定，也不要在问之前就出题。严格按顺序：',
  '第一步｜摸底：读文档了解内容与下级知识（api.doc.read() 读教学文档、api.doc.read("笔记") 读笔记、api.node.list() 看有哪些下级节点），试卷必须包含对下级知识的考察（若有）。顺带看一眼 api.state.read() 与 api.exam.read()：掌握度、错误记忆与历史考试（history 里的 weak）告诉你该重点考什么。',
  '第二步｜问一次：用 api.ask 出一张表单，两道题——① 试卷类型（单选：随堂小测 / 小考 / 大考，选项里写清各自的题量规模）；② 难度（单选：简易 / 中等 / 难 / 极难）。最多再加一道「有没有特别想考的章节」。**不要多问**：响铃与切到对话主位已由系统在你这一轮开始前做好，不必再调 tiktok / ui.switchMain。',
  '第三步｜定时限：除随堂小测（不限时，minutes 不用给）外，按题量与难度认真估一个 **minutes**（分钟）。下限是题目数 × 2，那只是地板——要写过程、要计算的题都要多留时间；宁可宽一点，也别让用户做不完。',
  '第四步｜出题：api.exam.create({ title, kind, level, minutes, questions })，kind 取 "quiz"（随堂小测）| "test"（小考）| "exam"（大考），level 取 "easy" | "medium" | "hard" | "extreme"，并据此拟定一个简短的试卷标题。',
  '每道题写成 { type, stem, options, answer, rubric, points }：' +
    'type 取 \'single\'（单选）| \'multiple\'（多选）| \'truefalse\'（对错）| \'fill\'（填空）| \'short\'（简答）；' +
    'stem 是题干；options 写成 [{ id: \'A\', text: \'选项文字\' }, { id: \'B\', text: \'…\' }]（对错题不用给）；' +
    'answer 是选项 id 数组如 [\'A\']（单选/多选/对错必给；对错题写 [\'true\'] / [\'false\']，也不用给 options；' +
    '填空给 [\'答案\'] 则由系统判分），rubric 写评分要点或解析，points 是分值（默认 1）。',
  '格式或时限写错时这次调用不会生效，结果最前面会写清「哪里不对、该写成什么」——照那句话改一次就好，不要另出一份试着看，也不要为了确认再调一次读接口（api.exam.read() 随时能看）。',
  '出完就在对话里说一句「卷子出好了，去文档区右侧的试卷列表点「考试」」，不要在对话里重复列出题目。',
].join('\n')

/**
 * 「阅卷」：交卷后自动触发。判分与错题讲解是**同一套工作流的两步**，
 * 而且讲解必须先看历史——「这次错在哪」与「他反复错在哪」是两句不同的话。
 */
const GRADE_INSTRUCTION = [
  '学习者刚交卷。这是一套两步的活，**一次 execute 里连着做完**，不要分两轮：',
  '第一步｜看卷与看历史：api.exam.read() 给你这一次的题目、作答、系统已判好的客观题，以及 **history**（这个知识点的历次考试，每条带 weak = 那次考错的题）；attempt 里还有这次的过程记录——超时多久（overtimeMin）、切屏几次（blurCount）、单题耗时与反复改过的题。这些都是判断依据，不要只看对错。',
  '第二步｜判分：api.exam.grade({ passed, summary, results })——系统已判好单选/多选/对错/有答案填空（分数沿用系统结果、不要重复提交），你要为**每一道答错的题**补 comment 讲解（包括客观题），并给总体评价与是否完全掌握。',
  '第三步｜错题讲解：**先看 history 里反复出现的同一个错法**，那才是薄弱项；只看这一次会把它当成偶然。然后用 api.exam.explain({ content }) 写一份 Markdown 讲解：错在哪、为什么会这么错、下次遇到同类题该怎么想。历史里出现过的老毛病要正面点出来（「这个错法你上次也犯过」比再讲一遍知识点有用得多）。这份讲解会显示在只读的试卷副本页签里，将来还会被翻出来看，所以要写成能独立读懂的一段。',
  '接着照旧做两件事（同一次编排里）：① 用 api.state.mistake 把错法记进错误记忆——pattern 写「错成了什么样」，如「把 Q 和 K 的角色搞反」，不要写「第 3 题错了」，同一类错法再犯才会累加；② 按这次成绩用 api.state.update({ mastery, note }) 修正掌握度，note 里写一句依据。',
].join('\n')

/**
 * 「超级实验室」：问清用户要什么实验/功能，然后生成一份可交互的超级文档。
 * 样式规范与 api 用法在系统提示词的超级文档一节，指令里不重复——只指路。
 */
const SUPERLAB_INSTRUCTION = [
  '现在启动「超级实验室」：在当前节点做一份**超级文档**——可交互的实验或小工具，用户在页签里点、文档干活并显示结果。',
  '第一步｜问需求：用 api.ask 问用户想做什么实验 / 需要什么功能（一道简答题，给两三个贴合当前节点主题的示例选项帮他起意）。留空等于「你来定」：挑当前节点里最能帮助理解的一个知识点自拟实验，不必再问。',
  '第二步｜先想后写：确定这个实验演示什么规律或验证什么结论、用户怎么交互（按什么、改什么、看什么结果）、界面按什么顺序排。',
  '第三步｜用 api.sdoc.write 在当前节点写一份**完整可运行的 HTML**（样式与脚本规范照系统提示词的「超级文档」一节：颜色一律 var(--color-*)、布局整洁不要圆角卡片、脚本顶层初始化）。要查文档、算结果这类重逻辑先 api.method.create 落成函数，脚本里 api.method.call 调用。',
  '第四步｜用 api.ui.superdoc 打开它，用 api.ui.switchMain("doc") 把文档区切到主位，再用一两句话告诉用户这个实验能玩什么。',
].join('\n')

/**
 * 「打卡」：用出题验证过的学习，不是点一下签到。
 *
 * 这条指令是「为什么打卡不能是签到」的落地：题目只能出在**今天真正读到的节**上
 * （api.checkin.status 的 sources 就是从有效阅读记录里取的），答到门槛才算过。
 * 于是刷时长的人答不出题，想纯签到的人根本没题可出。
 */
const CHECKIN_INSTRUCTION = [
  '用户要打卡。打卡**不是签到**：必须用出题验证今天真的学进去了。严格按下面的顺序做，不要跳步。',
  '第一步｜看今天读了什么：api.checkin.status() 给出今天的有效阅读时长、可出题的节（sources：每个节都带节点、文档与标题）、还剩几次机会、建议题数与通过线、以及连续天数。',
  '　若 eligible 为 false：把 reason 原样说给用户（它已经写成「还差 12 分钟有效阅读」这种话），不要出题、不要安慰式放行、也不要替他改时间。到此结束。',
  '第二步｜出题：只从 sources 里挑内容（那是他今天真正读到的节），一个节一题，题数用 suggestQuestions。用 api.ask 出一张表单，title 写「今日打卡 · 答对 X 题算过」（X 用 suggestThreshold）。',
  '　题型只要 single / multiple 选择题：干扰项要像真的会犯的错（漏乘、符号、把充分当必要…），不要一眼就能排除，也不要在题目或选项里泄露正确项——答案只有你知道。不要出简答题（判分要准，也要快）。',
  '第三步｜判分与记录：用户提交后逐题对照你自己的答案，数出 correct，然后 api.checkin.settle({ correct, total, threshold: suggestThreshold, passed, note })。passed 由你按门槛判，但系统会复核（低于门槛一律不算过）。note 写一句话：错在哪、明天该补什么。',
  '第四步｜回话：过了就说清「连续第几天」，并指出今天最该补的那一处；没过就直说差几题、还剩几次机会，并给一条具体的补法（复习哪一节、做哪一类题）。不要长篇安慰，也不要把没过说成「没关系」。',
  '若 api.ask 返回 cancelled（用户取消）：不要重试、不要记录成绩，说明一句就好。',
].join('\n')

/**
 * 「压缩上下文」：把这段对话折成一份交接摘要（见 learn/compact）。
 *
 * 关键差别：**摘要由你（导师）自己写**，不是宿主另起一次「把历史重发一遍再总结」的请求——
 * 你本来就看得到整段上下文，直接写就行。写完调 api.compact 落进会话；
 * **本轮结束后**它才生效：那之前的消息全部失活，只剩这份摘要 + 之后的新消息进上下文。
 *
 * 因此这份指令的重点全在两件事上：**未做完的事要高保真**，以及**别做别的**。
 */
const COMPACT_INSTRUCTION = [
  '把这段对话压缩成一份**交接摘要**：本轮结束后，这之前的消息全部失活，此后只有你写的这份摘要（以及之后的新消息）继续进上下文。原始消息不会再发给你，所以摘要里没写的东西就是真的没了。按顺序做：',
  '第一步｜先列「还没做完的事」（tasks，**这是最容易丢、也最要命的部分**）：这几轮里用户要的但还没交付的、正做到一半的、你答应过还没做的，逐条写清楚——涉及哪个节点、哪一份文档、哪个文件名、卡在哪一步、下一步该做什么。要写得能让「换一个人接手」照着继续干，不要写「继续完善文档」这种空话。做完了的事不要列进来。',
  '第二步｜再写正文摘要（summary，Markdown）：## 学习目标与背景 / ## 已经讲清的内容（结论、定义、例子）/ ## 学习者的状态（自评、错在哪、还卡在哪）/ ## 约定与术语（符号写法、文件名、命名口径）。用户说过的话里凡是表达「我想要什么」的，保留原意——那是这个目标的方向。',
  '第三步｜api.compact({ summary, tasks }) 提交。**只调这一次**：不要顺手改文档、不要建节点、不要出题，也不要重复调用。',
  '第四步｜回一句话告诉用户已经压好了（比如「前面的对话已折成摘要，未完成的事我都记着」），**不要复述摘要内容**。',
  '硬性要求：只写这段对话里真实出现过的东西——不要推测、不要补常识、不要编造；概念名、公式、文件名要写全；summary 控制在 1200 字以内。',
].join('\n')

/**
 * 「伪编译」：把文档里的一段代码转译成**在这个应用里跑得起来**的 JavaScript。
 *
 * 触发方是代码块的右侧菜单（见 lib/codeBlockMenu）：它把代码、语言标记与一个 key
 * 塞进 params，然后把这条指令当作一条 user 消息发出去。**三个参数都不能少**——
 * key 是宿主认领产物的凭据（见 lib/codeArtifacts 的待编译登记），
 * 而代码原文必须由触发方给全（导师当然也能 doc.read 读到它，但那样要多花一次读，
 * 而且用户框选的那一段未必与文档里的整块一致）。
 *
 * 这条指令是「为什么编译要交给导师」的落地：残缺片段的上下文、假上下文的模拟、
 * 转译时该保留什么，全都得看文档、看这个学习者在学什么——那正是导师手里有的东西。
 */
/**
 * 「了解」：用户在正文里划了一个词、点了「了解」。
 *
 * 它与「开讲」那条路的分工：开讲是**建一个下级节点**展开讲，了解只在这个词旁边
 * 挂一条两三句的注解，不动知识结构。因此它的交付物是 api.doc.annotate ——
 * 一条划在正文上的词条注解，用户不必把视线挪到对话栏去（因此 prep 是 'show'：
 * 只响一声铃，不抢主位）。
 *
 * 词条、出现序号与选中的原文都由触发方给全：序号决定标记落在**用户划的那一处**
 * （同一个词出现好几回时，只有序号分得清），原文让导师不必为了看一眼选段就先读整篇。
 */
const EXPLAIN_INSTRUCTION = [
  '用户在文档里选中了「{{term}}」，点了「了解」——他想要一句能挂在这段文字旁边的解释。严格按顺序做：',
  '第一步｜先看它在讲什么：用 api.doc.readRange()（或 api.doc.find() 定位前后文）读**这一段所在的上下文**。解释要贴着这篇文档讲——它在这里是什么意思、为什么这么说，而不是给一段百科式的通解。',
  '第二步｜写注解：调 **api.doc.annotate({ term, occurrence, body })**：',
  '　- term 与 occurrence **原样抄下面给的值**（term 要一字不差，宿主靠它在正文里找到那一段；occurrence 是第几次出现，靠它标到用户划的那一处）；',
  '　- body：两三句话的 Markdown，直接说清它在这里指什么。不要写标题、不要写「这个词的意思是」这种开场白、不要复述整段原文，也不要写成一篇小作文——注解是挂在正文边上的一小块。',
  '　- **这一次必须调**：不调的话，用户点了「了解」而正文上什么都不会出现。',
  '第三步｜回话：一句话就够（例如「已把 X 标在正文上」）。**不要**把那段解释再抄一遍（它就在他眼前）；**也不要调 api.ui.switchMain**——他正盯着自己划的那个词，把对话栏拽到眼前只会打断他。',
  '',
  '词条：{{term}}',
  '出现次数（从 0 起）：{{occurrence}}',
  '用户选中的原文：',
  '{{snippet}}',
].join('\n')

const CODE_COMPILE_INSTRUCTION = [
  '用户点了文档里那段代码块上的「编译」。请把这段代码**伪编译**成一段能在本应用里直接跑起来的 JavaScript。严格按顺序做：',
  '第零步｜先判它有没有输出（**这一步不通过就直接结束，不要往下做**）：扫一眼这段代码——如果它从头到尾只有定义（类型、接口、函数、类、常量），没有任何会被执行的语句、也不会打印任何东西，那它转译出来照样什么都不产出。这时**立刻停止编译**：调 api.code.silent({ key, reason })（reason 一句话说清为什么，如「只有类型与函数定义，没有被调用的语句」），然后在对话里用一句话告诉用户，**不要再写 js、不要再调 code.save，也不要动主栏**。注意分寸：只要有哪怕一句会被执行的语句（一次调用、一个 print、一段循环、一次赋值后使用），就往下走，别把能跑的代码判成无输出。',
  '第一步｜看代码与它的上下文：下面那段代码很可能是个**残缺片段**（上面少一个函数定义、少两个变量、少一行 import）。用 api.doc.read()（整篇）或 api.doc.readRange() / api.doc.find()（只取需要的那段）读**这篇文档**，从上下文里把缺的东西补齐——这段代码就是从这篇文档里摘出来的。',
  '第二步｜能补就补，补不上就假设：文档里也找不到的，按代码里的用法**模拟一份合理的假上下文**（假数据、假函数都行），让整段代码能跑出可见结果。**绝不要**因为片段不完整就回一句「无法编译」。',
  '第三步｜写 JavaScript。运行环境必须按这个来：一个 Web Worker——没有 window / document / DOM，没有 require / import / export，装不了 npm 包；可以用 console.log、await、Promise、setTimeout、Math / JSON / Date / 正则、TextEncoder / TextDecoder、crypto、URL；顶层可以直接写 await（宿主会把整段代码包在 async 函数里执行）；fetch 能用，但每次运行都要用户点一次同意。要让用户看见结果就必须 console.log（对象会被结构化显示）。',
  '第四步｜交货：调 **api.code.save({ key, js, note })**：',
  '　- key：用下面给的那串，**原样抄**，别改也别自己编（宿主靠它认领是哪一块代码）；',
  '　- js：转译好的**完整、自包含**的那段代码（不要写成函数包一层，直接就是可执行的语句；需要 return 就 return）；',
  '　- note：一两句中文说明——你补了哪些假设、做了什么改动。用户会看到它。',
  '　- **这一次必须调**：不调的话，那个代码块上的「运行」永远不会亮起来。代码原文不用你回抄，宿主按 key 自己认得是哪一段。',
  '第五步｜回话：在对话里用两三句说清「改了什么、假设了什么」。不要整段复述代码（产物已经在上面那次调用里交给宿主了），也不要重复贴围栏。**也不要调 api.ui.switchMain**：用户正盯着他点的那块代码，回执就画在那儿（转圈 → 「运行」亮起），你这段话他自己会来看——把对话栏拽到眼前只会打断他。',
  '',
  '语言标记：{{language}}',
  'key：{{key}}',
  '代码：',
  '```',
  '{{code}}',
  '```',
].join('\n')

/**
 * 「复习」：间隔复习会话（计划是系统建的，见 learn/review）。
 *
 * 这条指令是「复习不是重讲课、也不是考试」的落地：先主动提取（答前不给任何提示），
 * 再按阶段侧重检查，最后落账——完成不看对错，错的东西进错误记忆供下次复习针对。
 * 阶段侧重（{{focus}}）由触发方按到期阶段算好；{{titles}} 在合并复习时是整组清单。
 */
const REVIEW_INSTRUCTION = [
  '开始一次**复习**（{{titles}}；阶段：{{stage}}）。复习不是重新讲课，也不是考试：' +
    '目标是帮他在隔了一段时间之后**主动从记忆里提取**知识，并把暴露的薄弱处记下来供下次复习针对。严格按顺序：',
  '第一步｜看清这次复习：api.review.read() 给你计划、这一阶段的侧重（focus）、历次记录、错误记忆与**可合并的候选**（candidates）。有旧薄弱项（错误记忆里 fixed: false 的）的，这次要正面检查它们。',
  '第二步｜只在有候选时才做的合并判断：candidates 里与你判断**强相关**的（同父、前后置、常一起用），' +
    '用 api.ask 问用户要不要把这几个的复习合到一次里做（表单列出节点让他勾选，写一句你为什么觉得相关）。' +
    '他同意后调 api.review.merge({ nodeIds })，之后按合并后的整组复习、每个成员各自落账；' +
    '他不同意就只复习当前节点，**不要问第二遍**。',
  '第三步｜主动提取优先：**先**请他不看教学内容，用自己的话讲一遍这个阶段该提取的核心内容。' +
    '他开口之前不给答案、不贴教学文档、不给提示——提取不出来才有复习的价值。',
  '第四步｜按阶段做检查（侧重就是上面给的 focus）：',
  '　- 回忆 / 理解阶段：简答与基础题为主，可以每题标注「（考察：XXX）」帮他知道在检查哪一块；',
  '　- 应用阶段起加入**变式**：改背景、改条件、改问法、改使用场景，不要重复教学文档里的原题；',
  '　- 迁移 / 长期保持阶段：**不再标注考察点**，给陌生的情境让他自己判断该调用什么知识、为什么。',
  '　题目必须从**这个（些）节点的教学文档**里长出来（先 api.doc.read 读它），够判断掌握情况就好，不凑题量、不为难而难。',
  '第五步｜判与落账：逐条指出漏了什么、错在哪（这才是复习的价值），然后 **api.review.record({ complete, items, missed, mistakes, fixed, mastery, node? })** 落账：',
  '　- complete：交互做完就 true——**答对答错都算完成**，不要让他重做；他中途不想继续才 false；',
  '　- mistakes：这次暴露的错法（pattern 写「错成了什么样」，同一类错法说法要稳定）；',
  '　- fixed：这次答对了的旧薄弱项（会被标为已修复，下次不再当薄弱项教）；',
  '　- mastery / note：按这次表现修正掌握度。合并复习时每个成员各调一次（node 参数指名），',
  '　　更早没做的阶段系统会自动并入这一次，不要为补课重复调用。',
  '第六步｜收尾一两句：说清这次记下了哪些薄弱项、下次复习在什么时候（read 里的 next）。不要调 api.ui.switchMain。',
  '',
  '复习节点：{{titles}}',
  '阶段：{{stage}}',
  '这一阶段的侧重：{{focus}}',
].join('\n')

/**
 * 「浏览器操作」：替用户驱动内置浏览器完成任务。之所以特化成工作流：网页是
 * **看图干活**的场景，普通对话里模型容易去猜页面内容、或想找条「读文字」的近路——
 * 这里把「看 = 截图、动手 = 模拟鼠标键盘」钉成唯一的路子，并把连招塞进同一次
 * execute（连招才是浏览效率的主要来源），推理档位给 low（识别与决策都轻）。
 */
const BROWSER_USE_INSTRUCTION = [
  '你要替用户操作**内置浏览器**（文档区那种地球图标页签）完成任务。这一轮只用 api.browser.* 与 api.wait：',
  '**看 = snapshot（元素清单）/ read（整页 markdown）/ capture（截图，最后手段），',
  '动手 = browser.dom（对 ref 做受控 DOM 操作）**——没有执行任意页面 JS 的通道，',
  '也不要用 web.webFetch 凑合（那是另一个抓取器，看不到登录态）。',
  '',
  '流程：',
  '1. 先 api.browser.tabs() 看存活页签；没有合适的就 api.browser.open(网址) 开一个（纯关键词会当搜索词）。',
  '   后续操作按 tabId 指名；省略 tabId 指焦点格正看着的那个。',
  '2. **看**：先 api.browser.snapshot(tabId?) 拿「带 ref 的可交互元素清单」，认结构、找要点的元素全靠它；',
  '   要整页文字就 api.browser.read(tabId?)（转 markdown，与 webFetch 同管线：短的回全文、长的落盘回',
  '   大纲+uuid，登录态页面也能读），用 web.read(uuid, "节") 按节读。**截图（capture）是最后手段**，',
  '   只有布局与视觉必须亲眼看时才用；页面还在加载时先 api.wait(800)。',
  '3. **动手**：api.browser.dom(tabId?, ref, op, arg?)——对 snapshot 清单里的 ref 做受控操作：',
  '   "click" 点它 / "fill" 填文字（触发 input/change，React 输入框也认）/ "focus" 聚焦 /',
  '   "submit" 提交所在表单 / "text" 取元素文字 / "attr" 取属性（如 "href"）。',
  '   表单的连招：fill → submit；个别站点不认程序化点击时，用 point 高亮请用户手点。',
  '4. **指给用户看**：api.browser.point(tabId?, { ref } 或选择器)——页面滚到该元素并高亮一阵。',
  '',
  '编排纪律（少一轮是一轮，这是这个工作流的生命线）：',
  '- **一段 execute 写完一条完整的链**：snapshot → 按清单判断 → dom 的 fill/submit 连招 → read 收尾，',
  '  不要每个动作单独一轮。',
  '- 拿不准就用 **if/else + try/catch 把备选一次写全**：ref 过期就在 catch 里重新 snapshot 再试、',
  '  选择器失败换 { ref }、dom 点不动就 point 高亮请用户手点——失败被接住继续走，程序不中断，',
  '  也省掉「试一次、看报错、再试」的额外轮次。',
  '- **capture 只用在 snapshot/read 拿不到信息的时候**（看布局、验证视觉结果）。',
  '',
  '卡住了就问，别内耗：',
  '- 某一步你无法独立完成（验证码、登录、系统权限弹窗、页面就是不给面子）——**api.ask 把情况',
  '  说清楚，等用户来操作**；表单回来后接着干。',
  '- 表单一分钟没人理会会自动超时收回（回执里 timedOut: true）：那时你自行判断——换个路子继续，',
  '  或把手头的成果交付掉、说清卡在哪，等用户回来看。',
  '- **不会就是不会，绝不内耗**：同一个目标连续两次尝试失败，或你判断这条路走不通，就停下交付——',
  '  把已完成的、卡在哪、需要用户做什么说清楚。反复重试耗的是用户的 token。',
  '- 临近交付：这一轮开了很多页签的话，用 api.browser.close 把中间搜索页、试错页签挑没用的关掉，',
  '  留下用户可能还要看的；用户自己开的页签别动。',
  '',
  '安全纪律：这是用户的**真实登录会话**。提交订单、支付、删除、发送消息这类不可逆动作，',
  '必须先用 api.ask 跟用户确认再动手；用户没让关的页签不要 api.browser.close。',
].join('\n')

/**
 * 内置条目的定义形：没有时间戳（它们不是「登记」出来的），runnable 可以不给（默认能跑）。
 * effort 是**推荐档**——交付物型的厚（教学文档、出卷）、对话型的薄（探针、注解），
 * 逐条写在定义里；这是产品对「这项功能的底线质量」的表态，用户随时可以覆盖。
 */
type BuiltinDef = Omit<WorkflowRow, 'tier' | 'runnable' | 'createdAt' | 'updatedAt' | 'effort'> & {
  runnable?: boolean
  effort?: ReasoningEffort
}

/** 内置工作流的定义：id 稳定（触发与探针都靠它），名字就是对话里的分界条文案。 */
const BUILTIN_DEFS: BuiltinDef[] = [
  {
    id: 'teach-node',
    name: '开讲',
    description: '摸底前置知识盲点后，生成针对性的教学文档',
    instruction: TEACH_NODE_INSTRUCTION,
    prep: 'ask',
    // 核心交付物是教学文档：要深，但 max 的等待不值
    effort: 'high',
  },
  {
    id: 'goal-outline',
    name: '学习大纲',
    description: '为新学习目标起标题、写描述、写总述与第一层大纲',
    instruction: GOAL_OUTLINE_INSTRUCTION,
    // 标题 / 描述 / 大纲决定后续学习路径，值得想透
    effort: 'high',
  },
  {
    id: 'outline',
    name: '生成大纲',
    description: '为当前知识点规划或重写大纲（只列直接子层级一层）',
    instruction: OUTLINE_INSTRUCTION,
    // 交付物长在大纲页里（用户多半正盯着它）：只响一声铃、不抢主位
    prep: 'show',
    // 大纲规划要全局权衡层级
    effort: 'high',
  },
  {
    id: 'recall',
    name: '回忆',
    description: '合上文档，让用户讲一遍，当场纠正并记录',
    instruction: RECALL_INSTRUCTION,
    params: ['title'],
    // 对话交互，跟人的节奏走；材料是用户说的话，想太深反而拖节奏
    effort: 'medium',
  },
  {
    id: 'probe',
    name: '探针',
    description: '一两道极短的口答题，当场验证是不是真的会',
    instruction: PROBE_INSTRUCTION,
    // 极短输出、快响应优先；唯一要克制的是别出成表面题，low 保留薄思考
    effort: 'low',
  },
  {
    id: 'exam',
    name: '出卷',
    description: '先问清类型与难度，再出一份带时限的试卷',
    instruction: EXAM_INSTRUCTION,
    // 它自己会先 ask 一次（类型 / 难度），所以没有占位符、也从列表里可跑
    prep: 'ask',
    // 题干与干扰项质量直接影响学习；卷子的章法主要靠指令模板，high 是质量与等待的平衡点
    effort: 'high',
  },
  {
    id: 'exam-grade',
    name: '阅卷',
    description: '判分 + 看历史错题写讲解、记错法、修正掌握度（交卷后自动跑）',
    instruction: GRADE_INSTRUCTION,
    // 必须先有人交卷：从列表里空跑只会得到「没有需要讲解的考试」
    runnable: false,
    // 判分记错账会污染复习计划，讲解要质量；判分对照本身偏机械，max 的边际收益不值多等的
    effort: 'high',
  },
  {
    id: 'explain',
    name: '了解',
    description: '就正文里选中的那段文字写一条两三句的注解，划在正文上（选中文字 →「了解」触发）',
    instruction: EXPLAIN_INSTRUCTION,
    // 词条、序号与选段都由触发方补齐；从工作流列表里空跑没有词条可讲
    params: ['term', 'occurrence', 'snippet'],
    runnable: false,
    // 只响一声铃、不切主位：交付物就画在用户盯着的那段文字旁边（同「伪编译」）
    prep: 'show',
    // 选中即出的两三句注解，等待感最明显
    effort: 'low',
  },
  {
    id: 'superlab',
    name: '超级实验室',
    description: '问清想做什么实验，生成一份可交互的超级文档',
    instruction: SUPERLAB_INSTRUCTION,
    prep: 'ask',
    // 生成可交互 HTML/JS：复杂代码合成是 max 收益最大的场景，失败代价最高、也等得起
    effort: 'max',
  },
  {
    id: 'code-compile',
    name: '伪编译',
    description: '把文档里这段代码转译成可运行的 JS，产物交给它运行',
    instruction: CODE_COMPILE_INSTRUCTION,
    // 代码、语言与 key 由代码块菜单补齐；从工作流列表里空跑没有意义
    params: ['language', 'key', 'code'],
    runnable: false,
    // 只响铃、不切主位：用户点的是代码块，回执也在那儿（转圈 → 运行亮起），见 WorkflowRow.prep
    prep: 'show',
    // 转译规则明确、代码块通常短
    effort: 'medium',
  },
  {
    id: 'compact',
    name: '压缩上下文',
    description: '把前面的对话折成一份交接摘要（旧消息随即失活）',
    instruction: COMPACT_INSTRUCTION,
    // 摘要失真会带坏之后所有轮次：low 会丢细节，medium 保真与速度平衡
    effort: 'medium',
  },
  {
    id: 'checkin',
    name: '打卡',
    description: '按今天读到的内容出几道题，答到门槛才算打卡',
    instruction: CHECKIN_INSTRUCTION,
    // 它的交付物就是一张 ask 表单（压在输入框上方）：响一声铃并把对话栏切到主位
    prep: 'ask',
    // 每日仪式要快；题目只基于当日内容，范围小
    effort: 'medium',
  },
  {
    id: 'review',
    name: '复习',
    description: '按间隔复习计划带用户做一次复习：先主动提取，再按阶段检查并落账',
    instruction: REVIEW_INSTRUCTION,
    // 复习的第一步就是「请他合上文档讲一遍」：响铃 + 把对话栏切到主位，等他说
    prep: 'ask',
    // 触发方按到期阶段补齐（见 useWorkflowStarters 的 startReview）；
    // 从列表空跑拿不到 titles / stage / focus，所以不开放——入口在顶栏的复习面板
    params: ['titles', 'stage', 'focus'],
    runnable: false,
    // 主动提取的对话体验优先
    effort: 'medium',
  },
  {
    id: 'browser-use',
    name: '浏览器操作',
    description: '替用户操作内置浏览器：截图看页面、模拟鼠标键盘完成任务',
    instruction: BROWSER_USE_INSTRUCTION,
    // 全程看图干活：识别与决策都轻，low 足够——快才是浏览效率
    effort: 'low',
  },
]

/** 内置工作流的 id 集：normalize 剪 efforts 幽灵键、UI 判「有没有推荐档」都认它 */
export const BUILTIN_WORKFLOW_IDS: ReadonlySet<string> = new Set(BUILTIN_DEFS.map((d) => d.id))

/** 内置工作流的推荐档（id → 档位）：resolveWorkflowEffort 的 'default' 落点 */
export const BUILTIN_EFFORT: Record<string, ReasoningEffort> = Object.fromEntries(
  BUILTIN_DEFS.map((d) => [d.id, d.effort ?? 'high']),
)

/* ---------- 触发前的宿主准备 ---------- */

/**
 * 一条工作流触发前，宿主该做哪两下。
 *
 * 规则只有一条：**切主位只给「不回答就走不下去」的那种**（prep: 'ask'，第一步是一张
 * 压在输入框上方的表单）。其余一律不动主栏——切主位是从用户手里把视线抢走，
 * 他可能正在读文档；交付物在对话里（如「伪编译」）也不构成理由，
 * 因为那次点击的回执就画在他点的地方（代码块上的转圈与随后的「运行」）。
 *
 * 抽成纯函数是为了让这条规矩有个能被钉住的地方（见 tests/workflows.test.ts）：
 * 它写在 useAgent 的回调里时，只有真跑一轮才验证得了。
 */
export function workflowPrep(prep: WorkflowRow['prep']): { beep: boolean; takeMain: boolean } {
  if (!prep) return { beep: false, takeMain: false }
  return { beep: true, takeMain: prep === 'ask' }
}

/**
 * 一轮该用哪档思考。行上没配（用户没动过）时：内置用推荐档、登记的跟随聊天；
 * 'chat' 跟随聊天滑条；'default' 取内置推荐（登记的没有推荐，回落聊天）；
 * 其余即固定档，原样。聊天滑条只对聊天框发起的轮直接生效——工作流轮的档位
 * **独立于它**（这是有意设计：出卷要深、探针要快，一个全局滑条伺候不了所有任务）。
 * 抽成纯函数与 workflowPrep 同一条理由：配置解析要有能被钉住的地方。
 */
export function resolveWorkflowEffort(
  row: Pick<WorkflowRow, 'id' | 'tier' | 'effort'>,
  chatEffort: ReasoningEffort,
): ReasoningEffort {
  const setting = row.effort ?? (row.tier === 'builtin' ? 'default' : 'chat')
  if (setting === 'chat') return chatEffort
  if (setting === 'default') return BUILTIN_EFFORT[row.id] ?? chatEffort
  return setting
}

/** 内置工作流列表（顺序即设置里的展示顺序；时间戳为 0——它们不是登记出来的） */
export function builtinWorkflowRows(): WorkflowRow[] {
  return BUILTIN_DEFS.map((d) => ({
    ...d,
    tier: 'builtin' as const,
    runnable: d.runnable ?? true,
    createdAt: 0,
    updatedAt: 0,
    // 推荐档不冒充用户配置：row.effort 只装用户的三态设置（listWorkflowRows 再挂），
    // 推荐档经 BUILTIN_EFFORT 按 id 查——两套语义不能混在同一个字段里
    effort: undefined,
  }))
}

/* ---------- 登记表的纯逻辑 ---------- */

const globalOf = (store: LearnStore): WorkflowEntry[] => store.workflows?.global ?? []
const goalOf = (store: LearnStore, goalId: string): WorkflowEntry[] =>
  goalId ? (store.workflows?.byGoal?.[goalId] ?? []) : []

/** 三级并成一张列表：内置在前，全局次之，目标级最后（同名的不会有——登记时就按名去重） */
export function listWorkflowRows(store: LearnStore, goalId: string | null): WorkflowRow[] {
  // 用户配过的思考档位（键 = id，内置与登记通吃）挂到行上；没配的保持 undefined
  const efforts = store.workflows?.efforts ?? {}
  const rows: WorkflowRow[] = builtinWorkflowRows()
  for (const r of rows) r.effort = efforts[r.id]
  for (const e of globalOf(store)) rows.push({ ...e, tier: 'global', runnable: true, effort: efforts[e.id] })
  if (goalId) for (const e of goalOf(store, goalId)) rows.push({ ...e, tier: 'goal', runnable: true, effort: efforts[e.id] })
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
  input: { name?: unknown; instruction?: unknown; description?: unknown },
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
  const list = tier === 'global' ? globalOf(store) : goalOf(store, goalId)
  const existing = list.find((w) => w.name.toLowerCase() === name.toLowerCase())
  const entry: WorkflowEntry = existing
    ? { ...existing, instruction, description: description || existing.description, updatedAt: at }
    : {
        id: 'wf_' + at.toString(36) + Math.random().toString(36).slice(2, 8),
        name,
        description,
        instruction,
        createdAt: at,
        updatedAt: at,
      }
  const nextList = existing ? list.map((w) => (w === existing ? entry : w)) : [...list, entry]
  const book = {
    global: tier === 'global' ? nextList : (store.workflows?.global ?? []),
    byGoal: tier === 'goal' ? { ...(store.workflows?.byGoal ?? {}), [goalId]: nextList } : (store.workflows?.byGoal ?? {}),
    // 档位配置按 id 记在全局表里，登记的新建 / 覆盖都原样带走
    efforts: store.workflows?.efforts,
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
  // 登记删了，配过的档位也一并删：efforts 按 id 记在全局表里，留键成幽灵
  const efforts = { ...(store.workflows?.efforts ?? {}) }
  delete efforts[removedId]
  return { ...store, workflows: { global: nextGlobal, byGoal, efforts } }
}

/**
 * 给一条工作流配思考档位（三态，键 = id，内置与登记通吃；配置写在全局 efforts 表）。
 * id 不认识任何工作流（内置 ∪ 已登记）时原样返回 store——配置不能落在不存在的东西上。
 */
export function setWorkflowEffort(store: LearnStore, id: string, effort: WorkflowEffortSetting): LearnStore {
  const key = (id ?? '').trim()
  if (!key) return store
  const known =
    BUILTIN_WORKFLOW_IDS.has(key) ||
    globalOf(store).some((w) => w.id === key) ||
    Object.values(store.workflows?.byGoal ?? {}).some((list) => list.some((w) => w.id === key))
  if (!known) return store
  const efforts = { ...(store.workflows?.efforts ?? {}) }
  efforts[key] = effort
  return {
    ...store,
    workflows: {
      global: globalOf(store),
      byGoal: store.workflows?.byGoal ?? {},
      efforts,
    },
  }
}

/**
 * 把指令里的 {{占位符}} 换成实参；没给到的占位符原样留下——
 * 那是登记时写漏了参数，触发方（与用户）看得见比静默替换成空串好。
 */
export function renderWorkflowInstruction(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole))
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
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
    })
  }
  return out
}

/**
 * 读回 state.json 里的思考档位配置：键必须指向一条真实存在的工作流（validIds 由调用方
 * 按「内置 ∪ 当时还登记着的」算好），值必须是三态之一；其余整键丢弃——幽灵键留着，
 * 只会让读代码的人以为还有第 14 条内置工作流。
 */
export function normalizeWorkflowEfforts(
  raw: unknown,
  validIds: ReadonlySet<string>,
): Record<string, WorkflowEffortSetting> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, WorkflowEffortSetting> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validIds.has(id)) continue
    if (v === 'default' || v === 'chat' || REASONING_EFFORTS.includes(v as ReasoningEffort)) {
      out[id] = v as WorkflowEffortSetting
    }
  }
  return out
}
