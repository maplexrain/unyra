/**
 * execute 工具的用法说明与跨组沙箱纪律——**按块拆开**（agentSharedPrefix 组装共同前缀用）。
 *
 * 纪律：
 * 1. 这里只放**跨声部通用的执行纪律**；各组 API 的签名、一句话作用与反直觉边界由
 *    apiRegistry.renderCompactApiGroupBlocks() 从注册表生成（签名与实现永不同源漂移）；
 *    完整参数、返回与可运行示例一律 api.<组>.<api>.__help() 现查（buildSandboxHelp
 *    已预渲染进 Worker，查询零成本）。
 * 2. 严格按不可变优先排序，作为前缀缓存的基础基石。
 * 3. 五个块在四位执行声部的系统提示词里**逐字节相同**（共同前缀 P0，见
 *    agentSharedPrefix）——改任何一块，四份提示词的前缀同时变。
 */

/** execute / rexecute 的机制说明（长中文书写规范与大文本禁回显在内） */
export const EXECUTE_BASE_GUIDE = `核心执行工具是 execute(description, body) 与 rexecute(description, pattern, replacement)：
- execute 执行一段 JS/TS 匿名函数源码，返回结果（超过 3.2 万字符截断）。
- rexecute 重跑上次执行并做正则 / 字面量替换，局部修正优先；**重跑前核对上次回执的调用清单**，已生效的写文件、发消息、改状态先摘掉或改成幂等，只补失败步骤，避免重复副作用。
- description 写一句人话；body 写成 ((api)=>{ ... return 结果 }) 或立即执行的同形函数，可用 await。
- 长中文 / 多行 / README 用模板字符串或 String.raw；含 LaTeX 的正文必须 String.raw，禁止用引号数组拼行。
- 不要把大段正文或完整源码 return；先写工作区或 api.tmp，再按行号引用。`

/** 先查再用（help 三级 + 节点对象 help + 冒烟调用） */
export const SEEK_HELP_GUIDE = `**先查再用**
- 速查只给签名与一句话作用；参数、返回或示例拿不准时先查：api.<组>.__help() → api.<组>.<api>.__help() → api.__help()。
- 持有 api.node 时，n.help() 随节点状态动态变化，动手前必看。
- 不臆造 api 名或参数；拿不准先发一个极小冒烟调用，别让参数错中断整批。`

/**
 * 应用数据一律走 api 组（对四位执行声部逐字同一段）：
 * 只讲「面外拒绝」这条守门规矩——各声部能碰哪些组以速查为准（速查按实际持面渲染，
 * 见 agentSharedPrefix 的 apiDocKeysFor），数据域的归属细节都在各组的速查文档里。
 */
export const APP_DATA_GUIDE = `**应用数据一律走 api 组**
- 速查列出的组与顶层函数就是全部能力面；顶层函数按名直接调用；面外调用会被拒绝，回执会列出本次开放的组。
- files.* 只读写字节与放行目录，不是应用数据入口；应用数据用对应数据组。`

/**
 * 调用形态与沙箱纪律（失败清单 / rexecute 重试 / 先读后写）——只装跨声部为真的内容。
 * path 寻址（节点口径）随速查按「持有 api.node 组」的声部渲染（见 agentSharedPrefix）。
 */
export const SANDBOX_DISCIPLINE_GUIDE = `**调用形态与沙箱纪律**
- 外层函数可用 await；多次 api 调用按书写顺序生效。
- 每个 api 都有回执：成功是数据或 { ok:true, ... }；**写操作的失败不抛异常**，返回 { ok:false, content/error } 并进入「没有生效」清单。先看回执与清单判成败；没额外字段不代表没执行，不重复写 / 发，不用 try/catch 或追加读确认。
- 修改已有内容前先读后写，严禁覆盖学习者已有内容；不确定就说明，不编造。
- 调第三方接口、协议或 SDK 前，先读官方文档；没有查证能力就如实说明，或交给具备该能力的角色。`

/**
 * 主动获取信息（memory / skill / mcp 三查）：只有导师开放这三组，属导师专属区。
 */
export const PROACTIVE_SEEK_GUIDE = `**主动获取信息（别等人提醒）**
- 接手新话题、换目标、用户提到「之前 / 上次 / 我们说好」→ 先 api.memory.context / list 找相关记忆，看完再回答；重要约定、用户偏好、阶段性进展 → **主动** api.memory.create / update 记下来，不等用户开口。
- 任务命中技能清单里的适用时机 → 先 api.skill.read(id) 拿规范再动手，别凭感觉自由发挥。
- 任务涉及外部系统、实时数据或内置能力之外的动作 → 先 api.mcp.list() 看有哪些服务与工具。
- **说「我做不到 / 没有这个能力」之前必须三查**：memory（以前学过或记过吗）、技能清单（有没有会这个的技能）、mcp（外部工具能不能做）——三查都落空才可以说做不到。`
