# 沙箱 api

> 超级导师手感上的「唯一那只手」。它在对话里写一段 JS，宿主把它交给沙箱执行，
> 每次 `api.x.y(...)` 转回宿主、落到学习数据上。相关：[agent.md](agent.md)（人格与压缩）、
> [code-run.md](code-run.md)（另一套更小的运行沙箱）。

## 一个工具：`execute`

Agent 只有 `execute` 一个工具：它写一段 JS **匿名函数**（`((api)=>{ … })`，`await` 无条件可用），
宿主把这串源码交给一个 Worker 里的沙箱执行；沙箱把每次 `api.x.y(...)` 转回宿主，落到学习数据上。
没有 `window` / `document` / `fetch`，出错与超时都会变成一句可读的提示回到模型。

宿主在把它交给沙箱之前先摆成**一段 async 匿名函数**（去掉结尾的自调用括号与分号、剥掉最外层成对括号、
在函数头之前补 `async`；括号计数会跳过字符串与注释），并自己编译一次：编译不过就把真实的语法错误
直接回给模型——沙箱里抛的语法错行号指向沙箱自己的包装代码，对模型没有任何指向性。

## 一切按 path 寻址

上下文是目标级的，一次编排里 Agent 往往要同时碰好几个节点（给刚建的那个写文档、给这一个改描述、
再建一个新节点），所以凡是指向文档 / 节点的 api 都收一个 path：

```
""            当前节点的教学文档（path 省略时的默认）
"笔记"        当前节点的笔记文档
"极限"        本目标里标题为「极限」的节点（教学文档）
"极限/笔记"   同一个节点的笔记文档      "#3f2a…/笔记"   直接给节点 id
```

同一个目标内标题（归一化后）唯一，因此按标题一定指得明白；路径找不到时报错里会列出候选子节点，
模型照着改一次就对。

## api 一览

| 组 | api |
| --- | --- |
| 文档 | `doc.read(path)` · `doc.readRange(path,start,end)` · `doc.find(path,文字)` · `doc.write(path,content)` · `doc.replace(path,{start,end,content,expected})` · `doc.append(path,content)` |
| 节点 | `node.list()` · `node.read(path)` · `node.create({parent,title,description})`（**parent 必填**，不再隐式当前节点） · `node.title(path)` · `node.rename(path,title)` · `node.update(path,{title,description,status})` · `node.delete(path)` · `node.move(path,新父节点)` |
| 描述 | `description.read(path)` · `description.update(path,content)` |
| 大纲 | `outline.read(path?)` · `outline.write(path?,{intro,children})`（每个节点一份的结构化计划，**只写直接子层级一层**——「爷爷知道儿子的存在，但不知道孙子的存在」；页签里打开是交互页面） |
| 试卷 | `exam.create({title,kind,level,minutes,questions})` · `exam.read(attemptId?)` · `exam.grade({attemptId?,passed,summary,results})` · `exam.explain({content,attemptId?})` · `exam.delete({id})`（**写**受阶段约束，读任何时候都能调） |
| 学习状态 | `state.read(path)` · `state.update(path,{self,by,mastery,note})` · `state.mistake(path,{pattern,cause})` · `state.forget(path,pattern)` · `state.check(path,{kind,…})` |
| 暂存 | `tmp.set({key,value,ttlMs})` · `get` / `has` / `del` / `list` / `clear`（按节点存放，不进上下文） |
| 画像 | `userInfo.get()` · `userInfo.update({字段:值})`（**不进提示词**，导师要用得自己取；见 [agent.md](agent.md#用户与画像)） |
| 网页 | `web.webFetch(url)` · `web.read(uuid, '一级/二级')`（**太长的会落盘**、只回大纲树；只能 http/https，不碰内网） |

## 读与写的口径是分开的

`exam.read()` 任何时候都能调，没有卷子也是一种答案（回 `status:"none"`），不算失败；
写（出卷 / 判分 / 写讲解）才受阶段约束——有一次考试等着收尾（待判分，或判完还缺讲解）时不能再出卷，
判分与讲解同属那个阶段（它们是同一套工作流的两步，中间不该被自己拦下来）。

`exam.delete` 只认**一次都没考过**的卷子：考过的是学习记录（作答、输入顺序、单题耗时、切屏、判分、讲解），
要删得由用户在试卷列表里删——那里会列清「会连带删掉什么」并让他二次确认。这条判据在 `learn/exam.ts` 的
`examDeleteBlock` 里，是纯函数、有测试钉着——「不许删用户的东西」不该指望模型自觉。

## 写操作的失败不抛异常

它回一个 `{ok:false, content:"哪一步没做成、该怎么改"}` 的值，同时被汇总到这次工具结果最前面的
「没有生效」清单里（连同 api 名与那句话）。抛异常会带走同一批里其余的调用，而这些失败几乎都是
「参数不对、照着改一次就好」，值更能被模型用上。

代价是 body 里不能用 try/catch 判断成败——这一条写在提示词里了（模型为此浪费过两轮：
它 try/catch 没接住，又追加一次读接口去确认到底做成没有）。

## `exam.create` 的入参写法

入参是自由对象，写法因此必须写在提示词与工具说明里（沙箱没有 JSON Schema 级校验）：

```
{ title, kind:"quiz"|"test"|"exam", level:"easy"|"medium"|"hard"|"extreme", minutes, questions:[…] }
```

`minutes` 是时限分钟数：小测不用给（不限时），其余**不得低于题目数 × 2**——下限由 `resolveExamMinutes`
强制，那只是地板，Agent 该按题量与难度往上给。

每道题是：

```
{ type:"single"|"multiple"|"truefalse"|"fill"|"short", stem, options:[{id,text}], answer:["A"], rubric, points }
```

单选/多选/对错必须给 `answer`，对错题写 `["true"]`/`["false"]` 且不用给 `options`——选项固定是
「正确 / 错误」；填空/简答的 `answer` 是参考答案。

解析时**认得出就认**——`judge` / `tf` / `判断题` 都当对错题，题干写在 `question` / `content` / `title`
里也认，`options` 可以是字符串数组，`answer` 可以写 `"B"`、`"A,B"` 或选项原文；**认不出就点明**
「第几题、哪个字段、该写成什么」，而不是回一句「题目格式不合法」让模型猜
（一次真实运行里模型为这一句话枚举了 55 种写法，最后还是没出成卷）。

## 两条安全边界

- `node.delete` 不能删学习目标本身（那是整个目标，得用户在界面上删）；
- 改标题撞上同目标的重名会被拒绝（重名之后 path 就指不明白是谁了）。

## 加一个 api 要动四处

1. 实现在 `src/agent/sandbox/api.ts` 的 `buildApi`（它把 `SandboxOptions` 上的宿主能力逐个包成 api 方法；
   各组 `*Ops` 的实现住在 `src/learn/ops/`）；
2. 名单在 `src/agent/sandboxWorker.ts` 的 `API_NAMES`（不登记的话 Worker 侧不存在这个名字）；
3. 用法写进 `src/learn/ai/executeGuide.ts` 的 `EXECUTE_GUIDE`（模型唯一的手）；
4. 目录加进 `src/agent/apiCatalog.ts`（设置 → 开发者里那份「api 上下文管理」）。

后两者与前两者的一致性由 agent 探针逐条对账，漏一处就红。
