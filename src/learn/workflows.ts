import { REASONING_EFFORTS, type ReasoningEffort } from '../ai/types'
import { promptModuleByKey, type PromptModule } from './ai/promptModules'
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
 * 摸底（宿主已先响铃）→ 思考 → 生成针对性教学文档。
 */
const TEACH_NODE_INSTRUCTION = [
  '这个节点刚被创建，标题、描述、文档多半还是占位或空的。你要为它创建教学文档，但**不许直接开写**——先摸底再动笔。严格按下面的顺序：',
  '第一步｜整理前置知识与多源检索：结合节点标题、上级节点的文档（api.node.read / api.files.read 只读需要的部分）与你的学科判断，列出学会这个主题**绕不开的前置知识点**（一般 3~6 条：太少说明没拆开，太多说明没抓住主干）。**必须积极使用网络搜索（api.web.search）与网页抓取（api.fetch）**检索当前主题的权威讲义、官方文档或前沿实践进行比对提炼，收集真实权威的技术与事实依据，避免凭模型自身主观意志捏造教学内容。',
  '第二步｜摸底提问：用 api.ask 出一张表单，每条前置知识一道单选题「这个我已经掌握 / 会一点 / 完全不会」。表单会压在输入框上方，用户答完你才会继续——不要自问自答，也不要跳过这一步。（响铃提醒已由系统在你这一轮开始前做好，不必再调 tiktok。）',
  '第三步｜想清楚再动笔：按摸底结果定详略——「完全不会」的前置要先补讲，「会一点」的点到为止，「已掌握」的直接用；再想好文档结构：先讲什么、后讲什么、在哪衔接补讲的内容。',
  '第四步｜生成：',
  '1. 标题是用户选中的原词、不够准确的先 api.node.rename；描述空着就 api.node.update(path, { description }) 写 150~300 字。',
  '2. 按第三步的构思并结合网络搜索比对提炼出的权威资料 api.files.write 教学文档（写入对应 docs/.../节点名.md）：循序渐进、先直觉与例子再定义与推导，对摸底暴露的盲点**正面讲解**。**排版以当前「文档格式」策略为准（Markdown 与 HTML 各占多少照它来），结构配方见「文档排版与图表」提示词模块**：至少落下两三处结构性元素（提示框 / 两栏 / 步骤 / 图表），不要交一篇只有标题与段落的纯文本。' +
    '**来源引证规范（硬性）**：若本轮编写使用了网络检索（api.web.search / api.fetch），必须在教学文档末尾包含「## 📚 参考资料与权威来源」区块声明所有参考的真实网站网址与名称，并在最终对话回复中附带「### 🌐 参考与引证来源」，严禁遗漏来源。',
  '3. 大纲：这个节点下面还会展开子层级的（教学路线里确实分阶段），用 api.files.write("docs/.../节点名.outline.json", JSON.stringify({ intro, children }, null, 2)) 把**直接子层级**列进大纲' +
    '（children 每项 { title, summary }，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」，' +
    '孙辈的大纲由那些子目标自己的 outline 负责）；确定是叶子知识点的就不调它，大纲保持空白即可。',
  '4. 用 api.files.read("docs/.../节点名.meta.json") 看学习状态：有错误记忆的，这次讲解要正面处理那个错法；把摸底结果记下——每条前置按用户的答案从「已掌握」到「完全不会」挑最接近的一档。',
  '用户留空的题当作「会一点」处理，不要追问。先 api.node.read() 看一眼现状再开工，不要整篇读文档，也不要再找用户要确认。',
  '写完文档后用 api.ui.point() 把这份教学文档在文档区打开（已经开着就切到它），再请用户看刚生成的教学文档。若使用了网络检索，对话回复中必须声明参考资料链接。',
].join('\n')

/**
 * 「学习大纲」：新目标的系统性规划。交付物是**大纲页**（结构化的大纲 + 交互页），
 * 不再是把大纲整篇塞进教学文档——教学文档只写总述，路线住在大纲文件里
 * （见 learn/outline 的 OutlineDoc：创建节点时两份文件同时生成，导师往里写内容）。
 */
