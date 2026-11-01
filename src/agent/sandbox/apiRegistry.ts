/**
 * 这个文件负责什么：**execute 沙箱 api 的唯一注册表**。
 *
 * 一条 api 在这里登记三样东西：签名、一句话作用、完整用法（含示例）。
 * `wrapApi` 只接受登记过的名字；Worker 的可用名单、`__help()` 的正文、
 * 系统提示词里的 api 集索引、设置页的 api 目录，全部从这张表派生——
 * 实现与文档不再各写一份。
 *
 * 纪律：
 * - **名字是主键**：`node.read` 这种全名只出现一次；改名等于换一条 api。
 * - **用法必须能照着写**：示例用 `api.` 前缀，且是完整的可执行表达式。
 * - **不登记就不存在**：`wrapApi` 遇到未登记的名字会当场抛错（测试与运行都拦）。
 * - **应用数据不写文件路径**：doc / state / outline / exam / sdoc / wf / method
 *   的用法里只出现对应 api，不教模型拼 `*.json`。
 * - **旧写法组标 `legacy`**：等价的新组是唯一被宣传的入口（系统提示词组索引与
 *   根 help 只列非 legacy 组）；legacy 组仍登记、仍可调用（老对话的历史里还有它的
 *   调用），直查 `api.<组>.__help()` 也照常——只是不再向模型推荐。
 */

export interface ApiDoc {
  /** 组内方法名，如 `read` */
  name: string
  /** 全名，如 `node.read`；顶层函数就是名字本身 */
  full: string
  /** 给人看也给模型抄的签名 */
  signature: string
  /** 一句话作用（组列表里用） */
  summary: string
  /** 完整用法：何时用、边界、常见坑 */
  usage: string
  /** 参数说明（可选） */
  params?: string
  /** 返回形状（可选） */
  returns?: string
  /** 主示例（必填） */
  example: string
  /** 附加示例 */
  examples?: string[]
}

export interface ApiGroupDoc {
  key: string
  label: string
  /** 系统提示词里的一行索引 */
  intro: string
  /** `__help()` 里的组说明 */
  usage: string
  /** 组级示例（可选） */
  example?: string
  /** 旧写法兼容组：不再进系统提示词组索引与根 help（见文件头纪律） */
  legacy?: boolean
  /** legacy 组的替换写法说明（renderGroupHelp 的旧写法提示；不给则指向 content.*） */
  legacyNote?: string
  apis: ApiDoc[]
}

type ApiSeed = Omit<ApiDoc, 'full'> & { full?: string }

const a = (
  name: string,
  signature: string,
  summary: string,
  usage: string,
  example: string,
  extra: Partial<ApiSeed> = {},
): ApiSeed => ({ name, signature, summary, usage, example, ...extra })

const g = (
  key: string,
  label: string,
  intro: string,
  usage: string,
  apis: ApiSeed[],
  example?: string,
  extra: Partial<Pick<ApiGroupDoc, 'legacy' | 'legacyNote'>> = {},
): ApiGroupDoc => ({
  key,
  label,
  intro,
  usage,
  ...(example ? { example } : {}),
  ...extra,
  apis: apis.map((x) => ({
    ...x,
    full: x.full ?? (key === 'core' ? x.name : `${key}.${x.name}`),
  })),
})

/**
 * 全部 api 集。顺序就是系统提示词与设置页里的展示顺序：
 * 先学习数据（最常用），再工具，再运行时设施。
 */
