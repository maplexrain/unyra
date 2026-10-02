# 子代理（Sub-Agent）

> 超级导师可以派出「子代理」：它们各有**自己独立的上下文**，在导师的对话里干活，
> 干完只把**一份交付消息**交回导师。本文写的是它怎么跑、边界画在哪、为什么这样画。
> 运行时与工具见 `src/agent/subagent/`，面板里的会话视图见 `components/agent/`。

## 一段话总览

导师（超级导师）每一轮都有三件子代理工具：`agent_spawn`（定义一个子代理并**立刻启动**——
定义完成的同时它就开始跑第一单任务）、`agent_run`（给**当前对话里已定义**的子代理派后续的活，
阻塞等它做完）、`agent_list`（看本对话有哪些会话）。

**没有内置子代理**：要用只能先定义，而定义完成即启动，不存在「登记了但不跑」的半状态。
定义与会话都住在 `Conversation.subagents` 上、随 chat.json 落盘，生命周期只有**这一段导师对话**：
不能跨对话复用，本对话内可反复派活（同 key 的会话续着用）；切换对话各看各的，删除对话一起消失；
重启之后会话照旧能翻开（正在跑的那场复位为「被中断」，孤儿会话——定义不在了的——直接剪掉）。

## 决定与理由

| 决定 | 理由 |
| --- | --- |
| **没有内置**：web-search 一类的预置代理已删除，要用子代理只能先 `agent_spawn` 定义 | 预置的提示词与 api 面脱离导师的任务语境；这一单要什么角色、守什么纪律，导师最清楚，定义权全部交给它 |
| **定义即启动**：`agent_spawn` 的参数里就带第一单 `task`，定义完成立即开跑 | 「定义了但没跑」是半状态，只会诱导导师登记一堆永远不用的定义 |
| **只交付最终消息**：子代理中间的思考、工具编排一概不进导师上下文，只有最后一条回复作为工具结果回填 | 中间过程对导师是噪音；交付消息必须自包含、详细，这一点写死在定义的 system 里 |
| **会话按 key 复用（仅本对话）**：`agent_run` 用 `agent`（key）寻址；会话已存在就在它的上下文里继续，`fresh: true` 才清空重来 | 子代理会话不是一次性消耗品——「换个问题接着查」不该丢掉上一轮已经读到的网页；但跨对话复用会让旧上下文污染新任务，生命周期钉死在导师对话上 |
| **生命周期 = 导师对话**：子代理桶住在 `Conversation.subagents` 上、随 chat.json 落盘 | 需求即如此；落盘走既有链路（chat.json 整份序列化），载入时防御归一化（形状不对整桶丢弃，残留的「运行中」复位为「被中断」，孤儿会话剪掉），空桶不写字段 |
| **并发从简**：同轮多个 spawn / run 按序执行，导师在**全部完成后**才继续 | 「父等子」是硬要求，按序天然满足；真并行要把工具执行层改成并发的（execute 会并发写同一份 store），收益配不上风险 |
| **不递归**：子代理的 api 面里永远没有 agent_* 三件工具 | 子代理派子代理只会把责任链与 token 都炸开；编排是导师的事 |
| **模型与档位继承导师**：子代理跑在导师当前这一轮的提供商 / 模型 / 思考等级上 | 单独配模型是设置面的问题，等真有需求再加 |
| **中断级联**：用户点「停止」，正在跑的子代理当场中止，导师收到「已中断、无交付」的回执 | 导师不该在子代理死后假装它交了货；已产出的过程保留在子会话里可以翻看 |
| **前缀缓存逐字节纪律照旧**：子代理的历史由 `toChatHistory` 从它自己的消息里还原，前缀门禁按 `sub:{sessionId}` 分键记账；`fresh` 或重定义提示词时显式 reset | 子代理与导师共用同一套镜像纪律（`agent/history`），不另造第二套 |

## 数据模型（`src/agent/types.ts`）

```
SubAgentDef     一个子代理的定义：key / name / system（系统提示词）/ apiGroups（execute 开放哪些组）
SubAgentSession 一次生命的实例：defKey / 消息（ConversationMessage[]）/ status / runs / 交付记录
SubAgentBucket  一段对话的桶：{ defs, sessions }——住在 Conversation.subagents 上，随 chat.json 落盘
```

会话的消息就是**普通的 `ConversationMessage[]`**（导师的任务是一条 user 消息，每次任务是一条
assistant 回复，工具卡片、思考、通知都在 parts 里）。这样三样东西共用一个来源：

- **界面**：子会话视图直接渲染这份消息（与导师视图同一套 MessageList）；
- **模型上下文**：`toChatHistory` 还原——与导师完全同一条镜像纪律；
- **交付提取**：跑完后取最后一段（无工具调用的那跳）的正文。