const GOAL_OUTLINE_INSTRUCTION = [
  '这是用户刚新建的学习目标。用户的提问与参考资料附件在会话首条消息中，当前根节点的标题还是用户原话的临时形态。',
  '若用户在首条消息或当前指令中附带了参考资料、文件或大纲图片，必须仔细研读这些附件内容，优先依据附件中的知识脉络与核心要求来规划目标与大纲。',
  '',
  '【第一步｜交互确认目标创建模式（强制使用 api.ask）】',
  '在动笔生成大纲与文档前，**必须首先调用 api.ask 询问用户需要使用的创建模式**：',
  '表单题目：选择目标创建模式（单选）',
  '- 选项 A: 探索式（默认模式：生成根节点文档和初步大纲，后续节点由用户逐步确认生成。边探索边构建）',
  '- 选项 B: 规划式（先规划，再执行：生成根节点文档，并通过多源深度网络调研生成完整大纲树）',
  '- 选项 C: 完整式（一次性全套交付：生成完整大纲树，并一次性生成所有节点的完整教学文档）',
  '',
  '【重要：多轮确认纪律（规划式二次确认，完整式三次确认）】',
  '规划式和完整式由于生成时间较长，因此必须通过 api.ask 进行多轮确认：',
  '1. 探索式：用户选择探索式后，无需额外确认，立即开始执行。',
  '2. 规划式（必须二次确认）：',
  '   - 第二次确认：调用 api.ask 表单（标题「确认规划完整大纲树」，说明规划式将通过网络搜索深入调研行业规范与课程大纲，耗时稍长），选项提供「确认开始规划完整大纲树」与「返回修改为探索式」。用户确认后方可执行。',
  '3. 完整式（必须三次确认）：',
  '   - 第二次确认：调用 api.ask 表单（标题「耗时与生成规模评估」，说明完整式将一次性规划完整大纲树并生成所有节点的完整详尽讲义，消耗较多轮次与时间），选项提供「了解耗时，继续确认」与「返回修改为探索式」。',
  '   - 第三次确认：调用 api.ask 表单（标题「最终确认启动全量生成」，提示保持网络通畅与会话连接，询问是否立即启动），选项提供「确认立即启动全量生成」与「取消并改为探索式」。三次确认完成后方可启动。',
  '',
  '【第二步｜目标基础命名与描述更新】',
  '1. 用 api.node.rename(path, 新标题) 给这个目标起一个准确的主题名（长成数据目录名，去掉问句成分）。',
  '2. 用 api.node.update(path, { description }) 写一段 150~300 字的目标描述，阐明目标边界、核心技能与学习要求。',
  '3. 用 api.files.write 编写根节点的教学文档总述（写入 docs/.../目标名.md）：概述知识体系与起步建议。若参考了网络资料，**末尾必须包含「## 📚 参考资料与权威来源」，且必须使用网页类 chip（#[{"type":"web","url":"...","title":"..."}]）声明，严禁普通 Markdown 超链接 [文字](url)**。注意 chip 宽度有限，title 请精炼（15~25 汉字以内）。',
  '',
  '【第三步｜按所选模式执行大纲树与文档生成】',
  '- **若为探索式**：',
  '  用 api.files.write 写根节点大纲（docs/.../目标名.outline.json，或调 api.outline.write）：intro 一两段说明阶段划分，children 列出直接子层级（只写直接子层级一层），每项 { title, summary }。后续节点由用户在界面中逐步确认生成。',
  '- **若为规划式**：',
  '  必须积极调用 api.web.search 检索行业规范与权威学术大纲，**调用 api.node.createTree({ parent: rootId, tree: [...] }) 生成完整大纲树**（包含各层级分支与子节点，填充 title、description 与 outline），先规划完整棵知识树。',
  '- **若为完整式**：',
  '  必须积极调用 api.web.search 检索技术细节与实战范式，**调用 api.node.createTree({ parent: rootId, tree: [...] }) 一次性生成完整大纲树，并为所有节点在 content 字段中填入详尽、高质量的教学讲义（每篇讲义末尾以网页类 chip 声明权威来源）**，一次性交付全套体系。',
  '',
  '全部完成后调用 api.ui.point() 打开根节点教学文档并在大纲页中呈现完整学习路线。',
].join('\n')

/**
 * 「生成大纲」：给任意一个节点规划或重写它这一层的大纲（手动触发——大纲页上的
 * 「请导师生成大纲」，或工作流列表）。与「学习大纲」的分工：那条只管刚新建的总目标，
 * 这一条管所有节点（阶段目标要拆下一层、或者计划变了要重排）。
 */