export const API_GROUPS: ApiGroupDoc[] = [
  /* ---------- 执行控制（顶层函数） ---------- */
  g(
    'core',
    '执行控制',
    'wait / ask / tiktok / help / compact / fetch / see：顶层函数，不挂在某个组下。',
    `这一组不是对象，直接写在 api 上：
- api.wait(ms)：睡一会儿（0~120000ms），只在等页面/等用户时用。
- api.ask({ title?, questions })：弹表单并阻塞到用户提交；每题 { type: 'single'|'multiple'|'short', prompt, options?, when?, userInfo? }。
- api.tiktok()：响一声提示音。
- api.help()：api 集总览（与 api.__help() 同义）。
- api.compact({ summary, tasks? })：提交交接摘要；本轮结束后生效。
- api.fetch(url | { url } | urls[] + { maxChars? })：抓网页转 Markdown（等同 api.web.fetch）；给数组 = 并发批量（一次最多 5 篇，逐条返回、失败不拖累其他篇），maxChars 直接截好。
- api.see(图片地址 | base64 | { url?, base64?, mime?, name? } | { pdf?, page? })：看一张图或一份 PDF 的指定页，它们附在你的下一步里。`,
    [
      a('help', 'help()', 'api 集总览', '任何时候都能调。返回的是组名与一句说明，不含具体签名；具体用法用 api.<组>.__help()。', 'const overview = await api.help()'),
      a('wait', 'wait(ms | { seconds })', '等一段时间再继续', '等异步结果、等页面加载、等用户操作时用；上限 120 秒。纯计算不要用它拖时间。', 'await api.wait(800)'),
      a(
        'ask',
        'ask({ title?, questions })',
        '弹结构化表单并阻塞到用户作答',
        '题目类型 single / multiple / short；options 2~8 项；when 做联动；userInfo 让答案直接写进画像。用户取消回 cancelled:true，超时回 timedOut:true。',
        `const r = await api.ask({
  title: '确认难度',
  questions: [{ type: 'single', prompt: '这次想练哪一档？', options: ['基础', '进阶', '挑战'] }],
})`,
      ),
      a('tiktok', 'tiktok()', '响一声系统提示音', '需要把用户视线叫回来时用；不要连续响。', 'await api.tiktok()'),
      a('compact', 'compact({ summary, tasks? })', '提交上下文交接摘要', '只在本轮是压缩轮时调用；summary 是正文摘要，tasks 是未完成事项。本轮结束后旧消息才失活。', `await api.compact({ summary: '## 已讲清\\n- 极限的定义', tasks: ['继续讲夹逼定理'] })`),
      a('fetch', 'fetch(url | { url } | urls[], { maxChars? })', '抓网页并转 Markdown（web.fetch 的别名）；数组 = 并发批量', '与 api.web.fetch 完全等价，提示词里教的就是这个名字。回 { ok, title, content, error? }，失败不抛异常，先判 ok；批量给数组（一次最多 5 篇，回 { ok, results: [...] }，一篇失败只标记它自己）；maxChars 直接截好，省掉自己 slice。', `const pages = await api.fetch([url1, url2], { maxChars: 6000 })`),
      a(
        'see',
        'see(url | base64 | { url?, base64?, mime?, name? } | { pdf?, page?, name? })',
        '看一张图或一份 PDF 的指定页（附在你的下一步里）',
        '需要亲眼看一样东西时用：网页或接口里发现的图片链接、代码/文件里的 base64 图片、工作区文件里的 data URL、' +
          '论文/讲义/扫描件 PDF 里的图表与排版。图片走图像通道（与 res.read 读图同一机制），回执本身不含图片内容，' +
          '不要把 base64 写进返回值。字符串收三种写法：http(s) 图片地址、data:image/...;base64,...、裸 base64（按 mime 参数或魔数认格式）。' +
          '**看 PDF 用 { pdf, page }**：pdf 收 http(s) 地址、资源库引用 moji:static/<uuid>（先 res.list() 找）' +
          '或相对用户的文件路径；page 从 1 起，单个或数组（一次最多 4 页），省略看第 1 页——只渲染页面为图，不提供文字层；' +
          '个别字体未内嵌的 CJK PDF 可能缺字。图片上限 12MB、PDF 上限 32MB，过大的图先压缩到长边 1568 再入库；' +
          '同内容的图自动复用资源库已有那条。多页内容逐页调，先看你最需要的那几页。',
        `const r = await api.see('https://example.com/chart.png')
if (r.ok) { /* 图片已在你的下一步里，直接描述它即可 */ }
const p = await api.see({ pdf: 'moji:static/<uuid>', page: [1, 3] })`,
      ),
    ],
  ),

  /* ---------- 学习数据 ---------- */
  g(
    'node',
    '节点宇宙',
    'api.node.list() 查全图（带 uuid）→ get(uuid) 取节点对象 → help() 现查写法 → content 读 / editContent 写 / connect 连线。',
    `节点是学习数据的全部骨架：**文档**（讲义）、**大纲**（计划）、**笔记**、**试卷**、**超级文档**、**项目**（真实路径的授权声明）、**入口**——每一种都是节点，uuid 是唯一身份（api.node.list() 的回执里全带）。读写内容、建删节点、连线全部经由节点对象：

    const list = await api.node.list()            // 全图清单（uuid / 标题 / path / 挂件）
    const n = await api.node.get(list.nodes[0].uuid)
    const h = await n.help()                      // 这个节点自己的内容格式与连接规则
    const c = await n.content                     // 当下内容（整份快照）
    await n.editContent({ ...c, teaching: 新正文 })  // 整份写回（先读后写）
    const o = await api.node.get('o:' + 文档uuid)   // 大纲；入口是 'entry:' + 根文档uuid
    await o.connect(子文档对象, 'down')             // 把子文档挂到这一层（唯一可手工建立的连接）

对象成员**全类型同构**：content / editContent / help / connect / disconnect。规矩：
- editContent 是**整份替换**：先 await n.content 读现状，改字段，再整份写回——不要凭记忆默写；
- help() 随节点状态与上游**动态变化**（空卷讲出题格式、空文档讲写作纪律）——动手前必看；
- 挂件（笔记 / 试卷 / 超级文档）创建即挂：api.node.create({ kind, title, under: 文档uuid })，不能改挂；
- 连接里只有「大纲 → 文档」是手工的：connect(文档, 'down') 挂上、disconnect 摘下；
- 编排代码可以直接写 TypeScript。`,
    [
      a('list', 'node.list()', '目标的全图清单', '回 goal（含入口 uuid）与 nodes：每份文档带 uuid / 标题 / path / 状态 / 上游 / 大纲（目标项数）/ 笔记 / 试卷 / 超级文档（各带 uuid）；另有 projects 段（已声明的项目路径，配 api.project.* 用）。导航、找落点、核对存在性全靠它。', 'const list = await api.node.list()'),
      a('get', 'node.get(uuid)', '取一个节点对象', '回执在门面里被包成真对象（content / editContent / help / connect / disconnect）。uuid 全部来自 list()，不要手拼——大纲与入口的前缀规则 help() 里会讲。', "const n = await api.node.get(list.nodes[0].uuid)"),
      a('create', 'node.create({ kind, title?, under? , ...? })', '建节点（画布与 agent 同一条通道）', 'kind: doc / outline / note / exam / superdoc / video / project。doc 支持 root: true 设为目标根节点（目标尚无根节点时首个 doc 自动成根）。under 给了 = 创建即绑（挂件挂到那份文档、文档挂进大纲或视频节点之下，同目标同名文档复用不另建）；under 不给 = **独立游离实体**（笔记/超级文档进游离池、试卷宿主悬空、文档无父无纲），之后拖线 / connect 绑定。outline 配宿主文档一起成形：不给 under 就建「新文档+空大纲」，给了 under 就给那份文档补空卷大纲。试卷遇空壳复用原位。video 绑视频：不给 under 建，建好 editContent({ videoId }) 绑一个现有视频（清单在 list() 的 videos.all）。project 声明真实路径：{ kind: "project", path, under?: 文档uuid }——path 必给，拼法由路径自己说（盘符或 / 开头 = 绝对，其余相对目标根目录），声明之后 api.project.* 就能读写它下面的所有文件（清单在 list() 的 projects 段）。', `await api.node.create({ kind: 'note', title: '错题本', under: 文档uuid })`),
      a('delete', 'node.delete(uuid)', '删节点（删谁只删谁）', '删文档只删它自己：相连的线摘掉、下游文档断线成游离（不删除）、名下的笔记/试卷/超级文档随它走；删大纲 = 清空那份计划（文档与树边不动）；删挂件只删它自己。删试卷走 api.exam.delete（要先确认没有待判分的考试）。', `await api.node.delete(笔记uuid)`),
      a('invoke', 'node.invoke(uuid, 成员名, 参数数组)', '调节点对象的成员', '门面自动走它（n.editContent(...) 最终就是一次 node.invoke）；connect / disconnect 的对象参数会被折成 uuid。直接调时参数是数组形状。', `await api.node.invoke(文档uuid, 'editContent', [{ title: '极限', description: '', teaching: '# 极限', status: 'learning' }])`),
      a('brief', 'node.brief(uuid)', '文档的一页纸简报（写正文之前先看它）', '一次给齐：self（标题/描述/状态/字数）、port（认领的目标项——范围与边界以它为准）、siblings（同层其他目标项）、taught（全图各文档已讲过的小节标题——出现过的概念别重讲）。省掉 list 全图 + 逐个读。', `const brief = await api.node.brief(文档uuid)`),
      a('finish', 'node.finish(uuid, { content?, memory?, delivery?, open? })', '收尾仪式一次做完', '写完文档的四件事（editContent / memory.create / delivery.submit / 指给用户看）一个调用。content 先落：它失败就直接回、其余全不做；其余步骤逐个落、逐个如实报告（steps 里哪步没落上就单独补一次）。', `await api.node.finish(uuid, { content, memory: { type: 'work', title: '本轮进度', content: '讲完夹逼定理' }, delivery: { sources }, open: true })`),
      a('setRoot', 'node.setRoot(docUuid)', '指定目标的根文档节点', '将指定的文档节点设为当前目标的根文档，建立目标入口指针 entry 与默认工作区/UI 挂载基准。当 node.list() 中 root 为 null 时调用。', 'await api.node.setRoot(doc.uuid)'),
    ],
    `const list = await api.node.list()
const doc = list.nodes.find((n) => n.title === '极限')
if (doc) {
  const n = await api.node.get(doc.uuid)
  await n.help()                       // 先看这个节点自己怎么说
  const c = await n.content
  await n.editContent({ ...c, teaching: c.teaching + '\\n\\n## 补充' })
}`,
  ),
  g(
    'memory',
    '记忆',
    '跨对话的记忆：工作记忆（本目标）/ 长期记忆（跨目标）的增删改查。',
    `记忆**不会自动进上下文**：需要时自己 list / get。两种类型分工明确，别混着用：
- type:'work'（工作记忆，默认）：这个目标里「发生了什么 / 要做什么 / 怎么做 / 过程怎么样 / 结果怎么样」。
  只有本目标的会话读得到；你觉得某条已经是负担了，直接 delete（不需要确认）。
- type:'long'（长期记忆）：聊天里对用户的印象、作息、重要约定。任何目标都读得到，
  删除要显式确认：api.memory.delete(uuid, { confirm: true })。
一条记忆一个主题：title 一行说清是什么，content 写细节，keys 给检索用的关键词。
同一条要补充就用 update 改，不要另开一条重复的。`,
    [
      a('list', 'memory.list({ type? }?)', '列记忆条目', '回 count / long / work 与每条摘要（不含全文）；type 可只列一类。', `const mem = await api.memory.list({ type: 'long' })`),
      a('context', 'memory.context({ scope?, maxChars? })', '一页纸：最近的几条记忆摘要', '开场先领一页（画像、路线这类跨轮不变的东西都在里面），省掉 list + 逐条 get 两步。scope: work（默认，本目标）| long；默认截到 600 字。', `const ctx = await api.memory.context({ scope: 'work', maxChars: 600 })`),
      a('get', 'memory.get(uuid)', '读一条记忆全文', '按 uuid 取 title / keys / content / 时间；看不见的条目按「没有」处理。', `const one = await api.memory.get(mem.items[0].uuid)`),
      a('create', 'memory.create({ type, title, keys?, content })', '新建一条记忆', 'type: work（本目标）| long（跨目标）；title 省略时取正文首行。', `await api.memory.create({ type: 'work', title: '本轮进度', keys: ['极限', '进度'], content: '讲完夹逼定理，下一轮做两道放缩题。' })`),
      a('update', 'memory.update(uuid, { title?, keys?, content?, type? })', '更新一条记忆', '只改给了的字段；改 type 等于搬家（work ↔ long）。', `await api.memory.update(one.uuid, { content: '补充：放缩方向还会错。' })`),
      a('delete', 'memory.delete(uuid, { confirm? }?)', '删除一条记忆', '工作记忆直接删；长期记忆必须 { confirm: true }，否则回一句说明。', `await api.memory.delete(one.uuid)`),
    ],
    `// 先看有哪些，再决定记什么
const mem = await api.memory.list()
if (!mem.items.some((x) => x.title === '用户的作息')) {
  await api.memory.create({ type: 'long', title: '用户的作息', keys: ['作息'], content: '习惯凌晨 1 点后学习，上午回消息慢。' })
}`,
  ),
  g(
    'schedule',
    '日程安排',
    '给用户排日程：列、新建、修改、完成、删除；到点由宿主响铃提醒。',
    `日程是**给用户的提醒**，不是你自己要执行的计划：写进去之后到点由宿主响铃、在顶栏弹出事项，
用户自己确认或让它隔一阵再提醒——你既不要替用户确认，也不要 sleep 等着它到点。
时间用 "HH:mm"，date 用 "YYYY-MM-DD"；date 省略就是今天（那个时间今天已过就顺延到明天，回执会说明）。
remindBefore 是提前多少分钟提醒，默认 0（准点）。
排之前先 api.schedule.list() 看今天已经有什么，同一件事别排两遍；一次别排一大堆。`,
    [
      a('list', 'schedule.list({ from?, to?, days? }?)', '列出一段日期里的日程', '默认今天起 7 天；回每条的 id / 日期 / 时间 / 标题 / 是否完成 / 提醒方式。', `const s = await api.schedule.list({ days: 3 })`),
      a('create', 'schedule.create({ title, date?, time, minutes?, remindBefore?, note? })', '安排一条日程', 'title 与 time 必填；date 省略=今天。minutes 是时长（只用于展示），remindBefore 默认 0。回 id 与提醒时刻。', `await api.schedule.create({ title: '复习夹逼定理', date: '2026-10-20', time: '19:30', minutes: 45, remindBefore: 10 })`),
      a('update', 'schedule.update(id, { title?, date?, time?, minutes?, remindBefore?, note?, done? })', '改一条日程', '只改给了的字段；done:true 等于标记完成（不再提醒）。', `await api.schedule.update(id, { time: '20:00' })`),
      a('complete', 'schedule.complete(id)', '标记完成', '完成之后不再提醒；这是「这件事办完了」的落账。', `await api.schedule.complete(id)`),
      a('remove', 'schedule.remove(id)', '删除一条日程', '不可逆；用户明确不要了才删。', `await api.schedule.remove(id)`),
    ],
    `// 排一条之前先看看今天已经有什么
const today = await api.schedule.list({ days: 1 })
if (!today.items.some((x) => x.title.includes('复习'))) {
  await api.schedule.create({ title: '复习夹逼定理', time: '19:30', minutes: 45, remindBefore: 10 })
}`,
  ),
  g(
    'tmp',
    '临时变量',
    '当前节点作用域的临时数据：大块中间结果、跨调用传递。',
    `tmp.* 按当前节点存放，不进上下文。适合把浏览器/搜索拿到的大 JSON 暂存起来，
只在编排里取用。不要拿它当长期存储——长期数据用 doc / state / res。`,
    [
      a('set', 'tmp.set({ key, value, ttlMs? })', '存一个临时值', 'value 可以是任意可结构化克隆的值；ttlMs 到期自动清。', `await api.tmp.set({ key: 'searchRaw', value: results })`),
      a('get', 'tmp.get(key)', '取一个临时值', '回 { key, found, value }；没有时 found:false，不抛异常。', `const raw = await api.tmp.get('searchRaw')`),
      a('has', 'tmp.has(key)', '是否存过', '回 { key, found }。', `const hit = await api.tmp.has('searchRaw')`),
      a('del', 'tmp.del(key)', '删一个临时值', '回 { key, deleted }。', `await api.tmp.del('searchRaw')`),
      a('list', 'tmp.list()', '列当前节点的临时值', '回 { items: [{ key, chars, remainingMs, ... }] }。', `const list = await api.tmp.list()`),
      a('clear', 'tmp.clear()', '清空当前节点的临时值', '回 { removed }。', `await api.tmp.clear()`),
    ],
  ),
  g(
    'exam',
    '考试（作答侧）',
    '读卷、判分、写错题讲解、删卷——出题走节点宇宙（api.node.create + editContent）。',
    `试卷是节点宇宙的一员：出题 = api.node.create({ kind: "exam", under: 文档uuid }) 建卷（或复用画布上的空壳）→ const n = await api.node.get(卷uuid) → await n.help() 看题目格式 → n.editContent({ questions }) 落卷。
exam.* 只管**作答侧**：交卷后 exam.read() 看作答，exam.grade(...) 判分，exam.explain(...) 写讲解。
读任何时候都能调；判分与讲解受阶段约束（有卷待收尾时不能删）。用户作答事实（answers/inputs/dwell/blurs）严禁改写。`,
    [
      a('read', 'exam.read(attemptId?)', '读试卷与作答', '不给 attemptId 读最新一份；回题目、历次 attempts、判分与讲解状态。没有卷子也是一种答案（不是失败）。', `const paper = await api.exam.read()`),
      a('grade', 'exam.grade({ attemptId?, passed?, summary?, results })', '判分并落账', 'results 每项 { questionId, correct, score, maxScore, comment, by }；passed 决定节点是否标记已掌握。只改评价层，不改用户作答事实。', `await api.exam.grade({ passed: true, summary: '基础题全对，放缩方向还需巩固。', results: [{ questionId: 'q1', correct: true, score: 1, maxScore: 1, comment: '正确', by: 'agent' }] })`),
      a('rotateSheet', 'exam.rotateSheet({ sheetIndex?, degrees?, attemptId? })', '顺时针旋转整张手写答卷', '若用户拍照角度横置或颠倒，在裁切前将整张答卷转正（degrees 默认 90，可选 90/180/270）。转正后会自动在下一跳将正向图片附带回给模型确认。', `await api.exam.rotateSheet({ sheetIndex: 0, degrees: 90 })`),
      a('previewCrop', 'exam.previewCrop({ questionId, box, sourceImage?, attemptId? })', '裁切定位红框预检', '在原图上画出拟裁切的醒目红色线框并附带回传给模型视觉审查。模型审查是否存在题干截断、公式缺失或范围偏大/偏小，若不理想继续调整 box 再次预检，满意后再调用 cropAnswer 正式裁切。', `await api.exam.previewCrop({ questionId: 'q1', box: [120, 50, 480, 950] })`),
      a('cropAnswer', 'exam.cropAnswer({ questionId, box, sourceImage?, attemptId? })', '裁切手写答案并贴在对应题目上', '将手机拍摄答卷中的特定题目手写区域裁切下来，贴在对应题目上回看。box 为 [ymin, xmin, ymax, xmax]（0~1000 范围，如 [120, 50, 480, 950]）或 { x, y, width, height }。', `await api.exam.cropAnswer({ questionId: 'q1', box: [100, 50, 450, 950] })`),
      a('explain', 'exam.explain({ content, attemptId? })', '写错题讲解', '判分之后的第二步，落在同一次考试上；content 是 Markdown 讲解，写完自动打开试卷副本。', `await api.exam.explain({ content: '## 错题解析\\n\\n第 2 题错在……' })`),
      a('delete', 'exam.delete({ id? })', '删一份没考过的卷子', '考过的卷子是学习记录，agent 删不掉；只清理空卷/废稿。', `await api.exam.delete({ id: 'ex_xxx' })`),
    ],
  ),
  g(
    'res',
    '资源库',
    '目标 static/ 下的图片、PDF、附件：清单、详情、读、建、改、删、引用扫描。',
    `资源文件按 uuid 命名，文档里用 ![说明](moji:static/<uuid>) 引用。
读图片不会回 base64——图片会挂到下一跳；文本可以分段读。`,
    [
      a('list', 'res.list()', '列本目标全部资源', '回 uuid、名称、类型、大小、引用数。', `const assets = await api.res.list()`),
      a('info', 'res.info(uuid)', '单条资源详情', '回名称、类型、大小、描述、引用。', `const info = await api.res.info('a1b2c3')`),
      a('read', 'res.read(uuid, { start?, end? }?)', '读一份资源', '文本回内容（可给区间分段）；图片走图像通道挂到下一跳；其它二进制只回元数据。', `const text = await api.res.read('a1b2c3')`),
      a('create', 'res.create({ name, ext, content })', '新建文本资源', '只收文本；二进制资源用界面或文件工作区。', `await api.res.create({ name: '参考提纲', ext: 'md', content: '# 提纲' })`),
      a('update', 'res.update(uuid, { name?, description?, content? })', '改资源元数据或文本', '改名只动清单不动文件；改 content 会覆盖原文本，先 res.read 确认再动手。', `await api.res.update('a1b2c3', { description: '课程讲义截图' })`),
      a('delete', 'res.delete(uuid, { force? }? )', '删除一份资源', '还被引用时必须 force:true；不可逆，删除前先 res.refs 看引用面。', `await api.res.delete('a1b2c3')`),
      a('refs', 'res.refs(uuid?)', '引用扫描', '给 uuid 查这一条被谁引用；不给就列全部资源。', `const refs = await api.res.refs('a1b2c3')`),
    ],
  ),
  g(
    'workspace',
    '工作区',
    '当前节点 workspace/ 目录：列、读文本、写文本。',
    `工作区是用户交付物的落点（代码、报告、数据）。只收文本；路径写法与 doc 同构：
'极限/实验/数据.csv' 指该节点工作区下的文件，省略 path 是当前节点。`,
    [
      a('list', 'workspace.list(path?)', '列工作区目录', '目录不存在时回空清单，不是错误。', `const files = await api.workspace.list('极限')`),
      a('read', 'workspace.read(path?)', '读工作区文本文件', '太长会截断并带 totalChars。', `const code = await api.workspace.read('极限/实验/main.py')`),
      a('write', 'workspace.write({ path, content })', '写工作区文本文件', '整份覆盖，父目录自动建。交付物一律写这里。', `await api.workspace.write({ path: '极限/实验/main.py', content: 'print(1)' })`),
    ],
  ),
  g(
    'userInfo',
    '学习者画像',
    '昵称、年龄、教育程度、专业背景、当前身份、技能等。',
    `画像不进系统提示词；要贴合这个人时自己 get 一次。update 是增量语义，
只写传进来的字段。头像是展示字段，不从这里读写。`,
    [
      a('get', 'userInfo.get()', '读学习者画像', '回给模型看的那份（不含头像）；没有当前用户时回 error。贴合个人讲解前先取一次。', `const me = await api.userInfo.get()`),
      a('update', 'userInfo.update({ 字段: 值 })', '增量更新画像', '认不出的字段会逐条说明；不要一次传一堆没把握的值。', `await api.userInfo.update({ major: '计算机科学', level: '本科' })`),
    ],
  ),
  g(
    'method',
    '持久化函数',
    '目标级可执行函数源码：列表、创建/覆盖、删除、调用。',
    `method 存的是可执行代码，name 就是身份，同名 create 即覆盖。
超级文档里的按钮也只能通过 api.method.call 干活。`,
    [
      a('list', 'method.list()', '列已有函数清单', '回名字、体量与更新时间，不回源码；调用前先看有没有同名函数。', `const fns = await api.method.list()`),
      a('create', 'method.create({ name, code })', '新建/覆盖函数', 'code 是匿名函数源码，第一个参数是 api；创建时编译校验。', `await api.method.create({ name: '统计句号', code: '((api, path) => { const d = api.files.read; return 0 })' })`),
      a('delete', 'method.delete(name)', '删除一个持久化函数', '不可逆；正在被超级文档按钮调用的函数删掉会失效，删前告知用户。', `await api.method.delete('统计句号')`),
      a('call', 'method.call(name, ...args)', '执行函数', '注入当前编排的 api；返回函数返回值。', `const n = await api.method.call('统计句号', '极限')`),
    ],
  ),
  g(
    'wf',
    '工作流',
    '内置/全局/目标级工作流：列表、详情、登记、删除、触发。',
    `工作流存的是指令文本，不是可执行代码。wf.invoke 只排队：本轮收口后
宿主另起一轮，instruction 才作为 user 消息进入上下文。不要在 invoke 之后自己照着流程先做一遍。`,
    [
      a('list', 'wf.list({ full?, brief? }?)', '列可用工作流', '默认简略（只给 id/name/tier/description/chars）；full:true 带完整指令。', `const flows = await api.wf.list()`),
      a('get', 'wf.get(idOrName)', '看一条工作流的完整定义', '回 instruction、params 与说明；不含 prompt 规程正文（它在触发时注入）。', `const flow = await api.wf.get('开讲')`),
      a('create', 'wf.create({ name, instruction, description?, prompt?, tier? })', '登记/覆盖工作流', 'instruction 必填；prompt 是可选规程（同上下文只注一次）；tier 省略=目标级，global=跨目标。同名同级覆盖。', `await api.wf.create({ name: '课前摸底', instruction: '第一步：用 api.ask 摸底；第二步：按盲点把讲义写进节点（n.editContent）。' })`),
      a('remove', 'wf.remove(idOrName)', '删除一条登记工作流', '内置工作流删不掉；删除后设置里的工作流列表同步消失。', `await api.wf.remove('课前摸底')`),
      a('invoke', 'wf.invoke(idOrName, { params? })', '触发一条工作流', '不对：它只排队。回执说「已排队」就不要再调、也不要自己做。一次编排最多排一条，链上最多连三条。', `await api.wf.invoke('出卷', { params: { node: '极限' } })`),
    ],
  ),
  g(
    'code',
    '代码块伪编译',
    '把文档里那段代码转译成可运行 JS 的交付口。',
    `用户点代码块上的「编译」时，工作流会带着 key / 语言 / 代码进来。
转译完用 code.save 交货；只有定义、没有输出的代码用 code.silent 标停。`,
    [
      a('save', 'code.save({ key, js, note })', '交付伪编译产物', 'key 原样抄；js 必须完整、自包含、能在 Web Worker 跑；note 写补了哪些假设。', `await api.code.save({ key: 'abc123', js: 'console.log(1)', note: '补了一个假数据数组' })`),
      a('silent', 'code.silent({ key, reason })', '标记这段代码没有输出', '只有定义/接口/常量的代码块走这里；reason 一句话说清。', `await api.code.silent({ key: 'abc123', reason: '只有类型与函数定义，没有被调用的语句' })`),
    ],
  ),
  g(
    'chip',
    '引用 chip',
    '生成与校验回复里的可点击引用卡片。',
    `不要手拼 chip 的 path；build 会当场对 store 解析并带上 nodeId。
交付前用 check 把草稿里的 chip 逐颗验一遍。`,
    [
      a('build', 'chip.build({ type, path?, url?, note?, name?, examId?, attemptId?, dir?, title? })', '生成一颗引用 chip', 'type: doc / note / outline / super / exam / attempt / ws / web / local。定位不到回 ok:false 与原因。', `const c = await api.chip.build({ type: 'doc', path: '极限' })`),
      a('check', 'chip.check(text)', '校验文本里的全部 chip', '回 { total, valid, invalid, problems? }；坏的用 build 重新生成。', `const r = await api.chip.check(draft)`),
    ],
  ),
  g(
    'delivery',
    '交付登记',
    '把这一轮的文件变动与参考引证登记到消息底部（一行一条，溢出省略）。',
    `只在**确实交付了东西**时调：写完或改完文档、讲义、大纲、试卷、工作区文件之后登记一次。
没有交付物就不要调——空记录不显示，乱登记只会给用户添噪音。
同一轮分几次登记会合并去重（路径 / URL 各自唯一）。
这是给**界面**看的账，不是给正文复述用的：正文里不必再抄一遍文件清单与参考来源。`,
    [
      a('submit', 'delivery.submit({ files?, sources? })', '登记本轮交付',
        'files: [{ path, action?: created|updated|deleted, note? }]；sources: [{ title, url }]（只收 http/https）。**path 要写数据树里的节点路径原样**（如「微积分/极限」，不要自己拼 /教学、/讲义 之类后缀），或工作区文件的相对路径（带扩展名）——界面点它时按这两种形态分别打开文档与文件。回 { ok, files, sources, error? }。',
        `await api.delivery.submit({ files: [{ path: '微积分/极限', action: 'updated', note: '补了夹逼定理一节' }], sources: [{ title: '同济高等数学第七版', url: 'https://example.com/book' }] })`),
    ],
  ),
  g(
    'web',
    '网页抓取与搜索',
    '抓网页转 Markdown、联网搜索并提炼摘要（创作类交付与涉网编码要查证，纯本地调试不用）。',
    `先想清楚该不该搜：创建目标 / 规划大纲 / 写讲义 / 出试卷这类创作**要查证**权威资料；
纯算法、本地逻辑、调试自己的代码、格式转换、计算与整理这类确定性工作**不要搜**。
**例外：写的代码要调第三方接口或依赖协议 / 规范 / SDK 行为时必须搜**——查官方文档读原文再落笔，
接口行为猜不得。一次够用就停。
查证要真读原文：search 之后挑 1~3 篇最权威的用 fetch 读正文，只看着摘要下笔等于走个形式。
抓取失败不抛异常（{ ok:false, error }）；搜索默认 5 条，每条约 1.5k~2k 字符。
严禁把多个 query 的原始结果整段塞回上下文——先筛选字段再返回。`,
    [
      a('fetch', 'web.fetch(url | { url })', '抓网页转 Markdown', '与 api.fetch 同义；**8 秒硬超时**，超时或失败就换来源，不要对同一 URL 重试。创作类调研与涉网编码都用它读权威原文（摘要不算依据）。', `const page = await api.web.fetch('https://example.com/spec')`),
      a('search', 'web.search({ query, count?, need_content? } | query, opts?)', '联网搜索', '回 { ok, results: [{ title, url, snippet, summary, rerank_score, authority?, content? }] }。宽泛词加领域限定词。**创作类交付（目标 / 大纲 / 讲义 / 试卷）与涉网编码（接口 / 协议 / 规范 / SDK）要调**；纯算法、本地调试、计算、格式转换不要调。', `const r = await api.web.search({ query: '夹逼定理 教材 讲解', count: 5 })`),
    ],
  ),
  g(
    'browser',
    '内置浏览器',
    '操作界面上开着的网页页签：打开、快照、受控 DOM、读取、截图、日志、直发请求。',
    `看页面按便宜程度排：snapshot（带 ref 的元素清单）→ read（整页 Markdown）→ capture（截图，最后手段）。
动手只走 dom(tabId, ref, op)；没有执行任意页面 JS 的通道。
这是用户的真实登录会话：提交/支付/删除/发消息先 api.ask 确认。`,
    [
      a('open', 'browser.open(url)', '开一个网页页签', '纯关键词会当搜索词；返回 tabId，首屏已基本加载完。先 tabs 查重，别重复开同一网址。', `const tab = await api.browser.open('https://example.com')`),
      a('tabs', 'browser.tabs()', '列存活页签', '开工第一步；之后操作按 tabId 指名。', `const tabs = await api.browser.tabs()`),
      a('activate', 'browser.activate(tabId)', '切到某个页签', '目标网址已经开着就 activate，不要 open。', `await api.browser.activate(tabId)`),
      a('close', 'browser.close(tabId | tabId[])', '关闭网页页签', '用户自己开的别动；收尾时关掉中间搜索页/试错页，留下用户可能还要看的。', `await api.browser.close(tabId)`),
      a('snapshot', 'browser.snapshot(tabId?, { role?, contains?, limit? }?)', '可交互元素清单', '带 ref，认结构、找元素全靠它；大页面一定给过滤。DOM 变了 ref 会过期，重新 snapshot。', `const snap = await api.browser.snapshot(tabId, { contains: '登录', limit: 30 })`),
      a('point', 'browser.point(tabId?, { ref } | 选择器)', '把元素指给用户看', '页面滚到目标并短暂高亮；程序化点击不生效时请用户手点。', `await api.browser.point(tabId, { ref: 12 })`),
      a('dom', 'browser.dom(tabId?, ref, op, arg?)', '受控 DOM 操作', 'op: click / fill / focus / submit / text / attr。fill 触发 input/change，React 受控输入也认。', `await api.browser.dom(tabId, 12, 'fill', '张三')`),
      a('read', 'browser.read(tabId?, { maxChars?, offset? }?)', '整页转 Markdown', '登录态页面也能读；短的回全文，长的落盘回大纲。续读带 offset。', `const page = await api.browser.read(tabId)`),
      a('capture', 'browser.capture(tabId?)', '给网页截图', '最后手段：只有布局/视觉必须亲眼看时用；页面还在加载先 wait 800。截图存进资源库并附到下一跳。', `await api.browser.capture(tabId)`),
      a('logs', 'browser.logs(tabId, { kind?, level?, only?, limit?, afterSeq? }?)', '控制台与网络清单', '动作没生效/页面静默失败先看它；失败永不折叠，每行带条目号。', `const logs = await api.browser.logs(tabId, { level: 'error' })`),
      a('logDetail', 'browser.logDetail(tabId, seq)', '单条日志/请求详情', '条目号 96、"n96" 都认；网络条目给 url、请求头、postData、响应体。', `const detail = await api.browser.logDetail(tabId, 96)`),
      a('fetch', 'browser.fetch(tabId, 网址 | { reqId }, { method?, headers?, body?, offset?, maxBody?, toTmp? }?)', '在页面上下文直发 HTTP', '继承该页签登录态；请求级失败回 { status:0, failed:true }，不抛异常。写操作先 ask。', `const r = await api.browser.fetch(tabId, 'https://example.com/api/list')`),
      a('waitFor', 'browser.waitFor(tabId, { selector?, text?, urlIncludes?, networkIdle?, timeoutMs? }?)', '等条件成立', '比「wait 再取还是空」的循环可靠；返回命中的条件。', `await api.browser.waitFor(tabId, { selector: '.result-list' })`),
      a('record', 'browser.record(tabId, "start" | "stop")', '录制一段操作区间', 'start 钉水位，stop 回这段区间的折叠清单；配 api.ask 让用户手做登录/验证码。', `await api.browser.record(tabId, 'start')`),
      a('text', 'browser.text(tabId, { ref } | 选择器, { maxChars? }?)', '取区域渲染文本', 'SPA 上纯 HTML 抓不到正文时用它；≤4000 字，不是截图。', `const text = await api.browser.text(tabId, '.article')`),
      a('scroll', 'browser.scroll(tabId, { by } | { to } | { ref })', '滚动网页页面', '无限滚动信息流的引擎；看返回的 atBottom，true 就 wait 再滚。ui.scroll 滚的是文档区，别混用。', `await api.browser.scroll(tabId, { by: 800 })`),
    ],
  ),
  g(
    'mcp',
    'MCP 外部服务',
    '用户配置的真实外部工具：列表、现场探测、调用。',
    `先 list 看服务与工具；工具不存在就 discover 刷新。参数按工具公布的说明给，
不要猜。失败回 { ok:false }，按值判断。写操作/不可逆动作先 api.ask。`,
    [
      a('list', 'mcp.list()', '列服务与工具', '回 id、名称、传输、状态与缓存的工具清单。', `const servers = await api.mcp.list()`),
      a('discover', 'mcp.discover(server?)', '现场探测工具清单', 'SSE 服务实时请求，可能要等几秒；省略=探全部已启用服务。', `const tools = await api.mcp.discover('github')`),
      a('call', 'mcp.call(server, tool, args?)', '调一个外部工具', '参数按工具 description 给；结果回服务端文本，失败回 { ok:false }。', `await api.mcp.call('github', 'search_repos', { q: 'moji-notes' })`),
    ],
  ),
  g(
    'ui',
    '界面操作',
    '吐司、定位文档、滚动、截图、打开超级文档、受控 DOM。',
    `界面操作是「给用户看」的，不是数据读写。定位优先用 ui.point，
截图只在视觉必须亲眼看时用。`,
    [
      a('toast', 'ui.toast(message)', '弹一条吐司', '一句话，≤200 字；不要用它替代正式回复。', `await api.ui.toast('讲义已生成')`),
      a('point', 'ui.point(path?, tab?)', '打开并定位文档', '把教学文档/笔记在文档区打开并定位；交付后指引用户看这里。', `await api.ui.point('极限')`),
      a('scroll', 'ui.scroll({ to?, by? })', '滚文档区', 'to: top/bottom；by: 像素。滚的是文档区，不是网页。', `await api.ui.scroll({ to: 'top' })`),
      a('screenshot', 'ui.screenshot()', '截文档区', '截图进资源库并挂到下一跳；只在视觉必须亲眼看时用。', `await api.ui.screenshot()`),
      a('superdoc', 'ui.superdoc(path?, name)', '打开超级文档页签', '写完节点对象的 editContent({ html }) 后用它让用户看到（path 给文档的 #uuid 或标题）。', `await api.ui.superdoc('#' + 文档uuid, '夹逼实验')`),
      a('dom', 'ui.dom(async (root) => { ... })', '受控 DOM 读写', 'root 提供 exists/count/query/text/attr/html/rect/click 等；只用于文档区。', `await api.ui.dom(async (root) => { return await root.text('h1') })`),
    ],
  ),
  g(
    'subagent',
    '子代理',
    '并发派活：登记定义、派任务、等待交付、恢复、干预、中断、查看、删除。',
    `子代理适合长文档通读、繁重检索、独立并行任务。它们的 api 面按 create 时给的 tools
白名单裁剪（可选组见回执说明）；不要指望子代理有 wf/state/exam 这些导师专用组。
地址一律认 key（name 是显示名，碰巧写 name 也能对上）。`,
    [
      a('create', 'subagent.create({ key, system, tools?, name? })', '登记一个子代理（只登记、未启动）', 'key 是地址（字母开头，≤32 字符，可用字母/数字/-/_）；system ≥20 字，写清角色、工作方式与交付纪律（子代理看不到导师的对话）；tools 从允许名单里选，默认 [web, tmp]。同 key 再 create 即覆盖定义（会话保留，新提示词从下一次任务生效）。', `const r = await api.subagent.create({ key: 'paper', system: '你是论文研读员：通读给定论文，交付方法-实验-结论三段摘要。只用 api.web 与 api.res。', tools: ['web', 'res'] })`),
      a('run', 'subagent.run({ agent, task })', '派任务并后台启动', 'agent 认 key；task 写全：做什么、什么口径、交付什么格式。run 立即返回、任务并发跑，用 wait 收交付；同一个子代理同一时刻只跑一场。', `await api.subagent.run({ agent: 'paper', task: '通读 https://example.com/paper.pdf，交付 500 字摘要与三个关键结论' })`),
      a('resume', 'subagent.resume(key)', '继续一个被中断的子代理', '在同一份会话上接着跑，上下文保留、不加新指令；只对被中断过的有效。', `await api.subagent.resume('paper')`),
      a('intervene', 'subagent.intervene(key, message)', '给运行中的子代理插一条指令', '用于纠偏；消息排队等子代理下一跳消费，不要频繁打断。', `await api.subagent.intervene('paper', '先只看第 3 节')`),
      a('interrupt', 'subagent.interrupt(key)', '中断一个子代理任务', '立刻停跑但保留已产出的内容；之后可用 resume 继续。', `await api.subagent.interrupt('paper')`),
      a('view', 'subagent.view(key)', '查看子代理会话详情', '回状态、最近过程与上次交付；判断它卡没卡、跑偏没跑偏时用。', `const detail = await api.subagent.view('paper')`),
      a('delete', 'subagent.delete(key)', '删除一个子代理的定义与会话', '不可逆；交付没拿走前不要删。', `await api.subagent.delete('paper')`),
      a('wait', 'subagent.wait({ seconds })', '等子代理交付', '回已完成/仍在跑/超时三类；seconds 是本次愿意等的最大时长。不要用 sleep 轮询。', `const done = await api.subagent.wait({ seconds: 60 })`),
    ],
  ),
  g(
    'permission',
    '路径放行',
    '外部目录的查看、撤销与审批。',
    `数据根恒可访问；外部路径要用户放行。被拒后不要反复重试同一个路径，
把原因讲给用户，或改用数据根内的 workspace/。`,
    [
      a('list', 'permission.list()', '看当前作用域', '回 root 与 allowedDirs。', `const scope = await api.permission.list()`),
      a('revoke', 'permission.revoke(path)', '撤销一个放行目录', '归一化后精确匹配；数据根不可撤销。', `await api.permission.revoke('D:/shared')`),
      a('request', 'permission.request({ path, reason? })', '请求放行外部目录', '弹审批卡片并阻塞；批准后立刻生效。', `const r = await api.permission.request({ path: 'D:/datasets', reason: '读取课程数据集' })`),
    ],
  ),

  /* ---------- 通用文件与运行时 ---------- */
  g(
    'files',
    '通用文件（受限）',
    '只用于工作区、静态资源、技能与外部文件；不能读写应用数据。',
    `files.* 是通用文件系统，不是应用数据的入口。允许的范围：
- docs/.../workspace/**（用户交付物，优先用 api.workspace.*）；
- docs/.../static/**（静态资源，优先用 api.res.*）；
- skills/**（技能文件，优先用 api.skill.*）；
- 数据根之外、用户已放行的目录。
教学文档、笔记、大纲、meta、试卷、superdocs、chat.json、state.json、user.yaml、
workflow.json、method.json、reading.json 等应用数据一律走对应 api 组；
files.* 碰到它们会被拒绝，并提示该用哪一组。`,
    [
      a('read', 'files.read(path, { encoding?, offset?, maxBytes? }?)', '读真实文件', '只读非应用数据；文本支持 offset/maxBytes，二进制用 base64。', `const src = await api.files.read('docs/目标/节点/workspace/main.py')`),
      a('write', 'files.write(path, content, { encoding?, overwrite? }?)', '写真实文件', '父目录自动建；只写非应用数据。交付物优先 api.workspace.write。', `await api.files.write('docs/目标/节点/workspace/notes.txt', 'hello')`),
      a('edit', 'files.edit(path, { replace?, edits?, content?, start?, end? }?)', '改真实文件', '支持字符串替换、多项编辑、区间替换；只改非应用数据。', `await api.files.edit('docs/目标/节点/workspace/main.py', { replace: { target: 'print(1)', replacement: 'print(2)' } })`),
      a('list', 'files.list(path?)', '列一个目录的清单', '只列非应用数据目录；应用数据（docs/ 下的数据文件）会被拒绝，用 api.node.list()。', `const items = await api.files.list('docs/目标/节点/workspace')`),
      a('stat', 'files.stat(path)', '查文件或目录的属性', '回大小、类型与时间戳；只查非应用数据。', `const st = await api.files.stat('docs/目标/节点/workspace/main.py')`),
      a('mkdir', 'files.mkdir(path)', '创建一个目录', '父级自动递归；只建非应用数据目录（workspace/、static/、skills/、外部）。', `await api.files.mkdir('docs/目标/节点/workspace/output')`),
      a('copy', 'files.copy(from, to, { overwrite? }?)', '复制文件或目录', '两端都必须是非应用数据；目标存在时按 overwrite 决定是否覆盖。', `await api.files.copy('docs/目标/节点/workspace/a.txt', 'docs/目标/节点/workspace/b.txt')`),
      a('move', 'files.move(from, to)', '移动/重命名', '两端都必须是非应用数据；应用数据改名走节点对象的 editContent。', `await api.files.move('docs/目标/节点/workspace/a.txt', 'docs/目标/节点/workspace/b.txt')`),
      a('delete', 'files.delete(path)', '删除文件/目录', '只删非应用数据；不可逆，先确认。', `await api.files.delete('docs/目标/节点/workspace/tmp.txt')`),
    ],
  ),
  g(
    'process',
    '受控进程',
    '创建、启动、查询、停止、清理原生子进程。',
    `进程任务默认创建后不执行，start 才启动；生命周期与应用强绑定。
不要用 process 去读写应用数据——应用数据有专门 api；也不要用它绕过 files.* 的路径限制。
不可逆命令先 api.ask。`,
    [
      a('create', 'process.create({ command, args?, cwd?, env? })', '创建进程任务', 'cwd 必须在可访问目录内；创建后默认不跑。', `const p = await api.process.create({ command: 'python', args: ['main.py'], cwd: 'D:/work' })`),
      a('start', 'process.start(process_id)', '启动进程', '回 pid 与 running。', `await api.process.start(p.process_id)`),
      a('status', 'process.status(process_id)', '查进程状态', '回 running / exitCode。', `const st = await api.process.status(p.process_id)`),
      a('output', 'process.output(process_id, { offset?, reset? }?)', '读取进程的标准输出与错误', '支持增量读（带 offset 续读）；长输出分段拿，不要一次全量。', `const out = await api.process.output(p.process_id)`),
      a('stop', 'process.stop(process_id, { timeoutMs?, force? }?)', '停止进程', '先温和后强杀；force 会丢未落盘内容。', `await api.process.stop(p.process_id, { force: true })`),
      a('list', 'process.list()', '列进程任务', '回当前 agent 有权访问的全部任务。', `const all = await api.process.list()`),
      a('get', 'process.get(process_id)', '进程详情', '回命令、参数、cwd、状态、退出码。', `const one = await api.process.get(p.process_id)`),
      a('delete', 'process.delete(process_id)', '销毁一个进程任务', '运行中的会先强杀再删；只是清理记录，不影响已落盘的产物。', `await api.process.delete(p.process_id)`),
    ],
  ),
  g(
    'skill',
    '专业技能',
    '技能库：路径、列表、读规范、跑脚本、写、删。',
    `技能是渐进式开示的能力包：先 list 看索引，要用了再 read 拿完整规范。
脚本只能从 skills/<id>/scripts/ 里跑，不能拿它执行任意命令。`,
    [
      a('paths', 'skill.paths(id?)', '技能目录路径', '回 root / dir / scriptsDir / referencesDir / skillMd。', `const paths = await api.skill.paths('pdf')`),
      a('list', 'skill.list()', '列出全部已启用技能', '回名称、绝对目录与专属脚本清单；挑技能时先看它。', `const skills = await api.skill.list()`),
      a('read', 'skill.read(id)', '读技能完整规范', '调用即激活到短期上下文；回 instructions / scripts / references。', `const skill = await api.skill.read('pdf')`),
      a('run', 'skill.run(id, scriptName, args?)', '跑技能脚本', '只跑 skills/<id>/scripts/ 下的脚本；回 output / exitCode。', `const r = await api.skill.run('pdf', 'extract.py', ['input.pdf'])`),
      a('write', 'skill.write(skillDef)', '写/覆盖技能', '结构化维护技能定义；也可用 files.* 直接读写 skills/。', `await api.skill.write({ id: 'my-skill', name: '我的技能', instructions: '...' })`),
      a('delete', 'skill.delete(id)', '删除一个专业技能', '不可逆；整个技能目录（规范/脚本/参考）一并删除。', `await api.skill.delete('my-skill')`),
    ],
  ),
  g(
    'video',
    '视频资源',
    '视频资源与选集信息：查看绑定的视频及其分 P / 选集列表。',
    `视频资源与选集信息：
- video.get(videoIdOrUuid)：获取视频详情与所有选集（episodes）列表，包含选集标题、分 P 序号与播放来源。
- video.list()：列出当前目标可用的全部视频资源。`,
    [
      a('list', 'video.list()', '列出所有视频资源', '返回视频资源的 id、标题与插件名。', 'const list = await api.video.list()'),
      a('get', 'video.get(videoIdOrUuid)', '获取视频详情与选集', '返回 id、title、hasEpisodes、episodeCount 与 episodes 选集清单（每项带 page、title、source）。', "const info = await api.video.get('v-123')"),
    ],
  ),
  g(
    'project',
    '项目路径',
    '已声明 project 节点的真实路径读写：uuid + 项目内相对路径寻址，越出声明根一律拒绝。',
    `项目路径（先 api.node.list() 看 projects 段：uuid / title / path / pathKind / resolved）：
- 寻址一律 (uuid, subPath)：subPath 是**相对该项目根**的路径、'/' 分隔，根本身写空串 ''；
- 这条路径是节点宇宙里的 project 节点声明出来的（声明即授权）：声明的根及其下所有文件
  都可以读写；越出根的操作会被拒绝，不要试图用 .. 逃出去；
- path 的拼法由路径自己说（盘符或 / 开头 = 绝对，其余相对目标根目录），不需要你标注；
- 大文件用 read 的 { offset, maxBytes } 分片；二进制用 { encoding: 'base64' }；
- 不可逆操作（delete / move / write 覆盖）先看清楚再动手，拿不准先问用户。`,
    [
      a('list', 'project.list()', '列出当前目标已声明的项目', '回 uuid / title / path / pathKind / resolved（解析后的绝对路径）。第一步先看它。', 'const ps = await api.project.list()'),
      a('tree', 'project.tree(uuid, subPath?)', '列一个目录的清单', 'subPath 相对该项目根（空串 = 根）；回 path 与 entries（name / isDirectory / size / mtimeMs）。看结构先 tree 根，再逐层下钻。', `const t = await api.project.tree(uuid)`),
      a('read', 'project.read(uuid, subPath, { encoding?, offset?, maxBytes? }?)', '读一个文件', '文本默认 utf8；二进制传 { encoding: "base64" }；大文件用 offset / maxBytes 分片（回执带 totalChars）。', `const f = await api.project.read(uuid, 'src/main.py')`),
      a('write', 'project.write(uuid, subPath, content, { encoding?, overwrite? }?)', '写一个文件（父目录自动建）', 'content 传对象会自动 JSON.stringify；overwrite: false 时已存在则拒绝。', `await api.project.write(uuid, 'notes/todo.md', '# 计划\\n- ...')`),
      a('edit', 'project.edit(uuid, subPath, { content | replace | append })', '改一个已存在的文件', '三种之一：{ content: 全文替换 } / { replace: { target, replacement, all? } } / { append: 尾部追加 }。', `await api.project.edit(uuid, 'src/main.py', { replace: { target: 'port=8000', replacement: 'port=8080' } })`),
      a('mkdir', 'project.mkdir(uuid, subPath)', '建目录（父级自动递归）', '只建在该项目根之内；父级目录按需自动递归创建。', `await api.project.mkdir(uuid, 'output/logs')`),
      a('move', 'project.move(uuid, from, to)', '移动 / 重命名', 'from 与 to 都是**项目内**的相对路径；挪出项目根会被拒绝。', `await api.project.move(uuid, 'a.txt', 'archive/a.txt')`),
      a('copy', 'project.copy(uuid, from, to, { overwrite? }?)', '复制文件或目录', '递归复制；两端都必须在项目根之内。', `await api.project.copy(uuid, 'data.json', 'backup/data.json')`),
      a('delete', 'project.delete(uuid, subPath)', '删除文件或目录', '不可逆（目录整棵递归删）。subPath 不许是空串——撤掉整条声明走 api.node.delete(项目uuid)。', `await api.project.delete(uuid, 'tmp/build.log')`),
    ],
  ),

  /* ---------- 兼容/内部：不进 Worker 名单 ---------- */
]

