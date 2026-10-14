/**
 * 这个文件负责什么：**动态提示词注入**的模块注册表——低频能力的完整规范住在这里，
 * 系统提示词里只留一行索引；模型第一次真正用到某组 api（或写出某种内容）时，
 * 宿主把对应模块作为一条隐藏 user 消息注入上下文，**同一上下文只注一次**。
 *
 * 为什么这样拆：EXECUTE_GUIDE 曾把十几个低频域的完整手册整段压在系统提示词里
 * （sdoc 3k、browser 1.8k、exam 1.5k……），每一轮请求都全价付一遍，而多数对话
 * 根本用不到。搬进模块后：不用不花钱；用到时全文在场（不是压缩版）；压缩上下文后
 * 模块随旧消息失活，下次使用自动重新注入——判据见 missingPromptModules。
 *
 * 纪律：
 * - **模块文本与实现对账**：这里的每一段都源自 EXECUTE_GUIDE 的对应小节（无损搬移），
 *   api 行为改了这里也要改——apiCatalog 的目录页与 agent-ops 探针只对账「有没有」，
 *   对不了「写得对不对」。
 * - **key 一经使用不可改**：去重靠消息上的 promptModule 字段（落盘在 chat.json），
 *   改 key 等于让所有老对话的「已注入」记录作废。
 * - 模块文本必须**自包含**：模型读到它时上下文里没有别处的铺垫，开头一句要说清这是什么。
 */
import type { ConversationMessage } from '../../agent/types'
import { t } from '../../i18n'

export interface PromptModule {
  /** 稳定标识：去重、消息标记、触发映射全靠它（见文件头纪律） */
  key: string
  /** 界面分界条上显示的名字（mark = 提示词模块 · {title}） */
  title: string
  /** 注入上下文的完整文本（自包含） */
  text: string
}