const OUTLINE_INSTRUCTION = [
  '请为当前知识点**规划或重写它这一层的大纲**（写入 docs/.../节点名.outline.json，整份覆盖）。严格按顺序：',
  '第一步｜先看现状：api.files.read("docs/.../节点名.outline.json") 看已有大纲（有就整份重写，不要追加），api.node.read() 看标题、描述与现有下级节点，api.files.read(docPath, { maxBytes: 2000 }) 扫一眼教学文档的开头与标题结构（不要整篇读）。',
  '第二步｜多源检索与直接子层级规划：**多使用网络搜索（api.web.search）与抓取（api.fetch）**获取该知识分支的权威分类目录与行业标准脉络进行比对提炼，避免凭借主观臆造。这一层往下拆成哪几个**阶段目标**（一般 3~8 个，每个都能独立成篇、有明确的「学完会什么」）。已经有下级节点的，计划要与它们对齐——同一个人同一层不该有两套说法。',
  '第三步｜api.files.write("docs/.../节点名.outline.json", JSON.stringify({ intro, children }, null, 2))：intro 一两段（这一层按什么路线走、为什么这么分）；children 每项 { title, summary }，summary 两三句——学什么、为什么排在这个位置。key 由标题自动生成，不要自己编。',
  '深度规矩（硬性）：只写**直接子层级**，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」。孙辈的大纲由那些子目标自己的 outline 负责；children 里不要出现「1.1.1」这类两层以下的东西，summary 里也不要替孙辈规划。',
  '写完用 api.ui.point() 把这份文档在文档区打开，让用户在大纲页里看这一层的路线。',
].join('\n')

/**
 * 「出卷」：类型与难度由 Agent 问用户，出题后直接保存试卷文件。
 */
const EXAM_INSTRUCTION = [
  '用户要在这个知识点出一份试卷。**类型与难度由你问用户**，不要替他决定，也不要在问之前就出题。严格按顺序：',
  '第一步｜摸底：先调 const p = await api.node.paths() 获取当前知识点的物理路径（含 dir, examsDir, doc, id 等），用 api.files.read(p.doc) 读教学文档与笔记，api.node.list() 看有哪些下级节点，试卷必须包含对核心知识的考察。',
  '第二步｜问一次：用 api.ask 出一张表单，两道题——① 试卷类型（单选：随堂小测 / 小考 / 大考，选项里写清各自的题量规模）；② 难度（单选：简易 / 中等 / 难 / 极难）。最多再加一道「有没有特别想考的章节」。**不要多问**：响铃已由系统在你这一轮开始前做好，不必再调 tiktok。',
  '第三步｜定时限：除随堂小测（不限时，minutes: 0）外，按题量与难度认真估一个 minutes（分钟）。下限是题目数 × 2——要写过程、要计算的题多留时间；宁可宽一点，也别让用户做不完。',
  '第四步｜检索查证与出题落盘：**积极使用网络搜索（api.web.search）**检索该知识点的权威考试真题、标准题型、规范公式与参考题解进行比对提炼，严禁单凭模型自身主观意志编造生硬题目或错误答案。生成试卷唯一 ID（examId，如 ex_xxxx），构造完整符合 Schema 的试卷 JSON 对象（含 id: examId, nodeId: p.id, goalId: p.goalId, title, kind, level, minutes, createdAt: Date.now(), questions, attempts: []），用 api.files.write(`${p.dir}/exams/${examId}.json`, JSON.stringify(exam, null, 2)) 保存到对应节点下的 exams/ 目录中。文件名强制为 `${examId}.json`，attempts 必须传空数组 []。',
  '每道题写成 { id, type, stem, image, options, answer, rubric, points }：' +
    'type 取 \'single\'（单选）| \'multiple\'（多选）| \'truefalse\'（对错）| \'fill\'（填空）| \'short\'（简答）；' +
    'stem 是题干；options 写成 [{ id: \'A\', text: \'选项文字\' }, { id: \'B\', text: \'…\' }]（对错题为 true/false 两项）；' +
    'answer 是选项 id 数组如 [\'A\']（单选/多选/对错必给；对错题写 [\'true\'] / [\'false\']；填空给 [\'答案\']），rubric 写评分要点或解析，points 是分值（默认 1）。',
  '题面两条硬规矩：**① 涉及数学公式时必须用 LaTeX 写进 stem / options**（行内 $…$、独立公式 $$…$$）——不要用 Unicode 字符近似；' +
    '**② 需要图形的题给 image 字段**：值是完整的 SVG 源码（以 <svg 开头、</svg> 结尾，带 viewBox 与坐标数据）。',
  '出完就在对话里告诉用户试卷已生成并列出试卷名称与题量，请用户开始作答。',
].join('\n')

