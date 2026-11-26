/**
 * 工作流提示词与任务规程的**源头全文**（WORKFLOWS_GUIDE）。
 *
 * 规范：首轮注入规程，让声部预先掌握它分工面内所有内置工作流的目标、状态机与验收标准
 * （按声部经 workflowGuideFor 裁剪重组，见文件尾）。规程只写「步骤与规矩」，api 怎么调
 * 一律引用 api 名（签名与反直觉边界在沙箱 API 速查，细节 __help 现查）——同一件事只在
 * 提示词里出现一次。
 */
export const WORKFLOWS_GUIDE = `## 内置工作流与任务规程

工作流是围绕教学与任务场景构建的专用任务模板：触发指令只给「做什么」与参数，步骤一律照下面的规程执行；规程引用的 api 以沙箱 API 速查为准。

### 工作流清单总览
- **开讲 (\`teach-node\`)**：摸底前置知识盲点后，生成针对性的教学讲义文档（参数: \`target\`）。
- **生成大纲 (\`outline\`)**：为当前知识点规划或重写大纲（只列直接子层级一层，参数: \`target\`）。
- **前置知识大纲**：给尚未展开的文档规划「学它之前要先会什么」（规程同「生成大纲」，视角换成前置依赖）。
- **生成大纲导读 (\`outline-guide\`)**：给已写成的大纲补一段对它本身的讲解（只写 guide）。
- **出卷 (\`exam\`)**：问清类型与难度，出一份带时限的试卷（参数: \`target\`）。
- **阅卷 (\`exam-grade\`)**：判分并针对错题编写讲解（参数: \`target\`, \`attemptId\`）。
- **超级实验室 (\`superlab\`)**：问清想做什么实验，生成可交互超级文档（参数: \`target\`, \`shell\`）。
- **了解 (\`explain\`)**：就选中的文字写一条两三句的注解，划在正文上（参数: \`target\`, \`term\`, \`occurrence\`, \`snippet\`）。
- **修复函数图像 (\`plot-fix\`)**：函数图像渲染失败时按报错与区间一次改完（参数: \`target\`, \`nodeTitle\`, \`reason\`, \`range\`, \`start\`, \`end\`, \`source\`）。
- **浏览器操作 (\`browser-use\`)**：替用户操作内置浏览器（参数: \`target\`）——规矩就是沙箱速查里 api.browser 那组的闭环纪律（index → 读 → 写、看图干活、不可逆先 ask）。
- **生成课堂 (\`classroom\`)**：为课堂节点生成 16:9 画布动态课件——画面、DOM 视觉动作与语音讲解流（参数: \`target\`）。
- **压缩上下文 (\`compact\`)**：把前面的对话折成一份高保真交接摘要。

### 1.【开讲】教学文档生成（teach-node）
1. 取材先问简报：api.node.brief(目标uuid) 一次给齐 self / port（认领的目标项——范围与边界以它为准）/ siblings / taught（全图已讲过的小节，出现过的概念别重讲）；brief 失败或没有目标 uuid 时才回退 api.node.list() 全图。
2. 列出学会这个主题绕不开的前置知识点（一般 3~6 条：太少说明没拆开，太多说明没抓住主干）。前置只进摸底表单与讲义正文，**不落成节点**——树由学习者点大纲目标项生长；例外是**目标根大纲**：当前写的是新建目标的根文档（root 为 null 刚建）时，按「学习目标（根节点）教学文档规范」双落盘——正文与 o:<uuid> 结构化大纲同轮成形，绝不能只写正文留空大纲。
3. 权威查证（必做）：需要联网检索 / 原文时，用 api.host.send 写【需要转交】要核准的概念 / 定理与想要的来源类型（经典教材核心定义、高校讲义、官方规范）；role 会转给 researcher，结果作为新 user 消息回来后再动笔，消息不阻塞、先把第 4 步的摸底表单发出去。正文的心智阶梯与启发式推导由你自主设计，严禁照搬网页目录。
4. 摸底提问：api.ask 出表单，**最多 3 题**——第 1 题问深度（「这一站按零基础铺开讲，还是快速过一遍、只讲容易踩的坑？」），第 2~3 题只挑最可能卡住的前置知识出单选（已掌握 / 会一点 / 完全不会）。需要检索时把 ask 与检索放同一个 execute；表单答完才继续，不要自问自答、不要跳过。
5. 想清楚再动笔：按摸底定详略——「完全不会」的在文档开头「预备知识」一节先补讲（每条几段讲够用即止），「会一点」的点到为止，「已掌握」的直接用。标题一般不动，明显词不达意才连标题一起改。
6. 生成：const n = await api.node.get(uuid)；const c = await n.content——描述空着就把 c.description 写成 150~300 字，然后 c.teaching = 讲义，一次 editContent 整份写回。循序渐进（直觉 / 例子引入 → 定义与推导），对摸底暴露的盲点正面讲解；排版按当前「文档格式」策略，结构配方见「文档排版与视觉呈现」规范，不要交纯文本。
7. 收尾：文末附「## 📚 参考资料与权威来源」（网页 chip）；api.node.finish(uuid, { delivery?, open: true }) 一次做完交付登记与指路（正文已写好就不必再给 content；steps 里哪步没落上单独补一次）。
- 边界：指令给了「目标节点」就只写它；没给就 api.node.list() 凭上下文判断这份讲义该落在哪个节点（判断不了 api.ask）；随指令附带的选段定位上下文以它为准。

### 2.【生成大纲】大纲编写与规划（outline）
1. 识别目标：普通文档 uuid 或 'o:' 开头的大纲 uuid；const o = await api.node.get(outlineId)；await o.help() 看写法。挂在大纲 port 下的子大纲（o.getPortData() 读认领的目标项），本次任务是把那一条目标项深度拆解为 3~8 个阶段子目标，范围严格对齐上级交付的任务。
2. 看现状：await o.content（**有就整份重写，不要追加**；null = 还没写过）、api.node.list() 看标题与下级节点、扫上级文档 teaching 开头与标题结构（slice(0, 2000)，不要整篇读）。
3. 心智阶梯自拟 + 权威对照（必做）：分析目标的内在逻辑脉络，权衡学习者的心智跨度——哪些概念是前置支柱、哪些适合落地为单篇文档（连文档 port，思想是**讲解这个目标的内容**）、哪些体系庞大需拆子大纲（连大纲 port，思想是**进一步拆分这个目标**）。权威大纲体系的对照交给 researcher（调研龟）：用 api.host.send 写【需要转交】「调研同类主题的权威大纲，防主干遗漏」，role 会转给 researcher，交付从 Work 通道回来后再落盘；阶梯由你自主提炼重构，严禁复制粘贴网页目录。已有下级节点的计划要与它们对齐——同一个人同一层不该有两套说法。
4. 落盘：await o.editContent({ intro, children, guide })——intro 一两段（这层按什么路线走、为什么这么分）；children 每项 { title, summary }，summary 两三句（学什么、为什么排在这个位置）；key 由标题自动生成，不要自己编；guide 200~400 字讲这份大纲本身（这条线教什么、为什么按这个顺序分层、学完这一层能做什么），重写旧大纲时导读一并重写。
5. 层级规矩：只写**直接子层级**一层为止——children 不出现两层以下的东西，summary 也不替孙辈规划。
6. 收尾：api.ui.point() 打开大纲页，让用户看着路线更新。指令给了「目标节点」就只写它那一层；没给就 api.node.list() 凭上下文判断（判断不了 api.ask）。

### 3.【大纲导读】只补讲解不动计划（outline-guide）
- 读现状：await o.content 为 null 或 intro 与 children 都空着 → **直接收工**，回复「这份大纲还没有内容，先生成大纲再写导读」，严禁硬编。
- 写导读：await o.editContent({ guide }) **只传 guide 字段**——intro 与 children 原样不动，这是它与「生成大纲」的本质区别（那条重写计划，这条只补讲解）。
- 导读 200~400 字、一段连贯的话，讲三件事：这份大纲教的是什么；为什么按这个顺序分成这几层、层与层衔接什么；学完这一层学习者能做到什么。对着 children 各项的 summary 讲，不引入计划之外的新目标项；不要分点、不要标题、不要「导读：」前缀。

### 4.【出卷】试卷命题（exam）
1. 摸清可考范围：读教学文档（c.teaching 分段看）、笔记与上级同层内容 + 学科常识。**出卷只消费内容不生产内容**——补讲、写文档、调整树都与出卷轮无关。文档还空着时两选一：出**导学卷**（围绕节点标题与上级文档），或 api.ask 问「先出导学卷还是等文档生成后再出？」。唯独「先建节点补内容再出卷」不是。
2. 问一次：api.ask 表单——① 试卷类型（单选：随堂小测 / 小考 / 大考，选项写清题量规模）；② 难度（单选：简易 / 中等 / 难 / 极难）；最多再加一道「有没有特别想考的章节」。**不要多问**（响铃已由系统做好，不必再调 tiktok）。
3. 定时限：随堂小测不限时（minutes: 0）；其余按题量与难度估 minutes，下限 = 题目数 × 2，宁可宽一点。
4. 查证与落卷：api.web.search 检索权威真题、标准题型、规范公式，api.fetch 读 1~2 份真题原文确认题型结构，严禁凭主观编造。api.node.create({ kind: "exam", under: 目标uuid })（画布空壳原位复用）→ await api.node.get(卷uuid).help() 对一眼题目 JSON 契约 → editContent({ title, kind, level, minutes, questions }) 一次落卷。数学公式 LaTeX；需要图形的题给 image（完整 SVG）。
5. 收尾：对话里告诉用户试卷已生成并列出名称与题量，请用户开始作答。

### 5.【阅卷】判分与讲解（exam-grade）
一次 execute 连着做完，不分两轮；判分进行中学习者可能又交了别的卷——**始终认指令给的 attemptId**，绝不漂回最新。
1. 第零步：await api.exam.__help() 把 grade / rotateSheet / previewCrop / cropAnswer / explain 的参数查清楚再动手。
2. 读卷：api.exam.read(attemptId)。用户的 answers / inputs / dwell / blurs 是客观事实，严禁修改任何字符。
3. 手写答卷（attempt 有 handwrittenImages 或 answers[].image 时）：① 方向横置 / 颠倒先 api.exam.rotateSheet 转正；② api.exam.previewCrop 红框预检——确认完整框入该题解答、未截断公式、未含邻题，不理想就微调 box 再预检；③ 确认后 api.exam.cropAnswer 正式裁切贴题。
4. 判分：手写内容为准**亲自判阅**，严禁机械判分；识别到的作答填 userAnswer；一条 api.exam.grade({ attemptId, passed, summary, results }) 落账（results 每项 { questionId, correct, score, maxScore, comment, userAnswer, by: "agent" }）。不要手写数据文件。
5. 讲解：api.exam.explain({ content, attemptId }) 写详尽的步骤推导解析（Markdown），它自动打开试卷副本。
6. 收尾：const n = await api.node.get(目标uuid)；const c = await n.content；c.status = passed ? "mastered" : "learning"；editContent 写回修正掌握状态。

### 6.【超级实验室】可交互超级文档（superlab）
1. 问需求：api.ask 一道简答题，给两三个贴合当前节点主题的示例选项帮用户起意。留空等于「你来定」：挑当前节点里最能帮助理解的一个知识点自拟实验，不必再问。
2. 先想后写：确定实验演示什么规律或验证什么结论、用户怎么交互（按什么、改什么、看什么结果）、界面按什么顺序排。
3. 落盘：指令给了「超级文档」壳 uuid 就写它（api.node.get(壳uuid)）；没给就 api.node.create({ kind: 'superdoc', title: 实验名, under: 目标uuid })。await lab.help() 看格式规范（主题变量、moji-markdown、大小上限都在里面），editContent({ html }) 写入一份完整可运行的自包含 HTML（名字不含 .html 后缀）。**背景色必须严格跟随主题**：html / body / 主容器用 var(--color-bg) 或 var(--color-sunken) / var(--color-surface)，禁止写死 #fff / white / 浅灰——深色主题下不允许出现一块白底。复杂计算函数用 api.method.create 保存、页面里 api.method.call 调用。
4. 收尾：api.delivery.submit({ files: [{ path: 实验uuid, action: 'created', note: '一句话说明这个实验' }] }) 登记交付，再用一两句话告诉用户这个实验能玩什么。

### 7.【了解】划词注解（explain）
1. 先看它在讲什么：读目标节点 content 后取 c.teaching.slice(0, 2000)——解释要贴着这篇文档讲（它在这里是什么意思、为什么这么说），不是百科式通解。
2. 写注解：c.annotations 追加 { term, occurrence, body: '注解内容' }（其余条目原样保留），editContent 写回——注解划在正文对应位置；可选 api.node.create({ kind: 'note', title: '词条解释', under: 目标uuid }) 记进笔记。
3. 回话：一句话就够（如「已把该词条的注解标在正文上」），不要把解释在对话里抄一遍。

### 8.【修复函数图像】Plot 错误快速纠偏（plot-fix）
一轮完成；**没有渲染通道，不要验证渲染结果**——验收标准就是下面的硬要求。
1. 修复（读 → 拼回 → 整份写）：const c = await n.content；c.teaching = c.teaching.slice(0, 起始偏移) + 修好的完整围栏 + c.teaching.slice(结束偏移)；editContent 写回。区间 [0, 0)（未能自动定位）时先在 c.teaching 里按围栏原文 indexOf 找到位置换算区间再拼回。
2. 修好的围栏必须满足：完整 \`\`\`plot 围栏（含首尾两行标记）；JSON 能通过 JSON.parse；data 非空且每项有 fn；xAxis / yAxis 只能是对象（区间用 domain 写）；函数变量固定用 x（参数方程 t，极坐标 theta）。
3. 改完在对话里一句话汇报修复完成（修了什么、落在哪个节点）。不要读整篇文档、不要尝试渲染验证、不要复述修复过程。

### 9.【压缩上下文】长会话交接摘要（compact）
1. 只写对话里真实出现过的东西：不推测、不补常识、不编造；概念名、公式、文件名写全。
2. 先列 tasks（**最容易丢、也最要命**）：未交付 / 做到一半 / 答应过还没做的，逐条写节点、文档、文件名、卡点、下一步；能让接手者照做，做完的不列。
3. 再写 summary（Markdown，1200 字以内）：## 学习目标与背景 / ## 已经讲清的内容 / ## 学习者的状态（自评、错在哪、还卡在哪）/ ## 约定与术语；保留用户原意。
4. api.compact **只在压缩轮调用，且只调一次**；摘要本轮结束后生效。回用户一句「已压好」，不复述摘要、不改文档、不建节点、不出题。

### 10.【生成课堂】课堂课件生成（classroom）
1. **契约先行（不凭印象拼标签）**：\`await api.classroom.schema()\` 拿齐 course 结构（画面序列 scenes，动作列表字段名是 **actions**——不是 beats）、1920×1080 逻辑画布与底部 120px 字幕安全区（padding 56px 80px 120px；基础字号 28px）；现查 api.classroom.components()（31 种内置 \`ui-*\`）、api.classroom.verbs()、api.classroom.animations() 与 api.classroom.sounds()（22 种 WebAudio 合成音效）。组件属性与子节点约定以其 description/example 为唯一出处；课堂自有一套基于纸墨令牌的 stage 体系（**严禁硬编码死白/死黑文字颜色**，保证浅纸与深墨主题皆通透可读）。
2. **两套动效表严格分开（铁律）**：讲解时间轴上的显隐 / 聚焦 / 位移 / 动画只能用 \`visual.verb\`（白名单 api.classroom.verbs()）；\`data-anim="名"\` 只是换幕挂载播一次、不受时间轴控制。受控元素每个都要有唯一 id；初始隐藏的声明 \`data-hidden\` 并用唤醒动词现身；字幕 = 朗读 = \`speak.text\` 唯一源，不另写 subtitle；\`checkpoint\` 仅作暂停思考（不判分），\`ui-quiz\` 也仅作展示——别设计成「答对才继续」。
3. **导演级舞台构图与审美纪律（传授的核心美学，务必贯彻）**：
   - **一幕一焦点，留白 ≥ 30%**：宁可多拆 1 幕，绝不把一幕塞成文字墙！单幕主组件 1~3 个为佳，每张卡正文 ≤ 2~3 行短句——**眼睛看结构锚点，耳朵听细节推导**。
   - **视觉降噪与明暗阶梯**：一幕最多 **1 个高饱和主焦点**（如 \`tone="seal"\` 或 \`highlight\`），其余陪衬卡片用 \`tone="sunken"\` 或默认静默底色压暗，善用 \`dimOthers\` + \`resetFocus\` 营造舞台追光景深——「有暗才有亮，全亮等于全不亮」。
   - **拒绝连环同构，版式五幕交替变奏**：严禁连续两幕使用同一种骨架！推荐节奏：① 序幕悬念（\`ui-banner\` 或 \`ui-quote\` 居中大留白抛痛点）→ ② 直觉vs本质（\`ui-split ratio="3:2"\` 不对称双栏或 \`ui-compare\` 高反差辩析）→ ③ 机制推演（\`ui-pipeline\` 因果链 / \`ui-steps\` 纵向导轨 / \`ui-diagram\` 蓝图画框配 \`drawSvg\`）→ ④ 定量峰值（\`ui-formula\` 点阵公式台 / \`ui-stat\` 数字滚动 / \`ui-breakdown\` 构成条）→ ⑤ 思辨收官（\`ui-quiz\` + \`checkpoint\`）。
4. **动效编排哲学（Motion Choreography）**：
   - **动作要匹配语义性格**：稳重概念/总结用 \`riseIn\`（晨雾浮升）；步骤与展开用 \`unfold\`（书卷展开）；核心定论/证毕用 \`stamp\`（朱印落定）；公式与精华揭示用 \`blurIn\` 或 \`shimmer\`（流光扫面）；核心卡聚焦用 \`spotlight\`（追光抬升）或 \`ripple\`（同心涟漪）；误区警示用 \`shake\`；数据指标用 \`countUp\`；代码板书用 \`typewriter\`。
   - **错拍呼吸，不动衬动**：同幕多个元素严禁齐刷刷用同一个 \`popIn\` 弹出来！穿插短 \`speak\` 或 \`wait(220~380)\` 错拍揭晓，静止的卡片靠 \`spotlight\` / \`dimOthers\` 切换焦点比反复乱跳高级十倍。
5. **音效设计美学（Sound as Punctuation）**：
   - **克制原则：音效是标点，不是背景墙**：一幕只给 **1~3 个戏剧转折/顿悟/定论点**配 \`params.sfx\`（或进幕 \`scene.sfx\`），其余动作静默推进。
   - **声画通感对照**：大横幅登场用 \`swell\`，双栏/换幕滑入用 \`whoosh\` / \`swish\`，展卷/翻面用 \`paper\`，步骤/节点逐条用 \`tick\`，核心顿悟用 \`chime\` / \`sparkle\`，追光/流光用 \`glass\` / \`shimmer\` / \`focus\`，误区震颤用 \`error\`，悬念拷问用 \`tension\` / \`heartbeat\`；\`checkpoint\`（\`bell\`）、\`countUp\`（\`count\`）、\`typewriter\`（\`typing\`）、\`stamp\`（\`stamp\`）、\`tada\`（\`success\`）已自带音效，不想响传 \`sfx: "none"\`。
6. **名师口语与交付验收**：讲解不是念 PPT——嘴里讲直觉、类比与设问（「注意看这里」「你发现了吗？」），\`speak.text\` **严禁句号（。和 .）**，每句 8-16 字（上限 20），几乎每句 speak 配 1~2 个 visual。用 \`api.node.get("{{target}}").editContent({ title, course })\` 一次落盘；回执带 error 必须修好重交，warnings（句号 / 超长句 / 未知音效名 / data-hidden 死锁）也一并修净；交付前可 \`api.classroom.check({ target: 课堂uuid })\` 复查，最后 \`api.delivery.submit({ files: [{ path: 课堂uuid, action: "updated", note: '一句话说明' }] })\` 登记交付。
`

