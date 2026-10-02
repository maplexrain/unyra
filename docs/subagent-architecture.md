# 子代理（Sub-Agent）

> 超级导师可以派出「子代理」：它们各有**自己独立的上下文**，替导师干活，
> 干完只把**一份交付消息**交回导师。本文写的是它怎么跑、边界画在哪、为什么这样画。
> 运行时与工具见 `src/agent/subagent/`，面板里的会话视图见 `components/agent/`。

## 一段话总览

子代理的管理是 **execute 沙箱里的一组 api**（`subagent.*`，导师专用；不再有独立的导师工具），
工作范式是**脚本创建 → 脚本执行 → 脚本等待**：一次 execute 里
`subagent.create` 登记定义 → `subagent.run` 启动任务（**立即返回**，任务在后台跑）→
`subagent.wait` 收交付。一次 run 多个 agent，它们**真正并发**。

**没有内置子代理**：要用只能先定义。定义与会话都住在 `Conversation.subagents` 上、随
chat.json 落盘，生命周期只有**这一段导师对话**：不能跨对话复用，本对话内可反复派活
（同 key 的会话续着用）；切换对话各看各的，删除对话一起消失；重启之后会话照旧能翻开
（正在跑的那场复位为「被中断」，孤儿会话——定义不在了的——直接剪掉）。

## 决定与理由

| 决定 | 理由 |
| --- | --- |
| **没有内置**：预置代理（web-search）已删除，要用子代理只能先 create 定义 | 预置的提示词与 api 面脱离导师的任务语境；这一单要什么角色、守什么纪律，导师最清楚 |
| **创建与运行分开**：create 只登记定义，run 才派任务启动 | 「登记即启动」会把定义和派活绑死；先建好一支队伍、再按需分派，脚本才写得自然 |
| **并发运行**：run 把 agent loop 放到后台、api 立即返回；同轮多个 run 即并发 | 检索、通读、核实这类活天然并行；旧的「按序执行」让导师串行等每一单，慢且贵（2026-10-02 用户要求，推翻旧「并发从简」的决定） |
| **只交付最终消息**：子代理中间的思考、工具编排不进导师上下文，交付是 wait 回执里的一段正文 | 中间过程对导师是噪音；交付必须自包含、详细，这一点写死在定义的 system 里 |
| **wait 是唯一的收口**：有挂起交付→立即全收；有在跑的→监听全部、**首个完成即返回**（附仍在跑清单）；到最大时长没交付→返回 timedOut；无人可等→立即返回空 | 「父等子」从「每派一单阻塞一次」变成「只在等待时阻塞，且等到的是最先完成的那个」；最大时长由导师按任务难度主观给，是监督回路的触发器 |
| **挂起队列**：交付时没人在听就挂起，绝不丢、也不堵 agent；下一次 wait 把积压的一起返回 | 交付与收集天然解耦：execute 结束时仍有 agent 在跑是正常的，交付等下一次 wait 领 |
| **监督回路（防钻牛角尖）**：wait 超时 → view 看它最近的过程 → 确实在打转就 intervene 纠偏，走得正常就再等一轮 | 子代理的 agent loop 没有轮次上限，防深挖不能靠掐轮次，只能靠导师的时限与介入 |
| **介入不打断半截输出**：intervene 的指令排队，等「当前这条消息已完整」的边界（工具结果之后 / 无工具调用的消息完结之后）才作为 user 消息插入 | 把一条流式输出从中间截断会破坏消息完整性，协议也不允许；边界插入同时是 toChatHistory 镜像的推进点——半场落库与指令入账都钉在同一个点上，前缀缓存才不破 |
| **生命周期 = 导师对话**：桶住在 `Conversation.subagents` 上、随 chat.json 落盘 | 需求即如此；载入时防御归一化（形状不对整桶丢弃，残留「运行中」复位「被中断」，孤儿会话剪掉），空桶不写字段 |
| **不递归**：SUBAGENT_ALLOWED_GROUPS 里永远没有 subagent 组，子代理的 apiAllow 到不了它 | 子代理派子代理只会把责任链与 token 都炸开；编排是导师的事。装配层（subsetSandbox 不透传）与通道口（apiAllow 硬校验）双保险 |
| **模型与档位继承导师**：子代理用启动那一刻的导师轮配置跑完（换轮不漂移） | 单独配模型是设置面的问题，等真有需求再加 |
| **中断级联**：用户点「停止」，当前对话所有在跑的子代理当场中断；中断在下一个边界生效 | 导师不该在子代理死后假装它交了货；各场的「已中断」回执进挂起队列，下一次 wait 领走 |
| **前缀缓存逐字节纪律照旧**：子代理的历史由 `toChatHistory` 从它自己的消息里还原，前缀门禁按 `sub:{sessionId}` 分键记账；重定义提示词时显式 reset | 子代理与导师共用同一套镜像纪律（`agent/history`），不另造第二套 |

## 数据模型

