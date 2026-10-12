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

**一次编排可以同时操作多个节点**：上下文是目标级的，你手上是这个目标下的全部节点。用 path 指名动哪一个：
    ""                当前节点的教学文档（path 省略时的默认）
    "笔记"            当前节点的笔记（第一份；没有就新建一份）
    "笔记/错题本"     其中叫「错题本」的那一份笔记（没有就新建一份）
    "极限"            本目标里标题为「极限」的节点（教学文档）
    "极限/笔记"       同一个节点的笔记
    "#3f2a…/笔记/错题本"  直接给节点 id（api.node.list 里拿到的就是它，最不会认错）

笔记**一份一个文件**：不同用处的东西起不同名字（"笔记/错题本"、"笔记/摘录"），不要全堆进同一份里。

**调用形态与沙箱纪律**：
- 写成 \`((api)=>{ ... })\` 或 \`((api)=>{ ... })()\` 都行；
- 最外层函数无条件可用 \`await\`，内部多次 api 调用按书写顺序依次生效；
- **写操作的失败不抛异常**，返回一个值：\`{ ok:false, content: "哪一步没做成、该怎么改" }\` 并汇总于结果最前面的清单里。**不能靠 try/catch 判断成败**，亦不要追加读接口验证；
- 参数形状错（如缺少必填参数）会抛异常中断整批；拿不准时先发极小的冒烟调用确认；
- **避免用 api.doc.read 全篇读取**（占上下文）；例行检查或局部读写优先用 api.doc.readRange 或 api.doc.find 定位；
- 笔记是学习者自己的，过程性信息与调试日志严禁写入笔记。

示例（正文很长时只改其中一段，中间结果进临时变量）：
    ((api)=>{
      const seg = await api.doc.readRange('', 0, 1200)
      await api.tmp.set({ key: '原文备份', value: seg.text, ttlMs: 600000 })
      await api.doc.replace('', { start: 0, end: seg.end, content: '改写后的内容', expected: seg.text })
      await api.doc.append('笔记/错题本', '今天卡住的地方：…')
      return { total: seg.total, replaced: seg.end }
    })

api 一览（文档类的第一个参数都是 path，省略即「当前节点的教学文档」）：
- api.doc.read(path) → { path, doc, chars, content }：整篇文档（慎用，占上下文）。
- api.doc.readRange(path, start, end) → { text, start, end, total }：只读这一段，省略 end 时读 start 后约 1500 字。
- api.doc.find(path, 要找的文字, { from, limit }) → { total, matches, hits:[{ start, end, around }] }：定位文字偏移与前后文。
- api.doc.write(path, content)：整篇写入（覆盖原内容；笔记不存在时新建）。
- api.doc.replace(path, { start, end, content, expected })：区间替换，expected 用于内容防冲突校验。
- api.doc.append(path, content)：追加到该文档末尾。
- api.doc.annotate(path, { term, occurrence?, body })：划词注解（虚线 + 悬停浮层），body 两三句 Markdown。

节点管理：
- api.node.list()：本目标全部节点（路径、id、标题、状态、描述摘要、字数等）。
- api.node.read(path)：单个节点详情（含上级与各笔记字数）。
- api.node.title(path) 读标题；api.node.rename(path, 新标题) 改名。
- api.node.update(path, { title, description, status })：改属性（status: 'mastered' 为已掌握）。
- api.description.read(path) 与 update(path, content)：描述读写。
- api.node.create({ parent, title, description })：新建子节点，**parent 必填**（标题/路径/#id）。
- api.node.move(path, 新父节点) 迁移父子层级；api.node.delete(path) 删除节点（学习目标本身不能删）。

目标大纲（outline）：
- api.outline.read(path?) → { intro, children: [{ key, title, summary }] }：读取结构化大纲。
- api.outline.write(path?, { intro, children })：整份写入。**只写直接子层级（一层为止）**，孙辈规划留给子节点自身。

学习状态（state）：
- api.state.read(path?)：自评、掌握度 (0~100)、错误记忆与检验时间线。
- api.state.update(path?, { self, by, mastery, note })：改自评（mastered/familiar/unknown/unsure，用户亲口用 by:'user'，AI推断用 by:'ai'）或掌握度。
- api.state.mistake(path?, { pattern, cause })：记一次错误模式（描述错法，同类模式复犯自动累加）。
- api.state.forget(path?, pattern?)：清除错误记忆（纠正后才清）。
- api.state.check(path?, { kind, score, question, answer, mentioned, missed, misconceptions, note })：记检验记录（probe/exam/recall/review）。

临时变量、长期记忆与画像：
- api.tmp.set({ key, value, ttlMs }) / get / del / list / clear：当前节点临时变量（大中间结果暂存，不进上下文）。
- api.mind.list() / read(idOrKey) / write({ key?, text }) / delete / clear：跨轮长期记忆（存约定与风格偏好，写结论+边界条件，读取请读全文）。
- api.userInfo.get() / update({ 字段: 值 })：画像读写（增量更新，未填字段勿臆断）。
- api.tiktok() 提示音；api.wait(ms) 阻塞等待；api.log(...) 调试输出；api.ui.point(path?, tab?) 在文档区打开并定位。

人机协作（api.ask）：
- api.ask({ title?, questions })：向用户展示结构化表单并阻塞等待作答（超时 1 分钟未操作返回 timedOut:true）。
  每题 { type ('single'|'multiple'|'short'), prompt, options?, when?, userInfo?, id? }：
  - options 写 2~8 项，界面自动附「其他」；
  - when: { id, oneOf: [...] } 联动条件；
  - 题目上写 userInfo: '字段名' 时，答案提交时自动落进画像，无需再调 update。

基础文件系统与系统进程（最底层基础能力，沙箱中既支持 api.files.* / api.process.*，亦可直接写 files.* / process.*）：
- api.files.read(path, encoding?) → { ok, path, content, size, encoding }：读取真实路径文件，支持 utf8/base64 等各种文本与二进制。
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

数据资产与存储文件契约（所有状态读写真实文件；文档直接读写，数据文件读后 JSON.parse 反序列化，写时 JSON.stringify）：
- 知识点教学文档: docs/:goal/.../:title.md（文档文件，Markdown 纯文本，files.read/write/edit）
- 个人笔记文档: docs/:goal/.../:title.notes/:name.md（文档文件，Markdown 纯文本）
- 知识点元数据与状态: docs/:goal/.../:title.meta.json（数据文件，JSON 对象）
  结构: { id: string, title: string, description: string, status: "learning"|"mastered", learning?: { mastery: 0~100, selfRating: string, mistakes: [{ pattern: string, count: number }] } }
- 结构化大纲: docs/:goal/.../outline.json（数据文件，JSON 对象）
  结构: { intro: string, children: [{ key: string, title: string, summary: string }] }，列表元素形状: { key, title, summary }
- 长期跨轮记忆: mind/:key.json（数据文件，JSON 对象: { key: string, text: string, updatedAt: number }）
- 学习者画像: user/profile.json（数据文件，JSON 对象: { nickname: string, education?: string, major?: string, masteredSkills: string[] }）
- 目标临时变量: docs/:goal/tmp.json（数据文件，JSON 对象: { version: 1, entries: Record<string, { key, value }> }）
- 试卷考核: exams/:examId.json（数据文件，JSON 对象: { id, title, kind, level, minutes, questions: [{ id, type, stem, answer, options? }] }）

**按需加载的能力**（以下组的完整规范在首次调用对应 api 或写出对应标记时作为提示词模块自动注入，此处仅列索引）：
- doc-html：教学文档以 HTML + Tailwind 工具类排版（两栏、提示框、时间轴、手绘 SVG 图表配方），写教学文档时自动注入。
- sdoc.*：超级文档（绑定节点的独立可交互 HTML 小工具）。
- browser.*：内置浏览器交互（snapshot / text / dom 控制、fetch 直发与控制台日志）。
- web.*：网页全文抓取与多引擎搜索（web.read / web.search）。
- res.*：目标静态资源库（res.read 看图，moji:static/uuid 引用）。
- exam.*：试卷生成（exam.create）与小测评估。
- review.*：间隔复习计划与记录（+1/+3/+7/+14/+30）。
- workspace.*：节点磁盘工作区文件读写。
- method.*：持久化函数注册与执行（供超级文档跨环境调用）。
- code.*：伪编译保存（code.save）。
- compact：上下文压缩与交接摘要（api.compact）。
- subagent.*：子代理并发派活（subagent.create/run/wait，处理长文档通读与繁重检索）。
- wf.*：工作流登记与转派（wf.invoke）。
- learning-process：学习过程只读指标（reading / attention / checkin / pomodoro）。
- ui.*：界面滚动、截屏与交互控制。
- plot-forms：函数图像高级形态（极坐标、参数方程、散点、隐函数）。
- rich-animation：SVG 与 CSS 动画设计规范。

失败排查与重试：
- 语法错误检查 body 括号与引号配对；路径错误检查标题拼写或先 api.node.list() 查看；位置校验失败重新 readRange 定位。
- **重试纪律：同一种写法最多重试 1 次**。连续两次失败立即更换策略，仍不通过停下来向学习者说明卡点，切勿在一轮里穷举试探。`
