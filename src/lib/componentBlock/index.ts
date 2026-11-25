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

import { type PluginRenderContext, escapeHtml, encodeAttr } from '../renderPlugins'
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
import { getDocumentComponent } from './registry'
import type { ComponentNode, ComponentRenderCtx } from './types'

/**
 * 教学 Agent 的 Component 语法指引（用于排版指南与系统提示词，替代繁琐易错的 HTML 标签）
 */
export const COMPONENT_SYNTAX_GUIDE = `### 结构化教学排版组件（\`\`\`component 围栏）

教学文档中的结构化卡片排版**严禁手写整页 HTML、样式或脚本**，必须使用 \`\`\`component 代码块：
1. 围栏语言标识为 \`component\`：\`\`\`component ... \`\`\`
2. 使用轻量语义标签定义组件（如 \`<Notice>\`、\`<Compare>\` 等），支持标准属性 \`key="value"\`。
3. 插槽标记：使用带 \`#插槽名\` 属性的子元素指定插槽内容（如 \`<div #title>标题</div>\` 或 \`<div #describe>内容</div>\`）。
4. 分组插槽（如 \`<div #left>\`、\`<div #step>\`）有两种等价写法：
   - 属性写法：\`<div #left title="直觉误区" badge="常见错误">正文</div>\`
   - 嵌套写法：\`<div #left><div #title>直觉误区</div><div #content>正文</div></div>\`
     解析器会把 \`#title / #label / #badge\` 折叠成属性，把 \`#content / #body / #describe\` 折叠成正文；
     省略 \`#content\` 时，\`#title\` 之外的 HTML（如 \`<ul>\`）同样按正文处理。
   两种写法都接受；正文允许轻量内联 HTML（strong / em / code / ul / li），不要写整套页面样式。
5. 使用前**必须**通过 \`api.design.component.get(idOrTag)\` 查一次签名，按签名里的插槽名与属性写；
   不要自造插槽（如把 \`#left\` 的 \`badge\` 写成 \`#tag\`）。拼错时先用签名核对，不要靠猜。
6. 语法示例：
\`\`\`component
<Notice type="warn">
  <div #title>易错陷阱 · 边界条件</div>
  <div #describe>当分母趋近于 0 时，<strong>不能直接代入求值</strong>，必须先通过因式分解或洛必达法则消去零因子。</div>
</Notice>
\`\`\`

#### 动态获取组件签名（Execute API）
排版组件配方已解耦为动态注册中心，使用前请通过沙箱 API 动态获取组件签名：
- \`api.design.component.list()\`（亦支持 \`api.design.componet.list()\`）：获取已注册组件清单，仅返回简短描述与组件 id，节省 token。
- \`api.design.component.get(idOrTag)\`：获取组件详细签名（标签、可用插槽 slots、属性 attrs、示例 example 与模板）。
- \`api.design.component.register(...) / update(...) / delete(...)\`：动态注册与管理扩展配方组件。`

/** 根据组件标签名调度对应的渲染器 */
function renderSingleComponent(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const customDef = getDocumentComponent(node.tag)
  if (customDef?.template) {
    let out = customDef.template
    for (const [key, val] of Object.entries(node.attrs)) {
      out = out.replaceAll(`{{${key}}}`, ctx.renderInline ? ctx.renderInline(val) : ctx.escape(val))
    }
    for (const [slot, items] of Object.entries(node.slots)) {
      const slotContent = items
        .map((it) => (ctx.renderInline ? ctx.renderInline(it.content) : ctx.escape(it.content)))
        .join('\n')
      out = out.replaceAll(`{{${slot}}}`, slotContent)
    }
    return out
  }

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

/**
 * 便捷工具：将 component DSL 源码（如配方 example）渲染为展示用 HTML（供设置面板样式预览）
 */
export function renderComponentPreview(source: string): string {
  const ctx: PluginRenderContext = {
    escape: escapeHtml,
    attr: encodeAttr,
  }
  return componentBlock(source, ctx)
}

export * from './types'
export * from './parser'
export * from './renderers'
export * from './registry'
