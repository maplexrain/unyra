/**
 * 课堂 action.verb 白名单的唯一运行时事实源。
 *
 * VisualVerb（types.ts）是编译期类型；校验（audit.ts）、自愈（sanitizer.ts）、
 * 沙箱 verbs()、ActionCompiler 的路由都从这里取——四方永远同一张表，不再各写一份。
 *
 * 两套体系严格分开：
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
  { verb: 'appear', desc: '移除 data-hidden，淡入并轻微浮升——唤醒初始隐藏元素的稳健标配' },
  { verb: 'disappear', desc: '淡出并标记 data-hidden' },
  { verb: 'highlight', desc: '添加高亮发光框（params.color 自定义强调色）' },
  { verb: 'unhighlight', desc: '移除高亮发光框' },
  { verb: 'dimOthers', desc: '舞台聚光：聚焦 target，同级兄弟元素压暗并柔化景深' },
  { verb: 'resetFocus', desc: '恢复同级兄弟元素透明度与清晰度' },
  { verb: 'move', desc: '相对当前位置平滑位移（params.x / y，1920×1080 像素系）' },
  { verb: 'scale', desc: '平滑缩放至指定倍率（params.scale）' },
  { verb: 'drawSvg', desc: 'SVG 描边绘制动画（也能唤醒 data-hidden）' },
  { verb: 'updateText', desc: '平滑更新目标元素文本（params.text）' },
  { verb: 'pulse', desc: '原地轻微缩放脉冲一次，结束后恢复原状' },
]

/** 动画动词的一句话说明（键对齐 registry 的 BUILTIN_ANIMATIONS + 'animate'） */
const ANIME_VERB_DESC: Record<string, string> = {
  animate: '通用动画动词，由 params.animation 指定预设名',
  riseIn: '晨雾浮升入场（沉稳高级的首选揭晓）',
  popIn: '克制弹簧微弹入场',
  zoomIn: '光学推镜聚焦放大',
  blurIn: '电影景深虚化变焦入场',
  unfold: '书卷纵展开场（绝配步骤与定理）',
  stamp: '朱印落定定音（自带落印音效，绝配结论与 Q.E.D.）',
  slideInLeft: '自左丝滑驶入',
  slideInRight: '自右丝滑驶入',
  slideInTop: '自上落位降临',
  slideInBottom: '自下稳步浮现',
  spotlight: '舞台追光抬升聚焦',
  shimmer: '流光斜扫过卡片表面',
  ripple: '同心涟漪光环聚焦',
  glow: '呼吸光晕泛起',
  heartbeat: '双重深沉心跳律动',
  float: '云端轻柔浮动',
  bounce: '重力物理回弹',
  swing: '顶支点物理钟摆摇曳',
  wobble: '俏皮阻尼微晃',
  jello: '软体果冻切变弹性',
  rubberBand: '橡皮筋张力弹缩',
  shake: '纠错阻尼左右震颤（适合误区警示）',
  flash: '警戒双闪信号',
  tada: '礼花欢庆绽放（自带证毕和弦音效）',
  rotate: '360 度圆周平滑旋转',
  flip: '1200px 景深 3D 立体翻面',
  countUp: '数字步进滚动递增（params.end / start / prefix / suffix，自带算珠音）',
  typewriter: '打字机板书逐字显现（自带落笔键入音）',
}

/**
 * 能唤醒 data-hidden 隐藏元素的动词集合（唯一事实源：audit.ts 与 sanitizer.ts 共用）
 */
export const WAKING_VERBS: ReadonlySet<string> = new Set([
  'appear',
  'drawSvg',
  'riseIn',
  'popIn',
  'zoomIn',
  'blurIn',
  'unfold',
  'stamp',
  'slideInLeft',
  'slideInRight',
  'slideInTop',
  'slideInBottom',
  'flip',
  'bounce',
  'tada',
  'animate',
])

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