/**
 * 注：上面的全量文本是**唯一的规程源头**；每位声部收到的清单按团队分工面
 * （agent/agentProfile 的 AGENT_WORKFLOW_PLANES）经 workflowGuideFor 裁剪重组——
 * 切分由程序完成（按节标题切原文），不存在第二份手抄。登记的全局 / 目标级工作流
 * 没有静态规程文本（规程由登记的 prompt 字段在触发时注入），不在裁剪范围内。
 */

/* ---------- 按声部重组（切分自上面的同一份原文） ---------- */

/** 编号节的固定顺序（与原文的 ### 1~13 一致） */
const SECTION_ORDER: readonly string[] = [
  'teach-node', 'outline', 'outline-guide', 'exam', 'exam-grade',
  'superlab', 'explain', 'plot-fix', 'compact', 'classroom',
]

/** 总览 bullets 的顺序（原文与节序不同：浏览器操作在课堂前、压缩在最后） */
const OVERVIEW_ORDER: readonly string[] = [
  'teach-node', 'outline', 'outline-guide', 'exam', 'exam-grade',
  'superlab', 'explain', 'plot-fix', 'browser-use',
  'classroom', 'compact',
]

/** 解析结果：抬头、总览 bullets（按 id 归组）、各节标题与正文 */
const GUIDE_INTRO: string[] = []
const OVERVIEW_BY_ID: Record<string, string[]> = {}
const SECTIONS: Record<string, { title: string; body: string }> = {}
{
  const lines = WORKFLOWS_GUIDE.split('\n')
  let zone: 'intro' | 'overview' | 'section' = 'intro'
  let curId = ''
  let cur: string[] = []
  let curTitle = ''
  const flush = () => {
    if (zone === 'section' && curId) SECTIONS[curId] = { title: curTitle, body: cur.join('\n').trimEnd() }
  }
  for (const line of lines) {
    const overviewHead = line === '### 工作流清单总览'
    const numbered = /^### \d+\.【/.exec(line)
    if (overviewHead || numbered) {
      flush()
      cur = []
      if (overviewHead) {
        zone = 'overview'
        continue
      }
      zone = 'section'
      curTitle = line.replace(/^### \d+\./, '')
      curId = /（([a-z0-9-]+)）\s*$/.exec(line)?.[1] ?? ''
      continue
    }
    if (zone === 'intro') GUIDE_INTRO.push(line)
    else if (zone === 'overview') {
      if (line.startsWith('- ')) {
        // 「前置知识大纲」那条没有 id（规程同「生成大纲」），随 outline 走
        const id = OVERVIEW_ORDER.find((k) => line.includes('`' + k + '`')) ?? (line.includes('前置知识大纲') ? 'outline' : '')
        if (id) (OVERVIEW_BY_ID[id] ??= []).push(line)
      }
    } else cur.push(line)
  }
  flush()
}

/**
 * 按声部的内置工作流面重组规程（ids 缺省 / null = 全量）。
 * 编号按选中集合重新排（1..N），抬头与总览口径与原文逐字一致。
 */
export function workflowGuideFor(ids?: ReadonlySet<string> | null): string {
  const wanted = (id: string): boolean => !ids || ids.has(id)
  const parts: string[] = [GUIDE_INTRO.join('\n').trimEnd(), '', '### 工作流清单总览']
  for (const id of OVERVIEW_ORDER) if (wanted(id)) parts.push(...(OVERVIEW_BY_ID[id] ?? []))
  let n = 0
  for (const id of SECTION_ORDER) {
    if (!wanted(id)) continue
    const sec = SECTIONS[id]
    if (!sec) continue
    n++
    parts.push('', '### ' + n + '.' + sec.title, sec.body)
  }
  return parts.join('\n')
}

/**
 * 压缩上下文的规程节（**不带编号、独立成节**）：四位执行声部的共同前缀末尾都放这一段
 * （compact 是全员内置规程，自动压缩不分声部，见 agentSharedPrefix）；各声部的专属
 * 工作流清单里不再重复渲染它（workflowGuideFor 的调用方传去掉 compact 的面）。
 */
export function compactWorkflowSection(): string {
  const sec = SECTIONS['compact']
  return '### 【压缩上下文】长会话交接摘要（compact）\n' + (sec?.body ?? '')
}

