/**
 * 英文字典：导师对话区（components/agent 全部 + AgentSettingsModal）。
 *
 * 键 = 界面里的中文原文，逐字节一致（含全角标点）；插值用 {0} {1}。
 * 本文件只由「导师对话区」分片的接入者维护。
 */
const dict: Record<string, string> = {
  /* ---------- AgentPanel：标题、状态行、字号提示 ---------- */
  '超级导师': 'Super Tutor',
  '正在辅导「{0}」': 'Tutoring "{0}"',
  '思考中…': 'Thinking…',
  '导师正在准备': 'Your tutor is preparing',
  '正在{0}…': '{0}…',

  /* ---------- PersonaPicker ---------- */
  '导师人格：{0}，点击切换': 'Tutor persona: {0} — click to switch',
  '导师人格': 'Tutor persona',
  '换一种讲法，知识不变': 'A different way to explain — same knowledge',
  '切换从下一轮开始生效。人格是以一条隐藏指令进入上下文的，不改系统提示词， 之前的对话一条都不会重发。':
    'Takes effect from the next turn on. The persona enters the context as one hidden instruction and the system prompt is untouched; none of the earlier conversation is sent again.',

  /* ---------- EffortSlider（REASONING_HINT 四档） ---------- */
  '思考等级': 'Reasoning effort',
  '思考等级：{0}（{1}）': 'Reasoning effort: {0} ({1})',
  '快，短问答与批注': 'Fast — short answers and quick notes',
  '平衡，日常讲解': 'Balanced — everyday explanations',
  '深，教学与出卷': 'Deep — teaching and exam generation',
  '最深，复杂推导与代码': 'Deepest — complex reasoning and code',

  /* ---------- ModelPicker ---------- */
  '切换提供商 · 模型': 'Switch provider · model',
  '切换提供商与模型': 'Switch provider and model',
  '提供商': 'Providers',
  '还没有配置提供商，请先到设置里添加。': 'No provider configured yet — add one in Settings first.',
  '已配置 Key': 'Key configured',
  '未配置 Key': 'No Key',
  '{0} 个模型': '{0} models',
  '{0} 的模型': 'Models of {0}',
  '该提供商': 'This provider',
  '该提供商还没有可用模型，请到设置里添加。': 'This provider has no usable models yet — add one in Settings.',

  /* ---------- ContextDebugger ---------- */
  '上下文比对调试器': 'Context diff debugger',
  '每次把上下文发往 API 前记录一份快照；选两份比对，差异定位到消息与字符。':
    'Records a snapshot before each context goes to the API; pick two to diff, down to the message and the character.',
  '清空记录': 'Clear records',
  '还没有记录': 'No records yet',
  '在对话里发一条消息（或让导师跑一轮工具），每次请求发出前都会在这里留一份快照。':
    'Send a message in the conversation (or let the tutor run a tool) — a snapshot is kept here before every request.',
  '系统 {0} 字 · {1} 条消息': 'System {0} chars · {1} messages',
  '比较 #{0} → #{1}：': 'Compare #{0} → #{1}: ',
  '完全一致（前缀缓存可以命中）': 'Byte-identical (the prefix cache can hit)',
  '有差异': 'There are differences',
  '，第一处落在第 {0} 条消息': ', first change lands in message {0}',
  '（系统提示词也变了）': ' (the system prompt changed too)',
  '（工具声明也变了）': ' (the tool declarations changed too)',
  '系统提示词': 'System prompt',
  '第 {0} 字起变化': 'Changes from character {0}',
  '变了（老记录已裁掉原文，无法给出字符位置）': 'Changed (the older record kept no full text, so no character position)',
  '工具声明': 'Tool declarations',
  '工具的 JSON Schema 变了（缓存也会从这里断开）': 'The JSON Schema of the tools changed (the cache breaks here too)',
  '#{0} · {1}': '#{0} · {1}',
  '这条是新增的（A 里没有）': 'Added (not present in A)',
  '这条没了（B 里没有）': 'Gone (not present in B)',
  '第 {0} 字起变化（{1} → {2} 字）': 'Changes from character {0} ({1} → {2} chars)',
  '内容变了（{0} → {1} 字）；两份原文里有一份已裁掉，无法给出字符位置':
    'Content changed ({0} → {1} chars); one of the two originals was trimmed, so no character position is available',
  '这两份上下文逐字节一致。命中率仍然低的话，问题不在这两份之间——往上翻更早的记录， 或确认服务端真的支持前缀缓存（部分中转不回传用量也不做缓存）。':
    'These two contexts are byte-identical. If the hit rate is still low, the problem is not between these two — scroll up to earlier records, or confirm the server really supports prefix caching (some proxies neither return usage nor cache).',
  '设为对比基准': 'Set as baseline (A)',
  '设为对比对象': 'Set as comparison (B)',
  '＋ 新增': '+ Added',
  '− 消失': '− Removed',
  'Δ 变化': 'Δ Changed',
  '系统': 'System',
  '助手': 'Assistant',
  '工具结果': 'Tool result',
  '旧': 'Old',
  '新': 'New',

  /* ---------- ContextRing ---------- */
  '上下文占用未知': 'Context usage unknown',
  '上下文已用 {0}%': 'Context {0}% used',
  '上下文占用': 'Context usage',
  '窗口未知': 'window unknown',
  '未设置': 'not set',
  '本对话输入': 'Input in this conversation',
  '本对话输出': 'Output in this conversation',
  '平均缓存命中': 'Avg. cache hit',
  '按每次请求的输入量加权：一轮编排里的每一跳都各自计入（命中总量 ÷ 输入总量）， 不是只拿每轮最后一条回复来平均。':
    'Weighted by the input size of each request: every hop in an orchestration round counts (total hits ÷ total input), instead of averaging only the last reply of each round.',
  '部分数据是服务端未返回用量时的估算值': 'Some figures are estimates from requests where the server returned no usage',

  /* ---------- UsageLine ---------- */
  '服务端未返回用量，这里是按字数估算的': 'The server returned no usage; estimated from character counts',
  ' · 缓存 {0}': ' · cache {0}',
  ' · 估算': ' · est.',

  /* ---------- MsgRail / PaceStrip ---------- */
  '跳到：{0}': 'Jump to: {0}',
  '这个对话里导师回复的轮数': 'Tutor replies in this conversation',
  '{0} 轮': '{0} turns',
  '累计执行的编排步数（导师每跑一次代码算一步）': 'Orchestration steps so far (each code run by the tutor counts as one)',
  '{0} 步': '{0} steps',
  '当前输出速度：最近几秒的实时吞吐（请求结束后换成该跳的精确平均）':
    'Current output speed: live throughput of the last few seconds (replaced by the exact average of that hop once the request ends)',
  '这个对话累计消耗的 token（输入 + 输出）': 'Tokens spent in this conversation so far (input + output)',

  /* ---------- 「+」菜单（PlusMenu / usePlusMenu） ---------- */
  '更多': 'More',
  '工作流': 'Workflow',
  '对话历史': 'Conversation history',
  '新建对话': 'New conversation',
  '同一个目标，另起一段上下文': 'Same goal, a fresh context',
  '{0} 段': '{0} conversations',
  '文件': 'Files',
  '把文件发给导师看（也可以直接拖进来）': 'Send files to the tutor (or just drag them in)',
  '回忆 / 超级实验室 / 打卡': 'Recall / Super Lab / Daily check-in',
  '正在压缩…': 'Compressing…',
  '折成摘要继续聊（自动压缩阈值 {0}%）': 'Fold into a summary and keep chatting (auto-compress threshold {0}%)',
  '超级导师设置': 'Super Tutor settings',
  '压缩阈值等（与全局设置分开）': 'Compression threshold etc. (kept separate from global settings)',
  '合上文档，讲一遍': 'Close the document and explain it back',
  '说想要什么实验，导师做成可交互的超级文档': 'Say what experiment you want; the tutor turns it into an interactive Super Doc',
  '用今天读到的内容出几道题，答到门槛才算过': 'A few questions from what you read today; pass the bar to count as checked in',
  '删除该对话': 'Delete this conversation',
  '还没有消息': 'No messages yet',
  '对话 {0}': 'Conversation {0}',
  '{0} 条消息': '{0} messages',

  /* ---------- 斜杠命令（useSlashMenu） ---------- */
  '恢复之前的某一段对话': 'Resume an earlier conversation',
  '把前面的对话折成一份摘要继续聊': 'Fold the earlier conversation into a summary and continue',
  '压缩阈值、人格等（与全局设置分开）': 'Compression threshold, persona, etc. (kept separate from global settings)',
  '设置推理等级': 'Set reasoning effort',
  '思考多深：Low / High / Max': 'How deep to think: Low / High / Max',
  '出试卷': 'Create exam paper',
  '导师先问类型与难度，再出卷': 'The tutor asks for type and difficulty first, then writes the paper',
  '推理等级': 'Reasoning effort',
  '这个目标下还没有别的对话': 'No other conversations under this goal',
  '没有匹配的命令': 'No matching commands',
  '斜杠命令': 'Slash commands',
  '命令': 'Commands',
  '↑↓ 选 · Enter 执行 · Esc 取消': '↑↓ select · Enter to run · Esc to cancel',
  '↑↓ 选 · Enter 执行 · 退格返回': '↑↓ select · Enter to run · Backspace to go back',

  /* ---------- Composer ---------- */
  '导师接下来的计划': 'What the tutor plans to do next',
  '尚未配置「{0}」的 API Key，请到顶栏设置中填写（也可在那里更换提供商）。':
    'No API Key configured for "{0}" yet — fill it in under the top-bar Settings (you can switch providers there too).',
  '移除全部附件': 'Remove all attachments',
  '向超级导师提问…（/ 可用斜杠命令，可拖入文件、页签、图片）': 'Ask the Super Tutor… (/ for slash commands; drop files, tabs, or images)',
  '发送（Enter）': 'Send (Enter)',

  /* ---------- ToolCard ---------- */
  '执行中': 'Running',
  '失败': 'Failed',
  '代码': 'Code',
  '参数': 'Params',
  '结果': 'Result',

  /* ---------- MessageBubble ---------- */
  '点击回到文档，高亮这段文字': 'Click to jump back to the document and highlight this passage',
  '暂时无法定位这段文字（视图已切换或内容有改动）': 'Cannot locate this passage right now (the view has changed or the content was edited)',
  '选自文档 · 点击定位': 'From the document · click to locate',
  '再点一次删除': 'Click again to delete',
  '编辑': 'Edit',
  '确认': 'Confirm',
  '思考与工具 · {0} 步': 'Thinking & tools · {0} steps',
  '思考过程': 'Thinking',
  '回到最新消息（恢复自动滚动）': 'Back to the latest message (resume auto-scroll)',

  /* ---------- 空状态（useMessageList） ---------- */
  '让 AI 把这一概念讲清楚。': 'Have the AI explain this concept clearly.',
  '它会把讲解直接写进左侧的教学文档。选中文档里的陌生词汇就能创建下级节点继续深入；想要一份自己的笔记，直接说「把刚才讲的要点整理进我的笔记」。':
    'The explanation goes straight into the lesson document on the left. Select an unfamiliar word there to create a child node and dig deeper; for your own notes, just say "organize the key points into my notes".',
  '试试：「用直觉解释这个概念」「给我一个具体例子」「我卡在这里了，帮我拆开」':
    'Try: "Explain this concept intuitively", "Give me a concrete example", "I am stuck here — help me break it down"',

  /* ---------- CompactionDivider ---------- */
  '收起摘要': 'Hide summary',
  '看摘要': 'View summary',

  /* ---------- Images ---------- */
  '移除这张图': 'Remove this image',
  '{0} · 二进制': '{0} · binary',
  '已截断 · 约 {0} 字节': 'Truncated · about {0} bytes',
  '点击任意处关闭': 'Click anywhere to close',

  /* ---------- AskFormCard（结构化表单） ---------- */
  '导师想先确认几件事': 'The tutor wants to confirm a few things first',
  '第 {0} / {1} 题': 'Question {0} / {1}',
  '这一题的答案会直接存进你的画像（头像菜单 →「用户」里能改、能清空），导师以后不用再问':
    'This answer is saved straight into your profile (view or clear it under the avatar menu → "User"); the tutor will not need to ask again',
  '存进我的资料': 'Save to my profile',
  '其他：': 'Other: ',
  '写在这里': 'Write here',
  '在这里回答…': 'Answer here…',
  '前面的选择让所有后续问题都跳过了，直接提交即可。': 'Your earlier choices skipped all remaining questions — just submit.',
  '回到上一题（答案都留着）': 'Previous question (answers are kept)',
  '上一题': 'Previous',
  '想答的答，懒得答的留空直接提交也可以': 'Answer what you like; leaving blanks and submitting directly is fine too',
  '不回答了': 'Not answering',
  '提交': 'Submit',
  '下一题': 'Next',
  '下一题（答案都留着）': 'Next question (answers are kept)',

  /* ---------- useComposer：附件闸门的提示 ---------- */
  '当前模型不支持图片输入：可在设置里给这个模型勾上「图像」': 'The current model does not accept image input — enable "Image" for it in Settings',
  '一条消息最多 {0} 张图': 'At most {0} images per message',
  '最多 {0} 张图，多出来的没有添加': 'At most {0} images — the extras were not added',
  '粘贴的图片': 'Pasted image',
  '粘贴的图片 {0}': 'Pasted image {0}',
  '「{0}」超过 12MB，没有添加': '"{0}" is over 12MB and was not added',
  '一条消息最多 {0} 个文件附件': 'At most {0} file attachments per message',
  '最多 {0} 个文件附件，多出来的没有添加': 'At most {0} file attachments — the extras were not added',
  '「{0}」{1}': '"{0}" {1}',

  /* ---------- preview（定位条预览） ---------- */
  '［图］': '[image]',
  '［图片］': '[image]',
  '（空消息）': '(empty message)',
  '导师动作': 'Tutor action',

  /* ---------- toolLabel 的旧工具名标签 ---------- */
  '执行代码': 'Execute code',
  '读取笔记': 'Read note',
  '读取笔记片段': 'Read note excerpt',
  '更新笔记': 'Update note',
  '追加内容': 'Append content',
  '读取描述': 'Read description',
  '更新描述': 'Update description',
  '生成试卷': 'Generate exam paper',
  '读取试卷': 'Read exam paper',
  '提交阅卷': 'Submit grading',
  '笔记': 'Note',
  '描述': 'Description',
  '试卷': 'Exam paper',
  '局部修改笔记': 'Edit a note range',

  /* ---------- AgentSettingsModal：对话分页 ---------- */
  '调试工具，全部默认关闭': 'Debugging tools — all off by default',
  '导师可以代跑的任务模板；触发时指令以 user 消息进上下文': 'Task templates the tutor can run for you; when triggered, the instructions enter the context as a user message',
  '只影响对话区里的超级导师，与全局设置分开': 'Only affects the Super Tutor in the conversation area; kept separate from global settings',
  '当前模型': 'Current model',
  '还没选模型': 'No model selected',
  '这个提供商还没有填 API Key：压缩上下文要用一次模型，填好之后才能用。 模型本身在顶栏的全局设置里换。':
    'No API Key filled in for this provider yet: compacting the context makes one model call, so fill the Key in first. The model itself is switched in the top-bar global settings.',
  '上下文快满时自动压缩': 'Auto-compact when the context is nearly full',
  '到达下面的阈值时，让导师把前面的对话折成一份交接摘要（旧消息随即失活），不必等用户动手':
    'When the threshold below is reached, the tutor folds the earlier conversation into a handoff summary (older messages are retired at once) — no need to wait for the user',
  '自动压缩阈值': 'Auto-compact threshold',
  '上下文占用到 {0}% 时压一次': 'Compact once when the context reaches {0}%',
  '窗口占用由服务端上一轮报回来的用量算，不是估算。留三成余量是有意的： 一轮里模型要来回好几跳，每一跳的输入都比上一跳大，压到只剩一点余量时最后一跳容易顶着窗口报错。 压缩本身是一轮工作流（导师自己写摘要，见「更多 → 压缩上下文」）。':
    'Window usage comes from the usage the server reported last round, not an estimate. The 30% headroom is deliberate: one round takes several hops and each hop reads more than the last — compress too close to the limit and the final hop can hit the window and error out. Compaction itself is one workflow round (the tutor writes the summary itself; see "More → Compact context").',
  '压缩之后，被压掉的那些消息**不再进入上下文，只在界面上显示**（原来的内容一条都不会删）—— 对话区里那条虚线就是分界线，点「看摘要」能核对导师到底记住了什么。 想立刻压一次，用输入框左下角「更多 → 压缩上下文」。':
    'After compaction the folded-away messages no longer enter the context and remain visible in the UI only (nothing is deleted). The dashed line in the conversation is the boundary — click "View summary" to check what the tutor actually remembered. To compact right away, use "More → Compact context" at the bottom-left of the input box.',
  '恢复默认（自动 · 70% · 保留 8 条）': 'Reset to defaults (auto · 70% · keep 8)',
  '改动立即生效': 'Changes take effect immediately',
  '未配置 API Key': 'API Key not configured',

  /* ---------- AgentSettingsModal：开发者分页 ---------- */
  '这一页平时不显示。输入口令解锁（与全局设置里的开发者分页共用），解锁后会记住。':
    'This tab is hidden normally. Enter the passcode to unlock (shared with the developer tab in global settings); it stays unlocked afterwards.',
  '启用上下文比对调试器': 'Enable the context diff debugger',
  '每次把上下文发往 API 之前记录一份快照（系统提示词 + 全部消息 + 工具声明）':
    'Records a snapshot before each context goes to the API (system prompt + all messages + tool declarations)',
  '前缀缓存按逐字节匹配，命中率低几乎总是「某段上下文在两轮之间悄悄变了」。 调试器把两份快照逐条比对，差异直接定位到第几条消息、第几个字符。':
    'Prefix caching matches byte for byte — a low hit rate almost always means some part of the context quietly changed between two rounds. The debugger diffs two snapshots item by item and pins the difference down to the message and the character.',
  '打开调试器': 'Open debugger',
  'execute 工具 api 上下文管理': 'execute tool API context management',
  '当前 agent 在沙箱里可用的全部 api。用法写进系统提示词的那份（learn/ai 的 EXECUTE_GUIDE） 与这里是同一份能力的两个视图；模型调了不存在的 api 会得到「沙箱里没有这个 api」。':
    'Every API the agent can use inside the sandbox. This is the same capability set as the prompt-side reference (EXECUTE_GUIDE in learn/ai), seen from the other side; calling a nonexistent API gets the model "no such API in the sandbox".',
  '{0} 个 api': '{0} APIs',
  '有考试工具时': 'While exam tools are present',
  '主窗口界面在场时': 'While the main window UI is up',
  '这些都是调试工具，普通使用不需要打开它们。快照只留在内存里，关掉应用就没了；也不会发往任何服务。':
    'These are debugging tools; everyday use does not need them. Snapshots live in memory only and vanish when the app closes; nothing is sent to any service.',

  /* ---------- AgentSettingsModal：工作流分页 ---------- */
  '全局': 'Global',
  '目标级': 'Goal-level',
  '随应用提供，触发入口在对话与文档区里，不可删除': 'Ships with the app; triggered from the conversation and document areas; cannot be deleted',
  '每个学习目标的导师都能用': 'Available to the tutor of every learning goal',
  '只在当前学习目标里可用': 'Available only in the current learning goal',
  '{0} 条 · {1}': '{0} entries · {1}',
  '工作流是「不由一条消息直接驱动」的任务模板：开讲、回忆、出卷、超级实验室…… 它们不进系统提示词——被触发时，指令才以一条 user 消息整段进入上下文（对话里是一条分界条）。 想登记新的工作流，在对话里让超级导师用':
    'Workflows are task templates not driven directly by a single message: Teach, Recall, Generate exam, Super Lab… They never enter the system prompt — only when triggered do the instructions enter the context as one user message (a divider in the conversation). To register a new workflow, ask the Super Tutor in the conversation to use ',
  '完成，这里会立刻看到。': 'to set it up — it will show up here right away.',
  '触发要参数：{0}': 'Needs parameters to trigger: {0}',
  '指令 {0} 字': 'Instruction: {0} chars',
  '思考档位：工作流轮的档位独立于聊天滑条。默认 = 内置推荐档；跟随聊天 = 用滑条那档':
    'Reasoning effort: workflow rounds use their own effort, independent of the chat slider. Default = the built-in recommendation; Follow chat = use the chat slider level',
  '思考': 'Effort',
  '默认（{0}）': 'Default ({0})',
  '跟随聊天': 'Follow chat',
  '运行': 'Run',
  '（还没有登记的工作流）': '(no workflows registered yet)',
  '删除工作流「{0}」？': 'Delete workflow "{0}"?',
  '删除后这个触发入口就没了，指令文本也无法恢复；需要时可以让超级导师重新登记一份。':
    'Deleting removes this trigger for good and the instruction text cannot be recovered; you can always ask the Super Tutor to register a new one.',

  /* ---------- 子代理（SubAgentMenu / AgentPanel 子会话视图 / Composer 子会话模式） ---------- */
  '子代理会话': 'Sub-agent sessions',
  '返回导师对话': 'Back to the tutor conversation',
  '自定义': 'Custom',
  '任务进行中': 'Task running',
  '上次被中断': 'Last task interrupted',
  '上次出错': 'Last task failed',
  '空闲': 'Idle',
  '独立上下文 · {0} 次任务': 'Independent context · {0} tasks',
  '子会话只读': 'sub-session is read-only',
  '子会话只接受导师的调度——回到导师对话给它派任务。':
    'Sub-sessions only take orders from the tutor — go back to the tutor conversation to dispatch tasks.',
  '子代理正在准备': 'Sub-agent is preparing',
}

export default dict