## 一次任务的时序

```
导师 loop（runAgent）
  └─ assistant.tool_calls: agent_spawn({ key:'searcher', system:'…', tools:['web','tmp'], task:'…' })
       └─ 工具执行（useAgent 装配的 agent 工具）：
            1. 校验（key 形状 / system 长度 / api 组白名单 / task 非空），定义落进桶
            2. 按 key 找会话；没有则新建（同 key 重定义则保留原会话）
            3. 会话消息追加任务（user），toChatHistory 还原成它的历史
            4. runAgent({ system: 定义.system, tools: [execute(按需 api)] })
               —— 事件实时转发给面板（子会话视图里看得到流式输出）
            5. 结束后提取交付：最后一段正文；被中断/出错则无交付
            6. 回复消息（含 token 账）落进会话，交付文本作为工具结果回给导师
  └─ 导师拿到交付，继续自己的 loop（这就是「父等子」）
```

- **正常完成**：交付 = 子代理最后一条无工具调用的回复（被长度截断时取流式里已经吐出的正文，
  并标记「不完整」，让导师自己决定是否让它接着写）。
- **中断**（导师轮被停止，级联 abort 到子代理）：回执明说「已中断、无交付、上下文还在」，
  导师可以再次 `agent_run` 同一个 key 接着做，或 `fresh: true` 重来。
- **执行失败**（网络、模型侧错误）：同上，错误原文回给导师。

## execute 的按需 api 面

子代理只有 `execute` 一个工具，但**api 按需开放**，两个旋钮都在 `SandboxOptions` 上：

- `apiAllow?: string[]` —— 组白名单（如 `['web','tmp']`）。`createExecuteTool` 的 callApi
  通道口逐次核对：名单外的组当场回「沙箱里没有这个 api（本次只开放了 …）」。不设就是全量（导师）。
- `apiBrief?: string` —— execute 参数说明里的 api 清单换成按需版。子代理看到的工具描述
  只写它真有的 api（清单从 `apiCatalog.ts` 的目录按组生成，不另写一份）。

有几个组**永远不会**给子代理，白名单校验直接拒：`ask`（没有宿主表单通道，会永远阻塞）、
`ui`（界面操作是导师与用户之间的事）、`exam` / `checkin` / `review` / `pomodoro`（学习状态的
判断是导师的职责）、`userInfo`（画像）、`compact`、`wf`、`agent`（不递归）。
子代理可以选的白名单（`agent/subagent/groups.ts`）：

`web`（检索 / 读网页）· `tmp`（大中间结果）· `res`（资源库）· `doc`（文档读写）·
`node`（节点读写）· `outline` · `mind`（长期记忆）· `workspace`（工作区文件）·
`reading` / `attention`（学习事实，只读）。

## 网络检索类子代理（常用模板）

没有内置检索代理了：导师 spawn 一个 `tools:["web","tmp"]` 的检索代理，system 里把止损纪律
写死——摘要先筛、有明确网址直接读、同一页面/引擎/措辞绝不重试第二次、连续两步没有新信息
就收手交付、结论先行、关键事实带来源 URL、体量跟任务匹配。这段模板写在
`learn/ai/guides.ts` 的 `SUBAGENT_GUIDE` 里，导师照着它写定义即可。

### web.search api（`learn/webSearch.ts` + `lib/web/serp.ts`）

```
web.search(query, { engines? | engine?, lang?, count? }) →
  { ok, engines, query, results: [{ rank, title, url, snippet, engine }], failed?, note }
```

- **抓取完全复用现有链路**：`native().web.fetch`（主进程 `electron/web.ts`）——只读 GET、
  4MB / 20 秒上限、本机与内网一律拒绝，一条新口子都不开。主进程带完整浏览器指纹
  （Chrome 的 sec-ch-ua / sec-fetch-* 组合），**403/429 自动换 Firefox 指纹再试一次**
  （共享同一个 20 秒窗口）——站点认「不是浏览器」的请求是抓取 403 的主要来源；
- **解析在渲染层**（`lib/web/serp.ts`，DOMParser）：与 webDocs「字节主进程取、正文渲染层提」
  同一条分工；bing 的跳转链（/ck/a?…&u=a1<base64url>）在解析时就解回真实地址——
  读原文不再经过对无 cookie 抓取动辄 403 的 bing 跳转器；
- **engines 并行**：一次调用同时搜 ≤3 家（Promise.all），结果按引擎标注，解析不出的
  在 `failed` 里逐个说明——省掉一轮轮的往返，也让「别在一家上恋战」有据可依；
- 引擎与地址（`serpUrl`，纯函数）：

