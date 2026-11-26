/**
 * 内容声部（导师 / 出卷 / 设计）共用的排版与视觉指南。
 *
 * 这是替换后的单一排版规范：介质分工、component 围栏与动态 API、纸墨风设计令牌、
 * 四条视觉审美纪律。外层由 workSystem 用 `<content_layout>` 包住，常量本身不再带标签。
 */
export const SHARED_TYPOGRAPHY_GUIDE = [
  '### 1. 排版层级与基础规范',
  '- **介质分工**：教学文档以**标准 Markdown 为主**（标题、列表、表格、引用、代码块）；每份文档至少包含 **3~4 处结构化视觉组件**（使用 ```component 围栏）；数据/趋势图表一律走 ```plot / ```pisc / ```mermaid 围栏。严禁手写整页 HTML、繁琐内嵌 SVG、原生 HTML 图表或待办勾选框（`<input type="checkbox">`）。仅在少量交互补充（如折叠、按钮）时使用轻量 HTML + Tailwind（正文如 `<p class="text-[0.9em] leading-[1.85] text-ink">`）。',
  '- **LaTeX 兼容性**：仅用 `$...$` 与 `$$...$$`（禁用 `\\(...\\)`、`\\[...\\]`）；仅用核心命令（禁用 `\\usepackage`、`\\newcommand`、`\\label`/`\\ref`）；禁用 Unicode 近似数学字符（写 `\\alpha`、`x^2`、`\\sqrt{2}` 而非 `α`、`x²`、`√2`）；公式内中文放入 `\\text{...}`。脚本拼接用 `String.raw`，若写入回执报「疑似公式损坏」，按提示改写后重发。',
  '',
  '### 2. 结构化组件（```component 围栏）与动态 API',
  '- **先查签名再用**：使用前**必须**查签名，严禁自造或瞎猜插槽名。',
  '  - `api.design.component.list()`：获取已注册组件简表（id + 简述）。',
  '  - `api.design.component.get(idOrTag)`：获取完整签名（标签、slots、attrs、example、模板）。',
  '  - `api.design.component.register(...) / update(...) / delete(...)`：动态管理扩展组件。',
  '- **语法规则**：围栏语言为 `component`；用语义标签与 `key="value"` 属性；子元素用 `#插槽名` 指定插槽；正文允许轻量内联 HTML（`strong / em / code / ul / li`）。',
  '- **分组插槽两种等价写法**（如 `#left`、`#step`）：',
  '  - 属性写法：`<div #left title="直觉误区" badge="常见错误">正文</div>`',
  '  - 嵌套写法：`<div #left><div #title>直觉误区</div><div #content>正文</div></div>`（解析器会将 `#title/#label/#badge` 折叠为属性，将 `#content/#body/#describe` 或其余 HTML 折叠为正文）。',
  '- **示例**：',
  '```component',
  '<Notice type="warn">',
  '  <div #title>易错陷阱 · 边界条件</div>',
  '  <div #describe>当分母趋近于 0 时，<strong>不能直接代入求值</strong>，必须先通过因式分解或洛必达法则消去零因子。</div>',
  '</Notice>',
  '```',
  '',
  '### 3. 画布与纸墨风设计令牌',
  '- 画布尺寸：正文列宽上限 `800px`，内容净宽约 `745px`。',
  '- 色彩令牌（严禁硬编码刺眼纯色）：',
  '  - 背景：`bg-paper`（底纸）/ `bg-card`（浮起）/ `bg-sunken`（微凹）/ `bg-inset`（深凹槽）/ `bg-mark`（荧光笔底）',
  '  - 墨色：`text-ink-strong`（主标题）/ `text-ink`（正文）/ `text-ink-soft`（次要）/ `text-ink-faint`（注脚）',
  '  - 线条：`border-line` / `border-line-strong`',
  '  - 语义色：`seal`（朱砂·主强调）/ `ok`（青竹·正确）/ `warn`（琥珀·易错），均支持 `text-` / `bg-` / `border-` 前缀。',
  '- 排版与骨骼铁律：字号一律用 `em` 禁 `px`（常用 `0.72 / 0.8 / 0.88 / 0.96em`，大号数据 `1.45~1.75em`）；表格图表数字加 `tabular-nums`；容器与卡片严禁圆角（禁用 `rounded-lg/md/sm`，仅步骤序号圆圈与微缩状态点可用 `rounded-full`）；边框优先于阴影。',
  '',
  '### 4. 四条视觉审美纪律',
  '- **视觉呼吸感**：禁止连续堆砌卡片，任意两个组件间必须有 1~2 段平实的 Markdown 正文过渡。',
  '- **色彩降噪**：高饱和语义色（`seal / ok / warn`）只给最核心的 1~2 个焦点，陪衬用 `bg-seal/40`、`bg-ink-soft/40` 或 `bg-sunken` 压暗。',
  '- **动画克制**：动效仅用于体现「过程感」的图表，同屏最多一处，静态能讲清就不动。',
  '- **图文互文**：组件下方配说明，且紧邻正文必须明确点出「请看图中的 X 处」，让图表成为推理链条的一环。',
].join('\n')
