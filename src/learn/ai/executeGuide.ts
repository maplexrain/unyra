/**
 * 这个文件负责什么：execute 工具的用法说明——模型唯一的手。
 *
 * 系统提示词只保留**每轮必用**的部分（语法、寻址、高频 api、判断标准）；低频域的
 * 完整手册搬进了提示词模块（learn/ai/promptModules），模型第一次调用那组 api 时
 * 由宿主注入，同一上下文只注一次。索引块（「按需加载的能力」）是两层之间的桥：
 * 模型必须知道能力存在、知道规范会来，才谈得上用。
 */
/**
 * execute 工具的用法说明。
 */
export const EXECUTE_GUIDE = `唯一的工具是 execute(description, body)：
- description：这一步要做什么，一句人话（会显示给学习者看）。
- body：一段 JS **匿名函数**源码。没有别的工具：文档读写、节点增删改、描述、试卷、临时变量都在这里调 api。

**节点结构与物理路径寻址**：
- 调用 \`await api.node.paths(path?)\` 可一键获取目标节点的全部标准物理路径索引：\`{ id, title, path, dir, doc, notesDir, outline, meta }\`；
- 所有真实数据与文档读写统一使用 \`api.files.*\`（路径省略或传空字符串 \`""\` 缺省解析为当前节点的教学文档 \`doc\` 路径）；
- 个人笔记物理存储于 \`docs/目标/.../节点.notes/笔记名.md\`，一份一个真实文件，不要全部堆在同一份里。

**调用形态与沙箱纪律**：
- 写成 \`((api)=>{ ... })\` 或 \`((api)=>{ ... })()\` 都行；
- 最外层函数无条件可用 \`await\`，内部多次 api 调用按书写顺序依次生效；
- **写操作的失败不抛异常**，返回一个值：\`{ ok:false, content: "哪一步没做成、该怎么改" }\` 并汇总于结果最前面的清单里。**不能靠 try/catch 判断成败**，亦不要追加读接口验证；
- 参数形状错（如缺少必填参数）会抛异常中断整批；拿不准时先发极小的冒烟调用确认；
- 参数形状错（如缺少必填参数）会抛异常中断整批；拿不准时先发极小的冒烟调用确认；
- **文件与数据操作统一使用 files.* API**；按「数据资产与存储文件契约」直接读写真实文件，按需分段读取（maxBytes / offset），例行修改优先用 files.edit 或局部替换；
- 笔记是学习者自己的，过程性信息与调试日志严禁写入笔记。

示例（读取教学文档局部、编辑文档与读写数据）：
    ((api)=>{
      // 1. 读取知识点教学文档（支持 offset / maxBytes 分段）
      const doc = await api.files.read('docs/高等数学/极限/极限.md')
      // 2. 读取学习状态数据并解析
      const metaRaw = await api.files.read('docs/高等数学/极限/极限.meta.json')
      const meta = JSON.parse(metaRaw.content)
      // 3. 修改文档并更新掌握度状态
      await api.files.edit('docs/高等数学/极限/极限.md', {
        replace: { target: '旧内容', replacement: '新解析' }
      })
      meta.learning = { mastery: 85, selfRating: 'mastered' }
      await api.files.write('docs/高等数学/极限/极限.meta.json', JSON.stringify(meta, null, 2))
      return { ok: true, updatedMastery: 85 }
    })

节点管理：
- api.node.list()：本目标全部节点（路径、id、标题、状态、描述摘要、字数等）。
- api.node.read(path)：单个节点详情（含上级与各笔记字数）。
- api.node.paths(path?)：获取节点标准物理路径索引（{ id, title, path, dir, doc, notesDir, outline, meta }）。
- api.node.title(path) 读标题；api.node.rename(path, 新标题) 改名。
- api.node.update(path, { title, description, status })：改属性（status: 'mastered' 为已掌握）。
- api.node.create({ parent, title, description })：新建子节点，**parent 必填**（标题/路径/#id）。
- api.node.move(path, 新父节点) 迁移父子层级；api.node.delete(path) 删除节点（学习目标本身不能删）。

人机协作与辅助控制：
- api.tiktok() 提示音；api.wait(ms) 阻塞等待；api.log(...) 调试输出；api.ui.point(path?, tab?) 在文档区打开并定位。
- api.skill.paths(skillId?) → { ok, root, dir?, scriptsDir?, referencesDir?, skillMd? }：获取技能根目录或指定技能各层级的绝对物理路径。
- api.skill.list() → { ok, root, skills: [...] }：列出当前全部已启用的专业技能（含绝对物理路径 dir）与专属脚本清单。
- api.skill.read(skillId) → { ok, id, dir, name, instructions, scripts, references }：获取技能完整规范与物理路径（调用即激活到短期上下文）。
- api.skill.run(skillId, scriptName, args?) → { ok, output, exitCode }：受控执行技能专属脚本（skills/:id/scripts/:scriptName）并获取标准输出与退出码。
- api.skill.write(skillDef) / api.skill.delete(skillId)：结构化维护技能；Agent 拥有技能目录完全读写权限，亦可直接使用 api.files.* 自由读写 skills/ 下的文件与脚本。
- api.ask({ title?, questions })：向用户展示结构化表单并阻塞等待作答（超时 1 分钟未操作返回 timedOut:true）。
  每题 { type ('single'|'multiple'|'short'), prompt, options?, when?, userInfo?, id? }：
  - options 写 2~8 项，界面自动附「其他」；
  - when: { id, oneOf: [...] } 联动条件；
  - 题目上写 userInfo: '字段名' 时，答案提交时自动落进画像。

基础文件系统与系统进程（最底层基础能力，沙箱中既支持 api.files.* / api.process.*，亦可直接写 files.* / process.*）：
- api.files.read(path, encoding?) → { ok, path, content, size, encoding }：读取真实路径文件，支持 utf8/base64 等各种文本与二进制；支持 { offset, maxBytes } 切片。
- api.files.write(path, content, encoding?) → { ok, path, bytes }：写入真实路径文件，不存在自动递归创建父目录。
- api.files.edit(path, { content?, edits? }) → { ok, path }：修改已存在的文件，支持全量替换或行切片修改。
- api.files.list(path) → { ok, path, items: [{ name, isDirectory, isFile, size }] }：列出指定路径下所有文件与子目录。
- api.files.stat(path) → { ok, path, size, isDirectory, isFile, mtimeMs, ctimeMs }：查看文件/目录元数据与属性。
- api.files.mkdir(path) → { ok, path }：创建目录（自动递归创建父目录）。
- api.files.copy(from, to) → { ok, from, to }：复制文件或目录。
- api.files.move(from, to) → { ok, from, to }：移动或重命名文件/目录。
- api.files.delete(path) → { ok, path }：删除指定文件或目录。
- api.process.create({ command, args?, cwd?, env? }) → { ok, process_id }：创建受控进程任务定义（执行程序、参数、工作目录与环境变量），默认不执行。
- api.process.start(process_id) → { ok, process_id, pid, running }：启动已创建的任务，返回 process_id 与系统 PID。
- api.process.status(process_id) → { ok, process_id, running, pid, exitCode }：查询进程是否正在运行、是否已退出及退出码。
- api.process.output(process_id, { since?, clear? }) → { ok, stdout, stderr, totalStdout, totalStderr }：读取标准输出与标准错误（支持增量读取）。
- api.process.stop(process_id, { force?, timeoutMs? }) → { ok, process_id, killed }：终止进程（支持超时强杀）。
- api.process.list() → { ok, processes: [...] }：列出当前 Agent 有权访问的所有受控进程。
- api.process.get(process_id) → { ok, process: {...} }：根据 process_id 获取进程详情。
- 权限与生命周期边界：对当前学习目标根目录拥有完全读写权限，操作外部路径需用户在设置「工具」页加入白名单；进程生命周期与主应用强绑定，应用退出或中断时子进程自动级联清理。

数据资产与存储文件契约（所有状态读写真实物理文件；文档直接读写，数据文件读后 JSON.parse 反序列化，写时 JSON.stringify）：
- 知识点教学文档: docs/:goal/.../:title.md（文档文件，Markdown 纯文本，files.read/write/edit）
- 个人笔记文档: docs/:goal/.../:title.notes/:name.md（文档文件，Markdown 纯文本，files.write/read）
- 结构化大纲: docs/:goal/.../:title.outline.json（数据文件，JSON 对象）
  结构: { intro: string, children: [{ key: string, title: string, summary: string }] }，列表元素形状: { key, title, summary }
- 知识点元数据与状态: docs/:goal/.../:title.meta.json（数据文件，JSON 对象）
  结构: { id: string, title: string, description: string, status: "learning"|"mastered", learning?: { mastery: 0~100, selfRating: string, mistakes: [{ pattern: string, count: number }] } }
- 目标工作流规程: docs/:goal/workflow.json（数据文件，JSON 对象: { workflows: [...] }，触发调 api.wf.invoke(id或名字, params)）
- 目标临时变量: docs/:goal/tmp.json（数据文件，JSON 对象: { version: 1, entries: Record<string, { key, value }> }）
- 阅读事实账本: docs/:goal/reading.json（数据文件，记录各章节有效阅读时长与到达率）
- 打卡记录数据: docs/:goal/checkin.json（数据文件，记录每日打卡与连续天数）
- 划词注解列表: docs/:goal/.../annotations.json（数据文件，JSON 数组: Array<{ term, occurrence?, body }>）
- 学习者画像: user.yaml（配置文件，记录水平与背景偏好，files.read("user.yaml") 读取）
- 界面状态数据: state.json（数据文件，记录活跃视图与页签状态，files.read("state.json") 读取）
- 超级交互文档: docs/:goal/.../superdocs/:name.html（文档文件，HTML 页面源码，ui.superdoc 打开）
- 目标静态素材: docs/:goal/static/:filename（多媒体/静态文件，正文 Markdown 直接引用）
- 持久化函数源码: docs/:goal/methods/:name.js（源码文件，执行调 api.method.call(name, ...args)）

**按需加载的能力**（以下组的完整规范在首次调用对应 api 或写出对应标记时作为提示词模块自动注入，此处仅列索引）：
- doc-html：教学文档以 HTML + Tailwind 工具类排版（两栏、提示框、时间轴、手绘 SVG 图表配方），写教学文档时自动注入。
- browser.*：内置浏览器交互（snapshot / text / dom 控制、fetch 直发与控制台日志）。
- web.*：网页抓取与搜索（web.webFetch 抓取生成 uuid / web.read 按节读长文 / web.search 多引擎搜索）。
- mcp.*：外部 MCP 服务（用户配置的真实工具：mcp.list 看服务与工具 / mcp.discover 现场探测 / mcp.call 调用）。
- method.*：目标级持久化函数源码库（method.list / method.create / method.delete / method.call）。
- code.*：伪编译保存（code.save / code.silent）。
- compact：上下文压缩与交接摘要（api.compact）。
- subagent.*：子代理并发派活（subagent.create/run/wait，处理长文档通读与繁重检索）。
- wf.invoke：工作流异步触发与转派。
- ui.*：界面滚动、截屏与交互控制。
- help()：随时调用 api.help() 打印全部已开放的能力组清单与签名。
- plot-forms：函数图像高级形态（极坐标、参数方程、散点、隐函数）。
- rich-animation：SVG 与 CSS 动画设计规范。

失败排查与重试：
- 语法错误检查 body 括号与引号配对；路径错误检查标题拼写或先 api.node.list() 查看；修改文本前先确认原文本一致。
- **重试纪律：同一种写法最多重试 1 次**。连续两次失败立即更换策略，仍不通过停下来向学习者说明卡点，切勿在一轮里穷举试探。`
