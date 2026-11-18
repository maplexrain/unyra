/**
 * AI 驱动互动课堂引擎核心数据类型与 DSL 协议规范
 */

/** 完整课堂数据结构 */
export interface LessonCourse {
  courseId: string
  title: string
  description?: string
  scenes: LessonScene[]
}

/** 单个画面（状态隔离与快照基准） */
export interface LessonScene {
  id: string
  /** 画面标题，用于时间轴分段与导航 */
  title: string
  /**
   * 基于 1920x1080 逻辑坐标系的 H5 片段（支持内联 SVG 与预置舞台类名）
   * 约束：所有受控 DOM 元素必须有唯一的 id 属性
   * 初始隐藏元素统一声明 data-hidden 属性
   */
  html: string
  /** 线性动作指令序列 */
  actions: LessonAction[]
}

export type LessonAction = SpeakAction | VisualAction | WaitAction | CheckpointAction

/** 1. 核心讲解动作（默认阻塞） */
export interface SpeakAction {
  type: 'speak'
  /** 传给 TTS 语音合成器的纯口语文本（剔除 Markdown 符号与非朗读杂音） */
  text: string
  /** 屏幕底部字幕展示文本（缺省复用 text；支持 LaTeX 公式或高亮强调） */
  subtitle?: string
  /** 是否阻塞时间轴推进，缺省为 true */
  blocking?: boolean
}

/** 2. 语义化 DOM 视觉动作（默认非阻塞） */
export interface VisualAction {
  type: 'visual'
  /** 预设受控视觉动词 */
  verb: VisualVerb
  /** 目标元素 id（不带 '#' 前缀） */
  target: string
  /** 动词动作参数 */
  params?: VisualParams
  /** 是否阻塞时间轴推进，缺省为 false */
  blocking?: boolean
}

export interface VisualParams {
  /** 动画持续时间（毫秒），默认 450ms */
  duration?: number
  /** 相对 X 轴位移（1920 像素系） */
  x?: number
  /** 相对 Y 轴位移（1080 像素系） */
  y?: number
  /** 目标缩放倍率 */
  scale?: number
  /** 强调颜色（Hex 或 CSS 变量，用于 highlight / unhighlight） */
  color?: string
  /** 替换文本内容（用于 updateText） */
  text?: string
  /** anime.js 动画预设名（用于 animate 动词） */
  animation?: string
  /** countUp 动画目标数值 */
  end?: number
  /** countUp 动画起始数值（默认 0） */
  start?: number
  /** countUp 动画后缀（如 "%", "ms"） */
  suffix?: string
}

/** 3. 显式等待动作（用于讲解气口留白） */
export interface WaitAction {
  type: 'wait'
  /** 停顿时长（毫秒） */
  duration: number
  blocking: true
}

/** 4. 互动思考/确认检查点（用于暂停等待学生点击或思考） */
export interface CheckpointAction {
  type: 'checkpoint'
  /** 思考提示文案 */
  title?: string
  blocking: true
}

/** 受控视觉动词枚举 */
export type VisualVerb =
  | 'appear' // [状态型] 移除 data-hidden，淡入并轻微上浮
  | 'disappear' // [状态型] 淡出并设置 data-hidden
  | 'highlight' // [状态型] 添加高亮发光类
  | 'unhighlight' // [状态型] 移除高亮发光类
  | 'dimOthers' // [状态型] 聚焦 target，同级兄弟元素降低透明度至 0.25
  | 'resetFocus' // [状态型] 恢复同级兄弟元素透明度为 1
  | 'move' // [状态型] 相对当前位置平滑位移 (x, y)
  | 'scale' // [状态型] 平滑缩放至指定倍率
  | 'drawSvg' // [状态型] SVG 描边绘制动画
  | 'updateText' // [状态型] 平滑更新目标元素文本
  | 'pulse' // [瞬态型] 原地轻微缩放脉冲一次，结束后恢复原状
  // anime.js 内置动画动词
  | 'animate' // [动画] 通用动画动词，由 params.animation 指定预设名
  | 'bounce' // [动画] 弹性弹跳动效
  | 'shake' // [动画] 左右震颤警示动效
  | 'wobble' // [动画] 摆动趣味动效
  | 'float' // [动画] 轻柔上浮动效
  | 'flip' // [动画] 3D 翻转动效
  | 'popIn' // [动画] 弹性缩放进入动效
  | 'zoomIn' // [动画] 聚焦放大动效
  | 'rotate' // [动画] 顺时针旋转动效
  | 'glow' // [动画] 呼吸光晕动效
  | 'countUp' // [动画] 数字滚动递增动效
  | 'typewriter' // [动画] 打字机字符逐字显现动效

/** 运行时任务控制句柄 */
export interface RunningTask {
  pause: () => void
  resume: () => void
  abort: () => void
  instantFinish: () => void
  finished: Promise<void>
}

/** 外部统一 TTS 适配器契约 */
export interface ITTSAdapter {
  speak: (text: string, rate?: number) => TTSPlaybackHandle
  preload?: (text: string, rate?: number) => Promise<void>
}

export interface TTSPlaybackHandle {
  pause: () => void
  resume: () => void
  stop: () => void
  finished: Promise<void>
  /** 当底层音频真正就绪并开始发声时 resolve（用于音画精准对齐） */
  ready?: Promise<void>
}

/** 字幕外观样式配置 */
export interface SubtitleStyleConfig {
  /** 字号（px），默认 22 */
  fontSize: number
  /** 文字颜色（Hex 或 CSS 颜色值），默认 #ffffff */
  color: string
  /** 描边颜色，默认 #000000 */
  strokeColor: string
  /** 描边粗细（px），默认 1.5 */
  strokeWidth: number
  /** 背景模式：无背景纯描边 / 半透明轻晕 / 实色黑底 */
  bgMode: 'none' | 'translucent' | 'solid'
}

export interface SubtitleSettings {
  showSubtitle: boolean
  style: SubtitleStyleConfig
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  showSubtitle: true,
  style: {
    fontSize: 22,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 1.0,
    bgMode: 'translucent',
  },
}

/** 节拍时间轴标记节点 */
export interface TimelineBeat {
  beatId: string
  sceneIndex: number
  sceneTitle: string
  /** 该节拍起始动作索引 */
  startActionIndex: number
  /** 该节拍结束动作索引 */
  endActionIndex: number
  /** 节拍摘要标签 */
  label: string
  /** 节拍详情概要预览（供 Hover Tooltip 展示） */
  snippet?: string
  /** 该节拍所含视觉动作数 */
  visualActionCount: number
  /** 该节拍所含视觉动作概要文字列表（如“高亮 #card”、“淡入 #feat”） */
  visualDetails?: string[]
}

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'waiting_checkpoint' | 'ended'

export interface SchedulerSnapshot {
  status: PlaybackStatus
  sceneIndex: number
  actionIndex: number
  activeBeatIndex: number
  subtitle?: string
  checkpointTitle?: string
  playbackRate: number
}

/** 课堂节点持久化实体结构 */
export interface ClassroomEntity {
  id: string
  title: string
  description?: string
  goalId?: string
  createdAt: number
  updatedAt: number
  course: LessonCourse
  /** 关联子节点 ID 列表（笔记 / 考试 / 超级文档 / 文件） */
  childNodeIds?: string[]
}
