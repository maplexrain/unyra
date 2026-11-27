# role-work 架构

> 每个 agent 都是一位 **role**；role 不亲手做所有事，它把任务拆给一个或多个 **work**，
> work 在自己的独立上下文里执行，干完通过 `host.send` 交回 role，role 再决定怎么对外说。
> 旧 subagent / agent-team 委托架构已经删除，本文是当前唯一入口。

## 一段话总览

role 是有人格、对用户或其它 role 说话的那一层；work 没有人格，只拿任务、执行、交付。
role 通过 execute 沙箱里的 `work.*` 管理 work，通过 `chat.send` 走 user / agent / work 三个通道。
扇入 role 的消息只有一个来源：**通道流水**（`Conversation.channels`，上限 200 条）；
扇出 work 的独立上下文住在 `Conversation.works.sessions`，随 chat.json 落盘。

```
用户 ──user 通道──▶ role（人格 / 分诊 / 验收）
其它 role ──agent 通道──▶ role
role ──work.send──▶ work N（独立上下文，无人格）
work ──host.send──▶ 回到所属 role 的 Work 通道
```

## 团队 role 与名册

role 的身份由各自的提示词定义，不在任何提示词里枚举全局名册。需要协作时先
`api.agent.list()` 取当前已注册 agent 的 id / 名称 / 简介，按简介选人；新增、替换或
外部注册 agent 都不需要改提示词。`free` 只保留为无目标时的 legacy 自由对话运行态。

## role 层：沟通、调度与固定联网

- **一个 agent 的 role 层始终只有一段会话**（同一目标下复用最新的 `Conversation.voice`，
  没有才落 `cv:<role>:<goal>`）；work 才是一任务一段、可多开。
- role 的 API 是固定面：`tmp / web / work / chat / agent / delivery` + 顶层 `see / ask / fetch / compact`
  （`help` 恒在）。**web 是全员固定联网面**，每位 role 都能直接 `api.web.search` / `api.fetch`；
  其余领域组（node / exam / browser / classroom / schedule / workspace…）一律不下发。
- role 的系统提示词只写「我是谁、我负责什么分工、怎么派 work、怎么对外说」；
  排版配方、围栏语法、领域工作流、交付登记这些「怎么做」全部在 work 提示词里。
- role 的 loop 不阻塞：派完 work 立即用 `chat.send(user)` 回一句回执并结束本轮；
  **没有 `wait`**，也不轮询 `work.status`。需要用户明确回答（方向 / 范围 / 难度 / 产物形态）
  时，role 不自己在 chat 正文发问等回话，而是委派 work 用 `api.ask` 发结构化表单。

## role API 契约

```
api.work.list()
api.work.status(name)      // 只在用户明确问进度时看一眼，不轮询
api.work.stop(name)        // 中止但保留上下文，可续跑
api.work.create({ name? })
api.work.kill(name)        // 中止并删除
api.work.send({ name, text?, messageId? })
api.chat.send({ channel, to?, text, messageId?, attachments? })
api.agent.list()           // 只读：当前已注册 agent 的 id / 名称 / 简介
api.delivery.submit({ files, sources })
api.web.fetch(url | { url })
api.web.search({ query, count?, need_content? } | query, opts?)
api.fetch(url | { url } | urls[], { maxChars? })
api.see(url | moji:static 引用 | 本地路径 | { pdf, page })
api.ask({ title?, questions })  // 结构化表单；阻塞到用户作答
api.compact({ summary, tasks? })
```

- `chat.send` 的 channel 只有 `user / agent / work`；`agent` 的 `to` 是 role id，`work` 的 `to` 是 work 名，`user` 省略 `to`。
- 附件最多 4 个；支持 `moji:static/…`、工作区路径与 http(s) 图片。
- `chat.send` 的 `text` 是唯一对外正文。交付物完成通知可用单独一行 `---` 分隔简短 / 详细：前面一句话口语化完成通知，后面放具体改动、索引名 / 标识符、专业术语与核验过程；聊天界面默认只显示短句，用户可切换查看详细。普通问答、寒暄、进度同步不要用该分隔。
- 正文里单独一行 `[标题](work: work 名)` 会渲染成内嵌 work 状态块（两行、无边框）：标题 / work 名 / 状态 / 耗时 + 当前最后一步；思考、execute 标题、正文都会进入第二行，后一步覆盖前一步。每个运行中 work 一行；没有新结论也要发短回执带状态行，不能长时间静默。`work.send` 不负责消息级状态绑定。
- 名字 1–32 字、role 内唯一，缺省 `work-N`；`/ \ : * ? " < > |` 不许出现。
- `agent.list` 返回当前所有已注册 agent（内置、自由对话与外部），内置在前；只读，不能改名或增删。

## work 的边界

- work **没有人格**；系统提示词由 `buildWorkSystem(role)` 生成，创建时固化，不随 role 改动。
  按两段拼：执行基座（work 基础纪律 + 固定 API）→ 能力规程（本 role 的职责说明、排版配方、
  动态 API、围栏语法、工作流规程与领域纪律）。