export const PROMPT_MODULES: PromptModule[] = [
  {
    key: 'sdoc',
    title: '超级文档',
    text: `超级文档（Superdoc）——自包含单页交互应用（HTML / SVG / JS / CSS），独立渲染在主文档区页签：

一、物理路径体系与命名契约
- 节点超级文档（推荐）：每个知识点节点下可包含多个超级文档，物理存放于 docs/.../superdocs/<名称>.html。
  - 获取当前节点路径：先调用 const p = await api.node.paths()，返回对象中包含 dir、superdocsDir。
  - 完整物理文件路径形如：\`\${p.dir}/superdocs/\${name}.html\`（例如 docs/微积分/superdocs/极限动态演化.html）。
- 目标根级超级文档：存放于 \`superdocs/\${name}.html\`。
- 命名契约：文件名强制以 .html 结尾；在界面中与 api.ui.superdoc 中引用的名称 name 不含 .html 后缀。

二、怎么读与怎么写（核心动线）
1. 读取已有超级文档：
   - 查验列表：await api.files.list(\`\${p.dir}/superdocs/\`)；
   - 读取源码：await api.files.read(\`\${p.dir}/superdocs/\${name}.html\`)。
2. 创建与写入：
   - 使用标准文件写入：await api.files.write(\`\${p.dir}/superdocs/\${name}.html\`, htmlCode)。
   - 写入后立即在文档区展示：await api.ui.superdoc(p.path, name)（若为当前激活节点可直接 await api.ui.superdoc(name)）。
   - 局部改动：await api.files.edit(\`\${p.dir}/superdocs/\${name}.html\`, { replace: { old: '...', new: '...' } }) 或 files.write 整体覆写。
   - 响应式同步机制已打通：api.files 写入或修改后，底层 VFS 事件总线会在 0ms 乐观同步至应用内存状态并驱动 React 实时刷新，绝不会发生 0 字节清空或静默还原。

三、技术格式规范
- 自包含单页：HTML 中直接书写完整结构、<style> 内联样式与 <script> 交互代码。
- 主题变量：自适应系统深浅色外观，使用 CSS 变量：
  - 背景容器：var(--color-bg)、var(--color-sunken)、var(--color-surface)
  - 文本排版：var(--color-ink)、var(--color-ink-strong)、var(--color-ink-soft)
  - 边框与点缀：var(--color-seal)、var(--color-line)、var(--color-warn)、var(--color-success)
- 富文本说明组件：在页面中嵌入 <moji-markdown># 实验原理\\nLaTeX数学公式 $f(x)=\\\\lim...$ 与要点</moji-markdown>，宿主会自动解析渲染为结构化 Markdown。
- 沙箱脚本联动（持久化方法）：
  - 页面内的按钮或交互如需执行复杂的计算、数据汇总或跨节点分析，可在沙箱中通过 api.method.create({ name: 'calc', code: '((api, ...args) => { ... })' }) 创建持久化方法。
  - 超级文档内部 JS 通过 window.api.method.call('calc', ...args) 调用该方法。
- 内置超链接协议：
  - 静态资源：moji:static/{uuid}
  - 超级文档跳转：moji:super/{name}
  - 节点跳转：moji:node/{nodeId}

四、读写边界与严禁行为
- ✅ 能写：纯 HTML/CSS/JS 代码、SVG 矢量动画、moji-markdown 讲解、调用 window.api.method.call。
- ❌ 严禁调用退役桩：api.sdoc.write / api.sdoc.read（调用即抛异常，已被收敛为 api.files）。
- ❌ 严禁写入非法路径：不要脱离 superdocs/ 目录写入未归档的 HTML 文件。`,
  },
  {
    key: 'browser',
    title: '内置浏览器',
    text: `内置浏览器（browser.open / browser.tabs / browser.activate / browser.close / browser.snapshot / browser.point / browser.dom / browser.read / browser.capture / browser.logs / browser.logDetail / browser.fetch / browser.record / browser.text / browser.scroll）——这份规范在你第一次操作内置浏览器时注入：
- 这一组操作的是**界面上开着的网页页签**（文档区里那种地球图标页签）。没有页签就先
  api.browser.open('https://…') 开一个：纯关键词会当搜索词处理；返回 tabId，那时首屏已基本加载完。
- api.browser.tabs()：列出存活的页签。**browser.open 之前先查它**：目标网址已经开着就 activate
  过去，别重复开同一个网址。之后一切操作按 tabId 指名；省略 tabId 指「焦点格正看着的那个网页」。
- **看页面三招（按便宜程度排）**：
  - api.browser.snapshot(tabId?, { role?, contains?, limit? }?)：把可交互元素列成**带 ref 的清单**——
    认结构、找要点的元素全靠它。**大页面一定给过滤**：{role:"link"}、{contains:"关键词"}、{limit:30}，
    整份捞大页面就是 5k token 换 2 条信息。DOM 变了 ref 会过期，重新 snapshot 就好。
  - api.browser.text(tabId, { ref } | 选择器, { maxChars? }?)：取**渲染后**的区域文本（≤4000 字）——
    SPA 上唯一的文本通道，webFetch 提取不出正文的页面（报「没提取出正文」）靠它，不是截图。
  - api.browser.read(tabId?, { maxChars?, offset? }?)：整页转 markdown，与 web.webFetch 同一条管线
    （短的回全文，长的落盘回大纲树 + uuid，用 web.read 按节读）。**登录态页面也能读**——这是
    webFetch 做不到的。只要前段就给 {maxChars}（续读带 {offset: nextOffset}）。
  - api.browser.capture(tabId?)：截图（存进资源库并附在下一步里）。**最后手段**：只有布局与视觉
    必须亲眼看时才用；页面还在加载时先 api.wait(800)。
- **动手 = browser.dom**：对 snapshot 清单里的 ref 做受控操作（固定函数 + 值参数，没有任意 JS 的口子）：
  - dom(tabId?, ref, "click")：程序化点击（绝大多数站点的处理函数都会触发）。
  - dom(tabId?, ref, "fill", "文字")：填输入框——触发 input/change 事件，React 受控输入也认；中文照常。
  - dom(tabId?, ref, "focus") / dom(tabId?, ref, "submit")：聚焦；提交元素所在的表单。
  - dom(tabId?, ref, "text")：取这个元素的文字（≤4000 字）；dom(tabId?, ref, "attr", "href")：取属性值。
  - 个别检测程序化点击的站点点不动：api.browser.point 把元素高亮给用户、请用户手点。
- **指给用户看**：api.browser.point(tabId?, 目标)——页面像锚点跳转一样滚到目标元素，并注入一圈
  短暂的脉冲高亮。目标可以是 { ref } 或 CSS 选择器。汇报「我说的是这个元素」时用它。
- **日志与直发（logs / logDetail / fetch / record，tabId 一律必给，不吃焦点默认）**：
  - api.browser.logs(tabId, { kind?, level?, only?, limit?, afterSeq? }?)：页签的 console 报错 + 页面
    自己发的网络请求**清单**——重复折叠 ×N、静态资源（含 .js/.css 等扩展名）压一行、失败永不折叠，
    每行带 [c#]/[n#] 条目号。动作没生效/页面静默失败先看它（level 默认 error；{only:"api"} 只看
    XHR/Fetch；翻页拿上一份的 latestSeq 当 afterSeq）。
  - api.browser.logDetail(tabId, seq)：单条详情（条目号 96、"n96" 都认）——网络的给短网址 urlPath +
    全量 url、请求头（截断）、postData、截断响应体。
  - api.browser.fetch(tabId, 网址 | { reqId }, { method?, headers?, body?, offset?, maxBody? }?)：在页面
    上下文直发 HTTP，**继承该页签登录态**；{ reqId } = 重放网络清单里那条请求（头全带上，覆盖项
    落其上）。**请求级失败不抛异常**：没拿到响应回 { status:0, failed:true, reason }，按值分支不用
    try/catch；HTTP 4xx/5xx 是正常回执。长响应 { offset } 分段续读。
    **动态页面的快路**：先 UI 摸清一次请求形态，同类动作在 execute 循环里直发——循环里直发
    零推理成本，比一次次的 snapshot+dom 便宜一个量级。**写操作（POST/PUT/DELETE）与批量
    直发是不可逆动作，必须先 api.ask**；循环要节流（宁慢勿封）；触发本地逻辑（上传/支付/
    复杂前端状态）的动作仍走 UI。**重放的时间窗（实测）**：捕获后几秒内 {reqId} 重放通常能成
    （且站点只认首批若干条）；隔了轮次再重放大概率 403/404——捕获的头里有一次性签名，
    过期就要回 UI 重新触发一次拿新 reqId，别在旧条目上耗轮次。长响应别整段 return：
    { toTmp: 'key' } 全文（≤256k）落临时变量，代码里 tmp.get 出来解析，只把提炼结果交回来。
  - api.browser.record(tabId, "start" | "stop")：录制区间——start 钉水位，请用户做你做不了的操作
    （登录/验证码），stop 回**这段区间**的折叠清单。配 api.ask 用。
  - api.browser.scroll(tabId, { by: 像素 } | { to: "top"|"bottom"|选择器 } | { ref })：滚**页面**（无限
    滚动信息流的引擎）——滚完看返回的 atBottom，true 就 wait 一拍再滚，新内容才加载。
    注意 ui.scroll 滚的是文档区，别混用。
- **编排纪律（少一轮是一轮）**：
  - 一段 execute 把整条链写完：snapshot → 按清单判断 → dom 的 fill/submit 连招 → read 收尾，
    不要每个动作单独一轮。
  - 拿不准某一步行不行，就用 **if/else + try/catch 把备选一次写全**：ref 过期就在 catch 里重新
    snapshot 再试、选择器失败换 { ref }、dom 点不动就 point 请用户手点——失败被接住继续走，
    既不中断程序，也省掉「试一次、看报错、再试」的额外轮次。
  - **截图是最后手段**：snapshot / read / dom 的 text 与 attr 拿得到的信息，不要用截图拿。
- 网页是用户的真实登录会话：提交、支付、删除、发消息这类不可逆动作必须先 api.ask 确认；
  用户没让关的页签不要 close。跨源 iframe 里的元素 ref 定位不到（此时 point/capture 兜底）。`,
  },
  {
    key: 'web',
    title: '读网页与搜索',
    text: `读网页与搜索（web.webFetch / web.read / web.search）——这份规范在你第一次抓网页或搜索时注入：
- api.web.webFetch('https://…')：抓一页并转成 markdown。两万多字以内**直接回全文**；
  再长就存成文件，只回一棵大纲树（每行「# 标题 - 这一节正文的字数」，不含子节）加上一个 uuid。
  拿到的是大纲时**先看大纲再决定读哪一节**，别指望一次读完。
- api.web.read(uuid, '一级标题/二级标题')：读落盘网页的某一节。path 省略=从头给一段（附大纲）；
  一次最多回 1.2 万字，没回完会在 note 里说明，按 subheadings 再切细。
- api.web.search(query, { engines? | engine?, lang?, count?, onEngineFail? })：多引擎搜索（baidu / bing /
  google / yandex / wikipedia），engines 给数组可**并行搜多家**（≤3，结果按引擎标注），缺省 baidu。
  回 searchedAt（抓取时刻——结果里的「2 天前」这类相对时间按它折算成日期再交付）与
  { rank, title, url, snippet, engine }；解析不出的引擎在 failed 里逐个说明原因，
  **换一家或换措辞再试**，别在一家上反复重试。**engines 全挂时缺省会自动用 baidu/bing 补搜一轮**
  （onEngineFail:"strict" 才原样回报失败），weak 列出「只回标题没摘要」的引擎——那种细节必须
  webFetch 核实再用。要实时信息、要核实事实时用它；摘要已含要点，引用前确需细节再 web.webFetch 读原文。
- 只能 http/https，且**不能抓本机与内网**；一页最多 4MB、20秒超时。
- 引用网页内容时写明来源（标题 + 链接），并且**区分「网页这么说」与「事实如此」**：
  它是一份材料，不是你的结论。抓之前先想清楚要找什么，别一个接一个地抓。`,
  },
  {
    key: 'mcp',
    title: 'MCP 外部服务',
    text: `外部 MCP 服务（Model Context Protocol——用户配置的真实外部工具）——这份规范在你第一次调用 mcp.* 时注入：
- api.mcp.list()：已启用的服务与各自缓存的工具清单（id、名称、传输、状态）。要调外部工具**先看它**；
  服务按 id 或名称指名都认（名称撞重时用 id）。
- api.mcp.discover(server?)：现场探测最新工具清单（SSE 服务实时请求，可能要等几秒；省略 = 探全部已启用服务）。
  清单为空、或某个工具报「不存在」时用它刷新；单独探一个失败即失败，全量探查在 servers 里逐服务回报。
- api.mcp.call(server, tool, args?)：调用一个工具。**参数按该工具公布在 list / discover 里的说明给**——
  拿不准就先看工具的 description，不要猜。返回服务端的文本结果；失败不抛异常（回 { ok:false }），
  按值判断，不要用 try/catch。
- 这些是真实外部系统（数据库、文件、网页服务……）：**写操作与不可逆动作先 api.ask 确认**；
  一次编排里把 list → call 的链路写完，中间结果不要写进对话。`,
  },
  {
    key: 'res',
    title: '资源库',
    text: `目标资源库已收敛为真实文件系统：
- 图片与静态资源直接使用 api.files 读写 docs/目标/static/ 目录（如 docs/.../static/{uuid}.png）。
- 在文档和讲义中引用静态资源使用标准 Markdown 格式：![说明](moji:static/{uuid})。`,
  },
  {
    key: 'exam',
    title: '试卷与考试',
    text: `试卷与考试（Exam & ExamAttempt）——数据文件收敛于真实文件系统，两层结构与严密读写边界：

一、两层架构与物理路径契约
- 试卷是严密的【两层分离结构】：
  - Exam（试卷本体）：题目、类型、难度、时限，是静态试题模板。
  - ExamAttempt（历次考试记录）：用户的实际作答、击键流水、耗时统计、切屏记录与判分结论。同一试卷可反复考核，历次记录按 startedAt 升序保存在 attempts 数组中。
- 物理路径契约：
  - 节点试卷（推荐）：docs/.../exams/{examId}.json。先调用 const p = await api.node.paths()，其返回 dir 与 examsDir，路径为 \`\${p.dir}/exams/\${examId}.json\`。
  - 目标级试卷：exams/{examId}.json。
  - 命名契约：文件名强制为 {examId}.json，且与 JSON 内的 id 字段必须严格一致。
  - 批改错题报告（辅助）：可在同目录下保存 Markdown 讲解，如 \`\${p.dir}/exams/\${examId}_批改.md\`。

二、完整 JSON Schema 规范
试卷文件必须严格符合以下 JSON 契约：
{
  "id": "exam_uuid", // 试卷唯一 ID（与文件名一致）
  "nodeId": "node_id", // 所属知识点节点 ID
  "goalId": "goal_id", // 所属学习目标 ID
  "title": "试卷标题",
  "kind": "quiz" | "test" | "exam", // 随堂小测(quiz) | 单元测验(test) | 综合大考(exam)
  "level": "easy" | "medium" | "hard" | "extreme", // 简易 | 中等 | 难 | 极难
  "minutes": 15, // 时限(分钟)；0 为不限时(随堂小测)，其余强制不低于题目数 × 2
  "createdAt": 1728000000000,
  "questions": [
    {
      "id": "q1",
      "type": "single" | "multiple" | "truefalse" | "fill" | "short",
      "stem": "题干内容（支持 Markdown 与 LaTeX 公式，如 $x^2 + y^2 = 1$）",
      "options": [ // 单选、多选、对错必给；对错题选项为 true/false
        { "id": "A", "text": "选项文字" },
        { "id": "B", "text": "选项文字" }
      ],
      "answer": ["A"], // 参考答案选项 id 数组（如 ["A"]、["A","B"]、["true"]；填空题给 ["答案"]；简答通常留空）
      "rubric": "给 Agent 的评分标准与解析说明",
      "image": "<svg ...>完整的SVG配图源码（可选）</svg>",
      "points": 2 // 本题分值
    }
  ],
  "attempts": [] // 历次考试记录；Agent 出题时初始化为空数组 []
}

三、两阶段工作流：教 Agent 怎么读、怎么写
1. 出题阶段（阶段一，Agent 生成试卷）：
   - 读：先读节点讲义与掌握度；用 api.ask 询问用户期望的试卷类型与难度。
   - 写：构造符合上述 Schema 的试卷 JSON，写入 await api.files.write(\`\${p.dir}/exams/\${examId}.json\`, JSON.stringify(exam, null, 2))。
   - 纪律：出题阶段 attempts 必须传空数组 []，不要伪造或预置任何作答数据。
2. 阅卷阶段（阶段二，用户交卷后批改）：
   - 读：调用 await api.files.read(\`\${p.dir}/exams/\${examId}.json\`) 读取试卷与最新作答（exam.attempts[exam.attempts.length - 1]，携带 attemptId）。
   - 判分：客观题严格核对 answer；填空题与简答题依据 rubric 评判，生成 results 数组。
   - 更新并写回：更新该 attempt 的评价字段后，用 api.files.write 写回整份试卷 JSON。
   - 更新状态：调用 api.node.update(path, { status: passed ? 'mastered' : 'learning' }) 同步节点掌握状态。

四、读写权限与严格边界（哪些能写、哪些绝对禁止篡改）
- 🔒 用户事实层（只读！Agent 绝对禁止篡改）：
  - attempt.id（attemptId）、startedAt、endedAt、forceSubmit、overtimeMs：真实的开考与交卷时戳；
  - attempt.dwell（各题驻留毫秒数）、attempt.blurs（切屏记录）：衡量作答犹豫度与防作弊的事实数据；
  - attempt.answers（用户填写的最终答案）、attempt.inputs（用户作答敲击流记录）：用户的原始作答铁证。
  - ⚠️ Agent 严禁修改用户的 answers、inputs、dwell、blurs 中的任何一个字符或数据项！
- ✏️ Agent 评价层（Agent 唯一允许填写的字段）：
  - attempt.status：设为 "graded"；
  - attempt.results：逐题判分数组 [{ questionId, correct: boolean, score, maxScore, comment: "错题点拨", by: "agent" }]；
  - attempt.passed：是否通过（boolean）；
  - attempt.summary：综合成绩与掌握分析（字符串）；
  - attempt.explanation：针对错题的详尽步骤推导与 Markdown 解析。
- ❌ 严禁行为：
  - 绝不调用退役桩 api.exam.create / api.exam.read / api.exam.grade（调用即抛异常）；
  - 绝不改动或覆盖之前的历史 attempts 作答轮次。`,
  },
  {
    key: 'learning-process',
    title: '学习过程',
    text: `学习过程记录已收敛为真实数据文件管理：
- 有效阅读事实与打卡记录直接使用 api.files 读写 docs/目标/reading.json 与 checkin.json。
- 专注记录与学习状态从数据文件中读取，无需调用过时的专属接口。`,
  },
  {
    key: 'review',
    title: '间隔复习',
    text: `间隔复习已收敛为真实数据文件管理：
- 复习计划与阶段记录（+1/+3/+7/+14/+30 阶段）直接使用 api.files 读写对应目标下的 review.json 或对应节点的 .meta.json。
- 掌握度更新和薄弱点归档通过直接更新节点元数据或复习数据文件完成。`,
  },
  {
    key: 'workspace',
    title: '工作区',
    text: `工作区目录已统一收敛为真实文件系统：
- 每个节点的工作区物理目录为 docs/.../workspace/，在磁盘上真实存在。
- 直接使用 api.files.* 进行文件与目录的读写、列表、删除及管理，交付给用户的物理文件均落盘在此。`,
  },
  {
    key: 'method',
    title: '持久化函数',
    text: `持久化函数（method，按目标归档、跨对话有效）——这份规范在你第一次读写持久化函数时注入：
- api.method.create({ name, code })：把一段**可执行的函数源码**存进这个目标的函数库。
  code 写成匿名 async 函数，**第一个参数是 api**（整套沙箱 api 都在），其余参数是调用方传的实参：

      api.method.create({ name: '统计句号', code: "((api, path) => { const d = await api.files.read(path); return { count: (d.content.match(/。/g) ?? []).length, size: d.size } })" })

- 同名 create 就是**覆盖**（那是更新一个函数，不是重复建）。创建时会编译校验，
  编不过的当场被拒并给出原因。list() 只回名字与体量；delete(name) 删一个。
- api.method.call(name, ...args)：执行一个函数（注入当前编排的 api），返回它的返回值。
  在你的编排里它是「把一段逻辑打包重用」的办法；更重要的是——**超级文档里的脚本只能靠它干活**：
  超级文档的按钮写 api.method.call('统计句号', '极限')，宿主执行的就是你存的这份源码。
  所以「要在超级文档里复用的逻辑」都该落成 method，而不是只写在某次编排里。`,
  },
  {
    key: 'code',
    title: '代码块伪编译',
    text: `代码块伪编译（code）——这份规范在你第一次交付伪编译产物时注入：
- api.code.save({ key, js, note })：交付一份伪编译产物。用户点了文档里代码块上的「编译」时，
  会有一条「伪编译」工作流消息进来（带着 key、语言标记与那段代码）。你转译完调它交货，
  那一块代码下面的「运行」就会亮起来——产物存在数据目录里，重启还在。
- js 必须是**完整、自包含**、能在 Web Worker 里跑的代码（没有 DOM、没有 require/import，
  顶层可以用 await，要出结果就 console.log）；key 原样抄，代码原文不用回抄（宿主按 key 认得）。
- note 是你补的那些假设，一两句话，它会显示给用户。
- **先判有没有输出**：如果这段代码只有定义（类型、接口、函数、类、常量），没有任何会被执行的
  语句、也不会打印任何东西，那就**立刻停止、不要写 js**，改调 api.code.silent({ key, reason })
  把那一块标成无输出（之后它不再显示编译与运行）。这不是失败，是这类代码块的正常归宿。`,
  },
  {
    key: 'compact',
    title: '上下文压缩',
    text: `上下文压缩（compact）——这份规范在你第一次提交交接摘要时注入：
- api.compact({ summary, tasks })：把这段对话折成一份交接摘要。**你不是自己想压就压**——
  用户点了「压缩上下文」，或者上下文快到阈值时，会有一个工作流把整套要求给你（见工作流那一份指令）。
- 两个参数：tasks 是**还没做完的事**（逐条，写到能照着继续干：哪个节点、哪份文档、卡在哪一步），
  summary 是正文摘要（目标与背景 / 已讲清的内容 / 学习者的状态 / 约定与术语）。
- 它**不立刻生效**：摘要先记下，等本轮 loop 结束后旧消息才失活、摘要成为第一条消息。
  所以别重复调用，也别把摘要复述给用户。摘要太短会被拒（原始消息没了，摘要就是唯一的上下文）。`,
  },
  {
    key: 'subagent',
    title: '子代理',
    text: `子代理（subagent.*；把独立的活**并发地**派出去）——这份规范在你第一次派子代理时注入：
- 范式：**脚本创建 → 脚本执行 → 脚本等待**（都在一次 execute 里写完）：
  api.subagent.create({ key, name?, system, tools? }) 登记定义（system 写清角色、工作方式与
  **交付纪律**；tools 是它 execute 开放的 api 组，不给就是 web + tmp）→
  api.subagent.run({ agent, task }) 启动（**立即返回**，任务在后台跑；一次 run 多个 agent 就并发）→
  api.subagent.wait({ seconds }) 收交付。
- **task 要自包含**：子代理看不到你们的对话，要做什么、什么口径、交付什么格式全写在 task 里。
- agent 认 key（name 是显示名，碰巧同名也能对上）；**一个 key 同一时刻只跑一个任务**——要并发
  就建多个 key 再一起 run。别和 web.search 的 engines 并行混谈：那是同一次调用里并行搜多家，
  两种「并发」不是一回事。
- **wait 必带最大时长 seconds**（按任务难度主观定）：有挂起交付立即全部返回；否则监听所有在跑的，
  **任何一个先完成就立即返回它**（回执含 deliveries 与仍在跑的 running 清单）；到点没人交付返回
  timedOut。没有在跑也没有挂起时立即返回空。
- **监督回路（防钻牛角尖）**：wait 超时 → api.subagent.view(agent) 看 recent 里它最近在干什么 →
  确实在打转就 api.subagent.intervene(agent, 指令) 纠偏（指令在它当前这条消息输出完整后插入，
  绝不打断半截输出）；走得正常就再发起一轮 wait。
- 交付时没人在等就**挂起**，不会丢：下一次 wait 把积压的一起返回。execute 结束时仍有 agent 在
  后台跑是正常的——之后任何一次 execute 里都可以继续 wait 收。
- 中断与收拾：interrupt（中断，上下文保留）/ resume（从断点接着跑）/ delete（删定义与会话）。
  用户点「停止」会中断当前所有在跑的子代理。
- 什么时候派：费上下文的体力活（大量检索、通读长文档、批量核实）派出去，把你的上下文留给教学本身。
- 检索类任务的模板：create 一个 tools:["web","tmp"] 的检索代理，system 里写死止损纪律——摘要先筛、
  有明确网址直接读；同一页面/引擎/措辞绝不重试第二次；连续两步没有新信息就收手交付；结论先行、
  关键事实带来源 URL、体量跟任务匹配。web.search 引擎全挂会**自动用 baidu/bing 降级补搜**
  （不用在 task 里重申降级规矩）；回执带 searchedAt，结果里的「2 天前」这类相对时间按它折算。`,
  },
  {
    key: 'ui',
    title: '界面操作',
    text: `界面操作（ui；文档区没有打开的文档时，point / scroll / screenshot / dom 会明确失败）——这份规范在你第一次操作界面时注入：
- api.ui.toast('一句话')：弹一条吐司提示（轻量的告知；需要用户做动作的用 ask）。
- api.ui.point(path?, { line?, regex?, flags? })：在页签里打开/切到某个节点的文档
  （path 规则与 doc.* 一致，省略 = 当前节点的教学文档）。line 定位到某一行，
  regex 选中第一处匹配的文字——「我说的就是这一段」时用它指给用户看。
- api.ui.superdoc(path?, name)：打开/切到某节点的一份超级文档页签
  （sdoc.write 写完用它展示给用户；那份文档已被删时回执会说明，别再指给用户看）。
- api.ui.scroll({ to: 'top' | 'bottom' } 或 { by: 像素 })：滚动**文档区**（by 负数往上）——
  滚的不是内置浏览器的网页页签，滚页面用 api.browser.scroll。
- api.ui.screenshot()：截取文档区，图片会附在你的下一步里（与 res.read 读图同一条通道；
  截图同时存进了资源库，res.list 看得到）。讲解里想引用它：![说明](moji:static/uuid)。
- api.ui.dom(async (root) => { … })：回调拿到**文档区**根节点的**门面**（作用域只有文档区——
  浏览器页签里的网页不在内，查网页元素回 false/空是正常的，那要用 browser.text/snapshot），
  可以查看渲染结果、点文档里的按钮：root.query(sel) / root.exists(sel) / root.count(sel) /
  root.text(sel, i?) / root.attr(sel, name, i?) / root.html(sel, i?) / root.rect(sel, i?) /
  root.click(sel, i?)。全是异步的（每个操作回到宿主执行）；适合「确认渲染成了什么样」
  「帮用户展开某个面板」，不要拿来批量轮询。`,
  },
  {
    key: 'plot-forms',
    title: '函数图像的数据形态',
    text: `函数图像的 data 各形态（\`\`\`plot 的完整数据写法）——这份规范在你第一次写函数图像时注入。data 数组每项取下列形态之一（points / parametric / polar / implicit 必须写 graphType，否则会当成区间采样而报错）：
1) 显式函数：{ "fn": "x^2" }
   可加切线：{ "fn": "x^2", "derivative": { "fn": "2*x", "x0": 1 } }
   可加割线：{ "fn": "x^2", "secants": [{ "x0": 0, "x1": 1 }] }
   可指定颜色：{ "fn": "sin(x)", "color": "#a8432f" }
2) 参数曲线（变量用 t）：{ "graphType": "polyline", "fnType": "parametric", "x": "cos(t)", "y": "sin(t)" }
3) 极坐标（变量用 theta）：{ "graphType": "polyline", "fnType": "polar", "r": "1 + cos(theta)" }
4) 散点：{ "graphType": "scatter", "fnType": "points", "points": [[1, 1], [2, 4]] }
5) 向量：{ "graphType": "polyline", "fnType": "vector", "vector": [2, 1], "offset": [0, 0] }
6) 隐函数（用 interval 采样，需同时给 graphType 与 fnType）：
   { "graphType": "interval", "fnType": "implicit", "fn": "x^2 + y^2 - 1" }

其余写法要求：
- 表达式里只能用数学函数与四则运算，不要出现浏览器对象或函数定义。
- 图像默认不可缩放（避免在文档里滚动时误触），需要交互缩放时加 "disableZoom": false。`,
  },
  {
    key: 'rich-animation',
    title: '富媒体动画写法',
    text: `富媒体动画（现成的文档动画、SVG SMIL 与内嵌 CSS 动画）——这份规范在你第一次写动画内容时注入。
动画要克制：同一屏最多一两个，服务于讲解本身，不做装饰性干扰。
- **先用现成的四个**（正文里当工具类写，见「文档排版与图表」那份规范）：animate-doc-fade、
  animate-doc-rise、animate-doc-grow（配 origin-bottom 做柱子）、animate-doc-draw
  （配 pathLength="1" 与 stroke-dasharray="1" 描线）。九成的「动起来才看得懂」用这四个就够。
- SVG 内嵌动画（用 SMIL，适合「动起来才看得懂」的过程：波的传播、向量旋转、
  极限逼近、函数变换）。可用 <animate>、<animateTransform>、<animateMotion>、<set>，
  并为动画加上 repeatCount="indefinite" 让它循环：
  <svg viewBox="0 0 200 60"><circle r="6" fill="#a8432f">
    <animateMotion dur="3s" repeatCount="indefinite" path="M10,30 L190,30"/></circle></svg>
- 内嵌 CSS 动画（用 <style> 定义 @keyframes 做持续运动；适合脉冲、高亮、旋转）：
  <style>.moji-demo-pulse{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}</style>
  <span class="moji-demo-pulse">正在闪烁的要点</span>
- 内嵌 <style> 里的每条选择器都必须带一个本项目独有的前缀（如 .moji-demo-xxx），
  避免样式泄漏到页面其它位置；建议每个动画用不同的前缀。
- SVG 里给 fill / stroke 用具体颜色或 currentColor，深色与浅色模式下都要能看清
  （不要只用纯黑或纯白）。
- 内嵌 HTML 必须闭合良好；不确定能否渲染的写法就退回纯 Markdown。`,
  },
  {
    key: 'doc-html',
    title: '文档排版与图表',
    text: `文档排版与图表（教学文档的 HTML + Tailwind 配方）——「开讲」「学习大纲」这两条工作流会在动笔之前
把它交给你；其它场合则在你第一次写教学文档之后注入。

**先看这一条**：通篇只写 <h2>/<h3>/<p> 的文档不算讲义（渲染器给裸标签的只是兜底样式）。
每一份教学文档至少要落下 2~3 处结构性元素，下面六个配方就是为这件事准备的。

同一段内容的两种写法，差别就是「草稿」与「讲义」：
  草稿：<h3>三种变化率</h3><p>平均变化率是一段区间上的快慢，瞬时变化率是把区间压到零。</p>
  讲义：<h3 class="mt-7 mb-2 text-[1em] font-semibold text-ink-strong">三种变化率</h3>
        <div class="my-4 rounded-lg border-l-4 border-seal bg-sunken px-4 py-3">
        <p class="m-0 text-[0.88em] leading-relaxed text-ink">平均变化率是一段区间上的快慢，
        瞬时变化率是把区间压到零。</p>
        </div>
（同一个标题、同一句话，只是把「兜底样式」换成了显式的字号、墨色与层次——这一步不做，
用户看到的永远是左边那种。）
前提与系统提示词里「正文写作」一节同一套：正文列宽上限 800px、**可用内容宽度约 745px**；
颜色优先用应用的主题令牌（bg-paper / bg-card / bg-sunken / bg-inset、text-ink / text-ink-strong /
text-ink-soft / text-ink-faint、border-line / border-line-strong、text-seal / bg-seal、
text-ok / text-warn、bg-mark），它们跟着浅色/深色主题自动变。

能用的是**标准 Tailwind 工具类**（v4），常打交道的几组：
- 布局：flex / grid / grid-cols-2 / grid-cols-3 / items-center / items-end / justify-between / shrink-0
- 间距：gap-3 / gap-5 / p-4 / px-5 / py-3 / mt-6 / my-5 / space-y-2
- 文字：**字号一律用 em**（text-[0.9em] / text-[0.85em] / text-[0.75em] / text-[1.45em]）——
  正文有一个整篇的字号系数，它只缩放 em；写 px 的那部分不会跟着放大，一篇里就会一半大一半小。
  行距与字重：leading-relaxed / leading-[1.85] / font-semibold；数字对齐：tabular-nums
- 数字：tabular-nums（表格与图表里的数字务必加上，位数才会对齐）
- 形状：rounded-sm / rounded-lg（纸墨风，别用大圆角）/ border / border-l-4 / shadow-sm（少用）
- 任意值也认：w-[360px] / grid-cols-[1fr_auto] / [animation-delay:120ms] / bg-[#f3f4f6]

下面六个配方照抄改字即可（省略号处填你自己的内容）。注意每个配方的标签之间**不留空行**——
空行会把一个 HTML 块切成两半。

一、提示框（结论 / 易错点 / 记忆点）：
<div class="my-4 rounded-lg border-l-4 border-seal bg-sunken px-4 py-3">
<p class="m-0 text-[0.88em] leading-relaxed text-ink">结论写在这里。</p>
</div>
（结论用 border-ok、易错用 border-warn；整篇不要到处套盒子，一屏一个就够）

二、两栏对照（每栏约 350px）：
<div class="my-5 grid grid-cols-2 gap-5">
<div class="rounded-lg bg-sunken p-4"><h3 class="m-0 text-[0.95em] font-semibold text-ink-strong">甲说法</h3>
<p class="mt-2 text-[0.88em] leading-relaxed text-ink-soft">……</p></div>
<div class="rounded-lg bg-card p-4">……</div>
</div>

三、步骤 / 时间轴：
<div class="my-5 space-y-3">
<div class="flex gap-3">
<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-seal text-[0.78em] text-white">1</span>
<p class="m-0 text-[0.9em] leading-relaxed text-ink">第一步做什么。</p>
</div>
（第二步、第三步照写，序号改成 2、3）
</div>

四、横向条形图（比大小最直观）：
<div class="my-5 space-y-2 text-[0.85em]">
<div class="flex items-center gap-3">
<span class="w-[92px] shrink-0 text-ink-soft">甲</span>
<div class="h-3 flex-1 rounded-sm bg-inset"><div class="h-3 rounded-sm bg-seal/80" style="width:72%"></div></div>
<span class="w-[36px] shrink-0 text-right tabular-nums text-ink-faint">72</span>
</div>
（每组一行；宽度按「这一项 ÷ 最大值」算百分比，最大的那一项给 100%）
</div>

五、柱状图（柱子自己长出来）：
<div class="my-5">
<div class="flex h-40 items-end gap-4 border-b border-line px-2">
<div class="flex h-full flex-1 flex-col items-center justify-end"><div class="w-[58%] origin-bottom animate-doc-grow rounded-t-sm bg-seal/85" style="height:64%"></div></div>
<div class="flex h-full flex-1 flex-col items-center justify-end"><div class="w-[58%] origin-bottom animate-doc-grow rounded-t-sm bg-seal/85" style="height:100%"></div></div>
</div>
<div class="mt-2 flex gap-4 px-2 text-[0.75em] text-ink-faint">
<span class="flex-1 text-center">一季度</span>
<span class="flex-1 text-center">二季度</span>
</div>
</div>
（每组一列，结构照抄：**列必须是 h-full**，柱子写百分比高度才量得出来；把柱子直接放进
items-end 的容器里写百分比高度会算成 0——高度全没了，这是这条配方最容易踩空的一处。
要错峰入场就给柱子加 [animation-delay:120ms]，一列往后推一档）

六、折线与曲线（手画 SVG，线自己描出来）：
<figure class="md-fig my-5">
<svg viewBox="0 0 720 220" class="w-full">
<line x1="40" y1="190" x2="700" y2="190" stroke="currentColor" class="text-line" />
<path d="M40 170 L200 120 L360 132 L520 62 L700 44" fill="none" stroke="currentColor" stroke-width="2.5" class="text-seal animate-doc-draw" pathLength="1" stroke-dasharray="1" />
</svg>
<figcaption>图 1：一句话说清这张图要看哪一处。</figcaption>
</figure>
（viewBox 宽度按 720 给，正好铺满正文那一列；坐标自己算：x 均匀分布，y 按数值映射）

另外两个常用的：**数字并排**（grid grid-cols-3 gap-4 text-center，大数字用 text-[1.45em]
font-semibold tabular-nums）；**进度条**（外层 h-2 rounded-full bg-inset，内层同高 rounded-full
bg-ok，宽度用 style="width:38%"）。

三条纪律：
- **动画只用在过程上**：生长（animate-doc-grow）、描线（animate-doc-draw）、浮现
  （animate-doc-fade / animate-doc-rise）。同一屏最多一两个，静态讲得清就别动。
- 每张图配一句 <figcaption>，正文里也点一句「这张图看哪里」——图是讲解的一部分，不是装饰。
- **不要把整篇切成一张张卡片**：留白、字号层级和一条细分隔线（border-line）比边框与底色耐读。
  标题、表格、公式、代码块沿用渲染器自带的样子即可，不必自己重做。`,
  },
]