/** full → doc 的索引：wrapApi、__help、目录共用 */
const FULL_INDEX = new Map<string, ApiDoc>()
/** full → group 的索引 */
const GROUP_OF_FULL = new Map<string, ApiGroupDoc>()
for (const group of API_GROUPS) {
  for (const api of group.apis) {
    if (FULL_INDEX.has(api.full)) {
      throw new Error('[apiRegistry] 重复登记 api：' + api.full)
    }
    FULL_INDEX.set(api.full, api)
    GROUP_OF_FULL.set(api.full, group)
  }
}

/** 一条 api 的登记；没有就是没登记，wrapApi 会拦 */
export function apiDocOf(full: string): ApiDoc | null {
  return FULL_INDEX.get(full) ?? null
}

/** 一条 api 属于哪一组 */
export function apiGroupOf(full: string): ApiGroupDoc | null {
  return GROUP_OF_FULL.get(full) ?? null
}

/** 对外可见的组（在注册表里登记过、能被调用的全部组，含 legacy 兼容组） */
export function exposedGroups(): ApiGroupDoc[] {
  return API_GROUPS
}

/** 被宣传的组：系统提示词组索引与根 help 只列这些（legacy 旧写法组除外，见文件头纪律） */
export function promotedGroups(): ApiGroupDoc[] {
  return API_GROUPS.filter((group) => !group.legacy)
}

