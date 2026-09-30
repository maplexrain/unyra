/**
 * 外观设置：主题模式 + 正文文字大小系数。
 *
 * 界面语言不在这里：它跟机器走（appdata 的 global.yaml，见 lib/uiLocale），
 * 是全局设置，不属于任何一份用户配置。
 *
 * 与 AI 设置同放在用户的 setting.yaml 里（见 lib/userSettings），只是各管一片，
 * 互不影响——改主题不会碰到提供商的 Key。
 * 主题解析为 documentElement 上的 data-theme，CSS 变量据此换肤；显式主题原样落值，
 * 「跟随系统」只在浅 / 深之间解析（监听 prefers-color-scheme，系统切换即时生效）。
 * 字号系数由笔记区 Ctrl + 滚轮改（见 NodeNote），这里只负责存取与夹取范围。
 *
 * 属于用户级：切换用户后由 lib/boot.ts 重新载入配置并调用 refreshAppearance()，
 * 未登录时用中性默认值。
 *
 * 字体已统一为黑体（无衬线），写在 index.css 的 --font-sans 里，不再提供切换。
 */

import { useEffect, useState } from 'react'
import { readUserSettings, writeUserSettings } from './userSettings'
import { syncAppIcon } from './appIcon'

/**
 * 主题取值。
 *
 * 'system' 不是一种配色，而是一条解析规则：跟随操作系统的深浅色偏好，
 * 只会在浅色 / 深色**两套**之间解析（OS 只会说这两种，其余主题没有可跟随的信号）。
 * 其余取值都是显式配色：选择即固定落到 index.css 里同名的 data-theme 变量块，
 * 不随系统变化。新增一套主题 = index.css 加一个变量块 + 这里加一个取值。
 */
export type ThemeMode =
  | 'system'
  | 'light'
  | 'dark'
  | 'sepia'
  | 'amber'
  | 'pink'
  | 'blue'
  | 'green'
  | 'purple'
  | 'white'
  | 'graphite'
  | 'navy'
  | 'contrast'
  | 'black'

export interface Appearance {
  theme: ThemeMode
  /** 正文文字大小系数，1 = 原大小；只作用于渲染出来的文档，不动界面本身 */
  docScale: number
  /**
   * **左侧资源管理器**的宽度（px），默认 280（见 EXPLORER_WIDTH_DEFAULT）。
   * 与右侧那一栏同一个做法：拉它的右边线改，松手写进设置；窄屏下不生效（那时它是抽屉）。
   */
  explorerWidth: number
  /**
   * 右侧那一栏的宽度（px），默认 600（见 AGENT_WIDTH_DEFAULT）。可以拉着把手改
   * （见 LearnWorkspace 的拖拽把手），所以跟主题、字号一样属于用户级设置。
   * 窄屏下不生效：那时两栏上下叠放，各自整宽。
   *
   * 注意它量的是「位置」而不是「哪一栏」：宽度属于右格，不属于 AI 对话栏——
   * 默认对话在左（见 agentLeft），于是这一格装的是文档，而宽度仍是这个数。
   */
  agentWidth: number
  /**
   * AI 对话栏是否放在左边。**默认 true**：导师在左、文档在右；
   * 双击两栏中间那条线换个位置（见 LearnWorkspace 的 swapSides）。
   *
   * 与 agentWidth 同理：换的是位置，不是宽度。左格始终自适应（拿走剩下的宽度），
   * 右格始终是 agentWidth 那么宽，于是默认这一版里对话栏占左边那一大块，
   * 文档落进右边那条窄的——这正是「原位置的宽度不跟着对调」的意思。
   */
  agentLeft: boolean
  /**
   * 右侧那一栏是否收起。**默认 false**（展开）。
   *
   * 记的是「位置」而不是「哪一栏」（与 agentWidth 同一条纪律）：右边是文档栏还是对话栏，
   * 由 agentLeft 决定，而这个开关只管把**占着右边那一格的东西**收起来，给主区域让出地方。
   * 于是对调两栏之后，收起的仍然是右边那一格——与那条把手的语义一致，用户不用重新学一遍。
   *
   * 收起的动效与那颗骑在分割线上的按钮见 LearnWorkspace（那一格宽度补间到 0、
   * 内容 overflow-hidden，看着是滑出屏幕而不是被压扁）。
   */
  sideCollapsed: boolean
  /**
   * 教学模式：打开后在左下角常驻一个按键浮层（见 components/KeyCast）。
   * 它是给录屏讲课用的——观众看得见你按了什么，而不是只看结果在变。
   * 与主题、字号一样跟着用户走。
   */
  teachingMode: boolean
  /**
   * 对话区（超级导师那一栏的消息列表）文字大小系数，1 = 原大小。
   * 与 docScale 各存各的：两处的可读宽度差得远，一起缩反而别扭。
   * 调节方式一样是 Ctrl + 滚轮（见 AgentPanel），所以也属于用户级设置。
   */
  chatScale: number
}