| engine | 地址 | 说明 |
| --- | --- | --- |
| `baidu` | `www.baidu.com/s?wd=…` | 中文首选；链接是百度跳转链，读原文照常 webFetch |
| `bing` | `www.bing.com/search?q=…` | HTML 最稳定；跳转链解码后给真实地址 |
| `google` | `www.google.com/search?q=…&gbv=1` | 免 JS 的基础版；给出需要浏览器的页面时报错并建议换引擎 |
| `yandex` | `yandex.com/search/?text=…` | 常见验证码拦截，失败回执说明 |
| `wikipedia` | `{lang}.wikipedia.org/w/api.php?action=query&list=search` | 官方 API（JSON），lang 缺省 zh；部分网络不可达 |

缺省引擎是 **baidu**，检索类子代理的模板让它首选 `["baidu","bing"]` 并行——
google / yandex / wikipedia 在不少网络里不可达，回执的 failed 会说明，跳过别再试。
结果不落盘——一条摘要几百字，直接进观察就够了，与 webFetch「长文落盘」是两种体量。

## 面板 UI

- **入口按钮**：输入卡右下工具条、模型选择器的**左侧**。当前对话存在子代理会话时才出现：
  机器人图标 + 数量角标；点击在输入框**上方**弹出会话列表（与「+」菜单同一套绝对定位观感）。
  列表项：名字、状态点（运行中 / 空闲 / 上次中断）、任务次数；点击切进该会话。
  （内置/自定义的标记没有了——所有定义都来自本对话的 agent_spawn。）
- **子会话视图**：整个 agent 栏换到这个会话——顶栏是**左上角返回按钮** + 机器人图标 + 名字 +
  状态；消息列表与导师视图同一套（任务气泡 + 回复气泡 + 工具卡片 + 实时流式）。
  **输入框禁用**：子会话只接受导师的调度，用户在这里没有输入口；「停止」保留（停的是整轮，
  级联到子代理）。列表里跑着的那场任务有状态标记，切进去就能看到实时输出。

## 安全与边界

- 抓网页只有 `web:fetch` 一条既有通道：只读 GET、不碰内网、有上限——`web.search` 没有开任何新口子；
- 子代理跑在渲染层自己的 Worker 沙箱里，与导师的 execute 同一个执行器（`sandbox/worker.ts`），
  超时、心跳、api 记账全部继承；
- api 白名单是通道口硬校验（不是提示词君子协定）：名单外的调用当场被拒，回执里写明开放了哪些组；
- 子代理的执行不写导师对话、不碰考试 / 打卡 / 复习 / 画像；`doc` / `node` 组可以开放给子代理
  （导师明确要求时才能写学习数据）——开放与否完全由导师在 spawn 的 tools 里决定，边界由通道口硬校验兜底。

## 测试与对账

- `tests/subagent.test.ts`：假流驱动完整链路——spawn 定义即启动 → 交付回填 → 同会话复用
  （上下文累积、逐字节前缀）→ fresh 重置 → 中断无交付 → 未定义 key 报错指回 spawn →
  校验失败不落任何东西 → normalize 剪孤儿会话；断言子代理的历史还原逐字节镜像
  （前缀门禁按 `sub:` 分键）；
- `tests/webSerp.test.ts`：`serpUrl` 与五个引擎的 SERP 解析（happy-dom 环境，真实抓取页面的结构样本）；
- agent 探针（`scripts/agent-ops/`）：`web.search` 的 api 面钉进对账（api.ts ↔ sandboxWorker 的
  API_NAMES ↔ executeGuide ↔ apiCatalog 四处一致），并加一条「apiAllow 通道口硬校验」的用例；
- `docs/sandbox-api.md` 的 web 行同步更新。

## 相关路径

| 位置 | 是什么 |
| --- | --- |
| `src/agent/subagent/groups.ts` | 子代理可选的 api 组白名单与按组生成的 api 清单 |
| `src/agent/subagent/registry.ts` | 会话簿记的纯函数（建 / 追加任务 / 落回复 / 重置 / 载入归一化） |
| `src/agent/subagent/runner.ts` | 一次任务的执行：还原历史 → runAgent → 提取交付与 token 账 |
| `src/agent/subagent/tools.ts` | 导师侧的 agent_spawn / agent_run / agent_list 三件工具 |
| `src/learn/webSearch.ts` · `src/lib/web/serp.ts` | web.search 的宿主实现与 SERP 解析 |
| `src/learn/useAgent.ts` | 子代理状态桶（按会话）、工具装配、实时事件转发、停止级联 |
| `src/components/agent/panel/SubAgentMenu.tsx` | 入口按钮 + 会话列表弹出层 |
