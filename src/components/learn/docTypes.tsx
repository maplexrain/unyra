import { AppWindow, Bot, BookOpen, Brain, CalendarClock, ChartColumn, FilePlus, Folder, FolderOpen, Globe, GraduationCap, HardDrive, ListTree, Loader2, MonitorPlay, NotebookPen, Package, Puzzle, Settings2 } from 'lucide-react'

/**
 * 文档类型的**视觉身份**：一种类型一个图标、一个颜色。
 *
 * 页签栏与左侧资源管理器共用这一份——同一个东西在两处长得一样，用户才不用重新认一遍
 * （「蓝色那本」在页签上是笔记，在侧栏里也该是笔记）。
 *
 * 颜色**不跟主题变量走**：类型身份要恒定，切到深色或粉色主题，蓝的还是蓝的、紫的还是紫的，
 * 靠颜色认类型才认得稳。这几个色都取中等亮度，浅色纸面与深色纸面上都看得清。
 */
export type DocKindKey =
  | 'teach'
  | 'note'
  | 'super'
  | 'exam'
  | 'outline'
  | 'local'
  | 'ws'
  | 'web'
  | 'video'
  | 'pluginDoc'
  | 'settings'
  | 'usage'
  | 'schedule'
  | 'mind'
  | 'agentSettings'
  | 'blank'
  | 'draft'

const DOC_TYPE_COLOR: Record<DocKindKey, string> = {
  teach: '#4a8fd4', // 蓝：教学文档
  note: '#d9962e', // 琥珀：笔记
  super: '#a066d6', // 紫：超级文档
  exam: '#c0563a', // 朱：试卷（含它的历次考试）
  outline: '#2e8b6e', // 松绿：大纲页（结构化的路线图）
  local: '#98928a', // 中性灰：外部文件
  ws: '#7c8f4f', // 橄榄：工作区（项目）内部文件——与外部文件的灰明确分开
  web: '#2aa1b8', // 青：网页（内置浏览器）
  video: '#5d6ac4', // 靛蓝：视频学习（实验）——介于网页的青与超级文档的紫之间，谁也不撞
  pluginDoc: '#8a6d3b', // 土金：插件开发文档——参考手册的气质，与正文的黑白区分开
  settings: '#7c8698', // 蓝灰：系统页（设置）——与哪一类学习内容都不同族
  usage: '#7c8698', // 蓝灰：系统页（用量统计），与设置同族同色、图标不同
  schedule: '#c47a3d', // 陶土橙：日程表（时间与约定，与朱红的试卷、琥珀的笔记都不撞）
  mind: '#7c8698', // 蓝灰：系统页（记忆管理），系统页同族
  agentSettings: '#7c8698', // 蓝灰：系统页（超级导师设置），系统页同族
  blank: '#8c8c8c', // 浅中性灰：空白页签
  draft: '#6f8fb0', // 雾蓝：新建文件（还没落定的那一份，与「外部文件的灰」分开）
}

/**
 * 空白页签的图标：一张**空白的纸**（只有轮廓与右上折角，里面什么都不画）。
 *
 * 从前这里是一颗「+」——用户第一眼读成「新建按钮」，而它其实是一枚**页签**：
 * 点它只是选中这一页，不会新建任何东西（新建是页签栏末尾那颗真的 +）。
 * 「一张什么都没有的纸」表达的是「这一页还空着」，语义与行为对得上。
 *
 * 纸面里刻意**不画内容线**：试过两行虚线，11px 下会糊成几颗点，看着像「列表」
 * 或「菜单」，反而更像一个动作按钮。留白本身就是这个图标要说的那句话。
 *
 * 手画而不是取图标库：lucide 的 File 系列都带内容线，没有「空白」这一枚，
 * 而这一颗的线条要与页签里其它 11px 的类型图标同粗同重。
 * class 交给页签栏做「未被选中」时的呼吸提醒（见 workspace.css 的 .moji-blank-glyph）。
 */
function BlankPageGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="moji-blank-glyph"
      aria-hidden="true"
    >
      {/* 纸张轮廓 + 右上折角 */}
      <path d="M3.6 1.9h5l3.8 3.8v8.4H3.6z" />
      <path d="M8.6 1.9v3.8h3.8" />
    </svg>
  )
}

/**
 * 一颗类型图标：固定 16px 的格子（页签里那格是留给「与关闭键等宽的空档」的，
 * 侧栏里那格让标题对齐），图标 11px。
 */
export function DocTypeIcon({ kind, size = 11 }: { kind: DocKindKey; size?: number }) {
  const icon =
    kind === 'teach' ? (
      <BookOpen size={size} />
    ) : kind === 'note' ? (
      <NotebookPen size={size} />
    ) : kind === 'super' ? (
      <AppWindow size={size} />
    ) : kind === 'exam' ? (
      <GraduationCap size={size} />
    ) : kind === 'outline' ? (
      <ListTree size={size} />
    ) : kind === 'web' ? (
      <Globe size={size} />
    ) : kind === 'video' ? (
      <MonitorPlay size={size} />
    ) : kind === 'pluginDoc' ? (
      <Puzzle size={size} />
    ) : kind === 'settings' ? (
      <Settings2 size={size} />
    ) : kind === 'usage' ? (
      <ChartColumn size={size} />
    ) : kind === 'schedule' ? (
      <CalendarClock size={size} />
    ) : kind === 'mind' ? (
      <Brain size={size} />
    ) : kind === 'agentSettings' ? (
      <Bot size={size} />) : kind === 'blank' ? (
      <BlankPageGlyph size={size} />
    ) : kind === 'draft' ? (
      <FilePlus size={size} />
    ) : kind === 'ws' ? (
      // 工作区（项目）内部文件：盒子形状，与「新建项目」菜单项同一个图示
      <Package size={size} />
    ) : (
      <HardDrive size={size} />
    )

  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center"
      style={{ color: DOC_TYPE_COLOR[kind] }}
    >
      {icon}
    </span>
  )
}

/**
 * web 页签的类型图标：加载中给一颗转圈（同一个类型色），拿到站点图标后用它替掉地球。
 * 页签栏专用（资源管理器没有网页行）——favicon 与加载态是「这一页」的活信息，见 WebTabMeta。
 */
export function WebTabTypeIcon({ favicon, loading, size = 11 }: { favicon?: string; loading?: boolean; size?: number }) {
  if (loading) {
    return (
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: DOC_TYPE_COLOR.web }}
      >
        <Loader2 size={size} className="animate-spin" />
      </span>
    )
  }
  if (favicon) {
    return <img src={favicon} alt="" aria-hidden="true" className="h-3 w-3 shrink-0 self-center rounded-[3px]" />
  }
  return <DocTypeIcon kind="web" />
}

/**
 * 一颗**目录**图标：文件夹的形状 + 同一个中性灰。 *
 * 目录**不再带类型色**（用户定的）：目录行的职责是先让人认出「这是个装东西的目录」，
 * 与一份份实打实的文档（类型图标，各带各的类型色）一眼区分开——目录永远是文件夹的形状、
 * 永远是灰的，笔记 / 试卷 / 超级文档的目录不再各占一个颜色。占的还是同一个 16px 格子，
 * 两种行混排时图标对齐。
 */
const FOLDER_COLOR = '#98928a'

export function DocFolderIcon({ open = false, size = 12 }: { open?: boolean; size?: number }) {
  const shape = open ? <FolderOpen size={size} /> : <Folder size={size} />
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center"
      style={{ color: FOLDER_COLOR }}
    >
      {shape}
    </span>
  )
}