/** Worker 的 API_NAMES：从注册表派生，不再手抄（legacy 组也在——老对话还要调它） */
export function exposedApiNames(): string[] {
  return API_GROUPS.flatMap((group) => group.apis.map((api) => api.full))
}

/* ---------- 渲染 ---------- */

/** `api.__help()` 的正文 */
export function renderRootHelp(): string {
  const lines = ['execute 沙箱 api 集（先查组，再查单条 api）：', '']
  for (const group of promotedGroups()) {
    lines.push(
      group.key === 'core'
        ? '- 顶层函数 — ' + group.label + '：' + group.intro
        : '- api.' + group.key + ' — ' + group.label + '：' + group.intro,
    )
  }
  lines.push(
    '',
    '用法：',
    '    await api.<组>.__help()        // 这一组有哪些 api、签名与一句话用法',
    '    await api.<组>.<api>.__help()  // 这一条 api 的参数、返回、完整用法与示例',
    '    await api.__help()             // 这份总览',
    '',
    '纪律：不要凭记忆猜 api 名或参数；先 __help 再写。应用数据用对应组，files.* 只用于工作区/静态资源/技能/外部文件。',
  )
  return lines.join('\n')
}

/** `api.<group>.__help()` 的正文 */
export function renderGroupHelp(key: string): string {
  const group = API_GROUPS.find((x) => x.key === key)
  if (!group) return '没有 api.' + key + ' 这一组。先 await api.__help() 看有哪些组。'
  const items = group.apis
  if (!items.length) return 'api.' + key + ' 这一组在当前版本没有可用的 api。'
  const title = key === 'core' ? '顶层函数（api.<name>）' : 'api.' + key + ' — ' + group.label
  const lines = [
    title +
      (group.legacy
        ? '（旧写法：' + (group.legacyNote ?? '旧写法，等价入口见系统提示词的组索引') + '）'
        : ''),
    '',
    group.usage,
    '',
    '可用 api：',
  ]
  for (const api of items) {
    lines.push('- ' + api.signature + ' — ' + api.summary)
  }
  if (group.example) {
    lines.push('', '组示例：', group.example)
  }
  lines.push(
    '',
    key === 'core'
      ? '单条用法：await api.<name>.__help()'
      : '单条用法：await api.' + key + '.<api>.__help()',
  )
  return lines.join('\n')
}

