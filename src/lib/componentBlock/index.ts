/**
 * 结构化教学组件围栏 (```component) 模块入口
 *
 * 语法规范：
 * ```component
 * <Notice type="warn">
 *   <div #title>易错陷阱 · 边界条件</div>
 *   <div #describe>当分母趋近于 0 时，**不能直接代入求值**</div>
 * </Notice>
 * ```
 */

import type { PluginRenderContext } from '../renderPlugins'
import { renderInline } from '../markdown'
import { parseComponentBlock } from './parser'
import {
  renderBreakdown,
  renderCompare,
  renderConcept,
  renderFormula,
  renderGenericCard,
  renderNotice,
  renderPipeline,
  renderQuiz,
  renderStat,
  renderSteps,
} from './renderers'
import type { ComponentNode, ComponentRenderCtx } from './types'

export const COMPONENT_LANG = 'component'

/**
 * 教学 Agent 的 Component 语法指引（用于排版指南与系统提示词，替代繁琐的 HTML 标签）
 */
export const COMPONENT_SYNTAX_GUIDE = `结构化教学排版组件（\`\`\`component 围栏，用于替代冗长 HTML 配方，大幅节省 token 并规避标签未闭合问题）：
在 \`\`\`component 围栏内使用轻量语义标签与 \`#插槽名\` 属性组织内容，自动渲染为出版级直角精装卡片：
1. 提示框 (Notice)：<Notice type="warn|seal|ok|sky"><div #title>眉标标题</div><div #describe>详细内容（支持 Markdown / 公式）</div></Notice>
2. 双栏正误辨析 (Compare)：<Compare><div #left title="直觉误区" badge="常见错误" type="warn">内容</div><div #right title="严格定义" badge="正确认知" type="ok">内容</div></Compare>
3. 定理公式解剖卡 (Formula)：<Formula title="定理名称" expr="数学表达式"><div #item name="项名" tone="seal">含义解释</div></Formula>
4. 贯穿步骤轴 (Steps)：<Steps><div #step title="步骤标题">步骤说明</div></Steps>
5. 机制推导链 (Pipeline)：<Pipeline><div #stage label="STAGE 01" title="阶段标题" tone="seal">阶段说明</div></Pipeline>
6. 关键指标看板 (Stat)：<Stat><div #item label="指标名" value="大号数值" tone="seal">解读说明</div></Stat>
7. 词典式术语名片 (Concept)：<Concept><div #term>概念名</div><div #en>英文名</div><div #tag>领域标签</div><div #describe>定义</div></Concept>
8. 构成比例条 (Breakdown)：<Breakdown title="标题" total="总计 100%"><div #item label="类别" value="55%" tone="seal"></div></Breakdown>
9. 随堂微测自检卡 (Quiz)：<Quiz><div #title>自测问答</div><div #question>设问</div><div #answer>思路与答案解析（点击展开）</div></Quiz>`

/** 根据组件标签名调度对应的渲染器 */
function renderSingleComponent(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const tag = node.tag.toLowerCase()

  switch (tag) {
    case 'notice':
    case 'callout':
    case 'alert':
    case 'tip':
      return renderNotice(node, ctx)

    case 'compare':
    case 'duel':
    case 'diff':
    case 'split':
      return renderCompare(node, ctx)

    case 'formula':
    case 'anatomy':
    case 'theorem':
      return renderFormula(node, ctx)

    case 'steps':
    case 'timeline':
    case 'procedure':
    case 'sop':
      return renderSteps(node, ctx)

    case 'pipeline':
    case 'chain':
    case 'flow':
      return renderPipeline(node, ctx)

    case 'stat':
    case 'dashboard':
    case 'metrics':
    case 'indicator':
      return renderStat(node, ctx)

    case 'concept':
    case 'term':
      return renderConcept(node, ctx)

    case 'breakdown':
    case 'segments':
    case 'progress':
      return renderBreakdown(node, ctx)

    case 'quiz':
    case 'check':
    case 'question':
      return renderQuiz(node, ctx)

    case 'card':
    case 'banner':
    default:
      return renderGenericCard(node, ctx)
  }
}

/**
 * component 围栏渲染主函数
 */
export function componentBlock(source: string, ctx: PluginRenderContext, _info?: string): string {
  const clean = source.trim()
  if (!clean) return ''

  try {
    const nodes = parseComponentBlock(clean)
    if (!nodes.length) return ''

    const renderCtx: ComponentRenderCtx = {
      escape: ctx.escape,
      renderInline: (text: string) => renderInline(text),
    }

    return nodes.map((node) => renderSingleComponent(node, renderCtx)).join('\n\n')
  } catch (err) {
    console.warn('[componentBlock] 解析失败，退回源码展示:', err)
    return (
      `<div class="moji-component-error border border-warn/40 bg-sunken/40 p-3 text-[0.85em]">` +
      `<pre><code>${ctx.escape(clean)}</code></pre>` +
      `</div>`
    )
  }
}

export * from './types'
export * from './parser'
export * from './renderers'
