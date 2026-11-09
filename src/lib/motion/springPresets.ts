/**
 * 运动与弹簧物理曲线预设（基于 anime.js v4）。
 *
 * 遵循「纸墨与微物理」（Paper, Ink & Spring）的设计哲学：
 * 绝不使用浮夸艳俗的霓虹旋转或迟缓的大弹性动画，而是追求：
 * 1. 紧凑清脆（Snappy）：微交互如按压、切换，响应极快（150-250ms）；
 * 2. 细腻克制（Gentle）：展开、浮层、滑块过渡，平滑如丝，无顿挫；
 * 3. 物理惯性（Inertia）：旋转、复位带有阻尼回弹，不突兀。
 */
import { cubicBezier } from 'animejs'

/** 自然的非线性平滑减速曲线（用于大面积元素、视口滚动、弹窗展开） */
export const EASE_NATURAL = cubicBezier(0.16, 1, 0.3, 1)

/** 紧凑淡出曲线（用于元素关闭、离开视口） */
export const EASE_EXIT = cubicBezier(0.4, 0, 1, 1)

/** 紧凑利落的微交互缓动（用于按键轻压回弹、图标反馈） */
export const EASE_SNAPPY = 'out(3)'

/** 带有适度俏皮回弹的缓动（用于勾选徽章、成功提示、气泡弹出） */
export const EASE_BOUNCY = 'outBack(1.4)'

/** 旋转阻尼缓动 */
export const EASE_SPIN = 'out(3)'
