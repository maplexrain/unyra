/**
 * 内容声部（导师 / 出卷 / 设计）**共用**的排版与视觉指南。
 *
 * 只收三类都适用的排版内核，顺序沿用导师定稿：
 * 1. `component` 围栏与配方组件（结构化卡片，不手写 HTML）；
 * 2. 正文排版规范（Markdown 优先、em 与主题令牌、LaTeX 兼容、String.raw）；
 * 3. 「文档排版与视觉呈现」详细配方（两栏、提示框、时间轴、公式卡……）。
 *
 * 为什么不是导师整段「排版、语法与视觉规范指南」：那段里还有节点链接、学习目标大纲、
 * plot / pisc / mermaid / videos / quote / aiqa、富媒体动画等**教学文档专用语法**——
 * 出卷是试卷 JSON（图形走 `image` SVG），设计是课堂 `ui-*` 舞台与超级文档 HTML，
 * 各有自己的契约，搬过去只会教模型写出无效或冲突的围栏。共用只取排版/视觉内核，
 * 专用语法留在各自声部。
 *
 * 缓存纪律：这段对三位内容声部逐字节一致，放在共同基础前缀（P0）之后、固定组 api 之前，
 * 跨声部的缓存前缀因此能多命中一段。
 */

import { COMPONENT_SYNTAX_GUIDE } from '../../lib/componentBlock'
import { RICH_CONTENT_GUIDE } from './guides'
import { moduleTextOf } from './promptModules'

export const SHARED_TYPOGRAPHY_GUIDE = [
  COMPONENT_SYNTAX_GUIDE,
  '',
  RICH_CONTENT_GUIDE,
  '',
  moduleTextOf('doc-html'),
].join('\n\n')