/**
 * 「阅卷」：交卷后自动触发，判分并写错题讲解。
 */
const GRADE_INSTRUCTION = [
  '学习者刚交卷。这是一套完整的阅卷流程，**一次 execute 里连着做完**，不要分两轮：',
  '第一步｜读取试卷与作答：先调 const p = await api.node.paths()，用 api.files.read(`${p.dir}/exams/${examId}.json`) 读取试卷。取出最新一次作答（exam.attempts[exam.attempts.length - 1]）。**注意严格边界**：用户的 answers、inputs、dwell、blurs 是真实客观作答事实，**严禁修改篡改任何字符或数据项**！',
  '第二步｜判分与解析：对照参考答案逐题评判客观题，依据 rubric 评判填空题与简答题，更新最新 attempt 上的 status 为 "graded"、results 评分项列表 [{ questionId, correct, score, maxScore, comment, by: "agent" }]、passed、summary 评价以及 explanation 详尽步骤推导解析。',
  '第三步｜写回试卷：将更新了最新 attempt 评价数据的完整 exam JSON，用 api.files.write(`${p.dir}/exams/${examId}.json`, JSON.stringify(exam, null, 2)) 写回磁盘。同时可写一份 Markdown 批改小结（如 `${p.dir}/exams/${examId}_批改.md`）。',
  '第四步｜修正掌握度：用 api.node.update(p.path, { status: passed ? \'mastered\' : \'learning\' }) 更新掌握状态，并将高频薄弱错法写入当前节点的错题记录（如 `${p.notesDir}/错题.md`）。',
].join('\n')

/**
 * 「超级实验室」：问清用户要什么实验/功能，然后生成一份可交互的超级文档。
 */