- work 固定持有 `tmp / delivery / host` 组 + 该 role 的领域组（去掉 `work/chat/permission/ui`）；
  顶层固定 `wait / ask / see / compact`。`ask` 借用所属 role 的身份出现在对应通道的 ask 气泡，
  work 自己不直接发聊天消息。
- 一个 work 只对接创建它的 role；上下文、消息、execTrace、交付记录都在自己的账本里。
- `work.status` 只回状态、轮次、耗时与最近 execute 标题，不回正文与参数。
- work 结束若没显式 `host.send`，管理器把最后一段正文自动回传（标记 `auto`）。

## 通道与 UI

- `Conversation.channels` 记录所有对外收发；每条带 `channel / from / to / ts / envelopeId / direction`。
- 用户消息入站写一条 user 通道；`chat.send` 出去的 user 消息写 outbound。
- role 面板分两层：
  - **对话（chat）**：只画 user / agent 通道，不画工具、思考、Work 通道；
  - **思维（mind）**：画完整消息、工具、思考与 Work 交付。
- work 页签直接渲染 work 的消息与 execTrace；work 页签关闭不拦后台运行。
- 群聊评论串：索引严格为 `通道id>消息id`（群通道为 `group:<goalId>`）。一级主楼只带 `threadId`，
  评论区回复同时带 `threadId` 与 `threadRootId`；群聊一级列表用 `!threadRootId` 过滤，评论只在
  对应主楼的二级视图出现。agent 间任务交流进评论串，`@用户` 汇报与 ask 仍留一级。

## 收口兜底

- role 一轮没有 `chat.send(user)` 时，hook 把最终正文补成 user 通道消息（`auto: true`），
  保证对话层看得到回复。
- Work 交付回到 role：role 空闲 → 立即起一轮；正在跑 → 在当前 loop 结束边界注入一条
  `channel-message`。自由聊天也一样，交付不会再「留到下一次用户发言」。

## 持久化与迁移

- `Conversation.works = { sessions: WorkSession[] }`；载入时 `normalizeWorks` 校验并去重，
  `running` 复位为 `interrupted`，execTrace 只留最近 30 条。
- 旧 `Conversation.subagents` 在载入时迁移成 works：`defs.system` 变 work 的 systemPrompt，
  名称取 `def.name`，消息 / 状态 / 轮次 / 交付保留。
- 旧 `AgentTabRef.sub` 页签不迁移，读盘时忽略；新页签 key 为 `wa:<workId>`。

## 智能体后台浏览器

`api.browser.*` 现在管理的是**智能体自己的后台会话**，不再等同于文档区的用户网页页签：

- `open` 生成 `b:` 会话，不创建 `TabRef`、不激活文档页签，也不占页签栏。
- 会话常驻在 App 根部的 `AgentBrowserHost`，每个 session 一枚 `<webview>`；收起、切文档、
  切目标甚至关掉智能体页签后，guest 仍在后台运行。
- 智能体页内的 `AgentBrowserDock` 只是视口与状态面板：显示真实页面、当前动作、耗时、
  控制者；关闭 Dock 只隐藏视口，不销毁会话。
- 控制权分为 `agent / user / paused`。用户点“接管”后，agent 在下一个动作边界等待；
  “交还”后继续。用户直接点页面也会触发接管，避免和 agent 抢操作。
- `browser.tabs()` 只列当前 agent 自己的会话；`activate` 只换活动会话，不弹 Dock；
  `close` 只关闭自己的会话，绝不关用户网页页签。
- 智能体会话里的 `target=_blank` 会回流成同 owner 的新会话，不落成文档区页签。
- 会话按 `goalId + role + conversationId` 归属；每 owner 最多 2 个、全局最多 4 个，
  超限先回收最久未活跃的空闲会话。

相关路径：

| 位置 | 是什么 |
| --- | --- |
| `src/learn/web/agentBrowser/runtime.ts` | 会话池、控制权、动作状态、viewport、guest 归属 |
| `src/learn/web/browserOps.ts` | `browser.*` 的会话模式与旧 docArea 兼容路径 |
| `src/components/learn/agent-team/AgentBrowserHost.tsx` | App 根部常驻的 webview 宿主 |
| `src/components/learn/agent-team/AgentBrowserDock.tsx` | 智能体页内的状态条 / Dock / 接管控制 |

## 相关路径

| 位置 | 是什么 |
| --- | --- |
| `src/agent/roleWork/types.ts` | role / work / host / chat 的调用契约 |
| `src/agent/roleWork/registry.ts` | channels 与 works 的载入归一化、旧 subagent 迁移 |
| `src/agent/work/manager.ts` | work 生命周期、并发、注入、自动交付 |
| `src/agent/work/runner.ts` | 一次 work 任务的 agent loop 与交付提取 |
| `src/learn/roleWork/channels.ts` | 来源戳、信封、通道过滤 |
| `src/learn/roleWork/dispatch.ts` | 入站落账、忙时排队、跳边界注入 |
| `src/learn/ops/chat.ts` | `chat.send` 三通道的宿主实现 |
| `src/learn/ops/host.ts` | work → role 的回传 |
| `src/learn/ai/roleWorkGuide.ts` | role 的中文规程：角色层与工作层、通道 |
| `src/learn/ai/workSystem.ts` | work 的系统提示词（无人格） |