/** `api.<group>.<api>.__help()` 的正文 */
export function renderApiHelp(full: string): string {
  const api = apiDocOf(full)
  if (!api) {
    const group = full.includes('.') ? full.slice(0, full.indexOf('.')) : ''
    return (
      '没有登记 api.' +
      full +
      '。' +
      (group ? '先 await api.' + group + '.__help() 看这一组有哪些 api。' : '先 await api.__help() 看有哪些组。')
    )
  }
  const lines = [api.full, '签名：' + api.signature, '', '作用：' + api.summary, '', '用法：' + api.usage]
  if (api.params) lines.push('', '参数：' + api.params)
  if (api.returns) lines.push('', '返回：' + api.returns)
  lines.push('', '示例：', api.example)
  for (const ex of api.examples ?? []) lines.push('', ex)
  return lines.join('\n')
}

/**
 * 预先渲染好的帮助文本：Worker 启动时注入，`__help()` 同步返回，
 * 不花一次宿主往返。
 */
export interface SandboxHelp {
  root: string
  groups: Record<string, string>
  apis: Record<string, string>
}

export function buildSandboxHelp(): SandboxHelp {
  const groups: Record<string, string> = {}
  const apis: Record<string, string> = {}
  for (const group of exposedGroups()) {
    groups[group.key] = renderGroupHelp(group.key)
    for (const api of group.apis) {
      apis[api.full] = renderApiHelp(api.full)
    }
  }
  return { root: renderRootHelp(), groups, apis }
}

