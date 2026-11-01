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
    SPA 上唯一的文本通道，纯 HTML 抓取提取不出正文的页面（报「没提取出正文」）靠它，不是截图。
  - api.browser.read(tabId?, { maxChars?, offset? }?)：整页转 markdown
    （短的回全文，长的落盘回大纲）。**登录态页面也能读**——这是外部抓取做不到的。只要前段就给 {maxChars}（续读带 {offset: nextOffset}）。
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
  用户没让关的页签不要 close。跨源 iframe 里的元素 ref 定位不到（此时 point/capture 兜底）。
- 卡住了就问，别内耗：某一步无法独立完成（验证码、登录、系统权限弹窗）就 **api.ask 说清情况
  等用户操作**；表单一分钟没人理会会自动超时（回执 timedOut: true）——那时自行判断：换路子继续，
  或把手头的成果交付掉、说清卡在哪。**同一个目标连续两次尝试失败就停下交付**，反复重试耗的是
  用户的 token。
- 临近交付：这一轮开了很多页签的话，用 api.browser.close 把中间搜索页、试错页签挑没用的关掉，
  留下用户可能还要看的。`,
  },
  {
    key: 'web',
    title: '网络搜索与网页抓取',
    text: `网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）——这份规范在你第一次调用搜索或抓取时注入：
- **api.fetch({ url }) 或 api.fetch(url)**（亦可调 api.web.fetch，支持 url / link / href 别名）：
  * DeepSeek 官方抓取服务。输入目标网页 URL，返回统一结构 { ok: boolean, title: string, content: string, error?: string }。
  * 容错契约：失败时不抛异常，返回 { ok: false, title: '', content: '', error: '...' }。读取 content 绝不会报 undefined，但**必须先检查 if (!r.ok) 分支处理**。
  * 抓取受第三方站点反爬与超时限制（例如维基百科、部分高校课程网）：若抓取失败或超时，**严禁死循环重复抓取同一 URL**，请直接降级使用搜索结果中已有的 snippet / summary 摘要，或换用其他检索结果链接。
- **api.web.search({ query, count?: 5, need_content?: boolean, ... }) 或 api.web.search(query, { count: 5 })**：
  * DeepSeek 官方搜索服务。返回统一结构 { ok: boolean, results: Array<{ title, url, snippet, summary, rerank_score, authority?, content? }>, error?: string }。
  * 参数容错与别名：count 支持别名 maxResults / limit，默认值为 5（单条结果约 1.5k~2k 字符，5 条约 10k 字符，有效防止撑爆上下文）；query 支持 q / keyword；need_content 支持 needContent。
  * 搜索质量调优：宽泛词容易搜出专利书或商业碎片；建议补充领域限定词（如「教材」「规范」「原理解析」「教程」「官方文档」）。检索结果自带 rerank_score（相关度）与 authority（权威度），可自行筛选排序。
- **上下文体积防爆铁律（严防触碰 3.2 万字符上限）**：
  * 沙箱 execute 结果有 32,000 字符硬上限。严禁在一次 execute 里并发/连续塞入多个 query 并直接返回全量 raw 结果（否则极易触发截断丢失后续结果）！
  * 多关键词搜索时，请在 JS 脚本中按需筛选提炼字段：const items = r.results.map(x => ({ title: x.title, url: x.url, summary: x.summary || x.snippet }))；或分轮次按需检索。
  * need_content: true 会返回单条几千到上万字符的长正文，仅在极其关键且确需全文时对 1~2 个条目开启，绝不可全量开启。
- **该不该搜：按任务类型定**（本节最要紧的一条）：
  * **创作交付必搜（防幻觉 + 权威背书）**：新建学习目标、规划路线大纲、撰写教学讲义、命制考试题目时，**必须主动使用 api.web.search 检索权威参考源**（高校教学大纲、官方技术规范、经典教材目录、权威学术文献等），并挑最权威的 1~2 篇 api.fetch 读正文（或精读权威摘要）。
    - **防止幻觉（Fact Grounding）**：模型自身容易对专业术语、公理定义、定理条件、最新规范产生记忆漂移或微妙幻觉，必须对照权威资料核准；
    - **权威背书（Authority & Trust）**：文末附带权威资料并声明来源，让学习者感知到内容的严密性与可靠性，有据可查；
    - **主观心智架构（严禁照搬目录）**：检索是为事实核验与权威背书服务，知识的心智阶梯、循序渐进的启发式推导、阶段目标的拆解必须由导师自主深度设计，严禁把搜索到的网页目录机械复制为目标项。
  * **检索不是调研**：search 只负责找到入口，snippet / summary 是索引、不是依据。挑 1~3 篇最权威的（官方文档、标准原文、教材或大纲原文）用 api.fetch 读正文，看清它到底怎么讲，再做比对、提炼与取舍。交付物里引用的每条结论，都必须来自你**读过的正文**——只看着标题和摘要就下笔，等于走个形式。
  * **抓取有 8 秒硬超时**：超时就换一个来源（或改用搜索结果里的另一条），**绝不重试同一 URL**；只拿到摘要时如实说明「这是摘要层面的信息」，不要装作读过全文。
  * **确定性工作默认不搜**：纯算法、本地逻辑、调试自己的代码、重构、格式转换、计算与数据整理、解释已有内容、闲聊——直接用你自己的知识做，不要联网。
  * **编码涉网是例外，必须搜**：写的代码要调第三方接口、依赖协议 / 规范原文、SDK 用法、鉴权流程、数据格式契约（请求头、错误码、限流、分页这类边界）时，**先 api.web.search 找官方文档与规范原文，再用 api.fetch 读正文**，确认参数与边界后落笔——接口行为靠猜，只会把轮次烧在盲试上；自己代码里的 bug 与纯本地逻辑仍属上一条，不要拿「涉网」当借口什么都搜。
  * 另外两种情况也要搜：用户明确要求查资料 / 给了网址 / 要最新信息；事实在你知识截止之后，或你拿不准且答错的代价很高。
  * **一次够用就停**：一个 query 的 5 条结果通常已够多源比对，不要为了「更全」反复换词补搜，也不要为了凑来源列表而搜。
  * 检索不到权威来源时如实说明这是通识讲解，不要用「据说」「有资料显示」含糊带过——那比不搜更糟。
  * 引用或参考网络资料时，区分客观行业事实与材料观点，确保严谨性。
