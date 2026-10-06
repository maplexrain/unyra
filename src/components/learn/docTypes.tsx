import { AppWindow, BookOpen, FileClock, Folder, FolderOpen, Globe, GraduationCap, HardDrive, ListTree, Loader2, NotebookPen, ShieldCheck } from 'lucide-react'

/**
 * 文档类型的**视觉身份**：一种类型一个图标、一个颜色。
 *
 * 页签栏与左侧资源管理器共用这一份——同一个东西在两处长得一样，用户才不用重新认一遍
 * （「蓝色那本」在页签上是笔记，在侧栏里也该是笔记）。
 *
 * 颜色**不跟主题变量走**：类型身份要恒定，切到深色或粉色主题，蓝的还是蓝的、紫的还是紫的，
 * 靠颜色认类型才认得稳。这几个色都取中等亮度，浅色纸面与深色纸面上都看得清。
 */
export type DocKindKey = 'teach' | 'note' | 'super' | 'exam' | 'outline' | 'local' | 'web' | 'guard' | 'report'

const DOC_TYPE_COLOR: Record<DocKindKey, string> = {
  teach: '#4a8fd4', // 蓝：教学文档
  note: '#d9962e', // 琥珀：笔记
  super: '#a066d6', // 紫：超级文档
  exam: '#c0563a', // 朱：试卷（含它的历次考试）
  outline: '#2e8b6e', // 松绿：大纲页（结构化的路线图）
  local: '#98928a', // 中性灰：外部文件
  web: '#2aa1b8', // 青：网页（内置浏览器）
  guard: '#d4577b', // 绯粉：守卫 agent 的上下文（警戒色——它在盯梢）
  report: '#7a6a54', // 褐灰：专注模式报告（收场的凭据）
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
    ) : kind === 'guard' ? (
      <ShieldCheck size={size} />
    ) : kind === 'report' ? (
      <FileClock size={size} />
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