import { getLoadedSkills } from '../../agent/skill/registry'

const MODULE_BY_KEY = new Map(PROMPT_MODULES.map((m) => [m.key, m]))

export function promptModuleByKey(key: string): PromptModule | null {
  const mod = MODULE_BY_KEY.get(key)
  if (mod) return mod

  if (key.startsWith('skill:')) {
    const skillId = key.slice('skill:'.length)
    const skills = getLoadedSkills()
    const target = skills.find((s) => s.id === skillId)
    if (target) {
      return {
        key,
        title: `技能 · ${target.name}`,
        text: `### 专业技能规范与执行纪律：${target.name} (${target.id})\n\n${target.instructions.trim()}`,
      }
    }
  }

  return null
}

/**
 * api 名 → 模块 key 的触发映射：按组前缀（doc.write → doc），顶层名（wait / ask）用名字本身。
 * 只有「规范搬进了模块」的组才在这里；doc / node / state / ask 这些每轮必用的组不触发注入。
 */
const GROUP_MODULE: Record<string, string> = {
  sdoc: 'sdoc',
  browser: 'browser',
  web: 'web',
  mcp: 'mcp',
  res: 'res',
  exam: 'exam',
  reading: 'learning-process',
  attention: 'learning-process',
  checkin: 'learning-process',
  pomodoro: 'learning-process',
  review: 'review',
  workspace: 'workspace',
  method: 'method',
  code: 'code',
  compact: 'compact',
  subagent: 'subagent',
  ui: 'ui',
}