/** 全部主题取值，顺序即设置页的展示顺序：跟随系统、基础两套、浅色扩展、深色扩展 */
export const THEME_MODES: ThemeMode[] = [
  'system',
  'light',
  'dark',
  'sepia',
  'amber',
  'pink',
  'blue',
  'green',
  'purple',
  'white',
  'graphite',
  'navy',
  'contrast',
  'black',
]

export const THEME_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
  sepia: '暖纸',
  amber: '琥珀',
  pink: '樱花粉',
  blue: '静谧蓝',
  green: '清新绿',
  purple: '雾紫',
  white: '纯白',
  graphite: '石墨',
  navy: '夜航蓝',
  contrast: '高对比',
  black: '纯黑',
}

/** 深色一族的取值：深底浅字（决定顶栏图标等展示语义；CSS 里它们共享同一组伴随规则） */
const DARK_THEMES: ThemeMode[] = ['dark', 'graphite', 'navy', 'contrast', 'black']

/** 这套主题是不是深底浅字；「跟随系统」的深浅由解析结果决定，不算在这里 */
export const isDarkTheme = (mode: ThemeMode): boolean => DARK_THEMES.includes(mode)

/**
 * 主题选择器上的小色板：每个主题的纸色与强调色，纯展示用（跟随系统按浅色那套展示，
 * 真正落到哪套由系统偏好决定）。
 */
export const THEME_SWATCH: Record<ThemeMode, { paper: string; accent: string }> = {
  system: { paper: '#f5f2eb', accent: '#a8432f' },
  light: { paper: '#f5f2eb', accent: '#a8432f' },
  dark: { paper: '#17150f', accent: '#d0705a' },
  sepia: { paper: '#f2ead7', accent: '#a8432f' },
  amber: { paper: '#faf0e3', accent: '#c56a2e' },
  pink: { paper: '#fbf3f4', accent: '#cf5787' },
  blue: { paper: '#eef3f7', accent: '#3d6da6' },
  green: { paper: '#f1f6ee', accent: '#4f8f45' },
  purple: { paper: '#f2f0f6', accent: '#7e5fb5' },
  white: { paper: '#ffffff', accent: '#a8432f' },
  graphite: { paper: '#1b1b1d', accent: '#c96a58' },
  navy: { paper: '#10141f', accent: '#6f9ed6' },
  contrast: { paper: '#000000', accent: '#f2654a' },
  black: { paper: '#000000', accent: '#d0705a' },
}

/** 文字大小系数的可调范围与手感：文档区与对话区共用同一套，两边滚起来才是同一个手感 */
export const DOC_SCALE_MIN = 0.8
export const DOC_SCALE_MAX = 1.8
/** 一格滚轮（或触控板一次双指缩放）改变的倍率 */
export const SCALE_ZOOM_STEP = 1.07
/** 右下角那颗比例提示亮多久 */
export const SCALE_HUD_MS = 1300

/**
 * 右栏宽度范围：再窄放不下工具卡片与代码块；上限给到 800——宽屏下对话与文档各占一半也放得下。
 * 默认 600：默认布局是「对话在左、文档在右」（见 agentLeft），于是这 600px 量的是文档栏——
 * 读文档的那一栏不该比这更窄。对话栏拿走剩下的宽度（宽屏下绰绰有余），
 * 因此它到底多宽由窗口决定，消息定位条显不显示也看那个实际宽度（见 AgentPanel 的 RAIL_MIN_WIDTH）。
 */
export const AGENT_WIDTH_MIN = 400
export const AGENT_WIDTH_MAX = 800
export const AGENT_WIDTH_DEFAULT = 600

/**
 * 左侧资源管理器的宽度范围：再窄连「错题本」这种三字标题都放不下（还要给图标与缩进留位置），
 * 再宽就喧宾夺主了——它是找东西的地方，不是读东西的地方。
 * 默认 280：够放一个中文标题加一颗状态点，也够看清缩进出来的两三层。
 */
export const EXPLORER_WIDTH_MIN = 200
export const EXPLORER_WIDTH_MAX = 400
export const EXPLORER_WIDTH_DEFAULT = 280

/** 夹到范围内并取整（与 clampAgentWidth 同一条：拖拽给的是连续像素，存整数） */
export function clampExplorerWidth(v: number): number {
  if (!Number.isFinite(v)) return EXPLORER_WIDTH_DEFAULT
  return Math.round(Math.min(EXPLORER_WIDTH_MAX, Math.max(EXPLORER_WIDTH_MIN, v)))
}

/** 夹到范围内并取整：拖拽给的是连续像素，存整数免得设置文件里拖出一串小数 */
export function clampAgentWidth(v: number): number {
  if (!Number.isFinite(v)) return AGENT_WIDTH_DEFAULT
  return Math.round(Math.min(AGENT_WIDTH_MAX, Math.max(AGENT_WIDTH_MIN, v)))
}

const DEFAULT: Appearance = {
  theme: 'system',
  docScale: 1,
  agentWidth: AGENT_WIDTH_DEFAULT,
  explorerWidth: EXPLORER_WIDTH_DEFAULT,
  // 默认对话在左、文档在右（见 agentLeft 的说明）
  agentLeft: true,
  // 默认两栏都展开：收起是「这一会儿想多看点正文」时的手动动作
  sideCollapsed: false,
  teachingMode: false,
  chatScale: 1,
}