/** 系统提示词里的 api 集索引：只给组名与一句说明，不给具体签名（legacy 组不宣传） */
export function groupIndexForSystemPrompt(): string {
  return promotedGroups()
    .map((group) =>
      group.key === 'core'
        ? '- 顶层函数：' + group.intro
        : '- api.' + group.key + ' — ' + group.label + '：' + group.intro,
    )
    .join('\n')
}

/** 设置页/子代理 brief 用的简洁清单：组 → 条目 */

/**
 * 渲染全量 API 完整参考手册与代码示例（首轮系统提示词使用）。
 * 包含所有非 legacy 组及每条 API 的完整签名、功能说明、参数规格、返回规格与示例代码。
 */
export function renderAllApisDocumentation(): string {
  const fence = '```';
  const lines: string[] = [
    '### 沙箱全部 API 完整参考手册与示例',
    '以下是沙箱中所有可用 API 的完整签名、功能说明、参数返回值与可运行代码示例：',
    '',
  ]
  for (const group of promotedGroups()) {
    lines.push('#### 【' + (group.key === 'core' ? '顶层函数' : 'api.' + group.key) + '】' + group.label)
    lines.push('- **功能定位**：' + group.intro)
    if (group.usage?.trim()) {
      lines.push('- **用法规程**：\n' + group.usage.trim())
    }
    if (group.example?.trim()) {
      lines.push('- **组示例**：\n' + fence + 'javascript\n' + group.example.trim() + '\n' + fence)
    }
    lines.push('', '**API 详细规格与示例**：')
    for (const api of group.apis) {
      lines.push('- **`' + api.signature + '`** — ' + api.summary)
      lines.push('  - 全名：`api.' + api.full + '`')
      lines.push('  - 用法：' + api.usage)
      if (api.params) lines.push('  - 参数：' + api.params)
      if (api.returns) lines.push('  - 返回：' + api.returns)
      lines.push('  - 示例代码：\n' + fence + 'javascript\n' + api.example + '\n' + fence)
      if (api.examples && api.examples.length > 0) {
        for (const ex of api.examples) {
          lines.push(fence + 'javascript\n' + ex + '\n' + fence)
        }
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function catalogGroups(): Array<{
  key: string
  label: string
  intro: string
  items: Array<{ name: string; signature: string; summary: string }>
}> {
  return exposedGroups().map((group) => ({
    key: group.key,
    label: group.label,
    intro: group.intro,
    items: group.apis.map((api) => ({
      name: api.full,
      signature: api.signature,
      summary: api.summary,
    })),
  }))
}