export function promptModuleForApiName(name: string): string | null {
  if (name === 'ui.superdoc') return 'sdoc'
  const dot = name.indexOf('.')
  const group = dot < 0 ? name : name.slice(0, dot)
  return GROUP_MODULE[group] ?? null
}

/**
 * 写入内容里的标记 → 模块 key（内容触发）：模型写出 ```plot 图像或 SMIL / @keyframes
 * 动画时，对应的数据形态 / 动画写法模块就该在场。宿主在 execute 的 doc / sdoc 写入
 * 参数上嗅探（见 sandbox/execute 的 callApi）。
 */
export function promptModuleForContent(content: string, apiName?: string): string[] {
  const out: string[] = []
  // 写教学文档（files.write / files.edit / doc.write / append / replace）就注入排版配方
  if (apiName === 'files.write' || apiName === 'files.edit' || apiName?.startsWith('doc.')) out.push('doc-html')
  if (content.includes('```plot')) out.push('plot-forms')
  if (content.includes('<animate') || content.includes('@keyframes')) out.push('rich-animation')
  return out
}

/**
 * 从一次写入调用的参数里取出要嗅探的正文（供内容触发用，见 sandbox/execute 的 callApi）：
 * files.write 第二参数、files.edit 的 content 或 replace、doc.write / doc.append 第二参数等。
 * 其余调用不携带可嗅探的正文，回 null。
 */
