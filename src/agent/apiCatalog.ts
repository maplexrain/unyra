/**
 * execute 沙箱的 api 目录：一组一档，每条给签名与一句说明。
 *
 * 这是「execute 工具 api 上下文管理」页（超级导师设置 → 开发者，见
 * components/AgentSettingsModal）的数据源：开发者在这里核对「当前 agent 到底
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
    key: 'doc',
    label: '文档 · doc',
    intro: '全部按 path 寻址；path 省略 = 当前节点的教学文档，"笔记" = 当前节点的笔记，"极限/笔记/错题本" = 指名某一份。',
    items: [
      { name: 'doc.read', signature: 'doc.read(path?)', summary: '整篇文档（占上下文，慎用）→ { content, chars }', availability: 'always' },
      { name: 'doc.readRange', signature: 'doc.readRange(path?, start, end?)', summary: '只读一段；省略 end 读 start 后约 1500 字', availability: 'always' },
      { name: 'doc.find', signature: 'doc.find(path?, 文字, { from?, limit? }?)', summary: '查位置与前后文，不把整篇读进来；改长文档前先定位', availability: 'always' },
      { name: 'doc.write', signature: 'doc.write(path?, content)', summary: '整篇写入（指向不存在的笔记时新建）', availability: 'always' },
      { name: 'doc.replace', signature: 'doc.replace(path?, { start?, end?, content, expected? })', summary: '区间替换；expected 与现状不符会拒绝', availability: 'always' },
      { name: 'doc.append', signature: 'doc.append(path?, content)', summary: '追加到末尾', availability: 'always' },
      { name: 'doc.annotate', signature: 'doc.annotate(path?, { term, occurrence?, body })', summary: '在正文上划一条注解（挂在节点上；一个词一条，重复写即覆盖）', availability: 'always' },
    ],
  },
  {
    key: 'node',
    label: '节点 · node / description',
    intro: '一次编排可以同时操作多个节点；本目标内标题唯一，写标题一定指得明白。',
    items: [
      { name: 'node.list', signature: 'node.list()', summary: '全部节点：路径、id、标题、状态、描述摘要、文档字数、掌握度', availability: 'always' },
      { name: 'node.read', signature: 'node.read(path)', summary: '单个节点详情（含上级与各笔记字数）', availability: 'always' },
      { name: 'node.title', signature: 'node.title(path)', summary: '读标题', availability: 'always' },
      { name: 'node.rename', signature: 'node.rename(path, 新标题)', summary: '改名（数据目录名跟着变）', availability: 'always' },
      { name: 'node.update', signature: 'node.update(path, { title?, description?, status? })', summary: '改标题 / 描述 / 状态（learning | mastered）', availability: 'always' },
      { name: 'node.create', signature: 'node.create({ parent, title, description? })', summary: '建下级节点；parent 必填（标题 / 路径 / #id，不再隐式当前节点）；同名复用不重复建；创建时教学文档与大纲两份文件同时就位', availability: 'always' },
      { name: 'node.move', signature: 'node.move(path, 新父节点)', summary: '迁移节点到另一个节点之下（改父线；目标的根不能移、跨目标不能移、不能移成环）', availability: 'always' },
      { name: 'node.delete', signature: 'node.delete(path)', summary: '删除节点（学习目标本身不能删）', availability: 'always' },
      { name: 'description.read', signature: 'description.read(path?)', summary: '读描述', availability: 'always' },
      { name: 'description.update', signature: 'description.update(path?, content)', summary: '写描述', availability: 'always' },
    ],
  },
  {
    key: 'state',
    label: '学习状态 · state',
    intro: '写的是「系统对这个学习者的判断」；值域校验严格，乱值会被列着可选项拒收。',
    items: [
      { name: 'state.read', signature: 'state.read(path?)', summary: '自评、掌握度、错误记忆、检验时间线', availability: 'always' },
      { name: 'state.update', signature: 'state.update(path?, { self?, by?, mastery?, note? })', summary: '改自评（四档）或掌握度（0~100），note 写依据', availability: 'always' },
      { name: 'state.mistake', signature: 'state.mistake(path?, { pattern, cause? })', summary: '记一次错误；pattern 写「错成了什么样」', availability: 'always' },
      { name: 'state.forget', signature: 'state.forget(path?, pattern?)', summary: '清掉一条（或全部）错误记忆', availability: 'always' },
      { name: 'state.check', signature: 'state.check(path?, { kind, ... })', summary: '记一次检验（probe / exam / recall）', availability: 'always' },
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
    key: 'tmp',
    label: '临时变量 · tmp',
    intro: '按节点存放、可设过期、不进上下文；体量大的中间数据放这里，只把键名带回对话。',
    items: [
      { name: 'tmp.set', signature: 'tmp.set({ key, value, ttlMs? })', summary: '存（单值上限 20 万字符，必须可 JSON 序列化）', availability: 'always' },
      { name: 'tmp.get', signature: 'tmp.get(key)', summary: '取（found + value）', availability: 'always' },
      { name: 'tmp.has', signature: 'tmp.has(key)', summary: '存在与否', availability: 'always' },
      { name: 'tmp.del', signature: 'tmp.del(key)', summary: '删除一条', availability: 'always' },
      { name: 'tmp.list', signature: 'tmp.list()', summary: '只回键名与剩余时间，不回值', availability: 'always' },
      { name: 'tmp.clear', signature: 'tmp.clear()', summary: '清空当前节点的全部临时变量', availability: 'always' },
    ],
  },
  {
    key: 'exam',
    label: '试卷 · exam',
    intro:
      '两层：一份**试卷**可以考很多次，每次是一条**考试记录**（作答、输入顺序、单题耗时、切屏、判分、错题讲解）。' +
      '考试窗口由用户自己开——你不要替他开考。读永远可用，写看阶段：有待判分（或判完缺讲解）的那一次时不能出卷，' +
      '判分与讲解要一起做完。',
    items: [
      { name: 'exam.create', signature: 'exam.create({ title?, kind, level, minutes, questions })', summary: '出一份试卷；题型 single/multiple/truefalse/fill/short；除小测外 minutes 不得低于题目数 × 2；题面按 Markdown 渲染——数学公式必须 LaTeX（$…$/$$…$$），带图题给 image（完整 SVG 源码）', availability: 'exam' },
      { name: 'exam.read', signature: 'exam.read(attemptId?)', summary: '任何时候都能调；回题目、作答、系统判分与历次考试（含每次考错的题）', availability: 'exam' },
      { name: 'exam.grade', signature: 'exam.grade({ attemptId?, passed, summary, results })', summary: '判分：客观题以系统为准，你补 comment（要先有人交卷）', availability: 'exam' },
      { name: 'exam.explain', signature: 'exam.explain({ content, attemptId? })', summary: '错题讲解（判分之后的第二步）：看历史错题定薄弱项，写进那一次考试', availability: 'exam' },
      { name: 'exam.delete', signature: 'exam.delete({ id? })', summary: '删一份试卷；只认一次都没考过的（考过的要用户在列表里删）', availability: 'exam' },
    ],
  },
  {
    key: 'res',
    label: '资源库 · res',
    intro: '本目标 static/ 下的文件，用 uuid 寻址；读图不回数据，图片直接附在下一跳。',
    items: [
      { name: 'res.list', signature: 'res.list()', summary: '全部资源（含引用数与指纹）', availability: 'always' },
      { name: 'res.info', signature: 'res.info(uuid)', summary: '单条详情', availability: 'always' },
      { name: 'res.read', signature: 'res.read(uuid, { start?, end? }?)', summary: '文本回正文；图片挂到下一步', availability: 'always' },
      { name: 'res.create', signature: 'res.create({ name, ext, content })', summary: '新建文本资源（内容相同自动复用）', availability: 'always' },
      { name: 'res.update', signature: 'res.update(uuid, { name?, description?, content? })', summary: '改名 / 描述 / 内容', availability: 'always' },
      { name: 'res.delete', signature: 'res.delete(uuid, { force? })', summary: '删除（被引用时要 force）', availability: 'always' },
      { name: 'res.refs', signature: 'res.refs(uuid?)', summary: '引用扫描', availability: 'always' },
    ],
  },
  {
    key: 'mind',
    label: '长期记忆 · mind',
    intro: '按学习目标归档、跨对话有效。记忆不会自动进上下文——需要时必须主动 read；写入一条一个主题。',
    items: [
      { name: 'mind.list', signature: 'mind.list()', summary: '全部记忆（摘要；全文要 read）', availability: 'always' },
      { name: 'mind.read', signature: 'mind.read(idOrKey)', summary: '按 id 或 key 读全文', availability: 'always' },
      { name: 'mind.write', signature: 'mind.write({ key?, text })', summary: '写入；同 key 覆盖（同主题只留最新判断）', availability: 'always' },
      { name: 'mind.delete', signature: 'mind.delete(idOrKey)', summary: '删除一条', availability: 'always' },
      { name: 'mind.clear', signature: 'mind.clear()', summary: '清空本目标的全部记忆', availability: 'always' },
    ],
  },
  {
    key: 'method',
    label: '持久化函数 · method',
    intro:
      '按学习目标归档、跨对话有效的 **js 函数源码**库。code 写成匿名 async 函数，第一个参数是 api，' +
      '其余是调用实参：((api, path, n) => { ... })。同名 create 即覆盖（那就是更新）。' +
      '超级文档里的脚本用 api.method.call(name, ...args) 调它们——写一次，处处复用。',
    items: [
      { name: 'method.create', signature: 'method.create({ name, code })', summary: '新建/覆盖一个函数；语法在创建时就编译校验', availability: 'always' },
      { name: 'method.list', signature: 'method.list()', summary: '全部函数（名字、体量、更新时间；不带源码）', availability: 'always' },
      { name: 'method.call', signature: 'method.call(name, ...args)', summary: '执行一个函数（注入当前编排的 api），返回它的返回值', availability: 'always' },
      { name: 'method.delete', signature: 'method.delete(name)', summary: '删除一个函数', availability: 'always' },
    ],
  },
  {
    key: 'sdoc',
    label: '超级文档 · sdoc',
    intro:
      '绑定在节点上的**可交互 HTML 文档**（按钮、表单、自己的 <style>/<script>），一个节点可以有好几份，' +
      '名字即身份，write 同名覆盖。渲染在沙箱化的 iframe 里：脚本永远不跑在应用页面本身，' +
      '脚本里唯一的对外通道是 api.method.call(...)。写完用 api.ui.superdoc(path, name) 打开给用户。' +
      '内置 <moji-markdown> 元素可直接写 markdown（自动渲染）；[文字](moji:super/文档名) 点击跳到本节点的另一份超级文档。',
    items: [
      { name: 'sdoc.list', signature: 'sdoc.list(path?)', summary: '该节点的全部超级文档（名字、体量、更新时间）', availability: 'always' },
      { name: 'sdoc.read', signature: 'sdoc.read(path?, name)', summary: '读一份的 HTML 源码', availability: 'always' },
      { name: 'sdoc.write', signature: 'sdoc.write(path?, name, html)', summary: '写入（同名覆盖、没有就新建）；名字省略给默认名', availability: 'always' },
      { name: 'sdoc.delete', signature: 'sdoc.delete(path?, name)', summary: '删除一份', availability: 'always' },
    ],
  },
  {
    key: 'outline',
    label: '目标大纲 · outline',
    intro:
      '每个节点一份的**结构化计划**（导语 + 一层子目标），不是 Markdown——页签里打开是交互页面，' +
      '条目带着学习情况、可以展开（读的是子目标自己的大纲）。深度规矩是硬性的：只写直接子层级一层，' +
      '「爷爷知道儿子的存在，但不知道孙子的存在」。',
    items: [
      { name: 'outline.read', signature: 'outline.read(path?)', summary: '读大纲 → { intro, children:[{ key, title, summary }] }；还没写过时回 null（不是错误）', availability: 'always' },
      { name: 'outline.write', signature: 'outline.write(path?, { intro, children:[{ title, summary }] })', summary: '整份写入（覆盖）；key 由标题自动生成，children 最多 24 条、只此一层', availability: 'always' },
    ],
  },
  {
    key: 'wf',
    label: '工作流 · wf',
    intro:
      '三级任务模板（内置 / 全局 / 目标级）的登记处：它们**不进系统提示词**，被触发（用户在界面上点）时，' +
      'instruction 才作为一条 user 消息整段进入上下文。用户说「把这套流程做成工作流」就用 wf.create 落地。' +
      '没有 wf.run——触发永远由用户在界面上点。',
    items: [
      { name: 'wf.list', signature: 'wf.list()', summary: '全部工作流（内置 + 全局 + 当前目标），带 id、分级与完整指令', availability: 'always' },
      { name: 'wf.create', signature: 'wf.create({ name, instruction, description?, tier?, prompt? })', summary: '登记一条工作流；instruction 写成能独立执行的步骤清单，tier 缺省 goal（global 则所有目标可用）；prompt（可选）是每次触发都要在场的规程知识——按 wf:<id> 作键、同一上下文只注入一次，之后触发只发 instruction；同名覆盖', availability: 'always' },
      { name: 'wf.remove', signature: 'wf.remove(idOrName)', summary: '删除一条登记的工作流（内置的删不掉）', availability: 'always' },
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
    key: 'userInfo',
    label: '学习者画像 · userInfo',
    intro:
      '画像是**问出来的**、不是塞进提示词的：需要贴合这个人时自己 get 一次。缺什么就照 missing 用 ask 问，' +
      "题目上写 userInfo: '字段名'，用户提交那一刻回答直接落库——这是补全画像最省事的路子。",
    items: [
      { name: 'userInfo.get', signature: 'userInfo.get()', summary: '昵称、年龄、性别、语言、教育程度、专业背景、当前身份、工作经验、已掌握技能，外加 filled / missing（还缺哪些）', availability: 'always' },
      { name: 'userInfo.update', signature: "userInfo.update({ 字段: 值 })", summary: '增量写（只改给的字段）；认不出的字段与写不进去的值会逐条说明，不会整单丢弃', availability: 'always' },
    ],
  },
  {
    key: 'reading',
    label: '学习过程 · reading / attention / checkin / pomodoro',
    intro:
      '有效阅读记的是**事实**（会话、读到哪一节、有效时长、中断与交互），注意力评级是它的派生判断，' +
      '打卡用它出题。**阅读、注意力、打卡都按学习目标分开**（一个人同时学几门课是常态）：' +
      '这一组的 api 说的都是**当前目标**那一本账，别的目标的记录不在这条链上。' +
      '三条边界：① 时长只算「窗口在前台、页签在主位、没静坐超时」的时间；' +
      '② 评级不落盘、冷启动不给档位（样本不足时 confidence 是 low）；③ 打卡没有「直接成功」，' +
      '番茄钟是用户自己设时长与组数的纯计时器——这里只有只读的 status，没有开始与停止。',
    items: [
      { name: 'reading.get', signature: 'reading.get(path?)', summary: '该节点读到哪了：有效时长、打开次数、每份文档各节覆盖（reach<0.6 就是没读到）、最近会话', availability: 'always' },
      { name: 'reading.list', signature: 'reading.list()', summary: '当前目标里每个有记录的节点一行：未读的节、最后阅读时间、时长、文档完成情况', availability: 'always' },
      { name: 'reading.day', signature: 'reading.day(day?)', summary: '**当前目标**某个学习日（缺省今天，格式 2026-09-20）读了什么：有效时长、节点、交互印记', availability: 'always' },
      { name: 'attention.get', signature: 'attention.get(path?)', summary: '注意力评级：档位（focused/steady/fragmented/drifting/unknown）、五个维度、一句事实话、一句教学建议、建议的专注块长度 focusMinutes', availability: 'always' },
      { name: 'checkin.status', signature: 'checkin.status()', summary: '**当前目标**今天能不能打卡：有效阅读与门槛、可出题的节（题源，来自今天真正读到的内容）、还剩几次机会、建议题数与通过线；该目标下试卷首次考试及格（卷面 ≥ 60%）会自动打卡', availability: 'always' },
      { name: 'checkin.settle', signature: 'checkin.settle({ correct, total, threshold, passed, note? })', summary: '记一次**当前目标**的打卡结果：门槛与次数由系统复核（没到门槛一律不算过），note 写一句明天该补什么', availability: 'always' },
      { name: 'pomodoro.status', signature: 'pomodoro.status()', summary: '番茄钟记录（只读）：正在跑的是第几组/专注还是休息/还剩多久、今天几组多少分钟、最近七天与最近几条', availability: 'always' },
    ],
  },
  {
    key: 'review',
    label: '复习 · review',
    intro:
      '间隔复习的计划账。**计划是系统建的**：节点首次变「已掌握」时自动铺好 +1/+3/+7/+14/+30 五个阶段，' +
      '到了期没做也不顺延。你的活是带他做（先主动提取，再按阶段检查）与落账（record）；' +
      '完成不看对错——交互做完就算完成，答错的内容进错误记忆供下次复习针对。' +
      '把强相关节点的复习合到一次（merge）必须先经 ask 征得用户同意。',
    items: [
      { name: 'review.read', signature: 'review.read(path?)', summary: '这个节点的复习计划：到期阶段（侧重与逾期天数）、下次到期、补充任务、合并组成员、可合并的候选（candidates，带相关关系）、历次记录与错误记忆（fixed: false 的才是活薄弱项）', availability: 'always' },
      { name: 'review.record', signature: 'review.record({ complete, items?, missed?, mistakes?, fixed?, mastery?, note?, stage?, node?, extraId? })', summary: '落一次复习的账：完成当前（或 stage 指定的）阶段 / extraId 指定的补充任务；更早没做的阶段自动并入这一次；mistakes 记这次暴露的错法、fixed 标答对了的旧薄弱项、mastery 修正掌握度', availability: 'always' },
      { name: 'review.merge', signature: 'review.merge({ nodeIds })', summary: '把处于同一阶段的相关节点（含当前节点）的复习合成一组，后续阶段整组一起复习、落账各管各的；**必须先经 ask 征得用户同意**；拆组用 review.adjust', availability: 'always' },
      { name: 'review.extend', signature: 'review.extend({ focus, days? })', summary: '针对具体薄弱点追加一条补充复习（days 缺省 3 天后到期）；没有具体薄弱点就不要用', availability: 'always' },
      { name: 'review.adjust', signature: "review.adjust({ action: 'postpone' | 'split', days?, stage? })", summary: '调整计划：postpone 把到期日顺延几天（用户说最近忙时用）；split 退出合并组', availability: 'always' },
    ],
  },
  {
    key: 'workspace',
    label: '工作区 · workspace',
    intro:
      '节点在磁盘上的**真实目录**（users/<uid>/docs/<目标>/<节点>/workspace/，用户在系统资源管理器里' +
      '看得见、也能自己放文件进去）。路径与文档同构——节点路径在前、文件在后（极限/数据/实验.csv），' +
      '省略 path 就是当前节点。只收文本；写是整份覆盖、父目录自动建。要交付「拿得走的文件」' +
      '（整理好的资料、数据、代码）就放这里，别只留在对话里。',
    items: [
      { name: 'workspace.list', signature: 'workspace.list(path?)', summary: '列目录：节点（或节点路径 + 子目录）下真实有哪些文件与子目录（目录在前）；还没有文件时回空清单', availability: 'always' },
      { name: 'workspace.read', signature: 'workspace.read(path)', summary: '读一个文本文件；不存在会明说，二进制读不出文本，太长截断并带 totalChars', availability: 'always' },
      { name: 'workspace.write', signature: 'workspace.write({ path, content })', summary: '写一个文本文件（**整份覆盖**；父目录自动建）。回执带 created / updated——覆盖用户的真实文件前想一想', availability: 'always' },
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
      '对 ref 做受控 DOM 操作、整页转 markdown、截图。' +
      '**看 = snapshot/read（文本）优先，capture（截图）是最后手段**；dom 是受控操作（固定函数 + 值参数，' +
      '没有任意 JS 的口子），操作的是用户的真实登录会话——不可逆动作先问用户。',
    items: [
      { name: 'browser.open', signature: "browser.open('https://…')", summary: '开一个网页页签（纯关键词当搜索词）；回 tabId，返回时首屏基本加载完', availability: 'browser' },
      { name: 'browser.tabs', signature: 'browser.tabs()', summary: '全部存活的网页页签：tabId、url、标题、是否激活、所在格；browser.open 前先查它（同一网址 activate 即可，别重复开），之后一切操作按 tabId 指名', availability: 'browser' },
      { name: 'browser.snapshot', signature: 'browser.snapshot(tabId?)', summary: '页面快照：可交互元素列成带 ref 的清单（role + 名称 + 输入值，≤200 条）——认结构、找要点的元素全靠它；DOM 变了 ref 会过期，重新 snapshot 即可', availability: 'browser' },
      { name: 'browser.activate', signature: 'browser.activate(tabId)', summary: '把某个页签切到前台', availability: 'browser' },
      { name: 'browser.close', signature: 'browser.close(tabId)', summary: '关掉某个页签（不弹确认——用户没让关就别关）', availability: 'browser' },
      { name: 'browser.point', signature: 'browser.point(tabId?, 目标)', summary: '页面像锚点跳转一样滚到目标元素（{ ref } 或选择器），并注入短暂的脉冲高亮把它标出来——指给用户看、或自己确认位置', availability: 'browser' },
      { name: 'browser.dom', signature: 'browser.dom(tabId?, ref, op, arg?)', summary: '对 snapshot 清单里的 ref 做受控 DOM 操作：op = "click" / "fill"(文字，触发 input/change) / "focus" / "submit"(所在表单) / "text"(元素文字 ≤4000 字) / "attr"(属性名)；result 回操作自己的小结果', availability: 'browser' },
      { name: 'browser.read', signature: 'browser.read(tabId?)', summary: '整页转 markdown（与 webFetch 同一条管线）：短的回全文，长的落盘回大纲树（每节字数）+ uuid，再用 web.read 按节读——登录态页面也能读', availability: 'browser' },
      { name: 'browser.capture', signature: 'browser.capture(tabId?)', summary: '页面截图 → 存进资源库并附在下一跳（与 ui.screenshot 同一条通道）——**最后手段**：snapshot/read 拿不到的信息才用它', availability: 'browser' },
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
      { name: 'ui.switchMain', signature: "ui.switchMain('agent' | 'doc')", summary: '交换主栏：把对话栏或文档栏放到用户视线的主位', availability: 'ui' },
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
]
