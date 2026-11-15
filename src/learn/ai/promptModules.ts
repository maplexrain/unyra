/**
 * 这个文件负责什么：内容形态的排版 / 写法规范文本（doc-html、plot-forms、rich-animation）。
 *
 * 架构现状（2026-11 瘦身重构后）：这三份规范**随系统提示词首轮静态注入**
 * （teacherSystem 经 moduleTextOf 引用）——它们是「写教学文档 / 函数图像 / 动画」
 * 的高频配套，静态在场让首份文档就不缺配方（v0.5.8 教训：配方晚一轮，第一份文档
 * 永远是草稿）。曾有的按需动态注入（api 组触发 / 内容嗅探 / 内置工作流 promptModule）
 * 已随全量静态提示词退役；动态通道现在只服务**用户登记工作流的 prompt 字段**
 * （见 learn/workflows 的 workflowModules 与 useAgent 的轮首注入）。
 *
 * 纪律：
 * - **文本与实现对账**：渲染器改了写法，这里的说明也要改；示例里的类名是 load-bearing 的，
 *   压缩文案不许动 class 串。
 * - 图表一律走 ```plot / ```pisc / ```mermaid 围栏（各有专节），HTML 配方不承载图表。
 */
import type { ConversationMessage } from '../../agent/types'
import { t } from '../../i18n'

export interface PromptModule {
  /** 稳定标识 */
  key: string
  /** 界面分界条上显示的名字（mark = 提示词模块 · {title}） */
  title: string
  /** 注入上下文的完整文本 */
  text: string
}