export function writableContentOf(name: string, args: unknown[]): string | null {
  if (name === 'files.write' || name === 'doc.write' || name === 'doc.append') return typeof args[1] === 'string' ? args[1] : null
  if (name === 'files.edit') {
    const payload = args[1]
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>
      if (typeof p.content === 'string') return p.content
      if (p.replace && typeof p.replace === 'object') {
        const rep = p.replace as Record<string, unknown>
        if (typeof rep.replacement === 'string') return rep.replacement
        if (typeof rep.new === 'string') return rep.new
      }
    }
    return null
  }
  if (name === 'doc.replace') {
    const payload = args[1]
    const content =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>).content : undefined
    return typeof content === 'string' ? content : null
  }
  if (name === 'sdoc.write') return typeof args[2] === 'string' ? args[2] : null
  return null
}

/**
 * 去重判据：keys 里哪些模块**还没有**出现在活着的上下文里。
 *
 * 两种形态都算「已注入」：
 * - 回复里的 prompt-module 片段（mid-loop 边界注入，见 agent/types）；
 * - 轮开始时注入的独立隐藏消息（工作流触发，字段在消息上）。
 * 只统计 !retired——被压缩折掉的不再进上下文，必须允许重新注入
 * （与 needsPersonaAnnounce 的判据同一口径）。
 * 调用方传的消息列表必须与「这次请求真正会发的历史」同源（同一份 Conversation.messages）。
 */
export function missingPromptModules(messages: ConversationMessage[], keys: string[]): string[] {
  const alive = new Set<string>()
  for (const m of messages) {
    if (m.retired) continue
    if (m.promptModule) alive.add(m.promptModule)
    for (const p of m.parts) {
      if (p.type === 'prompt-module') alive.add(p.key)
    }
  }
  return [...new Set(keys)].filter((k) => !alive.has(k))
}

/**
 * 一条模块消息：隐藏 user 消息，mark 画成界面上可展开的分界条，promptModule 供去重。
 * 与 personaMessage 同一个形状家族——它进模型上下文、不显示气泡正文（展开看全文）。
 */
export function promptModuleMessage(mod: PromptModule, uuid: string, at: number): ConversationMessage {
  return {
    id: uuid,
    role: 'user',
    parts: [{ type: 'text', text: mod.text }],
    ts: at,
    hidden: true,
    mark: t('提示词模块 · {0}', mod.title),
    promptModule: mod.key,
  }
}
