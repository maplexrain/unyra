/**
 * execute 沙箱的 api 目录：一组一档，每条给签名与一句说明。
 *
 * 这是「execute 工具 api 上下文管理」页（超级导师设置 → 开发者，见
 * components/AgentSettingsPanel）的数据源：开发者在这里核对「当前 agent 到底
 * 有哪些 api 可用、各自怎么调」，与实现互相对账。
 *
 * 注意它**只是目录，不是实现**——真正的行为在 learn/agentOps / learn/mind /
 * agent/tools 与 learn/ai 的 EXECUTE_GUIDE。改了实现忘了改这里，页面上就会
 * 出现一条不存在的 api；所以每条都写明它挂在哪个条件上（是否注入）。
 */

export interface ApiEntry {
  name: string
  signature: string
  summary: string
  /** 什么时候才可用（绝大多数恒可用；条件注入的少数要写明） */
  availability?: 'always' | 'exam' | 'ui' | 'browser' | 'subagent'
}

export interface ApiGroup {
  key: string
  label: string
  intro: string
  items: ApiEntry[]
}

export const SANDBOX_API_CATALOG: ApiGroup[] = [
  {
    key: 'node',
    label: '节点 · node',
    intro: '一次编排可以同时操作多个节点；本目标内标题唯一，写标题一定指得明白。',
    items: [
      { name: 'node.list', signature: 'node.list()', summary: '全部节点：路径、id、标题、状态、描述摘要、文档字数、掌握度', availability: 'always' },
      { name: 'node.read', signature: 'node.read(path)', summary: '单个节点详情（含上级与各笔记字数）', availability: 'always' },
      { name: 'node.paths', signature: 'node.paths(path?)', summary: '查询节点的物理存储结构与全套路径（id / title / 路径 / 所在目录 / 教学文档 / 笔记目录 / 大纲文件 / 元数据文件）', availability: 'always' },
      { name: 'node.title', signature: 'node.title(path)', summary: '读标题', availability: 'always' },
      { name: 'node.rename', signature: 'node.rename(path, 新标题)', summary: '改名（数据目录名跟着变）', availability: 'always' },
      { name: 'node.update', signature: 'node.update(path, { title?, description?, status? })', summary: '改标题 / 描述 / 状态（learning | mastered）', availability: 'always' },
      { name: 'node.annotate', signature: 'node.annotate(path?, { term, body, occurrence? })', summary: '在节点文档中向某词条追加术语解析或概念批注', availability: 'always' },
      { name: 'node.create', signature: 'node.create({ parent, title, description? })', summary: '建下级节点；parent 必填（标题 / 路径 / #id）；同名节点会明确拒绝，标题禁止包含斜杠；创建时教学文档与大纲两份文件同时就位', availability: 'always' },
      { name: 'node.move', signature: 'node.move(path, 新父节点)', summary: '迁移节点到另一个节点之下（改父线；目标的根不能移、跨目标不能移、不能移成环）', availability: 'always' },
      { name: 'node.delete', signature: 'node.delete(path)', summary: '删除节点（学习目标本身不能删）', availability: 'always' },
    ],
  },
  {
    key: 'chip',
    label: '引用 chip · chip',
    intro:
      '交付清单里的 #[{…}] 用这一组生成与校验，**不要手写**——手拼的 path（拿节点标题或「教学」' +
      '这类别称去拼【目标】/教学）在数据树里不存在，学习者点开是一片空。build 当场对 store 解析，' +
      '生成的 payload 永远带 nodeId，定位不到就 ok:false 说明原因；check 在交付前把草稿里的 chip 逐颗验一遍。',
    items: [
      { name: 'chip.build', signature: 'chip.build({ type, path?, url?, note?, name?, examId?, attemptId?, dir?, title? })', summary: '生成一颗引用 chip 并当场验证可定位，返回 { chip, type, title }——把 chip 原样抄进回复。type 认 doc/note/outline/super/exam/attempt/ws/web/local；path 寻址与 doc.* 同构（省略 = 当前节点）', availability: 'always' },
      { name: 'chip.check', signature: 'chip.check(text)', summary: '交付前自查：解析文本里每一颗 #[{…}] 并验证定位，回 { total, valid, invalid, problems }——坏的用 build 重新生成', availability: 'always' },
    ],
  },
  {
    key: 'method',
    label: '持久化函数 · method',
    intro:
      '执行已保存的持久化 JS 函数源码（源码管理已统一收敛为 files.* 读写 docs/:goal/methods/:name.js）。' +
      '超级文档里的脚本亦用 api.method.call(name, ...args) 调它们——写一次，处处复用。',
    items: [
      { name: 'method.list', signature: 'method.list()', summary: '列出当前目标已有的函数名清单', availability: 'always' },
      { name: 'method.create', signature: 'method.create({ name, code })', summary: '把一段可执行的函数源码存进当前目标的函数库', availability: 'always' },
      { name: 'method.delete', signature: 'method.delete(name)', summary: '删除当前目标函数库里的某个函数', availability: 'always' },
      { name: 'method.call', signature: 'method.call(name, ...args)', summary: '执行一个函数（注入当前编排的 api），返回它的返回值', availability: 'always' },
    ],
  },
  {
    key: 'wf',
    label: '工作流触发 · wf',
    intro:
      '三级任务模板的触发调用（工作流的定义与修改已统一收敛为 files.* 读写 workflows/:name.json）。' +
      '导师用 wf.invoke 交活（多为出卷、复习等独占流程），instruction 作为一条 user 消息整段进入上下文。',
    items: [
      { name: 'wf.list', signature: 'wf.list(opts?)', summary: '列出所有可用工作流（内置/全局/目标级）的名称与简短描述（默认 brief 模式节约上下文；传 { full: true } 含完整指令）', availability: 'always' },
      { name: 'wf.get', signature: 'wf.get(idOrName)', summary: '获取指定工作流的完整定义与执行指令模板（含参数占位符）', availability: 'always' },
      { name: 'wf.invoke', signature: "wf.invoke(idOrName, { params? })", summary: '把这件事交给某条工作流：**不当场执行**，本轮收口后宿主另起一轮，instruction 作为一条 user 消息进上下文（params 填 {{占位符}}）；一次编排最多触发一条，一条链上最多连着触发三次', availability: 'always' },
    ],
  },
  {
    key: 'code',
    label: '代码块伪编译 · code',
    intro:
      '文档里的代码块上有一个「编译」按钮，用户点它会触发内置工作流「伪编译」（指令里带着 key、' +
      '语言标记与那段代码）。你转译完之后用这一条把产物交回宿主：宿主按 key 认领，' +
      '把它挂到那个代码块的「运行」按钮上（产物落在数据目录里，重启还在）。',
    items: [
      {
        name: 'code.save',
        signature: 'code.save({ key, js, note })',
        summary:
          '交付伪编译产物：key 原样用触发消息里给的那串；js 是完整、自包含、能在 Web Worker 里跑的代码' +
          '（无 DOM、无 require/import，顶层可用 await，要出结果就 console.log）；note 是一两句说明（显示给用户）。' +
          '不调它，那个代码块的「运行」不会亮',
        availability: 'always',
      },
      {
        name: 'code.silent',
        signature: 'code.silent({ key, reason })',
        summary:
          '判定这段代码**没有输出**：只有定义（类型 / 接口 / 函数 / 类）的代码块，转译出来也没有任何东西可看。' +
          '看到这种代码就**立刻停止编译**、不要写 js，调它并给一句 reason；那块代码从此不再显示编译与运行',
        availability: 'always',
      },
    ],
  },
  {
    key: 'compact',
    label: '上下文 · compact',
    intro:
      '把这段对话压成一份交接摘要。**摘要由你写**（你本来就看得到整段上下文），' +
      '写完调 api.compact 落进会话；**本轮 loop 结束后**它才生效：那之前的消息全部失活，' +
      '此后只有这份摘要与之后的新消息进上下文。所以两件事最重要：' +
      '**把还没做完的事逐条写进 tasks（要高保真）**，以及**只调这一次、别顺手做别的**。',
    items: [
      { name: 'compact', signature: 'compact({ summary, tasks })', summary: '写入交接摘要：summary 是正文（目标与背景 / 已讲清的内容 / 学习者的状态 / 约定与术语），tasks 是还没做完的事（逐条，写到能照着继续干）；太短会被拒', availability: 'always' },
    ],
  },
  {
    key: 'web',
    label: '读网页与搜索 · web.webFetch / web.read / web.search',
    intro:
      '把网页读成正文、用主流引擎搜索。**长的页面不会整篇塞给你**：超过两万多字就存成文件，只回一棵大纲树' +
      '（每行「# 标题 - 这一节正文的字数」，不含子节），你按小节 web.read 去取。' +
      '抓取只读、有体积（4MB）与时间（20 秒）上限，本机与内网地址一律拒绝。' +
      '别连着抓十几个站点：先想清楚要哪一段，再动手。',
    items: [
      { name: 'web.webFetch', signature: "web.webFetch('https://…')", summary: '抓一页并转成 markdown：短的回全文，长的存成文件并回大纲树（每节字数）+ uuid', availability: 'always' },
      { name: 'web.read', signature: "web.read(uuid, '一级标题/二级标题')", summary: '读落盘网页的某一节（path 可省略：从头给一段 + 大纲）；一次最多回 1.2 万字，没回完会说明怎么继续', availability: 'always' },
      { name: 'web.search', signature: "web.search(query, { engines? | engine?, lang?, count?, onEngineFail? }?)", summary: '多引擎搜索（baidu / bing / google / yandex / wikipedia）：engines 给数组并行搜多家（≤3）；回 searchedAt（抓取时刻，结果里的相对时间按它折算）+ results，解析不出的引擎在 failed 里说明；**engines 全挂缺省自动用 baidu/bing 补搜一轮**（onEngineFail:"strict" 关掉），weak 列出只回标题没摘要的引擎', availability: 'always' },
    ],
  },
  {
    key: 'browser',
    label: '内置浏览器 · browser',
    intro:
      '操作**界面上开着的网页页签**（文档区里那种地球图标页签）：开站、管理页签、snapshot 元素清单、' +
      '对 ref 做受控 DOM 操作、区域/整页取文本、日志与网络请求、页面上下文直发 HTTP、截图。' +
      '**看 = snapshot/text/read（文本）优先，capture（截图）是最后手段**；dom 与 fetch 是受控操作' +
      '（固定函数 + 值参数，没有任意 JS 的口子），操作的是用户的真实登录会话——不可逆动作先问用户。' +
      'logs/logDetail/fetch/record/text/scroll 这六条 **tabId 必给**（日志与请求跟着页签走）。',
    items: [
      { name: 'browser.open', signature: "browser.open('https://…')", summary: '开一个网页页签（纯关键词当搜索词）；回 tabId，返回时首屏基本加载完', availability: 'browser' },
      { name: 'browser.tabs', signature: 'browser.tabs()', summary: '全部存活的网页页签：回 { tabs: [{ tabId, url, title, active, group }] }；browser.open 前先查它（同一网址 activate 即可，别重复开），之后一切操作按 tabId 指名', availability: 'browser' },
      { name: 'browser.snapshot', signature: 'browser.snapshot(tabId?, { role?, contains?, limit? }?)', summary: '页面快照：可交互元素列成带 ref 的清单（role + 名称 + 输入值）——认结构、找要点的元素全靠它；**大页面给过滤**：{role:"link"}、{contains:"关键词"}、{limit:30}，别整份捞；DOM 变了 ref 会过期，重新 snapshot 即可', availability: 'browser' },
      { name: 'browser.activate', signature: 'browser.activate(tabId)', summary: '把某个页签切到前台', availability: 'browser' },
      { name: 'browser.close', signature: 'browser.close(tabId | [tabId…])', summary: '关掉某个页签（不弹确认）；给数组批量关——试错页签的收尾一把清（用户自己开的别关）', availability: 'browser' },
      { name: 'browser.point', signature: 'browser.point(tabId?, 目标)', summary: '页面像锚点跳转一样滚到目标元素（{ ref } 或选择器），并注入短暂的脉冲高亮把它标出来——指给用户看、或自己确认位置', availability: 'browser' },
      { name: 'browser.dom', signature: 'browser.dom(tabId?, ref | { ref }, op, arg?)', summary: '对 snapshot 清单里的 ref 做受控 DOM 操作（ref 认数字或 { ref }，与 text/point 一致）：op = "click" / "fill"(文字，触发 input/change) / "focus" / "submit"(所在表单) / "press"(键盘键如 "Enter"——fill+submit 走不通的搜索框靠它) / "text"(元素文字 ≤4000 字) / "attr"(属性名)；result 回操作自己的小结果', availability: 'browser' },
      { name: 'browser.read', signature: 'browser.read(tabId?, { maxChars?, offset? }?)', summary: '整页转 markdown（与 webFetch 同一条管线）：短的回全文（给 {maxChars} 只取前段、{offset} 续读），长的落盘回大纲树 + uuid，再用 web.read 按节读——登录态页面也能读。提取不出正文（SPA 常见）时改用 browser.text，别怀疑渲染', availability: 'browser' },
      { name: 'browser.capture', signature: 'browser.capture(tabId?)', summary: '页面截图 → 存进资源库并附在下一跳，回执带 uuid（引用写 ![说明](moji:static/<uuid>)，不用再翻 res.list）；偶发超时会自动重试一次——**最后手段**：snapshot/read/text 拿不到的信息才用它', availability: 'browser' },
      { name: 'browser.logs', signature: 'browser.logs(tabId, { kind?, level?, only?, limit?, afterSeq?, meta? }?)', summary: '页签日志**清单**（tabId 必给）：console 报错 + 页面自己发的网络请求，重复折叠成 ×N 一行、静态资源（含 .js/.css/.mp4 等按扩展名）压一行、失败永不折叠；每行带 [c#]/[n#] 条目号。动作没生效/页面静默失败先看它；level 默认 error；{only:"api"} 只看 XHR/Fetch、{only:"fail"} 只看失败；{meta:true} 顺手回结构化条目（seq/method/url/status，不用正则扒行）；翻页拿上一份的 latestSeq 当 afterSeq', availability: 'browser' },
      { name: 'browser.logDetail', signature: 'browser.logDetail(tabId, seq)', summary: '按条目号取**单条详情**（96、"n96" 都认）：console 给完整文本与调用栈；网络给短网址（urlPath）+ 全量 url、请求头（每值截断）、postData、截断的响应体——清单里看到可疑行再来细看', availability: 'browser' },
      { name: 'browser.fetch', signature: 'browser.fetch(tabId, 网址 | { reqId }, { method?, headers?, body?, offset?, maxBody? }?)', summary: '在页面上下文直发 HTTP，**继承该页签的登录态**（cookie 自动带上）：{ reqId } 是网络清单里的条目号——原样重放页面发过的请求（请求头全带上），覆盖项落在其上。**请求级失败不抛异常**：没拿到响应回 { status:0, failed:true, reason }，按值分支；4xx/5xx 是正常回执。长响应 { offset, maxBody } 分段读（nextOffset 续读）；{ toTmp:"key" } 把**全文**（上限 256k）落临时变量、只回 preview——代码里 tmp.get 出来解析，正文不进上下文。动态页面的快路：UI 摸清一次请求形态，同类动作在 execute 循环里直发（零推理成本）。**写操作（POST/PUT/DELETE）与批量直发是不可逆动作，先 ask**；循环要节流，宁慢勿封', availability: 'browser' },
      { name: 'browser.record', signature: 'browser.record(tabId, "start" | "stop")', summary: '日志录制区间：start 钉下水位 →（ask 用户做你做不了的操作：登录、验证码…）→ stop 回**这段区间**的折叠清单并清水位——专拿「用户操作产生」的日志来分析', availability: 'browser' },
      { name: 'browser.text', signature: 'browser.text(tabId, { ref } | 选择器, { maxChars? }?)', summary: '取**渲染后**的区域文本（innerText，默认 ≤4000 字）：SPA 上唯一的文本通道——webFetch 提取不出正文的页面靠它，不用截图；目标给 snapshot 清单的 { ref } 或 CSS 选择器', availability: 'browser' },
      { name: 'browser.scroll', signature: 'browser.scroll(tabId, { by: 像素 } | { to: "top"|"bottom"|选择器 } | { ref })', summary: '滚**页面**（无限滚动信息流的引擎）：滚完回 { scrollY, scrollHeight, atBottom }——atBottom 时等一拍再滚，新内容才加载；ui.scroll 滚的是文档区，别混用', availability: 'browser' },
      { name: 'browser.waitFor', signature: 'browser.waitFor(tabId, { selector? | text? | urlIncludes? | networkIdle? | load? }, { timeoutMs? }?)', summary: '**等条件成立**（默认 8s，250ms 轮询）——「wait 一下、再取一次、还是空」循环的替代品，省的就是这种轮次：等元素出现 {selector}、等正文含某字 {text}、等跳转 {urlIncludes}、等请求清零 {networkIdle:true}（SPA 数据回来）、等加载完 {load:true}。回 { matched, waitedMs, url }；超时回执带页面现状', availability: 'browser' },
    ],
  },
  {
    key: 'flow',
    label: '人机协作 · wait / ask / tiktok',
    intro: 'ask 会阻塞到用户提交；调用前先 tiktok 响一声。一次把要问的都放进一张表单。',
    items: [
      { name: 'wait', signature: 'wait(ms)', summary: '阻塞等待 0~120000 ms，给界面/用户留时间', availability: 'always' },
      {
        name: 'ask',
        signature: 'ask({ title?, questions: [...] })',
        summary:
          '结构化表单（阻塞到提交）：题型 single / multiple（自动附「其他」+补充输入）与 short；' +
          '题目给 when: { id, oneOf } 实现「前面选了什么影响后面问什么」；返回 answers，用户取消时 cancelled: true',
        availability: 'always',
      },
      { name: 'tiktok', signature: 'tiktok()', summary: '响一声系统提示音，提醒用户来看', availability: 'always' },
    ],
  },
  {
    key: 'ui',
    label: '界面操作 · ui',
    intro: '都需要界面在场；文档区没有打开的文档时 point / scroll / screenshot / dom 会明确失败。',
    items: [
      { name: 'ui.toast', signature: "ui.toast('一句话')", summary: '弹吐司提示', availability: 'ui' },
      { name: 'ui.point', signature: 'ui.point(path?, { line?, regex?, flags? })', summary: '在页签里打开/切到某节点的文档；可定位到一行或选中正则第一处匹配', availability: 'ui' },
      { name: 'ui.scroll', signature: "ui.scroll({ to?: 'top'|'bottom', by? })", summary: '滚动文档区（by 为像素，负数往上）', availability: 'ui' },
      { name: 'ui.screenshot', signature: 'ui.screenshot()', summary: '截取文档区存进资源库，图片附在你的下一步里', availability: 'ui' },
      { name: 'ui.superdoc', signature: 'ui.superdoc(path?, name)', summary: '打开/切到某节点的一份超级文档页签（sdoc.write 写完用它展示给用户）', availability: 'ui' },
      {
        name: 'ui.dom',
        signature: 'ui.dom(async (root) => { … })',
        summary:
          '回调拿到文档区根节点的门面：root.query(sel) / text(sel, i?) / attr(sel, name, i?) / html(sel, i?) / rect(sel, i?) / count(sel) / exists(sel) / click(sel, i?)',
        availability: 'ui',
      },
    ],
  },
  {
    key: 'subagent',
    label: '子代理 · subagent（导师专用）',
    intro:
      '把独立的活**并发地**派给子代理：它们各有自己独立的上下文，在后台同时跑各自的工作循环，' +
      '跑完各交一份交付消息——中间过程不占你的上下文。范式：create 登记 → run 启动（一次 run 多个即并发）' +
      '→ wait 收交付（首个完成即返回，必带最大时长）。**子代理自身拿不到这一组**（不递归）。',
    items: [
      { name: 'subagent.create', signature: 'subagent.create({ key, name?, system, tools? })', summary: '登记定义（只登记、不启动）；system 写清角色、工作方式与交付纪律；tools 是它 execute 开放的 api 组（不给就是 web + tmp）；同 key 再登记即覆盖（会话上下文保留）', availability: 'subagent' },
      { name: 'subagent.run', signature: 'subagent.run({ agent, task })', summary: '派任务并启动，**立即返回**（任务在后台跑）；agent 认 key（name 作别名，同名歧义要指名）；task 要自包含（子代理看不到你们的对话）；**一个 key 同一时刻只跑一个任务**，要并发建多个 key', availability: 'subagent' },
      { name: 'subagent.wait', signature: 'subagent.wait({ seconds })', summary: '等交付：有挂起的立即全部返回；否则监听所有在跑的，**首个完成即返回**（含仍在跑清单）；到 seconds 没人交付返回 timedOut；无人可等立即返回空', availability: 'subagent' },
      { name: 'subagent.view', signature: 'subagent.view(agent)', summary: '看状态与最近过程（recent 是最近几条消息）——超时后先 view 判断是否在钻牛角尖，再决定 intervene 还是再等一轮', availability: 'subagent' },
      { name: 'subagent.intervene', signature: 'subagent.intervene(agent, instruction)', summary: '给运行中的 agent 插入一条指令；等它当前这条消息输出完整后才插入，不打断半截输出', availability: 'subagent' },
      { name: 'subagent.interrupt', signature: 'subagent.interrupt(agent)', summary: '中断运行中的 agent（在下一个边界生效；上下文保留，可 resume）', availability: 'subagent' },
      { name: 'subagent.resume', signature: 'subagent.resume(agent)', summary: '把被中断的 agent 从断点接着跑（上下文保留，不加新指令）', availability: 'subagent' },
      { name: 'subagent.delete', signature: 'subagent.delete(agent)', summary: '删定义与会话（含挂起的交付；在跑的先中断）', availability: 'subagent' },
    ],
  },
  {
    key: 'files',
    label: '真实文件系统 · files',
    intro:
      '直接读写操作系统真实路径下的文件与目录，支持各种文件类型（文本或 base64 二进制）。' +
      '权限受限保护：仅对当前目标目录及在设置中放行的目录拥有完全权限，其余路径将被安全拦截。',
    items: [
      { name: 'files.read', signature: 'files.read(path, { encoding?, maxBytes? }?)', summary: '读取真实路径的文件，允许读各种类型', availability: 'always' },
      { name: 'files.write', signature: 'files.write(path, content, { encoding?, overwrite? }?)', summary: '写入某个真实路径文件，没有就创建，允许写各种类型', availability: 'always' },
      { name: 'files.edit', signature: 'files.edit(path, { replace?, content?, start?, end? })', summary: '修改已存在的文件，支持字符串替换与区间更新', availability: 'always' },
      { name: 'files.list', signature: 'files.list(path?)', summary: '列出某个路径下所有文件的名称与属性', availability: 'always' },
      { name: 'files.stat', signature: 'files.stat(path)', summary: '查看某个文件的详细信息（大小、修改时间、文件类型等）', availability: 'always' },
      { name: 'files.mkdir', signature: 'files.mkdir(path)', summary: '创建目录（默认递归建起父级）', availability: 'always' },
      { name: 'files.copy', signature: 'files.copy(from, to, { overwrite? }?)', summary: '复制文件或目录', availability: 'always' },
      { name: 'files.move', signature: 'files.move(from, to)', summary: '移动或重命名文件或目录', availability: 'always' },
      { name: 'files.delete', signature: 'files.delete(path)', summary: '删除文件或目录', availability: 'always' },
    ],
  },
  {
    key: 'process',
    label: '系统进程任务 · process',
    intro:
      '创建与管理原生进程任务，支持增量捕获标准输出和标准错误。' +
      '生命周期绑定：进程任务与宿主应用进程强绑定，应用退出或中断终止时所有进程均被自动清理。',
    items: [
      { name: 'process.create', signature: 'process.create({ command, args?, cwd?, env? })', summary: '创建进程任务，定义执行程序、参数、工作目录和环境变量；默认不执行', availability: 'always' },
      { name: 'process.start', signature: 'process.start(process_id)', summary: '启动已创建的任务，返回 process_id 与 pid', availability: 'always' },
      { name: 'process.status', signature: 'process.status(process_id)', summary: '查询进程是否正在运行、是否已退出，以及退出码', availability: 'always' },
      { name: 'process.output', signature: 'process.output(process_id, { offset?, reset? }?)', summary: '读取标准输出和标准错误，支持增量读取', availability: 'always' },
      { name: 'process.stop', signature: 'process.stop(process_id, { timeoutMs?, force? }?)', summary: '请求终止进程，并定义超时后的强制终止策略', availability: 'always' },
      { name: 'process.list', signature: 'process.list()', summary: '列出当前 Agent 有权访问的进程任务清单', availability: 'always' },
      { name: 'process.get', signature: 'process.get(process_id)', summary: '根据 process_id 获取进程详情', availability: 'always' },
      { name: 'process.delete', signature: 'process.delete(process_id)', summary: '销毁并删除已结束或运行中的进程记录（若在运行则强制杀死）', availability: 'always' },
    ],
  },
  {
    key: 'help',
    label: '帮助与自描述 · help',
    intro: '查询当前沙箱开放的能力组与 API 签名清单。',
    items: [
      { name: 'help', signature: 'help()', summary: '返回当前沙箱 16 组核心能力清单、分组描述与各组常用方法', availability: 'always' },
    ],
  },
]