export const PROMPT_MODULES: PromptModule[] = [
  {
    key: 'plot-forms',
    title: '函数图像的数据形态',
    text: `函数图像的 data 各形态（\`\`\`plot 的完整数据写法）——data 数组每项取下列形态之一（points / parametric / polar / implicit 必须写 graphType，否则会当成区间采样而报错）：
1) 显式函数：{ "fn": "x^2" }
   可加切线：{ "fn": "x^2", "derivative": { "fn": "2*x", "x0": 1 } }
   可加割线：{ "fn": "x^2", "secants": [{ "x0": 0, "x1": 1 }] }
   可指定颜色：{ "fn": "sin(x)", "color": "#a8432f" }
2) 参数曲线（变量用 t）：{ "graphType": "polyline", "fnType": "parametric", "x": "cos(t)", "y": "sin(t)" }
3) 极坐标（变量用 theta）：{ "graphType": "polyline", "fnType": "polar", "r": "1 + cos(theta)" }
4) 散点：{ "graphType": "scatter", "fnType": "points", "points": [[1, 1], [2, 4]] }
5) 向量：{ "graphType": "polyline", "fnType": "vector", "vector": [2, 1], "offset": [0, 0] }
6) 隐函数（用 interval 采样，需同时给 graphType 与 fnType）：
   { "graphType": "interval", "fnType": "implicit", "fn": "x^2 + y^2 - 1" }

其余写法要求：
- 表达式里只能用数学函数与四则运算，不要出现浏览器对象或函数定义。
- 图像默认不可缩放（避免在文档里滚动时误触），需要交互缩放时加 "disableZoom": false。`,
  },
  {
    key: 'rich-animation',
    title: '富媒体动画写法',
    text: `富媒体动画（现成的文档动画、SVG SMIL 与内嵌 CSS 动画）。动画要克制：同一屏最多一两个，服务于讲解本身，不做装饰性干扰。
- **先用现成的四个**（正文里当工具类写）：animate-doc-fade、animate-doc-rise、animate-doc-grow（配 origin-bottom 由小变大浮现）、animate-doc-draw（配 pathLength="1" 与 stroke-dasharray="1" 做线条生长）。九成的「动起来才看得懂」用这四个就够。
- SVG 内嵌动画（用 SMIL，适合「动起来才看得懂」的过程：波的传播、向量旋转、极限逼近）：可用 <animate>、<animateTransform>、<animateMotion>、<set>，并加 repeatCount="indefinite" 循环：
  <svg viewBox="0 0 200 60"><circle r="6" fill="#a8432f">
    <animateMotion dur="3s" repeatCount="indefinite" path="M10,30 L190,30"/></circle></svg>
- 内嵌 CSS 动画（用 <style> 定义 @keyframes 做持续运动；适合脉冲、高亮、旋转）：
  <style>.moji-demo-pulse{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}</style>
  <span class="moji-demo-pulse">正在闪烁的要点</span>
- 内嵌 <style> 里的每条选择器都必须带本项目独有的前缀（如 .moji-demo-xxx），避免样式泄漏；建议每个动画用不同前缀。
- SVG 里 fill / stroke 用具体颜色或 currentColor，深浅色模式下都要能看清（不要只用纯黑或纯白）。
- 内嵌 HTML 必须闭合良好；不确定能否渲染的写法就退回纯 Markdown。`,
  },
  {
    key: 'doc-html',
    title: '文档排版与视觉呈现',
    text: `## 文档排版与视觉呈现（教学讲义 HTML + Tailwind 精装规范）

> 通篇只有标题和段落的文档不算讲义（渲染器给裸标签的只是兜底样式）。每份教学文档至少落下 **3~4 处结构化视觉组件**（从下方 9 个配方中选型，辅以原生表格与公式）。**数据 / 趋势类图表一律走 \`\`\`plot / \`\`\`pisc / \`\`\`mermaid 围栏**（各有专节），本规范不手写 SVG 或 HTML 图表。

### 1. 画布前提与设计令牌
1. **画布尺寸**：正文列宽上限 \`800px\`，可用内容净宽约 \`745px\`。
2. **纸墨风主题令牌（跟随深浅色，严禁硬编码刺眼纯色）**：
   - 背景层：\`bg-paper\`（底纸）/ \`bg-card\`（浮起）/ \`bg-sunken\`（微凹）/ \`bg-inset\`（深凹槽）/ \`bg-mark\`（荧光笔底）
   - 墨色层：\`text-ink-strong\`（主标题）/ \`text-ink\`（正文）/ \`text-ink-soft\`（次要）/ \`text-ink-faint\`（注脚）
   - 线条层：\`border-line\` / \`border-line-strong\`
   - 语义色：\`seal\`（朱砂，主强调）/ \`ok\`（青竹，正确结论）/ \`warn\`（琥珀，易错警告），均有 text- / bg- / border- 前缀
3. **排版铁律**：字号一律 \`em\` 禁 px（正文支持等比缩放；常用档位 0.72 / 0.8 / 0.88 / 0.96em，大号数据 1.45~1.75em）；表格图表编号加 \`tabular-nums\`；**容器与卡片严禁任何圆角**（rounded-lg / md / sm 一律不用，保持纯正直角骨骼感）——仅步骤序号圆圈与微缩状态圆点可用 \`rounded-full\`；边框优先于阴影；**HTML 配方内部标签之间严禁留空行**（空行会让 Markdown 解析器把 HTML 拦腰截断）。

### 2. 九个精装配方（照抄结构、替换文字与数据）

#### 配方一：带眉标的提示框（核心结论 / 易错警示 / 思考锚点）
核心结论用 \`border-l-seal\` + \`text-seal\`；定理总结用 \`border-l-ok\`；易错陷阱用 \`border-l-warn\`。
\`\`\`html
<div class="my-5 border border-line border-l-4 border-l-warn bg-sunken/60 px-5 py-3.5"><div class="flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-warn"></span><span class="text-[0.72em] font-semibold tracking-widest text-warn">易错陷阱 · 边界条件</span></div><p class="mt-1.5 mb-0 text-[0.88em] leading-relaxed text-ink">当分母趋近于 0 时，<strong>不能直接代入求值</strong>，必须先通过因式分解或洛必达法则消去零因子。</p></div>
\`\`\`

#### 配方二：双栏概念交锋 / 正误辨析（每栏约 360px；顶部色条或语义徽章区分立场）
\`\`\`html
<div class="my-5 grid grid-cols-2 gap-4"><div class="border border-line bg-sunken/50 p-4"><div class="flex items-center justify-between border-b border-line pb-2"><span class="text-[0.92em] font-semibold text-ink-strong">直觉误区</span><span class="bg-warn/15 px-1.5 py-0.5 text-[0.72em] font-semibold text-warn">✗ 常见错误</span></div><p class="mt-2.5 mb-0 text-[0.86em] leading-relaxed text-ink-soft">认为导数等于 0 的点一定是极值点，忽略了导数在驻点两侧是否变号。</p></div><div class="border border-line bg-card p-4"><div class="flex items-center justify-between border-b border-line pb-2"><span class="text-[0.92em] font-semibold text-ink-strong">严格定义</span><span class="bg-ok/15 px-1.5 py-0.5 text-[0.72em] font-semibold text-ok">✓ 正确认知</span></div><p class="mt-2.5 mb-0 text-[0.86em] leading-relaxed text-ink">驻点只是极值点的<strong>候选人</strong>。如 y = x³ 在 x = 0 处导数为 0，但两侧皆正，属于拐点而非极值点。</p></div></div>
\`\`\`

#### 配方三：定理 / 核心公式解剖卡（上半部居中核心表达式，下半部多栏拆解每项意义）
\`\`\`html
<div class="my-6 border border-line bg-card overflow-hidden"><div class="border-b border-line bg-sunken/50 px-5 py-4 text-center"><div class="text-[0.72em] font-semibold tracking-widest text-ink-faint">核心表达式 · 贝叶斯定理</div><div class="mt-1.5 text-[1.35em] font-semibold tracking-wide text-ink-strong tabular-nums">P(A|B) = [ P(B|A) · P(A) ] / P(B)</div></div><div class="grid grid-cols-3 divide-x divide-line bg-paper/40 text-[0.82em]"><div class="p-3.5"><span class="font-semibold text-seal">P(A|B) 后验概率</span><p class="mt-1 mb-0 leading-snug text-ink-soft">看到新证据 B 后，对事件 A 发生概率的修正认知。</p></div><div class="p-3.5"><span class="font-semibold text-ink-strong">P(B|A) 似然度</span><p class="mt-1 mb-0 leading-snug text-ink-soft">假定 A 成立的前提下，观察到现象 B 的可能性。</p></div><div class="p-3.5"><span class="font-semibold text-ink-soft">P(A) 先验概率</span><p class="mt-1 mb-0 leading-snug text-ink-soft">在没有新证据之前，基于历史经验对 A 的初始判断。</p></div></div></div>
\`\`\`

#### 配方四：带贯穿引导线的步骤轴（推导过程 / 解题 SOP / 历史演进）
左侧 \`border-l\` 贯穿竖线，序号圆圈压在线上，每步自带小标题与微说明。
\`\`\`html
<div class="my-5 pl-3"><div class="relative border-l border-line-strong pl-6 space-y-5"><div class="relative"><span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-seal text-[0.72em] font-semibold text-white tabular-nums">1</span><h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">定位系统边界与研究对象</h4><p class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">明确把哪个物体或物体系隔离出来，圈出所有接触面与场力来源。</p></div><div class="relative"><span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-seal text-[0.72em] font-semibold text-white tabular-nums">2</span><h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">建立正交坐标系并正交分解</h4><p class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">沿加速度方向建立 x 轴，垂直方向建 y 轴，将斜向力投影到坐标轴上。</p></div><div class="relative"><span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-strong text-[0.72em] font-semibold text-white tabular-nums">3</span><h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">联立平衡方程或牛顿第二定律求解</h4><p class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">分别列出 ΣFx = ma 与 ΣFy = 0，消去未知中间量。</p></div></div></div>
\`\`\`

#### 配方五：横向机制推导链（因果流 / 编译管线 / 状态转化——「A 导致 B 导致 C」比纯文字直观十倍）
\`\`\`html
<div class="my-5 flex items-stretch justify-between gap-2 border border-line bg-sunken/40 p-3.5 text-[0.84em]"><div class="flex-1 bg-card p-3 border border-line"><div class="text-[0.72em] text-ink-faint tabular-nums">STAGE 01</div><div class="mt-0.5 font-semibold text-ink-strong">源码输入</div><p class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">字符流读入内存</p></div><div class="flex items-center text-ink-faint px-1">→</div><div class="flex-1 bg-card p-3 border border-line"><div class="text-[0.72em] text-seal tabular-nums">STAGE 02</div><div class="mt-0.5 font-semibold text-ink-strong">词法与语法分析</div><p class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">生成抽象语法树 AST</p></div><div class="flex items-center text-ink-faint px-1">→</div><div class="flex-1 bg-card p-3 border border-seal/50"><div class="text-[0.72em] text-ok tabular-nums">STAGE 03</div><div class="mt-0.5 font-semibold text-ink-strong">目标代码生成</div><p class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">输出机器指令序列</p></div></div>
\`\`\`

#### 配方六：关键指标 / 参数看板（顶栏分类标签，中间大号 tabular-nums 数据，底栏一句解读）
\`\`\`html
<div class="my-5 grid grid-cols-3 gap-4"><div class="border border-line bg-card px-4 py-3.5"><div class="text-[0.74em] text-ink-faint">时间复杂度（平均）</div><div class="mt-1 text-[1.5em] font-semibold text-seal tabular-nums">O(n log n)</div><div class="mt-1 text-[0.78em] text-ink-soft">分治递归的最优平衡点</div></div><div class="border border-line bg-card px-4 py-3.5"><div class="text-[0.74em] text-ink-faint">最坏退化情况</div><div class="mt-1 text-[1.5em] font-semibold text-warn tabular-nums">O(n²)</div><div class="mt-1 text-[0.78em] text-ink-soft">基准值每次恰好选到极值</div></div><div class="border border-line bg-card px-4 py-3.5"><div class="text-[0.74em] text-ink-faint">原地空间开销</div><div class="mt-1 text-[1.5em] font-semibold text-ok tabular-nums">O(log n)</div><div class="mt-1 text-[0.78em] text-ink-soft">仅消耗递归调用栈深度</div></div></div>
\`\`\`

#### 配方七：词典式术语名片（引入新概念 / 专有名词时：词条名 + 英文对照 + 领域标签 + 一句话本质定义）
\`\`\`html
<div class="my-4 border border-line bg-card px-5 py-3.5"><div class="flex items-baseline justify-between border-b border-line pb-2"><div class="flex items-baseline gap-2.5"><span class="text-[1.05em] font-semibold text-ink-strong">熵增定律</span><span class="text-[0.82em] italic text-ink-faint">Law of Increasing Entropy · ΔS ≥ 0</span></div><span class="bg-sunken px-2 py-0.5 text-[0.72em] text-ink-soft">热力学第二定律</span></div><p class="mt-2.5 mb-0 text-[0.88em] leading-relaxed text-ink">在孤立系统中，热量总是自发地从高温物体流向低温物体，系统的<strong>微观无序度（熵）</strong>永远不会自发减少。</p></div>
\`\`\`

#### 配方八：分段式构成条（比例拆解 / 时间分配 / 内存布局——多色块拼接 + 底部圆点图例）
\`\`\`html
<div class="my-5 border border-line bg-card p-4"><div class="flex items-baseline justify-between text-[0.84em]"><span class="font-semibold text-ink-strong">典型深度学习训练显存占用构成</span><span class="tabular-nums text-ink-faint">总计 100%</span></div><div class="mt-2.5 flex h-3 w-full overflow-hidden bg-inset gap-0.5"><div class="h-full bg-seal" style="width:55%"></div><div class="h-full bg-ok" style="width:25%"></div><div class="h-full bg-warn" style="width:20%"></div></div><div class="mt-2.5 flex items-center gap-5 text-[0.76em] text-ink-soft"><span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full bg-seal"></i>优化器状态 <strong class="tabular-nums text-ink-strong">55%</strong></span><span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full bg-ok"></i>激活值缓存 <strong class="tabular-nums text-ink-strong">25%</strong></span><span class="flex items-center gap-1.5"><i class="inline-block h-2 w-2 rounded-full bg-warn"></i>模型权重与梯度 <strong class="tabular-nums text-ink-strong">20%</strong></span></div></div>
\`\`\`

#### 配方九：随堂微测 / 自检折叠卡（上方设问，下方虚线分割出带底色的「思路揭晓」，放小节末尾检验理解）
\`\`\`html
<div class="my-5 border border-line bg-card overflow-hidden"><div class="px-5 py-3.5"><span class="bg-seal/10 px-1.5 py-0.5 text-[0.72em] font-semibold text-seal">快问快答 · 概念自检</span><p class="mt-2 mb-0 text-[0.9em] font-semibold text-ink-strong">如果将单摆的摆球质量增加一倍，在小角度摆动下，它的固有周期 T 会如何变化？</p></div><div class="border-t border-dashed border-line bg-sunken/60 px-5 py-3 text-[0.84em] leading-relaxed text-ink-soft"><strong class="text-ok">✓ 答案：保持不变。</strong> 由单摆周期公式 T = 2π√(L/g) 可知，周期仅取决于摆长 L 与当地重力加速度 g，与摆球质量 m 无关。</div></div>
\`\`\`

### 3. 四条排版审美纪律（必读）
1. **视觉呼吸感（禁止盒子堆砌）**：不要把整篇文档切成十几个连续卡片——任意两个配方之间必须有 1~2 段平实的 Markdown 正文过渡；留白、字号层级和一条细分隔线比满屏边框耐读。
2. **色彩降噪**：高饱和语义色（seal / ok / warn）只给最核心的 1~2 个焦点数据，其余陪衬用 \`bg-seal/40\`、\`bg-ink-soft/40\` 或 \`bg-sunken\` 压暗——有暗才有亮。
3. **动画克制**：生长 / 描线 / 浮现只用在需要体现「过程感」的图表上，同一屏最多一处动画，静态能讲清的绝不乱动。
4. **图文互文**：每个组件下方配说明，且在紧邻正文里明确点出「请看图中的 X 处」——图表是推理链条的一环，不是凑数的装饰品。`,
  },
]