/**
 * 夹到范围内，并取整到 0.1%。
 *
 * 取整是为了让同一个数在多次换算后收敛，不至于越滚越碎；留一位小数是因为
 * 触控板双指缩放的每一次 delta 都很小（一次只够 0.3%），若按整数百分比取整，
 * 每一次都会被抹回原值，那一整下手势就等于没发生。
 */
function clampScale(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback
  const clamped = Math.min(DOC_SCALE_MAX, Math.max(DOC_SCALE_MIN, v))
  return Math.round(clamped * 1000) / 1000
}

/** 文档正文字号（见 NodeNote 的 Ctrl + 滚轮） */
export function clampDocScale(v: number): number {
  return clampScale(v, DEFAULT.docScale)
}

/** 对话区字号（见 AgentPanel 的 Ctrl + 滚轮）：范围与取整规则和正文共用一套 */
export function clampChatScale(v: number): number {
  return clampScale(v, DEFAULT.chatScale)
}

function normalize(raw: unknown): Appearance {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT }
  const r = raw as Record<string, unknown>
  return {
    theme: THEME_MODES.includes(r.theme as ThemeMode) ? (r.theme as ThemeMode) : DEFAULT.theme,
    docScale: clampDocScale(typeof r.docScale === 'number' ? r.docScale : DEFAULT.docScale),
    agentWidth: clampAgentWidth(typeof r.agentWidth === 'number' ? r.agentWidth : DEFAULT.agentWidth),
    // 老设置文件里没有这一项：按默认宽度走（原来写死的 w-72 = 288，视觉上几乎没变）
    explorerWidth: clampExplorerWidth(
      typeof r.explorerWidth === 'number' ? r.explorerWidth : DEFAULT.explorerWidth,
    ),
    // 老设置文件里没有这一项，缺省按默认的 true 走；明确存过 false 的仍然留在右边
    agentLeft: r.agentLeft !== false,
    // 同一条纪律：老设置文件里没有就按「展开」走
    sideCollapsed: r.sideCollapsed === true,
    // 教学模式默认关：它是录屏时才需要的东西，平时留着只挡画面
    teachingMode: r.teachingMode === true,
    chatScale: clampChatScale(typeof r.chatScale === 'number' ? r.chatScale : DEFAULT.chatScale),
  }
}

let current: Appearance = { ...DEFAULT }
let media: MediaQueryList | null = null

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 上一次画上去的主题：只用来判断「强调色变了没有」，不必为它多存一份设置 */
let painted: ThemeMode | null = null

function paint(): void {
  /**
   * 显式主题原样落到 data-theme 上（index.css 按取值分块提供变量）；
   * 跟随系统只在浅 / 深之间解析——它表达的是「跟 OS 走」，不是第五套配色。
   */
  const theme = current.theme === 'system' ? (prefersDark() ? 'dark' : 'light') : current.theme
  document.documentElement.dataset.theme = theme
  /*
   * 窗口 / 任务栏 / 托盘图标跟着强调色一起换（渲染层染色，见 lib/appIcon）：尽力而为。
   *
   * **只在强调色真的变了时同步**：setAppearance 是「改外观」的总入口，
   * 而右侧栏收起 / 展开、两栏宽度都走它——每一次都重设一遍图标，
   * 等于为一件没变的事发一次 IPC（一张 64×64 的 PNG 数据），白搭一次卡顿。
   */
  if (painted === theme) return
  painted = theme
  void syncAppIcon(THEME_SWATCH[theme].accent)
}

function ensureMedia(): void {
  if (media || typeof window === 'undefined') return
  media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', () => {
    if (current.theme === 'system') paint()
  })
}

export function loadAppearance(): Appearance {
  return normalize(readUserSettings('appearance'))
}

export function saveAppearance(a: Appearance): void {
  writeUserSettings('appearance', a)
}

/*
 * 订阅：外观是模块级状态（不走 React），关心它的组件要自己订一下。
 * 只有「改完要立刻反映到界面上」的少数几处需要它（教学模式的按键浮层就是），
 * 别的组件读一次性快照就够。
 */
const listeners = new Set<() => void>()

export function subscribeAppearance(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 应用并持久化；设置面板每次改动即时调用，所见即所得 */
export function setAppearance(a: Appearance): void {
  current = normalize(a)
  saveAppearance(current)
  paint()
  for (const cb of [...listeners]) cb()
}

/** 组件里读外观：改了一并跟着重渲染 */
export function useAppearance(): Appearance {
  const [value, setValue] = useState(getAppearance)
  useEffect(() => subscribeAppearance(() => setValue(getAppearance())), [])
  return value
}

/**
 * 按当前作用域重新读入外观并应用。
 * 启动、登录 / 切换用户 / 登出后调用（见 lib/boot.ts）：让主题跟着用户走，
 * 未登录态则用默认值。
 */
export function refreshAppearance(): void {
  current = loadAppearance()
  ensureMedia()
  paint()
}

export function getAppearance(): Appearance {
  return current
}
