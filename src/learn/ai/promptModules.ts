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
    text: `## 文档排版与视觉呈现（教学讲义排版与组件规范）

> 通篇只有标题和段落的文档不算讲义（渲染器给裸标签的只是兜底样式）。每份教学文档至少落下 **3~4 处结构化视觉组件**（使用 \`\`\`component 围栏，辅以原生表格与公式）。**数据 / 趋势类图表一律走 \`\`\`plot / \`\`\`pisc / \`\`\`mermaid 围栏**（各有专节），严禁手写繁琐的内嵌 SVG 或原生 HTML 图表。

### 1. 画布前提与设计令牌
1. **画布尺寸**：正文列宽上限 \`800px\`，可用内容净宽约 \`745px\`。
2. **纸墨风主题令牌（跟随深浅色，严禁硬编码刺眼纯色）**：
   - 背景层：\`bg-paper\`（底纸）/ \`bg-card\`（浮起）/ \`bg-sunken\`（微凹）/ \`bg-inset\`（深凹槽）/ \`bg-mark\`（荧光笔底）
   - 墨色层：\`text-ink-strong\`（主标题）/ \`text-ink\`（正文）/ \`text-ink-soft\`（次要）/ \`text-ink-faint\`（注脚）
   - 线条层：\`border-line\` / \`border-line-strong\`
   - 语义色：\`seal\`（朱砂，主强调）/ \`ok\`（青竹，正确结论）/ \`warn\`（琥珀，易错警告），均有 text- / bg- / border- 前缀
3. **排版铁律**：字号一律 \`em\` 禁 px（正文支持等比缩放；常用档位 0.72 / 0.8 / 0.88 / 0.96em，大号数据 1.45~1.75em）；表格图表编号加 \`tabular-nums\`；**容器与卡片严禁任何圆角**（rounded-lg / md / sm 一律不用，保持纯正直角骨骼感）——仅步骤序号圆圈与微缩状态圆点可用 \`rounded-full\`；边框优先于阴影。

### 2. 结构化排版组件（\`\`\`component 围栏）与动态签名
正文结构化卡片严禁手写内嵌 HTML 标签！一律使用 \`\`\`component 围栏：
\`\`\`component
<Notice type="warn">
  <div #title>核心结论</div>
  <div #describe>详细内容说明</div>
</Notice>
\`\`\`
已注册的配方组件已从系统提示词解耦，使用前需通过 execute API 动态获取组件签名：
- \`api.design.component.list()\`（亦支持 \`api.design.componet.list\`）：获取已注册的配方组件清单，只暴露作用简短描述与组件 id，大幅节省 token。
- \`api.design.component.get(idOrTag)\`：获取详细的组件签名（可用 slots 插槽、attrs 属性、示例 example 与模板结构）。
- 扩展配方组件：支持 \`api.design.component.register\`（注册）、\`update\`（更新）、\`delete\`（删除）。

### 3. 四条排版审美纪律（必读）
1. **视觉呼吸感（禁止盒子堆砌）**：不要把整篇文档切成十几个连续卡片——任意两个组件之间必须有 1~2 段平实的 Markdown 正文过渡；留白、字号层级和一条细分隔线比满屏边框耐读。
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

/** 取出一个模块的完整文本（找不到抛错） */
export function moduleTextOf(key: string): string {
  const mod = PROMPT_MODULES.find((m) => m.key === key)
  if (!mod) throw new Error('未知的提示词模块：' + key)
  return mod.text
}