/**
 * 一条模块消息：隐藏 **assistant** 消息，promptModule 供去重。
 *
 * 模块是「怎么做」的**声明**（排版配方、规程）——固定内容、声明一次、同上下文不重复，
 * 归 assistant 边；「做什么」的指令（工作流、用户消息）才是 user。与 personaMessage
 * 同一个形状家族，也是一条**提示词注入**（inject: 'prompt'）：它不分割轮次，界面上
 * 并进那一轮的「思考、工具与提示词」过程组（见 agent/messageKind 与 panel/partGroups）。
 */
export function promptModuleMessage(mod: PromptModule, uuid: string, at: number): ConversationMessage {
  return {
    id: uuid,
    role: 'assistant',
    parts: [{ type: 'text', text: mod.text }],
    ts: at,
    hidden: true,
    mark: t('提示词模块 · {0}', mod.title),
    promptModule: mod.key,
    inject: 'prompt',
  }
}

/**
 * 去重判据：keys 里哪些模块**还没有**出现在活着的上下文里。
 *
 * 两种形态都算「已注入」：
 * - 回复里的 prompt-module 片段（mid-loop 边界注入，见 agent/types）；
 * - 轮开始时注入的独立隐藏消息（工作流触发，字段在消息上）。
 * 只统计 !retired——被压缩折掉的不再进上下文，必须允许重新注入
 * （与 needsPersonaAnnounce 的判据同一口径）。
 * 调用方传的消息列表必须与「这次请求真正会发的历史」同源（同一份 Conversation.messages）。
 */
export function missingPromptModules(messages: ConversationMessage[], keys: string[]): string[] {
  const alive = new Set<string>()
  for (const m of messages) {
    if (m.retired) continue
    if (m.promptModule) alive.add(m.promptModule)
    for (const p of m.parts) {
      if (p.type === 'prompt-module') alive.add(p.key)
    }
  }
  return [...new Set(keys)].filter((k) => !alive.has(k))
}

/**
 * 界面显示用：一个模块 key 的标题。未知 key（老对话的历史残留——已退役模块、
 * 被删掉的规程）返回 null，调用方回退 key 本身；'wf:<id>' 是登记工作流的
 * prompt 模块（见 learn/workflows 的 workflowModules）。
 */
export function promptModuleTitleOf(key: string): string | null {
  if (key.startsWith('wf:')) return '工作流规程'
  return PROMPT_MODULES.find((m) => m.key === key)?.title ?? null
}