```
SubAgentDef     一个子代理的定义：key / name / system（系统提示词）/ apiGroups（execute 开放哪些组）
SubAgentSession 一次生命的实例：defKey / 消息（ConversationMessage[]）/ status / runs / 交付记录
SubAgentBucket  一段对话的桶：{ defs, sessions }——住在 Conversation.subagents 上，随 chat.json 落盘
```

会话的消息就是**普通的 `ConversationMessage[]`**（任务与介入指令是 user 消息，
每段过程与交付是 assistant 回复，工具卡片、思考、通知都在 parts 里）。三样东西共用一个来源：

- **界面**：子会话视图直接渲染这份消息（与导师视图同一套 MessageList）；
- **模型上下文**：`toChatHistory` 还原——与导师完全同一条镜像纪律；
- **交付提取**：wait 回执里的交付 = 最后一段（无工具调用的那跳）的正文。

管理器（`subagent/manager.ts`）自己只留**内存态**：在跑的句柄（abort 控制器 + 介入队列）、
挂起交付队列、等待者。落库的都在桶里，进程被杀只丢挂起交付与等待者。

## 一次任务的时序

```
导师 loop（runAgent）
  └─ assistant.tool_calls: execute("派两个检索任务")
       └─ 沙箱 body（一次编排里写完整条链）：
            api.subagent.create({ key:'s1', system:'…', tools:['web','tmp'] })
            api.subagent.create({ key:'s2', system:'…' })
            api.subagent.run({ agent:'s1', task:'…' })   // 立即返回，s1 在后台跑
            api.subagent.run({ agent:'s2', task:'…' })   // s1 与 s2 并发
            const r = await api.subagent.wait({ seconds: 30 })
            // r = { deliveries:[{ agent, name, delivery }], running:[…] }
            return r
  └─ 导师拿到回执：有交付就消化，只有 running 就继续自己的事，之后再 wait
```

- **正常完成**：交付 = 子代理最后一条无工具调用的回复正文（被长度截断时标记「不完整」）。
- **等待超时**：`timedOut: true` + 仍在跑清单——导师 view 查看、intervene 纠偏或再等一轮。
- **中断**：`status: 'interrupted'`、无交付、上下文保留，resume 可从断点接着跑。
- **执行失败**：错误原文在 `issue` 里回给导师。

## execute 的按需 api 面

子代理只有 `execute` 一个工具，但 **api 按需开放**，两个旋钮都在 `SandboxOptions` 上：

- `apiAllow?: string[]` —— 组白名单（如 `['web','tmp']`）。`createExecuteTool` 的 callApi
  通道口逐次核对：名单外的组当场回「沙箱里没有这个 api（本次只开放了 …）」。不设就是全量（导师）。
- `apiBrief?: string` —— execute 参数说明里的 api 清单换成按需版（清单从 `apiCatalog.ts`
  按组生成，不另写一份）。

有几个组**永远不会**给子代理，白名单校验直接拒：`ask`（没有宿主表单通道，会永远阻塞）、
`ui`（界面操作是导师与用户之间的事）、`exam` / `checkin` / `review` / `pomodoro`（学习状态的
判断是导师的职责）、`userInfo`（画像）、`compact`、`wf`、`subagent`（不递归）。
子代理可以选的白名单（`agent/subagent/groups.ts`）：

`web`（检索 / 读网页）· `tmp`（大中间结果）· `res`（资源库）· `doc`（文档读写）·
`node`（节点读写）· `outline` · `mind`（长期记忆）· `workspace`（工作区文件）·
`reading` / `attention`（学习事实，只读）。

## 网络检索类子代理（常用模板）

没有内置检索代理：导师 create 一个 `tools:["web","tmp"]` 的检索代理，system 里把止损纪律
写死——摘要先筛、有明确网址直接读、同一页面/引擎/措辞绝不重试第二次、连续两步没有新信息
就收手交付、结论先行、关键事实带来源 URL、体量跟任务匹配。这段模板写在
`learn/ai/guides.ts` 的 `SUBAGENT_GUIDE` 与 executeGuide 里，导师照着它写定义即可。

### web.search api（`learn/webSearch.ts` + `lib/web/serp.ts`）

```
web.search(query, { engines? | engine?, lang?, count? }) →
  { ok, engines, query, results: [{ rank, title, url, snippet, engine }], failed?, note }
```

- **抓取完全复用现有链路**：`native().web.fetch`（主进程 `electron/web.ts`）——只读 GET、
  4MB / 20 秒上限、本机与内网一律拒绝，一条新口子都不开。主进程带完整浏览器指纹
  （Chrome 的 sec-ch-ua / sec-fetch-* 组合），**403/429 自动换 Firefox 指纹再试一次**
  （共享同一个 20 秒窗口）——站点认「不是浏览器」的请求是抓取 403 的主要来源；
- **解析在渲染层**（`lib/web/serp.ts`，DOMParser）：bing 的跳转链在解析时解回真实地址；
- **engines 并行**：一次调用同时搜 ≤3 家（Promise.all），解析不出的在 `failed` 里说明；
- 引擎与地址（`serpUrl`，纯函数）：