const SUPERLAB_INSTRUCTION = [
  '现在启动「超级实验室」：在当前节点做一份**超级文档**——可交互的实验或小工具，用户在页签里点、文档干活并显示结果。',
  '第一步｜问需求：用 api.ask 问用户想做什么实验 / 需要什么功能（一道简答题，给两三个贴合当前节点主题的示例选项帮他起意）。留空等于「你来定」：挑当前节点里最能帮助理解的一个知识点自拟实验，不必再问。',
  '第二步｜先想后写：确定这个实验演示什么规律或验证什么结论、用户怎么交互（按什么、改什么、看什么结果）、界面按什么顺序排。',
  '第三步｜落盘 HTML：先调用 const p = await api.node.paths() 获取当前节点目录，使用 api.files.write 写入一份完整可运行的自包含 HTML 文件（路径必须为 `${p.dir}/superdocs/${实验名}.html`，样式变量使用 var(--color-*)，说明装进 <moji-markdown>）。若包含复杂的计算函数，可通过 api.method.create 保存并通过 window.api.method.call 调用。',
  '第四步｜用 api.ui.superdoc(p.path, \'实验名\') 打开该超级文档页签，再用一两句话告诉用户这个实验能玩什么。',
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
 * 「了解」：用户在正文里划了一个词、点了「了解」。
 */
const EXPLAIN_INSTRUCTION = [
  '用户在文档里选中了「{{term}}」，点了「了解」——他想要一句能挂在这段文字旁边的解释。严格按顺序做：',
  '第一步｜先看它在讲什么：先调用 api.node.paths() 得到当前教学文档路径，用 api.files.read(doc, { maxBytes: 2000 }) 读**这一段所在的上下文**。解释要贴着这篇文档讲——它在这里是什么意思、为什么这么说，而不是给一段百科式的通解。',
  '第二步｜写注解：调用 api.node.annotate（兼容 api.doc.annotate）({ term: \'{{term}}\', occurrence: {{occurrence}}, body: \'注解内容\' }) 将注解标在正文对应位置；同时可用 api.files.write 把词条解释记录进笔记（如 docs/.../节点.notes/词条解释.md）。',
  '第三步｜回话：一句话就够（例如「已把 {{term}} 的注解标在正文上」）。不要把那段解释再在对话中抄一遍。',
  '',
  '词条：{{term}}',
  '出现次数（从 0 起）：{{occurrence}}',
  '用户选中的原文：',
  '{{snippet}}',
].join('\n')

const CODE_COMPILE_INSTRUCTION = [
  '用户点了文档里那段代码块上的「编译」。请把这段代码**伪编译**成一段能在本应用里直接跑起来的 JavaScript。严格按顺序做：',
  '第零步｜先判它有没有输出（**这一步不通过就直接结束，不要往下做**）：扫一眼这段代码——如果它从头到尾只有定义（类型、接口、函数、类、常量），没有任何会被执行的语句、也不会打印任何东西，那它转译出来照样什么都不产出。这时**立刻停止编译**：调 api.code.silent({ key, reason })（reason 一句话说清为什么，如「只有类型与函数定义，没有被调用的语句」），然后在对话里用一句话告诉用户，**不要再写 js、也不要再调 code.save**。注意分寸：只要有哪怕一句会被执行的语句（一次调用、一个 print、一段循环、一次赋值后使用），就往下走，别把能跑的代码判成无输出。',
  '第一步｜看代码与它的上下文：下面那段代码很可能是个**残缺片段**（上面少一个函数定义、少两个变量、少一行 import）。用 api.files.read(docPath) 读**这篇文档**，从上下文里把缺的东西补齐——这段代码就是从这篇文档里摘出来的。',
  '第二步｜能补就补，补不上就假设：文档里也找不到的，按代码里的用法**模拟一份合理的假上下文**（假数据、假函数都行），让整段代码能跑出可见结果。**绝不要**因为片段不完整就回一句「无法编译」。',
  '第三步｜写 JavaScript。运行环境必须按这个来：一个 Web Worker——没有 window / document / DOM，没有 require / import / export，装不了 npm 包；可以用 console.log、await、Promise、setTimeout、Math / JSON / Date / 正则、TextEncoder / TextDecoder、crypto、URL；顶层可以直接写 await（宿主会把整段代码包在 async 函数里执行）；fetch 能用，但每次运行都要用户点一次同意。要让用户看见结果就必须 console.log（对象会被结构化显示）。',
  '第四步｜交货：调 **api.code.save({ key, js, note })**：',
  '　- key：用下面给的那串，**原样抄**，别改也别自己编（宿主靠它认领是哪一块代码）；',
  '　- js：转译好的**完整、自包含**的那段代码（不要写成函数包一层，直接就是可执行的语句；需要 return 就 return）；',
  '　- note：一两句中文说明——你补了哪些假设、做了什么改动。用户会看到它。',
  '　- **这一次必须调**：不调的话，那个代码块上的「运行」永远不会亮起来。代码原文不用你回抄，宿主按 key 自己认得是哪一段。',
  '第五步｜回话：在对话里用两三句说清「改了什么、假设了什么」。不要整段复述代码（产物已经在上面那次调用里交给宿主了），也不要重复贴围栏——用户正盯着他点的那块代码，回执就画在那儿（转圈 → 「运行」亮起），你这段话他自己会来看。',
  '',
  '语言标记：{{language}}',
  'key：{{key}}',
  '代码：',
  '```',
  '{{code}}',
  '```',
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
  '也不要用 api.fetch 外部抓取凑合（那是另一个抓取器，看不到登录态）。',
  '',
  '流程：',
  '1. **开工第一步必先 api.browser.tabs() 清点存活页签，这一步不可跳过**：目标网址已经',
  '   开着就直接 api.browser.activate 到它，绝不重复 api.browser.open 同一个网址——',
  '   页签越开越多，后面收拾它们全是额外动作。没有合适的才 open（纯关键词会当搜索词）。',
  '   后续操作按 tabId 指名；省略 tabId 指焦点格正看着的那个。',
  '2. **看**：先 api.browser.snapshot(tabId?) 拿「带 ref 的可交互元素清单」，认结构、找要点的元素全靠它；',
  '   要整页文字就 api.browser.read(tabId?)（转 markdown：短的回全文、长的落盘回大纲，登录态页面也能读）。**截图（capture）是最后手段**，',
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
 * effort 是**推荐档**——交付物型的厚（教学文档、出卷）、对话型的薄（了解、压缩），
 * 逐条写在定义里；这是产品对「这项功能的底线质量」的表态，用户随时可以覆盖。
 */
type BuiltinDef = Omit<WorkflowRow, 'tier' | 'runnable' | 'createdAt' | 'updatedAt' | 'effort'> & {
  runnable?: boolean
  effort?: ReasoningEffort
}

/** 内置工作流的定义：id 稳定（触发与校验都靠它），名字就是对话里的分界条文案。 */
const BUILTIN_DEFS: BuiltinDef[] = [
  {
    id: 'teach-node',
    name: '开讲',
    description: '摸底前置知识盲点后，生成针对性的教学文档',
    instruction: TEACH_NODE_INSTRUCTION,
    // 这一次的交付物就是一份讲义：排版配方（HTML + Tailwind 的六个可抄配方）必须**动笔之前**在场——
    // 靠 doc.* 写入触发只会晚一轮，第一份文档就永远是纯 HTML 草稿（v0.5.8 踩过）。
    // 纯 Markdown 策略下这一份会被格式过滤拦掉（见 runTurnUnchecked 的 effectiveModules）
    promptModule: 'doc-html',
    prep: 'ask',
    // 核心交付物是教学文档：要深，但 max 的等待不值
    effort: 'high',
  },
  {
    id: 'goal-outline',
    name: '学习大纲',
    description: '交互确认创建模式（探索式/规划式/完整式），为新目标规划大纲树与编写讲义',
    instruction: GOAL_OUTLINE_INSTRUCTION,
    // 同「开讲」：总述也是讲义，排版配方要先于动笔在场
    promptModule: 'doc-html',
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
    id: 'exam',
    name: '出卷',
    description: '先问清类型与难度，再出一份带时限的试卷',
    instruction: EXAM_INSTRUCTION,
    promptModule: 'exam',
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
    promptModule: 'exam',
    // 必须先有人交卷：从列表里空跑只会得到「没有需要讲解的考试」
    runnable: false,
    // 判分记错账会污染掌握度，讲解要质量；判分对照本身偏机械，max 的边际收益不值多等的
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
    promptModule: 'sdoc',
    prep: 'ask',
    // 生成可交互 HTML/JS：复杂代码合成是 max 收益最大的场景，失败代价最高、也等得起
    effort: 'max',
  },
  {
    id: 'code-compile',
    name: '伪编译',
    description: '把文档里这段代码转译成可运行的 JS，产物交给它运行',
    instruction: CODE_COMPILE_INSTRUCTION,
    // 产物交付的 api 口径（save / silent）随这条工作流注入一次
    promptModule: 'code',
    // 代码、语言与 key 由代码块菜单补齐；从工作流列表里空跑没有意义
    params: ['language', 'key', 'code'],
    runnable: false,
    // 响一声铃就够：用户点的是代码块，回执也在那儿（转圈 → 运行亮起），见 WorkflowRow.prep
    prep: 'show',
    // 转译规则明确、代码块通常短
    effort: 'medium',
  },
  {
    id: 'compact',
    name: '压缩上下文',
    description: '把前面的对话折成一份交接摘要（旧消息随即失活）',
    instruction: COMPACT_INSTRUCTION,
    // api.compact 的生效时机与参数口径随这条工作流注入一次
    promptModule: 'compact',
    // 压缩是摘录式改写：材料全在上下文里，不需要额外推理，None 最快也最省
    effort: 'none',
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
 * 一轮该用哪档思考。行上没配（用户没动过）时：内置用推荐档、登记的跟随聊天；
 * 'chat' 跟随聊天滑条；'default' 取内置推荐（登记的没有推荐，回落聊天）；
 * 其余即固定档，原样。聊天滑条只对聊天框发起的轮直接生效——工作流轮的档位
 * **独立于它**（这是有意设计：出卷要深、了解要快，一个全局滑条伺候不了所有任务）。
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

/**
 * 一条工作流触发时要注入哪些提示词模块（动态提示词注入，见 learn/ai/promptModules）：
 * - 内置条目的 promptModule 指到注册表里的内置模块（key 原样）；
 * - 登记条目的 prompt 是自己的规程文本，按 wf:<id> 作键动态成模块。
 * 两者都有就都注入（去重在宿主那边做：同一 key 只注一次）。都没有就是空。
 */
export function workflowModules(
  row: Pick<WorkflowRow, 'id' | 'name' | 'prompt' | 'promptModule'>,
): PromptModule[] {
  const out: PromptModule[] = []
  if (row.promptModule) {
    const m = promptModuleByKey(row.promptModule)
    if (m) out.push(m)
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
      // 规程提示词（动态注入用，见 workflowModules）：形状不对就不带这一块
      ...(typeof m.prompt === 'string' && m.prompt.trim() ? { prompt: m.prompt } : {}),
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