- **网络引用与参考资料声明规范（强制性交付纪律）**：
  * **必须声明来源（防幻觉权威交付）**：凡在生成教学文档、大纲规划或试卷设计中使用了网络搜索（api.web.search）或网页抓取（api.fetch）获得外部事实依据的，必须在最终交付物中明确声明参考的权威站点与网址；教学文档文末**必须包含「## 📚 参考资料与权威来源」区块**。
  * **文档末尾必须使用网页类 Chip（严禁使用普通超链接）**：文档末尾的参考与引证来源**必须使用网页类 chip（#[{"type":"web","url":"...","title":"..."}] 或通过 await api.chip.build({ type: 'web', url, title }) 生成），严禁写成普通 Markdown 超链接 [文字](url)**。用户点击网页 chip 将在应用内置浏览器页签中直接查阅。
  * **Chip 标题字数限制提醒**：界面对 Chip 设置了最大宽度限制（视觉上超出自动以省略号截断），因此 chip 的 title 字段必须简明扼要（建议控制在 15~25 个汉字或 30~50 个英文字符以内，例如《MDN: Flex 布局指南》），严禁把整句话、长段摘要或整串网址塞进 title！详细的参考说明、依据与观点写在 chip 后面的 Markdown 文本中。
  * **文档内声明格式示例（教学文档末尾必须包含）**：
    \`\`\`markdown
    ## 📚 参考资料与权威来源
    - #[{"type":"web","url":"https://example.com/spec","title":"官方规范核心定义"}] - 简要说明参考依据（如：核心定义与官方最佳实践）
    - #[{"type":"web","url":"https://example.com/course","title":"权威高校公开课讲义"}] - 简要说明参考依据（如：数学理论推导与典型案例参考）
    \`\`\`
  * **对话里不再复述来源清单**：本轮改了哪些文件、真正引用了哪些来源，用一次 \`api.delivery.submit({ files, sources })\` 登记——界面会在消息底部按「一行一条」展示（文件变动 + 参考引证）。\`sources\` 只收真正读过并引用的 http/https 链接，\`files\` 写数据树路径或工作区相对路径。**没有交付物就不要调**；同一轮分几次登记会合并去重。
    示例：\`await api.delivery.submit({ files: [{ path: '微积分/极限', action: 'updated', note: '补了夹逼定理' }], sources: [{ title: '同济高等数学第七版', url: 'https://example.com/book' }] })\`
    文档内部（文末「## 📚 参考资料与权威来源」）仍按上面那条芯片规范写，那是文档的一部分，不属于交付账。`,
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
    text: `目标资源库（api.res.*）——这份规范在你第一次读写静态资源时注入：
- 清单/详情/读/建/改/删/引用扫描全部走 api.res.*（先 await api.res.__help() 查用法）；
- 图片与静态资源物理存放于 docs/目标/static/，但**不要用 api.files.* 直接读写**——那是应用数据；
- 在文档和讲义中引用静态资源使用标准 Markdown 格式：![说明](moji:static/{uuid})。`,
  },
  {
    key: 'exam',
    title: '试卷与考试',
    text: `试卷与考试——两层结构与严密读写边界：

一、试卷是节点，出题走节点宇宙
- 出题：api.node.create({ kind: "exam", under: 文档uuid }) 建卷（画布上的空壳会被原位复用）→ await api.node.get(卷uuid).help() 看**题目 JSON 契约**（题型、options、answer、rubric、image 的完整格式都在它身上）→ editContent({ title, kind, level, minutes, questions }) 落卷。历次作答（attempts）不在 content 里，也绝不会被动到。
- 两阶段流程：出题（如上）→ 交卷后 api.exam.read() 看作答、api.exam.grade(...) 判分、api.exam.explain(...) 写讲解。读任何时候都能调；判分与讲解受阶段约束。

二、读写权限与严格边界（哪些能写、哪些绝对禁止篡改）
- 🔒 用户事实层（只读！Agent 绝对禁止篡改）：
  - attempt.id（attemptId）、startedAt、endedAt、forceSubmit、overtimeMs：真实的开考与交卷时戳；
  - attempt.dwell（各题驻留毫秒数）、attempt.blurs（切屏记录）：衡量作答犹豫度与防作弊的事实数据；
  - attempt.answers（用户填写的最终答案）、attempt.inputs（用户作答敲击流记录）：用户的原始作答铁证。
- ✏️ Agent 评价层（Agent 唯一允许填写的字段）：
  - attempt.status：设为 "graded"；
  - attempt.results：逐题判分数组 [{ questionId, correct: boolean, score, maxScore, comment: "错题点拨", by: "agent" }]；
  - attempt.passed：是否通过（boolean）；
  - attempt.summary：综合成绩与掌握分析（字符串）；
  - attempt.explanation：针对错题的详尽步骤推导与 Markdown 解析。
- ❌ 严禁行为：绝不用 api.files.* 直接读写节点文件；绝不改写用户作答事实（answers / inputs / dwell / blurs）；绝不改动或覆盖之前的历史 attempts 作答轮次。

三、「出卷」流程（「出卷」工作流的执行规程）
- 摸清可考范围：const n = await api.node.get(目标节点uuid) 读教学文档（c.teaching.slice 分段看），笔记与上级、同层内容看 api.node.list()。**可考范围 = 这些已有内容 + 学科常识**——出卷只消费内容，不生产内容：补讲、写文档、调整树都与出卷轮无关。文档还空着时两选一：出**导学卷**（围绕节点标题与上级文档），或 api.ask 问「先出导学卷还是等文档生成后再出？」。唯独「先建节点补内容再出卷」不是。
- 问一次：api.ask 出一张表单——① 试卷类型（单选：随堂小测 / 小考 / 大考，选项写清题量规模）；② 难度（单选：简易 / 中等 / 难 / 极难）；最多再加一道「有没有特别想考的章节」。**不要多问**（响铃已由系统做好，不必再调 tiktok）。
- 定时限：随堂小测不限时（minutes: 0）；其余按题量与难度估 minutes，下限 = 题目数 × 2，宁可宽一点。
- 检索查证与落卷：**积极 api.web.search** 检索权威真题、标准题型、规范公式，并 **api.web.fetch 读 1~2 份真题原文**确认题型结构再命题，严禁凭主观意志编造。然后 api.node.create({ kind: "exam", under: 目标节点uuid })（空壳原位复用）→ await api.node.get(卷uuid).help() 对一眼格式 → editContent({ title, kind, level, minutes, questions }) 一次落卷。数学公式 LaTeX；需要图形的题给 image（完整 SVG）。
- 收尾：对话里告诉用户试卷已生成并列出名称与题量，请用户开始作答。

四、「阅卷」流程（「阅卷」工作流的执行规程；一次 execute 连着做完，不分两轮）
- 第零步：await api.exam.__help() 把 grade / rotateSheet / previewCrop / cropAnswer / explain 的参数查清楚再动手。
- 读卷：api.exam.read() 读当前节点的试卷与 attempts（给了「作答记录」attemptId 就读那一次，否则取最新）。**用户的 answers / inputs / dwell / blurs 是客观事实，严禁修改篡改任何字符**。
- 手写答卷方向转正与裁切贴题（若 attempt 中包含手写照片 handwrittenImages 或 answers[].image）：
  ① **方向转正**：若用户拍摄角度横置或颠倒，**必须先调用 api.exam.rotateSheet({ sheetIndex: 0, degrees: 90 })** 将其顺时针旋转转正！转正后你将直接在下一跳收到正向图片；
  ② **红框防截断预检**：为防止裁切偏差或文字被边缘截断，正式裁切前**必须先调用 api.exam.previewCrop({ questionId, box: [ymin, xmin, ymax, xmax], sourceImage: 0 })** 在图像上标出醒目红框。仔细审查返回的红框预检图：确保完整框入该题解答，且未截断公式、未包含邻题。若不理想，微调坐标再次 previewCrop 审查；
  ③ **正式裁切贴题**：确认预检红框无误后，调用 **api.exam.cropAnswer({ questionId, box: [ymin, xmin, ymax, xmax], sourceImage: 0 })** 将各题手写区域正式裁切并贴在试卷对应题目上。
- 判分：若有手写答卷，客观题与主观题均以手写内容为准由你亲自判阅，严禁机械判分；并将识别到的选项/手写文字填入 userAnswer，**一条 api.exam.grade({ attemptId, passed, summary, results }) 落账**（results = [{ questionId, correct, score, maxScore, comment, userAnswer, by: "agent" }]）。不要手写数据文件。
- 讲解：api.exam.explain({ content, attemptId }) 写详尽的步骤推导解析（Markdown），它自动打开试卷副本。
- 收尾：const n = await api.node.get(目标节点uuid)；const c = await n.content; c.status = passed ? "mastered" : "learning"; await n.editContent(c) 修正掌握状态。
- 指令给了「目标节点」就只动它；**没给**就 api.node.list() 凭上下文判断（判断不了 api.ask）。`,
  },
  {
    key: 'superlab',
    title: '超级实验室',
    text: `「超级实验室」工作流——在目标节点做一份**超级文档**：可交互的实验或小工具，用户在页签里点、文档干活并显示结果。本轮的交付物就这一份实验；知识树、教学文档都不动。
- 问需求：api.ask 问用户想做什么实验 / 需要什么功能（一道简答题，给两三个贴合当前节点主题的示例选项帮他起意）。留空等于「你来定」：挑当前节点里最能帮助理解的一个知识点自拟实验，不必再问。
- 先想后写：确定实验演示什么规律或验证什么结论、用户怎么交互（按什么、改什么、看什么结果）、界面按什么顺序排。
- 落盘：指令给了「超级文档」（一份空壳的 uuid）就**写它**——const lab = await api.node.get(壳uuid)；没给就 const r = await api.node.create({ kind: "superdoc", title: 实验名, under: 目标节点uuid })。然后 await lab.help() 看格式规范（主题变量、moji-markdown、大小上限都在里面），await lab.editContent({ html }) 写入一份完整可运行的自包含 HTML（名字不含 .html 后缀）。复杂计算函数用 api.method.create 保存、页面里 window.api.method.call 调用。
- 收尾：api.ui.superdoc('#'+目标节点uuid, '实验名') 打开该页签，再用一两句话告诉用户这个实验能玩什么。目标节点没给就 api.node.list() 凭上下文判断，判断不了 api.ask。`,
  },
  {
    key: 'explain',
    title: '了解（词条注解）',
    text: `「了解」工作流——用户在文档里选中了一个词、点了「了解」，想要一句能挂在这段文字旁边的解释。严格按顺序做：
- 先看它在讲什么：const n = await api.node.get(目标节点uuid)；const c = await n.content；取 c.teaching.slice(0, 2000) 读**这一段所在的上下文**。解释要贴着这篇文档讲——它在这里是什么意思、为什么这么说，而不是给一段百科式的通解。
- 写注解：给 c.annotations 追加一条 { term: 词条, occurrence: 出现序号, body: '注解内容' }（其余条目原样保留），await n.editContent(c) 写回——注解就划在正文对应位置；同时可用 api.node.create({ kind: 'note', title: '词条解释', under: 目标节点uuid }) 把解释记进一份笔记。
- 回话：一句话就够（例如「已把该词条的注解标在正文上」）。不要把那段解释再在对话中抄一遍。`,
  },
  {
    key: 'teach-method',
    title: '教学文档生成',
    text: `「教学文档生成」方法——为知识节点产出一份针对性教学文档的完整流程。触发它的指令只给任务与参数，步骤一律照这里执行：

一、先查再用
- 本轮会用到 api.node.* 与 api.ask。动手前先 await api.<组>.__help() 把签名与示例查清楚，不要凭记忆猜参数。
- **取材先问简报**：api.node.brief(目标uuid) 一次给齐 self / port（认领的目标项——范围与边界以它为准）/ siblings（同层其他目标项）/ taught（全图已讲过的小节，出现过的概念别重讲）。简报失败或没有目标 uuid 时才回退 api.node.list() 全图，不要默认从全图开始。

二、前置知识与权威防幻觉检索（必搜）
- 结合简报与上游文档判断，列出学会这个主题**绕不开的前置知识点**（一般 3~6 条：太少说明没拆开，太多说明没抓住主干）。
- **权威防幻觉检索与事实查证（必须执行）**：撰写讲义前，**必须主动使用 api.web.search 检索权威参考资料**（经典教材核心定义、高校教学讲义、官方技术规范、学术文献），挑最权威的 1~2 篇核准核心概念、定理推导与关键细节。
  * **防止幻觉（Fact Grounding）**：模型自身容易对专业术语、公理定义、定理推导、版本规范产生记忆漂移或微妙幻觉，必须对照权威资料核验校准；
  * **权威背书（Authority & Trust）**：文末附带权威资料并声明来源，让学习者感知到内容的严密性与可靠性，有据可查；
  * **自主启发式讲授（严禁照搬）**：权威资料用于核实事实与确立背书，正文的心智阶梯、循序渐进的启发式推导（直觉引入 → 严格推导 → 典型误区剖析 → 实战对比）由导师自主深度设计，严禁碎片化拼凑网页。
- 前置知识只进摸底表单与讲义正文，**不落成节点**——树由学习者在画布上生长（点大纲目标项挂文档、再逐个生成）。

三、摸底提问
- **先问深度，再问盲区**：用 api.ask 出表单，**最多 3 题**。第 1 题是元问题——「这一站你想让我按零基础铺开讲，还是快速过一遍、只讲容易踩的坑？」；第 2~3 题只挑最可能卡住的前置知识出单选题「这个我已经掌握 / 会一点 / 完全不会」。问一道元问题比问五道知识题准得多——全选「完全不会」多半是懒得细看，不是真的全不会。
- **表单与检索兼顾**：若本轮确实需要检索外部接口或规范细节，可将 ask 与检索放同一个 execute 里发，避免额外轮次开销；无需检索时直接出摸底表单。
- 表单会压在输入框上方，用户答完才继续——不要自问自答，也不要跳过。（触发响铃已由系统做好，不必再调 tiktok。）

四、想清楚再动笔
- 按摸底结果定详略：「完全不会」的前置在文档开头的**「预备知识」一节先补讲**（每条几段讲够用即止），「会一点」的点到为止，「已掌握」的直接用。
- 想好文档结构：先讲什么、后讲什么、在哪衔接补讲的内容。前置之外的延伸方向留给文末「下一步」，不进正文。

五、生成
- 标题已就位，一般不动；明显词不达意才连标题一起改。const n = await api.node.get(uuid)；const c = await n.content——描述空着就把 c.description 写成 150~300 字，然后 c.teaching = 讲义，一次 await n.editContent(c) 写回（整份替换，先读后写）。循序渐进、先直觉与例子再定义与推导，对摸底暴露的盲点**正面讲解**。文档连接大纲 port 的核心思想是「讲解这个目标的内容」，围绕该目标项深度讲透。排版以当前「文档格式」策略为准，结构配方见「文档排版与视觉呈现」模块：至少两三处结构性元素，不要交一篇纯文本。
- **权威引证声明与网页 Chip（必须包含）**：教学文档末尾**必须包含「## 📚 参考资料与权威来源」区块**，严格使用规范的网页 Chip（#[{"type":"web","url":"...","title":"..."}] 或 await api.chip.build({ type: 'web', url, title })）列明参考的权威站点，为讲义提供坚实的权威背书。

六、收尾与交付
- **根据学习状态主动提议完善文档（需 ask 授权）**：若在学习过程中发现学习者的状态反馈（做题错题、复述困难、提问疑惑）表明已有文档需要补充或订正，允许导师发挥主观能动性主动提议修改完善已有文档；但**必须先通过 api.ask 询问学习者是否允许修改**，列明改动理由与要点，在用户确认同意后方可调用 editContent 修改。
- **收尾一次做完**：api.node.finish(uuid, { delivery?, open: true })——交付登记、把文档指给用户看，一个调用落完；正文已在第五步写好就不必再给 content。哪一步没落上看回执里的 steps，单独补一次即可。
- 若用了网络检索，对话回复里必须声明参考资料链接。

七、任务边界与连接思想
- 文档连接大纲 port 是为了讲解目标内容，讲义围绕该目标项落地。
- 指令给了「目标节点」就只写它；**没给**就先 api.node.list() 看现状，凭上下文判断这份讲义该落在哪个节点（判断不了就 api.ask 问一次）。
- 若随指令附带了选段定位等上下文（这份文档落地哪条大纲目标项），以它为准。`,
  },
  {
    key: 'outline-method',
    title: '大纲编写',
    text: `「大纲编写」方法——为知识节点规划一份「这一层往下怎么学」的计划文件。触发它的指令只给任务与参数，规矩一律照这里执行：

一、深刻理解两种连接思想与主观能动性
- **文档连接大纲 port**：是为了**讲解这个目标的内容**（将该目标项落地成具体的讲义教学文档）。
- **大纲连接大纲 port**：是为了**进一步拆分这个目标**（当某个目标项内涵丰富、知识面广或包含多个阶段时，挂接子大纲作为子计划进一步细化拆解成下一层的阶段目标）。
- **发挥主观能动性**：根据目标复杂度和知识广度，主动判断该落地为文档还是继续细化拆分子大纲。

二、先查再用与看现状
- 识别目标节点：目标可能是普通文档 uuid 或以 o: 开头的大纲 uuid。
  \`const targetUuid = (typeof target === 'string' ? target : '').trim();\`
  \`const outlineId = targetUuid.startsWith('o:') ? targetUuid : 'o:' + targetUuid;\`
  \`const o = await api.node.get(outlineId); await o.help();\`
- **挂在大纲 port 下的子大纲拆分**：
  先 \`const ports = await o.getPortData();\` 读它认领的上级目标项，并通过 \`o.relations\` 中的 up 找到上级大纲上下文。
  认领了上级大纲 port 的大纲，本次规划的核心任务是：**将认领的这一条目标项深度拆解为 3~8 个更细致的阶段子目标**，范围严格对齐上级交付的任务，不遗漏也不越界。
- await o.content 看已有大纲（**有就整份重写，不要追加**；null = 还没写过），api.node.list() 看标题、描述与现有下级节点，await 节点.content 后取 teaching.slice(0, 2000) 扫教学文档的开头与标题结构（不要整篇读）。

三、认知规划与心智拆解（自主制定 + 权威对照防幻觉）
- **心智阶梯驱动的自主制定（核心）**：大纲的核心是为学习者量身定制由浅入深、循序渐进的认知阶梯。必须发挥导师自身的教育学与架构能力：分析当前目标的内在逻辑脉络，权衡学习者的心智跨度，判断哪几个概念是前置支柱、哪些适合落地为单篇文档（文档连 port，思想是讲解内容）、哪些体系庞大需拆为子大纲（大纲连 port，思想是进一步拆分目标）。严禁把大纲编写当成“网上搜目录搬运”，大纲的结构与目标项必须由导师自主深度制定。
- **WebSearch 权威对照与防幻觉（必搜）**：大纲规划前**必须主动使用 api.web.search 检索权威参考源**（高校教学大纲、官方技术规范、经典教材目录、权威学术体系等）。其核心作用有二：
  ① **防幻觉与体系核验**：核对专业术语的标准表达与核心分支，防止模型自身记忆漂移或重大主干遗漏；
  ② **权威背书**：汲取权威体系框架的严密性，确保大纲具有权威参考源支撑。
  检索完成后，由导师自主提炼并重构为 3~8 个阶段目标，严禁直接复制粘贴单一网页目录。
- **自主拆解阶段目标**：这一层往下拆成哪几个**阶段目标**（一般 3~8 个，每个都能独立成篇、有明确的「学完会什么」）。已经有下级节点的，计划要与它们对齐——同一个人同一层不该有两套说法。

四、落盘
- await o.editContent({ intro, children })：intro 一两段（这一层按什么路线走、为什么这么分）；children 每项 { title, summary }，summary 两三句——学什么、为什么排在这个位置。key 由标题自动生成，不要自己编。
- 收尾：写完用 api.ui.point() 打开大纲页，让用户看着路线更新。

五、层级规矩
- 只写**直接子层级**，一层为止——「爷爷知道儿子的存在，但不知道孙子的存在」。孙辈的大纲由那些子目标自己的大纲负责；children 里不要出现「1.1.1」这类两层以下的东西，summary 里也不要替孙辈规划。
- 指令给了「目标节点」就只写它那一层；**没给**就先 api.node.list() 看现状，凭上下文判断该规划哪一层（判断不了就 api.ask 问一次）。

六、收尾
- 写完用 api.ui.point() 把这份文档在文档区打开，让用户在大纲页里看这一层的路线。`,
  },
  {
    key: 'video-overview',
    title: '视频总览生成',
    text: `「视频总览」工作流——为绑定的视频资源规划语义分类结构并生成总览文档：

一、判断选集与终止条件（核心铁律）
1. 第一步必须调用 const info = await api.video.get(videoId) 获取视频详情与选集（episodes）信息。
2. 判断视频是否有选集：
   - 若 !info.hasEpisodes 或 info.episodeCount <= 1（视频没有分 P 或合集选集）：
     **必须立即停止工作流**，严禁创建任何文档或节点，直接在对话中回复告知用户：“此视频无法生成总览文档”（说明该视频为单集内容，无分 P 或合集选集，无法按选集拆解生成总览分类）。
3. 若视频有选集（info.hasEpisodes 为 true 且选集数量 > 1）：
   - 获取所有选集的标题与序号（如 P1, P2... 或 01, 02... 序号 + 标题），根据标题语义分析知识体系脉络。

二、总览文档创建与层级挂载（必须挂在视频节点子级）
- 总览文档类型与普通文档节点完全相同（kind: 'doc'）。
- **必须挂在视频节点之下作为子节点**（under 传入视频节点的 UUID，即工作流参数里的 target）：
  \`\`\`javascript
  const doc = await api.node.create({
    kind: 'doc',
    title: info.title + ' · 视频总览',
    under: target, // 视频节点的 UUID，让总览文档直接作为视频节点的子级
  })
  \`\`\`
  注意：under: target 会自动为文档节点与视频节点建立父子连线。若总览文档此前已存在，create 也会自动补全这根连线。

三、内容分类与标题层级规范（标题最少一层，最多三层）
根据对视频标题语义的归纳分类来编排正文结构：
- **标题层级最少一层，最多三层（即只使用 #、##、###；严禁使用 #### 及以上四级或更深标题）**，由你对视频标题语义的分类范围来决定具体需要几层：
  例如单层分类：
  # Java 基础入门
  
  两层分类：
  # Java 基础入门
  ## 第一阶段 基础语法
  
  三层分类：
  # Java 基础入门
  ## 第一阶段 核心入门
  ### 导学与环境搭建
- 每个小节主题分类下方插入 \`\`\`videos\`\`\` 代码块组件，将对应的视频选集链路展示出来：
  \`\`\`videos
  {{videoNodeUUID}}
  {{ range }}
  \`\`\`
  - 第一行必须是视频节点的 UUID（直接写目标视频节点实际的 uuid 字符串，即 target 参数）；
  - 第二行是展示视频的选集范围，例如：1-20, 23, 29-30（单集写数字，区间用横杠连接，多个区间用逗号隔开）。

四、写入总览文档正文
通过 api.node.get(doc.uuid) 获取创建的文档节点，使用 editContent({ teaching }) 写入完整的总览文档内容。确保所有选集序号范围都被合理归纳，没有遗漏。

五、收尾
在对话框中向用户清晰汇报生成的视频总览文档大纲结构与选集分类分布。`,
  },
  {
    key: 'project-interpret',
    title: '项目与文章解读',
    text: `「项目与文章解读」工作流规范（配合 project 节点与 quote 块语法）——当用户需要导师带着解读某些文章、文献或代码项目时，必须严格执行以下工作流：

一、前置要求：创建项目节点与材料落盘（铁律）
只要用户提供了明确的文章（含网页文章、文献、长文等）或工程项目源码：
1. **必须创建项目节点（kind: 'project'）**：无论材料是单篇文章还是大型代码仓库，在带用户解读前，都必须调用 api.node.create 创建一个项目节点（kind: 'project'）进行显式引用与挂载（挂在对应解读文档节点下或目标根节点下）。
2. **非本地材料必须通过代码真实抓取落盘（严禁自行抄录/脑补生成）**：
   - 若目标材料不在本地磁盘，**严禁导师凭空生成或抄录一份“伪文章/伪代码”**；
   - 必须通过代码工具（如使用 api.web.fetch、或在终端中运行 curl / fetch / 脚本等方式）将网络上的真实原文完整扒下来；
   - 将抓取到的原文文件保存落盘到本地工作区或目标目录（如 \`article.md\` 或源码文件）；
   - 然后再创建项目节点指向该落盘路径，确保证据链与源文件绝对真实完整。
3. 若当前目标尚未设定根文档（node.list() 中 root 为 null），先创建解读文档节点作为根节点（api.node.create({ kind: 'doc', title, root: true }) 或调用 api.node.setRoot(docUuid)），确保工作区基准就位。

二、声明项目节点（Project Node）示例
\`\`\`javascript
const proj = await api.node.create({
  kind: 'project',
  title: '文章或项目名称',
  path: '抓取落盘后的文件或项目绝对路径/相对路径',
  under: targetDocUuid, // 挂在对应解读文档节点下
})
\`\`\`
声明项目节点之后，该路径及其子树全部文件对 api.project.* 完全开放，在后续阅读、探索、引用中可随时读写。

三、编写解读文档与 Quote 块引用（核心契约）
在生成或编辑解读文档（teaching）时，不要无序大段照抄全文，**在后续讲解中必须高频使用 quote 块精准引用源文件核心行进行剖析**：
1. Quote 块语法结构：
   \`\`\`quote
   这是一段引文前置说明或背景过渡普通文本
   @文件路径(起始行-结束行){
     mark(起始行:起始列, 结束行:结束列)
   }
   以上代码片段来自xxx，重点在于...
   \`\`\`
2. 语法解析规则：
   - 块内普通文本：非 @ 开头的行作为普通文本展示，用于解释说明、段落过渡或背景交待。
   - 原文引用行：以 @ 开头，格式为 \`@<文件路径>(<起始行>-<结束行>)\`，支持可选的花括号 \`{ ... }\` 包裹 mark 标记规则。
     - 文件路径：支持绝对路径（如 \`E:/demo/index.html\`）或相对于工作区/项目节点的相对路径（如 \`workspace/article.md\`、\`src/index.ts\`）。系统会自动根据文件后缀识别语言并展示对应的代码语法高亮。
     - 行号范围：如 \`(10-34)\`，从 1 开始的闭区间；也兼容 \`(10~34)\`、\`(10至34)\` 或单行 \`(10)\`。
   - mark 标记规则：位于 \`{ ... }\` 内，格式为 \`mark(起始行:起始列, 结束行:结束列)\`（行列号均从 1 开始）。
     - 含义：将文件中指定行列范围的内容添加高亮标记背景（自适应主题高亮色），并保留代码语法高亮。
     - 支持形式：\`mark(l1:c1, l2:c2)\`、\`mark(l1:c1, c2)\`（单行区间）、\`mark(line)\`（全行标记）。
     - 注意：严禁使用圆角样式，必须保持直角设计风格！
   - 同一个 quote 块内可以包含多段普通文本与多个 @ 原文引用，形成图文对照的精读笔记。

四、排版与精读原则
- 先总述背景与核心架构，再定位关键段落/函数深入剖析。
- 用 quote 块精准引用原文关键逻辑，并在 quote 块周围配合清晰的设计思想、执行流程与图表，帮助用户吃透每一个细节。`,
  },
  {
    key: 'schedule',
    title: '日程',
    text: `日程（api.schedule.*）：list / create / update / complete / remove。
给用户排提醒，到点由宿主响铃、用户自己确认或稍后提醒——不要替用户确认，也不要 sleep 等它到点。`,
  },
  {
    key: 'workspace',
    title: '工作区',
    text: `工作区目录（api.workspace.*）——用户交付物的落点：
- 每个节点的工作区物理目录为 docs/.../workspace/，在磁盘上真实存在；
- 列/读/写优先走 api.workspace.*（list / read / write，先 await api.workspace.__help() 查用法）；
- api.files.* 也可以操作 workspace/（它是少数对 files 开放的应用目录），但结构化读写请用 api.workspace.*。`,
  },
  {
    key: 'method',
    title: '持久化函数',
    text: `持久化函数（method，按目标归档、跨对话有效）——这份规范在你第一次读写持久化函数时注入：
- api.method.create({ name, code })：把一段**可执行的函数源码**存进这个目标的函数库。
  code 写成匿名 async 函数，**第一个参数是 api**（整套沙箱 api 都在），其余参数是调用方传的实参：

      api.method.create({ name: '统计句号', code: "((api, uuid) => { const n = await api.node.get(uuid); const c = await n.content; return { count: (c.teaching.match(/。/g) ?? []).length, size: c.teaching.length } })" })

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
  把那一块标成无输出（之后它不再显示编译与运行）。这不是失败，是这类代码块的正常归宿。
  分寸：只要有哪怕一句会被执行的语句（一次调用、一个 print、一段循环、一次赋值后使用），就往下走，
  别把能跑的代码判成无输出。
- **残缺片段是常态**：那段代码多半从文档里摘出来时缺了上下文（少函数定义、少变量、少 import）。
  api.node.get(所属文档uuid) 后读 content.teaching，从文档里把缺的东西补齐；文档里也找不到的，
  按代码里的用法**模拟一份合理的假上下文**（假数据、假函数都行），让整段代码跑出可见结果——
  **绝不要**因为片段不完整就回一句「无法编译」。
- 运行环境就是一个 Web Worker：没有 window / document / DOM，没有 require / import / export，
  装不了 npm 包；可以用 console.log、await、Promise、setTimeout、Math / JSON / Date / 正则、
  TextEncoder / TextDecoder、crypto、URL；顶层可以直接 await；fetch 能用但要用户点一次同意。
  要让用户看见结果就必须 console.log（对象会被结构化显示）。
- 交货纪律：key 原样抄（别改也别自己编）；js 是完整自包含的可执行语句（不要包一层函数）；
  note 一两句中文说明补了哪些假设。**save 必须调**——不调那块代码的「运行」永远不会亮。
  代码原文不用回抄，也不要在对话里整段复述产物。`,
  },
  {
    key: 'essay-commit',
    title: '随笔整理',
    text: `「随笔整理」工作流——用户提交了**当前的全部随笔**，把与上次相比的增量整理进知识树的笔记。快照是完整的，但之前的提交已经整理过其中大部分：只处理**新增、修改、删除**的部分，别把未变化的内容重做一遍。
1. 先看知识树（api.node.list() 拿全部节点、大纲与挂件清单——每份笔记的 uuid 都在回执里），并读一读【已有整理记录】提到的那几份笔记，弄清上次整理到哪儿了。
2. **只处理【本次新增的随笔】【本次修改的随笔】【本次删除的随笔（只剩标题）】**；【本次未变化的随笔】只用来理解上下文，**不要再写一遍**；【已有整理记录】里的内容已经进过笔记。
3. 修改类随笔只给了改动处（>>> 新增 / 改动 <<< 之间）：把这段改动**合并进上次对应的笔记**，保留其余段落；确实要整篇写回时，先 await api.node.get(该笔记uuid) 取 content 读全文，改完 editContent 写回，不要整篇重写。
4. 新增内容与某份已有笔记主题相同就合并进去；该节点还没有合适笔记时才新建「随笔整理」：api.node.create({ kind: "note", title: "随笔整理", under: 该文档uuid }) 后 editContent({ text })。
5. 归不进任何已有节点的：并进最合适上级节点的「随笔整理」笔记；只有内容足够独立、值得单独成节时才 api.node.create({ kind: "doc", title, under: 父文档uuid }) 建子节点再给它建笔记。
6. 删除类随笔：只在对应笔记里**清理只来自它的段落**，或改写进更合适的位置；不要因为一条随笔被删就删掉整份笔记。
7. 只保留有长期价值的知识、结论、疑问与例子；合并重复内容，不要逐句照抄，不要编造材料里没有的东西。整理后的笔记要能独立读懂。
8. 每改完一处，在回复里用一行列出「节点路径 → 笔记名（新建/更新）」。
9. 最后为这次提交写一条**提交评论**，放在下面这对标记之间（两行标记必须原样保留，一个字都不能改；标记之间是 Markdown，**第一行是标题**——一句话概括这次整理，之后两三句正文说明把哪些内容归到了哪些节点、留下了什么疑问）。
<!-- essay-commit-comment
## （标题）
（正文）
-->`,
  },
  {
    key: 'plot-fix',
    title: '修复函数图像',
    text: `「修复函数图像」工作流——文档里一个 \`\`\`plot 渲染失败，按报错与区间一次改完。**一轮完成，不要验证渲染结果**（没有渲染通道），验收标准就是下面的硬要求。
- 修复（读 → 拼回 → 整份写）：const n = await api.node.get(目标节点uuid)；const c = await n.content；c.teaching = c.teaching.slice(0, 起始偏移) + 修好的完整围栏 + c.teaching.slice(结束偏移)；await n.editContent(c)。
- 修好的围栏必须满足（这就是验收标准）：是完整的 \`\`\`plot 围栏（含首尾两行标记）；JSON 能通过 JSON.parse；data 非空且每项有 fn；xAxis / yAxis 只能是对象（区间用 domain 写），不能写成字符串；函数变量固定用 x（参数方程用 t，极坐标用 theta）。
- 字符区间是 [0, 0)（未能自动定位，文档可能刚被改过）时：先在 c.teaching 里按围栏原文 indexOf 找到这段围栏，换算出区间再拼回。
- 改完立即 api.delivery.submit 登记修复。不要读整篇文档，不要尝试渲染验证，不要复述修复过程。`,
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
  所以别重复调用，也别把摘要复述给用户。摘要太短会被拒（原始消息没了，摘要就是唯一的上下文）。
- 摘要的写法（按顺序）：
  1. 先列 tasks（**最容易丢、也最要命**）：这几轮里用户要的但还没交付的、正做到一半的、答应过
     还没做的，逐条写清——哪个节点、哪份文档、哪个文件名、卡在哪、下一步做什么。要能让
     「换一个人接手」照着继续干，不要写「继续完善文档」这种空话。做完了的不列。
  2. 再写 summary（Markdown）：## 学习目标与背景 / ## 已经讲清的内容 / ## 学习者的状态
     （自评、错在哪、还卡在哪）/ ## 约定与术语。用户表达「我想要什么」的话保留原意。
  3. api.compact({ summary, tasks }) **只调这一次**；不要顺手改文档、建节点、出题。
  4. 回一句话告诉用户已经压好，**不要复述摘要内容**。
- 硬性要求：只写对话里真实出现过的东西——不推测、不补常识、不编造；概念名、公式、文件名写全；
  summary 控制在 1200 字以内。`,
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
- **先用现成的四个**（正文里当工具类写，见「文档排版与视觉呈现」那份规范）：animate-doc-fade、
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
    title: '文档排版与视觉呈现',
    text: `## 文档排版与视觉呈现（教学讲义 HTML + Tailwind 精装规范）

> **注入说明**：「开讲」「学习大纲」工作流会在动笔前将本规范交给你；其余场合在你首次编写教学文档后注入。

### 0. 核心审美准则：从「草稿」到「出版级讲义」
通篇只有标题和段落的文档不算讲义（渲染器给裸标签的只是兜底样式）。每一份教学文档必须具备**出版级的阅读韵律**，整篇至少落下 **3~4 处结构化视觉组件**（优先从下方 12 个精装 HTML 配方中选型，辅以原生表格与公式）。

看看同一段内容在「草稿」与「精装讲义」下的审美差距：
- **❌ 草稿（禁止）**：
  \`<h3>三种变化率</h3><p>平均变化率是一段区间上的快慢，瞬时变化率是把区间压到零。</p>\`
- **✅ 精装讲义**：
  \`<div class="my-5 border border-line bg-sunken/70 px-5 py-4"><div class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-seal"></span><span class="text-[0.72em] font-semibold tracking-wider text-seal">核心概念</span></div><h3 class="mt-1 mb-1.5 text-[0.98em] font-semibold text-ink-strong">平均变化率 vs 瞬时变化率</h3><p class="m-0 text-[0.88em] leading-relaxed text-ink">平均变化率衡量<strong>一段区间</strong>上的整体快慢；瞬时变化率则是把区间无限压缩到<strong>零</strong>时的极限状态。</p></div>\`

---

### 1. 画布前提与 Tailwind 工具箱
1. **画布尺寸**：正文列宽上限 \`800px\`，**可用内容净宽约 \`745px\`**。
2. **纸墨风主题令牌（跟随深浅色模式自动切换，严禁硬编码刺眼纯色）**：
   - **背景层**：\`bg-paper\`（底纸）/ \`bg-card\`（浮起卡片）/ \`bg-sunken\`（微凹底块）/ \`bg-inset\`（深凹槽/进度底）/ \`bg-mark\`（荧光笔高亮底）
   - **墨色层**：\`text-ink-strong\`（浓墨，主标题/核心词）/ \`text-ink\`（正墨，正文）/ \`text-ink-soft\`（淡墨，次要说明）/ \`text-ink-faint\`（残墨，角标/坐标轴/注脚）
   - **线条层**：\`border-line\`（常规细线）/ \`border-line-strong\`（强调线）
   - **语义印章色**：\`text-seal\` & \`bg-seal\` & \`border-seal\`（朱砂印章色，主强调）/ \`text-ok\` & \`bg-ok\` & \`border-ok\`（青竹色，正确/结论/达标）/ \`text-warn\` & \`bg-warn\` & \`border-warn\`（琥珀色，易错/警告/边界条件）
3. **字号与排版铁律**：
   - **字号一律用 \`em\`**：正文带有全局缩放系数，只缩放 \`em\`。严禁写 \`px\` 字号！常用档位：角标 \`text-[0.72em]\`、辅助说明 \`text-[0.8em]\`、紧凑正文 \`text-[0.88em]\`、小标题 \`text-[0.96em]\`、大号数据 \`text-[1.45em]\` ~ \`text-[1.75em]\`。
   - **数字对齐**：凡涉及表格、图表、编号、公式参数对比，必加 \`tabular-nums\`。
   - **直角骨骼感（严禁圆角边框）**：纸墨风讲究直角利落的装帧骨骼感，**容器与卡片边框严禁使用任何圆角**（绝对不要用 \`rounded-lg\`、\`rounded-md\`、\`rounded-sm\` 等圆角边框类名，一律保持纯正直角），边框优先于阴影（\`shadow-sm\` 极少用）。
   - **⚠️ 严禁空行断块**：每个 HTML 配方内部标签之间**绝对不能留空行**！空行会导致 Markdown 解析器把 HTML 拦腰截断成两半。

---

### 2. 十二个精装教学 UI 配方（照抄结构、替换文字与数据）

#### 配方一：带眉标的提示框（核心结论 / 易错警示 / 思考锚点）
*审美要点：用「小圆点 + 字距拉开的眉标（Eyebrow）」代替生硬的大标题，左边框配合细全框，精致度翻倍。*
- **核心结论**用 \`border-l-seal\` + \`text-seal\`；**定理总结**用 \`border-l-ok\` + \`text-ok\`；**易错陷阱**用 \`border-l-warn\` + \`text-warn\`。
\`\`\`html
<div class="my-5 border border-line border-l-4 border-l-warn bg-sunken/60 px-5 py-3.5"><div class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-warn"></span><span class="text-[0.72em] font-semibold tracking-widest text-warn">易错陷阱 · 边界条件</span></div><p class="mt-1.5 mb-0 text-[0.88em] leading-relaxed text-ink">当分母趋近于 0 时，<strong>不能直接代入求值</strong>，必须先通过因式分解或洛必达法则消去零因子。</p></div>
\`\`\`

#### 配方二：双栏概念交锋 / 正误辨析（每栏约 360px）
*审美要点：顶部加 2px 色条或语义徽章区分立场，避免两个灰盒子傻傻分不清。*
\`\`\`html
<div class="my-5 grid grid-cols-2 gap-4"><div class="border border-line bg-sunken/50 p-4"><div class="flex items-center justify-between border-b border-line pb-2"><span class="text-[0.92em] font-semibold text-ink-strong">直觉误区</span><span class="bg-warn/15 px-1.5 py-0.5 text-[0.72em] font-semibold text-warn">✗ 常见错误</span></div><p class="mt-2.5 mb-0 text-[0.86em] leading-relaxed text-ink-soft">认为导数等于 0 的点一定是极值点，忽略了导数在驻点两侧是否变号。</p></div><div class="border border-line bg-card p-4"><div class="flex items-center justify-between border-b border-line pb-2"><span class="text-[0.92em] font-semibold text-ink-strong">严格定义</span><span class="bg-ok/15 px-1.5 py-0.5 text-[0.72em] font-semibold text-ok">✓ 正确认知</span></div><p class="mt-2.5 mb-0 text-[0.86em] leading-relaxed text-ink">驻点只是极值点的<strong>候选人</strong>。如 y = x³ 在 x = 0 处导数为 0，但两侧皆正，属于拐点而非极值点。</p></div></div>
\`\`\`

#### 配方三：定理 / 核心公式解剖卡（公式 + 逐项拆解）
*审美要点：教学中最怕丢出一个冷冰冰的公式。上半部居中展示核心表达式，下半部用三栏微网格拆解每一项的物理/数学意义。*
\`\`\`html
<div class="my-6 border border-line bg-card overflow-hidden"><div class="border-b border-line bg-sunken/50 px-5 py-4 text-center"><div class="text-[0.72em] font-semibold tracking-widest text-ink-faint">核心表达式 · 贝叶斯定理</div><div class="mt-1.5 text-[1.35em] font-semibold tracking-wide text-ink-strong tabular-nums">P(A|B) = [ P(B|A) · P(A) ] / P(B)</div></div><div class="grid grid-cols-3 divide-x divide-line bg-paper/40 text-[0.82em]"><div class="p-3.5"><span class="font-semibold text-seal">P(A|B) 后验概率</span><p class="mt-1 mb-0 leading-snug text-ink-soft">看到新证据 B 后，对事件 A 发生概率的修正认知。</p></div><div class="p-3.5"><span class="font-semibold text-ink-strong">P(B|A) 似然度</span><p class="mt-1 mb-0 leading-snug text-ink-soft">假定 A 成立的前提下，观察到现象 B 的可能性。</p></div><div class="p-3.5"><span class="font-semibold text-ink-soft">P(A) 先验概率</span><p class="mt-1 mb-0 leading-snug text-ink-soft">在没有新证据之前，基于历史经验对 A 的初始判断。</p></div></div></div>
\`\`\`

#### 配方四：带贯穿引导线的步骤轴（推导过程 / 解题SOP / 历史演进）
*审美要点：用左侧 \`border-l\` 做出贯穿竖线，序号圆圈压在线上，每一步自带小标题与微说明，告别松散罗列。*
\`\`\`html
<div class="my-5 pl-3"><div class="relative border-l border-line-strong pl-6 space-y-5"><div class="relative"><span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-seal text-[0.72em] font-semibold text-white tabular-nums">1</span><h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">定位系统边界与研究对象</h4><p class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">明确把哪个物体或物体系隔离出来，圈出所有接触面与场力来源。</p></div><div class="relative"><span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-seal text-[0.72em] font-semibold text-white tabular-nums">2</span><h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">建立正交坐标系并正交分解</h4><p class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">沿加速度方向建立 x 轴，垂直方向建 y 轴，将斜向力投影到坐标轴上。</p></div><div class="relative"><span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-strong text-[0.72em] font-semibold text-white tabular-nums">3</span><h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">联立平衡方程或牛顿第二定律求解</h4><p class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">分别列出 ΣFx = ma 与 ΣFy = 0，消去未知中间量。</p></div></div></div>
\`\`\`

#### 配方五：横向机制推导链（因果流 / 编译管线 / 状态转化）
*审美要点：用于展现「A 导致 B 导致 C」的机制，比纯文字描述直观十倍。*
\`\`\`html
<div class="my-5 flex items-stretch justify-between gap-2 border border-line bg-sunken/40 p-3.5 text-[0.84em]"><div class="flex-1 bg-card p-3 border border-line"><div class="text-[0.72em] text-ink-faint tabular-nums">STAGE 01</div><div class="mt-0.5 font-semibold text-ink-strong">源码输入</div><p class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">字符流读入内存</p></div><div class="flex items-center text-ink-faint px-1">→</div><div class="flex-1 bg-card p-3 border border-line"><div class="text-[0.72em] text-seal tabular-nums">STAGE 02</div><div class="mt-0.5 font-semibold text-ink-strong">词法与语法分析</div><p class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">生成抽象语法树 AST</p></div><div class="flex items-center text-ink-faint px-1">→</div><div class="flex-1 bg-card p-3 border border-seal/50"><div class="text-[0.72em] text-ok tabular-nums">STAGE 03</div><div class="mt-0.5 font-semibold text-ink-strong">目标代码生成</div><p class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">输出机器指令序列</p></div></div>
\`\`\`

#### 配方六：关键指标 / 参数看板（3栏大数字并排）
*审美要点：顶栏给分类标签，中间给大号 \`tabular-nums\` 核心数据，底栏给一句精炼解读。*
\`\`\`html
<div class="my-5 grid grid-cols-3 gap-4"><div class="border border-line bg-card px-4 py-3.5"><div class="text-[0.74em] text-ink-faint">时间复杂度（平均）</div><div class="mt-1 text-[1.5em] font-semibold text-seal tabular-nums">O(n log n)</div><div class="mt-1 text-[0.78em] text-ink-soft">分治递归的最优平衡点</div></div><div class="border border-line bg-card px-4 py-3.5"><div class="text-[0.74em] text-ink-faint">最坏退化情况</div><div class="mt-1 text-[1.5em] font-semibold text-warn tabular-nums">O(n²)</div><div class="mt-1 text-[0.78em] text-ink-soft">基准值每次恰好选到极值</div></div><div class="border border-line bg-card px-4 py-3.5"><div class="text-[0.74em] text-ink-faint">原地空间开销</div><div class="mt-1 text-[1.5em] font-semibold text-ok tabular-nums">O(log n)</div><div class="mt-1 text-[0.78em] text-ink-soft">仅消耗递归调用栈深度</div></div></div>
\`\`\`

#### 配方七：词典式术语名片（引入新概念 / 专有名词时使用）
*审美要点：模仿权威辞书排版，包含词条名、英文/符号对照、词性/领域标签，以及一句话本质定义。*
\`\`\`html
<div class="my-4 border border-line bg-card px-5 py-3.5"><div class="flex items-baseline justify-between border-b border-line pb-2"><div class="flex items-baseline gap-2.5"><span class="text-[1.05em] font-semibold text-ink-strong">熵增定律</span><span class="text-[0.82em] italic text-ink-faint">Law of Increasing Entropy · ΔS ≥ 0</span></div><span class="bg-sunken px-2 py-0.5 text-[0.72em] text-ink-soft">热力学第二定律</span></div><p class="mt-2.5 mb-0 text-[0.88em] leading-relaxed text-ink">在孤立系统中，热量总是自发地从高温物体流向低温物体，系统的<strong>微观无序度（熵）</strong>永远不会自发减少。</p></div>
\`\`\`

#### 配方八：精装横向条形对比图（量级对比 / 占比排行）
*审美要点：增加图表 Header 说明单位，最优项用 \`bg-seal\` 高亮，其余陪跑项用 \`bg-ink-soft/40\` 降噪，形成强烈视觉焦点。*
\`\`\`html
<div class="my-5 border border-line bg-card p-4"><div class="mb-3 flex items-baseline justify-between border-b border-line pb-2"><span class="text-[0.88em] font-semibold text-ink-strong">不同存储介质访问延迟量级对比</span><span class="text-[0.74em] text-ink-faint">单位：纳秒 (ns)，越短越快</span></div><div class="space-y-2.5 text-[0.84em]"><div class="flex items-center gap-3"><span class="w-[105px] shrink-0 font-semibold text-ink-strong">L1 缓存</span><div class="h-2.5 flex-1 bg-inset"><div class="h-2.5 bg-ok" style="width:8%"></div></div><span class="w-[52px] shrink-0 text-right font-semibold tabular-nums text-ok">1 ns</span></div><div class="flex items-center gap-3"><span class="w-[105px] shrink-0 text-ink-soft">L2 缓存</span><div class="h-2.5 flex-1 bg-inset"><div class="h-2.5 bg-seal/80" style="width:28%"></div></div><span class="w-[52px] shrink-0 text-right tabular-nums text-ink-soft">4 ns</span></div><div class="flex items-center gap-3"><span class="w-[105px] shrink-0 text-ink-soft">主存 (RAM)</span><div class="h-2.5 flex-1 bg-inset"><div class="h-2.5 bg-ink-soft/45" style="width:100%"></div></div><span class="w-[52px] shrink-0 text-right tabular-nums text-ink-faint">100 ns</span></div></div></div>
\`\`\`

#### 配方九：带数值顶标的生长柱状图（离散数据对比）
*审美要点：列容器必须写 \`h-full\`（否则百分比高度塌陷为 0）！在柱子顶端加上 \`tabular-nums\` 具体数值，关键柱用 \`bg-seal\`，常规柱用 \`bg-seal/45\` 拉开主次。*
\`\`\`html
<div class="my-5 border border-line bg-card p-4"><div class="mb-3 flex items-baseline justify-between"><span class="text-[0.88em] font-semibold text-ink-strong">样本在不同迭代轮次下的准确率跃升</span><span class="text-[0.74em] text-ink-faint">单位：%</span></div><div class="flex h-40 items-end gap-4 border-b border-line px-3 pt-5"><div class="flex h-full flex-1 flex-col items-center justify-end"><span class="mb-1 text-[0.72em] tabular-nums text-ink-faint">42%</span><div class="w-[52%] origin-bottom animate-doc-grow bg-seal/40" style="height:42%"></div></div><div class="flex h-full flex-1 flex-col items-center justify-end"><span class="mb-1 text-[0.72em] tabular-nums text-ink-faint">68%</span><div class="w-[52%] origin-bottom animate-doc-grow bg-seal/65 [animation-delay:120ms]" style="height:68%"></div></div><div class="flex h-full flex-1 flex-col items-center justify-end"><span class="mb-1 text-[0.72em] font-semibold tabular-nums text-seal">94%</span><div class="w-[52%] origin-bottom animate-doc-grow bg-seal [animation-delay:240ms]" style="height:94%"></div></div></div><div class="mt-2 flex gap-4 px-3 text-[0.76em] text-ink-faint"><span class="flex-1 text-center">Epoch 1</span><span class="flex-1 text-center">Epoch 5</span><span class="flex-1 text-center font-semibold text-ink-strong">Epoch 10 (收敛)</span></div></div>
\`\`\`

#### 配方十：带基准网格与关键点标注的 SVG 曲线图（趋势 / 函数图像）
*审美要点：不要只画一条孤零零的线！加上虚线参考线（\`stroke-dasharray="4 4"\`）、曲线下方的淡色渐变投影区、以及关键转折点的圆圈与文字标注，立刻拥有教科书插图质感。*
\`\`\`html
<figure class="md-fig my-5 border border-line bg-card p-4"><svg viewBox="0 0 720 220" class="w-full"><line x1="45" y1="40" x2="690" y2="40" stroke="currentColor" stroke-dasharray="4 4" class="text-line" /><line x1="45" y1="115" x2="690" y2="115" stroke="currentColor" stroke-dasharray="4 4" class="text-line" /><line x1="45" y1="190" x2="690" y2="190" stroke="currentColor" class="text-line-strong" /><text x="36" y="44" text-anchor="end" class="fill-current text-ink-faint text-[11px] tabular-nums">100</text><text x="36" y="119" text-anchor="end" class="fill-current text-ink-faint text-[11px] tabular-nums">50</text><text x="36" y="194" text-anchor="end" class="fill-current text-ink-faint text-[11px] tabular-nums">0</text><path d="M45 175 L200 135 L360 142 L520 68 L680 48" fill="none" stroke="currentColor" stroke-width="2.5" class="text-seal animate-doc-draw" pathLength="1" stroke-dasharray="1" /><circle cx="520" cy="68" r="4.5" class="fill-current text-seal" /><text x="520" y="53" text-anchor="middle" class="fill-current text-ink-strong text-[12px] font-semibold">拐点突破 (78%)</text></svg><figcaption class="mt-2 text-center text-[0.78em] text-ink-faint">图 1：第 4 阶段跨过临界阈值后，斜率显著陡峭化（视线请聚焦圆点标注处）。</figcaption></figure>
\`\`\`

#### 配方十一：分段式构成条（比例拆解 / 时间分配 / 内存布局）
*审美要点：单个进度条太单调，用多色块拼接展示整体内部的构成比例，底部配圆点图例。*
\`\`\`html
<div class="my-5 border border-line bg-card p-4"><div class="flex items-baseline justify-between text-[0.84em]"><span class="font-semibold text-ink-strong">典型深度学习训练显存占用构成</span><span class="tabular-nums text-ink-faint">总计 100%</span></div><div class="mt-2.5 flex h-3 w-full overflow-hidden bg-inset gap-0.5"><div class="h-full bg-seal" style="width:55%"></div><div class="h-full bg-ok" style="width:25%"></div><div class="h-full bg-warn" style="width:20%"></div></div><div class="mt-2.5 flex items-center gap-5 text-[0.76em] text-ink-soft"><span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full bg-seal"></i>优化器状态 <strong class="tabular-nums text-ink-strong">55%</strong></span><span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full bg-ok"></i>激活值缓存 <strong class="tabular-nums text-ink-strong">25%</strong></span><span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full bg-warn"></i>模型权重与梯度 <strong class="tabular-nums text-ink-strong">20%</strong></span></div></div>
\`\`\`

#### 配方十二：随堂微测 / 自检折叠卡（思考题 + 答案揭晓）
*审美要点：把练习题和解析放在同一个视觉容器内，上方设问，下方用虚线分割出带底色的「思路揭晓」，极适合放在小节末尾检验理解。*
\`\`\`html
<div class="my-5 border border-line bg-card overflow-hidden"><div class="px-5 py-3.5"><span class="bg-seal/10 px-1.5 py-0.5 text-[0.72em] font-semibold text-seal">快问快答 · 概念自检</span><p class="mt-2 mb-0 text-[0.9em] font-semibold text-ink-strong">如果将单摆的摆球质量增加一倍，在小角度摆动下，它的固有周期 T 会如何变化？</p></div><div class="border-t border-dashed border-line bg-sunken/60 px-5 py-3 text-[0.84em] leading-relaxed text-ink-soft"><strong class="text-ok">✓ 答案：保持不变。</strong> 由单摆周期公式 T = 2π√(L/g) 可知，周期仅取决于摆长 L 与当地重力加速度 g，与摆球质量 m 无关。</div></div>
\`\`\`

---

### 3. 四条排版审美纪律（必读）

1. **视觉呼吸感（禁止盒子堆砌）**：**绝对不要把整篇文档切成十几个连续的卡片**！任意两个 HTML 配方之间，必须有至少 1~2 段平实的 Markdown 正文作为过渡与铺垫。留白、字号层级和一条细分隔线（\`border-line\`）比满屏边框耐读得多。
2. **色彩降噪原则**：一个图表或组件里，高饱和度的语义色（\`seal\` / \`ok\` / \`warn\`）**只给最核心的那 1~2 个焦点数据**（例如最大值、拐点、正确项），其余陪衬项一律用 \`bg-seal/40\`、\`bg-ink-soft/40\` 或 \`bg-sunken\` 压暗，有暗才有亮。
3. **动画克制**：生长（\`animate-doc-grow\`）、描线（\`animate-doc-draw\`）、浮现（\`animate-doc-fade\` / \`animate-doc-rise\`）只用在需要体现「过程感」的图表上，同一屏最多一处动画，静态能讲清的绝不乱动。
4. **图文互文**：每张图或数据看板下方必须配说明，且在紧邻的正文里明确点出「请看图中的 X 处」——图表是推理链条的一环，绝不是凑数的装饰品。`,
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
 * api 名 → 模块 key 的触发映射：按组前缀（content.write → content），顶层名（wait / ask）用名字本身。
 * 只有「规范搬进了模块」的组才在这里；content / graph / state / ask 这些每轮必用的组不触发注入。
 */
const GROUP_MODULE: Record<string, string> = {
  browser: 'browser',
  web: 'web',
  fetch: 'web',
  mcp: 'mcp',
  res: 'res',
  exam: 'exam',
  schedule: 'schedule',
  workspace: 'workspace',
  method: 'method',
  code: 'code',
  compact: 'compact',
  subagent: 'subagent',
  ui: 'ui',
  project: 'project-interpret',
}

export function promptModuleForApiName(name: string): string | null {
  const dot = name.indexOf('.')
  const group = dot < 0 ? name : name.slice(0, dot)
  return GROUP_MODULE[group] ?? null
}

/**
 * 写入内容里的标记 → 模块 key（内容触发）：模型写出 ```plot 图像或 SMIL / @keyframes
 * 动画时，对应的数据形态 / 动画写法模块就该在场。宿主在 execute 的写入调用参数上
 * 嗅探（见 sandbox/execute 的 callApi 与下面的 writableContentOf）。
 *
 * target 是这次写入的第一个参数（content.* 的定位对象）：part 写 superdoc:* 的写入
 * 本来就是完整 HTML，不注入 doc-html 排版配方（那与超级文档的写法相冲），但 plot /
 * 动画标记照常嗅探。
 */
export function promptModuleForContent(content: string, superdoc: boolean, apiName?: string): string[] {
  const out: string[] = []
  // 写教学文档（files.write / files.edit / 节点对象的 editContent 写 teaching）就注入排版配方；
  // 超级文档（payload 是完整 HTML）不注入 doc-html——排版配方与它的写法相冲
  const writeish = apiName === 'files.write' || apiName === 'files.edit' || apiName === 'node.invoke'
  if (!superdoc && writeish) {
    out.push('doc-html')
  }
  if (content.includes('```plot')) out.push('plot-forms')
  if (content.includes('```quote')) out.push('project-interpret')
  if (content.includes('<animate') || content.includes('@keyframes')) out.push('rich-animation')
  return out
}

/**
 * 从一次写入调用里取出可嗅探的正文与「是不是完整 HTML（超级文档）」。
 * 大纲等对象 payload 没有可嗅探的正文，回 null；其余调用不携带正文，也回 null。
 */
export interface WritableContent {
  text: string
  /** 超级文档：payload 本来就是完整 HTML，不注入排版配方 */
  superdoc: boolean
}

export function writableContentOf(name: string, args: unknown[]): WritableContent | null {
  if (name === 'files.write') {
    return typeof args[1] === 'string' ? { text: args[1], superdoc: false } : null
  }
  if (name === 'files.edit') {
    const payload = args[1]
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>
      if (typeof p.content === 'string') return { text: p.content, superdoc: false }
      if (p.replace && typeof p.replace === 'object') {
        const rep = p.replace as Record<string, unknown>
        if (typeof rep.replacement === 'string') return { text: rep.replacement, superdoc: false }
        if (typeof rep.new === 'string') return { text: rep.new, superdoc: false }
      }
    }
    return null
  }
  if (name === 'node.invoke') {
    // 新协议：invoke(uuid, 成员名, 参数数组)——只有 editContent 带可嗅探的正文
    const member = typeof args[1] === 'string' ? args[1] : ''
    if (member !== 'editContent') return null
    const rest = Array.isArray(args[2]) ? args[2] : []
    const payload = rest[0]
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const p = payload as Record<string, unknown>
    if (typeof p.teaching === 'string') return { text: p.teaching, superdoc: false }
    if (typeof p.text === 'string') return { text: p.text, superdoc: false }
    if (typeof p.html === 'string') return { text: p.html, superdoc: true }
    return null
  }
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
 * 一条模块消息：隐藏 **assistant** 消息，promptModule 供去重。
 *
 * 模块是「怎么做」的**声明**（排版配方、api 规程、方法流程）——固定内容、声明一次、
 * 同上下文不重复，归 assistant 边；「做什么」的指令（工作流、用户消息）才是 user。
 * 与 personaMessage 同一个形状家族，也是一条**提示词注入**（inject: 'prompt'）：
 * 它不分割轮次，界面上并进那一轮的「思考、工具与提示词」过程组——与思考、工具调用
 * 同一层（见 agent/messageKind 与 panel/partGroups）。正文只在上下文里，展开看全文。
 */
export function promptModuleMessage(mod: PromptModule, uuid: string, at: number): ConversationMessage {
  return {
    id: uuid,
    role: 'assistant',
    parts: [{ type: 'text', text: mod.text }],
    ts: at,
    hidden: true,
    mark: t('提示词模块 · {0}', mod.title),
    promptModule: mod.key,
    inject: 'prompt',
  }
}
