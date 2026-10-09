# 动态提示词注入

> 系统提示词只装「每轮都要」的部分；低频域的完整规范（超级文档、内置浏览器、试卷口径……）
> 住进**提示词模块**，模型第一次真正用到时由宿主注入上下文——同一上下文只注一次。
> 相关：[sandbox-api.md](sandbox-api.md)（api 目录与对账）、[agent.md](agent.md)（系统提示词与压缩）。

## 为什么

EXECUTE_GUIDE 曾把十几个低频域的手册整段压在系统提示词里（超级文档 3k、内置浏览器 1.8k、
试卷 1.5k……），每一轮请求都全价付一遍，而多数对话根本用不到。拆成模块后三件事同时成立：

- **不用不花钱**：没碰超级文档的会话，那 3k 规范一个字都不进上下文；
- **用到是全文**：注入的是完整规范（不是为省 token 压出来的缩写本），搬迁是无损的；
- **压缩后自动重注**：模块消息随旧消息一起失活，下次使用判据发现「活着的不在场」就重新注入。

减负账目：系统提示词约 35,600 字符 → 约 18,100 字符（**-49%**）；搬走的约 16,900 字符
住在 `src/learn/ai/promptModules.ts`，只在首次使用时进上下文。

## 机制

模块注册表（`PROMPT_MODULES`）每条 `{ key, title, text }`。触发有三种，最终都汇到宿主的
去重判据上：

| 触发 | 检测点 | 例子 |
| --- | --- | --- |
| api 组 | execute 编排结束后按 `log` 里的组前缀报给宿主（`onPromptModule`） | 第一次调 `sdoc.write` → `sdoc` |
| 写入内容 | execute 在 doc/sdoc 写入参数上嗅探标记（`writableContentOf` + api 名） | 写出 ` ```plot ` → `plot-forms`；写出 `<animate>`/`@keyframes` → `rich-animation` |
| 写入目标 | 同上，但认的是 **api 名**而不是内容 | 第一次写教学文档（`doc.write`/`append`/`replace`）→ `doc-html`（正文的 HTML + Tailwind 配方）。这一条**不挑内容**：模型要是压根不知道正文能写 HTML，它写出来的永远是纯 Markdown，「写出了 class 才注入」就等不到那一刻 |
| 工作流 | 触发时随指令注入（内置条目的 promptModule / 登记条目的 prompt 字段） | 「超级实验室」→ sdoc；**「开讲」与「学习大纲」→ doc-html** |
| | | ↑ 后两条是**动笔之前**就要在场的那一类：靠 doc.* 写入触发只会晚一轮，第一份教学文档就永远是纯 HTML 草稿 |

**去重判据**（`missingPromptModules`）：扫一遍会话消息，`promptModule === key` 且**未失活**
（`retired` 不算数）的消息已存在 → 不注入。判据只认消息上的结构化标记字段，不认文案——
那正是 persona 补发（`needsPersonaAnnounce`）的同一套判据，模块是它的推广。

**注入位置**：只在队尾追加，绝不插进历史中部——这是前缀缓存的不变量（见 `agent/prefixGate`）。
两个注入点都是「追加」：

- 工作流触发：与人格补发同一处，排在用户消息之前（轮开始时，`useAgent.runTurnUnchecked`）；
- api 组 / 内容触发：排在轮次收口的回复**之后**（`useAgent` 的 finally），下一轮请求自然带上。

**透明化**：模块消息是隐藏 user 消息（进模型上下文、不出用户气泡），但带 `mark` 渲染成
一条可展开的分界条（`ModuleDivider`）——「提示词模块 · 超级文档 · 已注入上下文」，点开是全文。
用户随时能看到「导师此刻的上下文里被塞进了什么」。

## 落盘往返

`ConversationMessage.promptModule` 随 chat.json 落盘，读回时 `normalizeConversation` 按字段
白名单重建——漏了它，重启后每用一次低频组就重复注一遍。它有 chatPersist 用例钉着。

## 加一个模块要动三处

1. 文本与 key 加进 `src/learn/ai/promptModules.ts`（自包含：模型读到它时没有别处的铺垫）；
2. 触发挂上：api 组进 `GROUP_MODULE` 映射、内容标记进 `promptModuleForContent`、
   工作流在 `BUILTIN_DEFS` 上写 `promptModule`；
3. 系统提示词的「按需加载的能力」索引块（`executeGuide.ts`）加一行——**索引是两层之间的桥**：
   模型必须知道能力存在、知道规范会来，才谈得上用；一行提示还兼着「首次调用前别瞎猜」的底线。

模块文本与 api 实现的一致性没有自动对账（探针对账的是「有没有」，不是「写得对不对」）——
改 api 行为时连同模块文本一起改。