| engine | 地址 | 说明 |
| --- | --- | --- |
| `baidu` | `www.baidu.com/s?wd=…` | 中文首选；链接是百度跳转链，读原文照常 webFetch |
| `bing` | `www.bing.com/search?q=…` | HTML 最稳定；跳转链解码后给真实地址 |
| `google` | `www.google.com/search?q=…&gbv=1` | 免 JS 的基础版；给出需要浏览器的页面时报错并建议换引擎 |
| `yandex` | `yandex.com/search/?text=…` | 常见验证码拦截，失败回执说明 |
| `wikipedia` | `{lang}.wikipedia.org/w/api.php?action=query&list=search` | 官方 API（JSON），lang 缺省 zh；部分网络不可达 |

缺省引擎是 **baidu**，检索类模板首选 `["baidu","bing"]` 并行。结果不落盘——一条摘要几百字，
直接进观察就够了，与 webFetch「长文落盘」是两种体量。

## 面板 UI

- **入口按钮**：输入卡右下工具条、模型选择器的**左侧**。当前对话存在子代理会话时才出现：
  机器人图标 + 数量角标（有在跑的会变成主题色）；点击在输入框**上方**弹出会话列表
  （与「+」菜单同一套绝对定位观感）。列表项：名字、状态（运行中 / 空闲 / 上次中断）、
  任务次数、最近交付预览；点击切进该会话。**并发时多场同时标「任务进行中」**。
- **子会话视图**：整个 agent 栏换到这个会话——顶栏是**左上角返回按钮** + 机器人图标 + 名字 +
  状态；消息列表与导师视图同一套（任务气泡 + 回复气泡 + 工具卡片 + 实时流式）。
  并发模型下过程是边跑边落库的（介入插入前固化一段、收口再固化一段），会话消息与实时流式
  天然不重不漏。**输入框禁用**：子会话只接受导师的调度，用户在这里没有输入口；
  「停止」保留（停的是整轮，级联中断所有在跑的子代理）。

## 安全与边界

- 抓网页只有 `web:fetch` 一条既有通道：只读 GET、不碰内网、有上限——`web.search` 没有开任何新口子；
- 子代理跑在渲染层自己的 Worker 沙箱里，与导师的 execute 同一个执行器（`sandbox/worker.ts`），
  超时、心跳、api 记账全部继承（沙箱超时按「空闲时长」算，wait 挂着就持续心跳，不会被掐）；
- api 白名单是通道口硬校验（不是提示词君子协定）：名单外的调用当场被拒，回执里写明开放了哪些组；
  **subagent 组在子代理的名单里永远不存在**（不递归）；
- 子代理的执行不写导师对话、不碰考试 / 打卡 / 复习 / 画像；`doc` / `node` 组可以开放给子代理
  （导师明确要求时才能写学习数据）——开放与否完全由导师在 create 的 tools 里决定，边界由通道口兜底；
- 并发的多场任务各自经 setBucket 函数式更新写回桶（无共享可变快照）；worker 沙箱一次编排一个，
  天然隔离。

## 测试与对账

- `tests/subagent.test.ts`：假流驱动完整链路——create 校验 → run 后台启动 → **并发与首个完成** →
  **挂起队列** → **wait 超时** → view → **介入（工具边界与收口边界两条路）** → 中断与 resume →
  删除 → 会话复用逐字节前缀 → apiAllow 通道口（含 subagent 组进不来）→ normalize 剪孤儿会话；
- `tests/webSerp.test.ts`：`serpUrl` 与五个引擎的 SERP 解析（happy-dom 环境）；
- agent 探针（`scripts/agent-ops/`）：subagent 八个 api 进名单对账（api.ts ↔ sandboxWorker 的
  API_NAMES ↔ executeGuide ↔ apiCatalog 四处一致），每条都有「真的存在」的用例；
- `docs/sandbox-api.md` 的 web 行同步更新。

## 相关路径

| 位置 | 是什么 |
| --- | --- |
| `src/agent/subagent/groups.ts` | 子代理可选的 api 组白名单与按组生成的 api 清单 |
| `src/agent/subagent/registry.ts` | 会话簿记的纯函数（建 / 追加 / 半场落库 / 收口 / 重置 / 载入归一化） |
| `src/agent/subagent/runner.ts` | 一次任务的执行：还原历史 → runAgent（带介入通道）→ 提取交付与 token 账 |
| `src/agent/subagent/manager.ts` | 宿主管理器：并发驱动、挂起队列、等待者、subagent 八件 api |
| `src/learn/webSearch.ts` · `src/lib/web/serp.ts` | web.search 的宿主实现与 SERP 解析 |
| `src/learn/useAgent.ts` | 管理器生命周期（按对话、跨轮）、实时多槽、停止级联 |
| `src/components/agent/panel/SubAgentMenu.tsx` | 入口按钮 + 会话列表弹出层 |
