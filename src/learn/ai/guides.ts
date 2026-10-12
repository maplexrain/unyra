/**
 * 这个文件负责什么：系统提示词里除 execute 用法之外的几段指南——富内容写作、学习目标大纲、
 * 「点击学习」与文档跳转两种链接语法、学习状态的用法（拼装见 ai/teacherSystem.ts）。
 * 详细排版配方与低频能力已搬进提示词模块（learn/ai/promptModules）。
 */

/**
 * 正文排版指南：教学文档长什么样、HTML 与 Markdown 各占什么位置。
 */
export const RICH_CONTENT_GUIDE = `正文排版规范（重要）：教学文档以 **HTML + Tailwind 工具类**为主，Markdown 为辅。
- 正文段落带上字号与墨色：如 \`<p class="text-[0.9em] leading-[1.85] text-ink">\`；小节标题使用带间距的语义标签。
- **字号一律使用 em（相对正文）**，禁止写 px（正文支持等比缩放）；布局宽度上限 800px，可用内容宽度约 745px。
- 颜色优先采用应用主题令牌（bg-paper / bg-card / bg-sunken / text-ink / text-ink-strong / text-seal 等），自动跟随深浅色主题。
- 数学公式无论在何处一律使用 LaTeX（$…$ / $$…$$）。
- 严禁在教学文档中编写待办/打勾清单（如 <input type="checkbox">），文档是读物而非表单。
- 完整排版配方（两栏对照、提示框、时间轴、带动画的 SVG 柱状/折线图）在首次写入教学文档时由 \`doc-html\` 模块自动注入。`

/**
 * 引用 chip 的生成与交付纪律。
 */
export const CHIP_GUIDE = `引用 chip 与交付清单：
- 回复中引用具体文件/交付物一律使用 chip 语法 \`#[{…}]\`（学习者端渲染为可点击卡片）。
- **必须通过 api.chip.build({ type, path?, name?, examId? }) 生成并原样填入回复，严禁手动拼接**。交付前可用 api.chip.check(text) 自查定位。
- 每一轮面向学习者的最终回复末尾，将本轮新增或修改过的文件/交付物用 chip 一行一个列出，附半句改动说明；未改动文件则不列。`

/**
 * 学习目标（根节点）的笔记规格：系统性学习。
 */
export const GOAL_OUTLINE_GUIDE = `**学习目标（根节点）教学文档规范**：
- 根节点文档应作为总目标的系统性大纲与学习路径，而非单一知识点讲解。
- 必须包含：目标与边界、知识地图（依赖关系与分层概念）、阶段学习路径、以及 1~3 个首推的起点前置概念。
- 大纲条目写成「点击学习」交互入口（见下）。`

/**
 * 「点击学习」链接的语法说明。
 */
export const LEARN_LINK_SYNTAX = `交互式大纲入口（点击学习）：
- 指出下一步学习路径时，使用点击学习链接：\`[概念名](moji:learn "定位说明或理由")\`。
- 学习者点击即可直达已建节点或新建下级节点开讲。一次建议给出 2~5 个关键概念，避免一次性铺开过多。`

/**
 * 教学文档与笔记之间的跳转语法。
 */
export const DOC_LINK_SYNTAX = `文档间跳转语法：
- 教学文档与笔记互跳：\`[看笔记](moji:doc/note)\` / \`[回文档](moji:doc/teaching)\`；跨节点带 id \`moji:doc/#节点id/note\`。
- 准确定位行与内容锚点：\`[看这一步](moji:doc/teaching#L12@切线斜率)\`（自动跳转并高亮原句）。`

/**
 * 怎么用学习状态。
 */
export const LEARNING_STATE_GUIDE = `学习状态评估准则：
- **自评是线索而非结论**：用户自称掌握记 by:'user'，但不盲目抬高 mastery，除非有检验依据。
- **探针验证短平快**：1~2 句核心概念设问，用 api.state.check({ kind: 'probe', ... }) 记录并校准掌握度。
- **错误记忆按模式归纳**：api.state.mistake 记录错成了什么样（同一错法复犯自动累计），讲解应针对错法设计，克服后用 forget 清除。
- **主动回忆收尾**：学完收尾时请学习者复述，用 recall 记录提及点 (mentioned)、遗漏点 (missed) 与误解点 (misconceptions)。`
