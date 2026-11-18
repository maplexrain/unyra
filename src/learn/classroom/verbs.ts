/**
 * 课堂 action.verb 白名单的唯一运行时事实源。
 *
 * VisualVerb（types.ts）是编译期类型；校验（audit.ts）、沙箱 verbs()、ActionCompiler
 * 的路由都从这里取——三方永远同一张表，不再各写一份。
 *
 * 两套体系严格分开（2026-11-18 定稿，此前提示词把两套混成一套教）：
 * - 这里是 **action.verb**：时间轴逐条调度（LessonScheduler），分状态动词与动画动词两类；
 * - data-anim（registry.ts 的 BUILTIN_ANIMATIONS）：换幕挂载时播一次，不受时间轴控制。
 *   registry 的名字同时是动画动词的来源之一（pulse 例外，见 ANIME_ACTION_VERBS 注释）。
 */
import { BUILTIN_ANIMATIONS } from './registry'

export interface VerbInfo {
  verb: string
  desc: string
}

/** 状态动词：由 ActionCompiler.applyFinalState 落终态（seek 可重现） */
export const STATE_VERBS: VerbInfo[] = [
  { verb: 'appear', desc: '移除 data-hidden，淡入并轻微上浮——唤醒初始隐藏元素的标配' },
  { verb: 'disappear', desc: '淡出并标记 data-hidden' },
  { verb: 'highlight', desc: '添加高亮发光类（params.color 自定义强调色）' },
  { verb: 'unhighlight', desc: '移除高亮发光类' },
  { verb: 'dimOthers', desc: '聚焦 target，同级兄弟元素降透明度至 0.25' },
  { verb: 'resetFocus', desc: '恢复同级兄弟元素透明度为 1' },
  { verb: 'move', desc: '相对当前位置平滑位移（params.x / y，1920×1080 像素系）' },
  { verb: 'scale', desc: '平滑缩放至指定倍率（params.scale）' },
  { verb: 'drawSvg', desc: 'SVG 描边绘制动画（也能唤醒 data-hidden）' },
  { verb: 'updateText', desc: '平滑更新目标元素文本（params.text）' },
  { verb: 'pulse', desc: '原地轻微缩放脉冲一次，结束后恢复原状' },
]

/** 动画动词的一句话说明（键对齐 registry 的 BUILTIN_ANIMATIONS + 'animate'） */
const ANIME_VERB_DESC: Record<string, string> = {
  animate: '通用动画动词，由 params.animation 指定预设名',
  popIn: '弹性缩放进入',
  zoomIn: '聚焦放大',
  slideInLeft: '自左滑入',
  slideInRight: '自右滑入',
  slideInTop: '自上降落',
  slideInBottom: '自下浮现',
  bounce: '弹性弹跳',
  shake: '左右震颤警示',
  wobble: '摆动趣味',
  float: '轻柔上浮',
  rotate: '顺时针旋转',
  flip: '3D 翻转',
  glow: '呼吸光晕',
  countUp: '数字滚动递增（params.end / start / suffix）',
  typewriter: '打字机逐字显现',
}

/**
 * 走 anime.js 通道的 action.verb：'animate' + registry 里的一次性入场动效。
 * pulse 例外——它是状态动词（单次脉冲走 applyFinalState）；registry 里的 pulse
 * 只是 data-anim 的循环形态，不当 action.verb 路由。
 */
export const ANIME_ACTION_VERBS: ReadonlySet<string> = new Set([
  'animate',
  ...BUILTIN_ANIMATIONS.map((d) => d.verb).filter((v) => v !== 'pulse'),
])

/** action.verb 完整白名单（状态 ∪ 动画）——校验与 verbs() 共用 */
export const VISUAL_VERB_WHITELIST: ReadonlySet<string> = new Set([
  ...STATE_VERBS.map((v) => v.verb),
  ...ANIME_ACTION_VERBS,
])

/** verbs() 回执：两张表各带一行用途 */
export function verbCatalog(): { state: VerbInfo[]; anime: VerbInfo[] } {
  return {
    state: STATE_VERBS,
    anime: [...ANIME_ACTION_VERBS]
      .sort()
      .map((v) => ({ verb: v, desc: ANIME_VERB_DESC[v] ?? '自定义动效（api.classroom.animations() 查详情）' })),
  }
}
