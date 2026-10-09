/**
 * 这个文件负责：侧栏**分类夹**的全套零件。此前「可折叠的东西」有三种各画各的——
 * 顶层分区（学习目标 / 收藏 / 本地文件 / 最近打开）、树里的目录行（文档 / 工作区）、
 * 收藏的分组行——同一深度的缩进、行尾的数量、右侧的动作钮、展开的动画都不对齐。
 * 现在全部从这里出：
 *
 * - `Section` 顶层分区：小写间距的大写标题行 + 箭头 + 计数 + 动作钮插槽（SectionAction）；
 * - `FolderRow` 树里的目录行：开合跟随状态的文件夹图标 + 标题 + 计数（CountBadge）+
 *   行尾插槽（trailing）+ 箭头——收藏分组 / 节点的「文档」/ 工作区目录共用这一种行；
 * - `Indent` 一层缩进：ml + 左侧那条细线，树的每一层与收藏的分组内都走它，
 *   同一深度永远同一左缘；
 * - `Collapse` 折叠动画（0fr→1fr 的 grid 过渡）与 `CountBadge` 数量标记，两类夹子共用。
 *
 * 定制靠插槽：Section 的 `action`、FolderRow 的 `trailing` 各收一颗行尾按钮；
 * 行为（点击开合、右键菜单、拖拽）仍由调用方给——这里只管「分类夹长什么样」。
 */
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { DocFolderIcon } from '../docTypes'
import { chipJson, type ChipPayload } from '../../../lib/chipSyntax'

/**
 * 展开 / 收起的那一段动画。
 *
 * 用 grid-template-rows 从 0fr 到 1fr：这是**唯一**能对「高度未知」的内容做过渡的办法——
 * height 从 0 到 auto 不可动画，而预先量高度要么写死（内容一变就错），要么每帧读一次布局。
 * 内层 overflow-hidden + min-h-0 把内容裁住。
 *
 * 收起时子树**仍然挂着**（只是裁成 0 高），换来的是两个方向都有动画；
 * 树大到几百个节点时这里会成为负担，那时再改成「收起动画播完再卸载」。
 * inert：裁掉的那部分不该还能被 Tab 选中。
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={
        'grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ' +
        (open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')
      }
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

/** 行尾的数量标记：一眼知道这一层有几份，不必展开去数（目录行与分区头同一款） */
export function CountBadge({ n }: { n: number }) {
  return <span className="shrink-0 rounded bg-line/70 px-1.5 py-px text-[10px] leading-4 text-ink-faint">{n}</span>
}

/**
 * 一层缩进：树的每一层（下级节点 / 文档 / 工作区 / 历次考试）与收藏分组的成员都套它。
 * 左侧那条细线把「这一层装在谁底下」画出来；同一深度因此永远同一左缘——
 * 收藏分组里的一行与树里同层的一行，缩进分毫不差。
 */
export function Indent({ children }: { children: ReactNode }) {
  return (
    <div className="ml-2 border-l border-line pl-1">{children}</div>
  )
}

/**
 * 顶层分区：学习目标 / 收藏 / 本地文件 / 最近打开这四块的可折叠外皮。
 * 标题行是一颗整行按钮（点标题开合），右侧的 `action` 插槽放这一类的入口动作
 * （新建目标 / 新建分组 / 打开本地文件），统一用 SectionAction 画。
 */
export function Section({
  title,
  count,
  open,
  onToggle,
  action,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mb-1">
      <div className="group flex items-center gap-1 px-3 py-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[12.5px] font-medium tracking-wide text-ink-soft uppercase transition hover:text-ink"
        >
          {/* 单箭头旋转（与 Collapse 的高度动画同拍），不再两颗图标硬切换 */}
          <ChevronRight
            size={13}
            className={
              'shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none ' +
              (open ? 'rotate-90' : '')
            }
          />
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-[11.5px] font-normal text-ink-faint normal-case">{count}</span>
        </button>
        {action}
      </div>
      <Collapse open={open}>{children}</Collapse>
    </section>
  )
}

/**
 * 分区标题行右侧的动作钮。三个分区原先各画各的（6px 的、20px 的、常驻的、悬停才现身的），
 * 现在统一成一种：悬停分区标题行才现身（占位不动、只淡入，行不抖），键盘焦点同样现身。
 */
export function SectionAction({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-line/70 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      {children}
    </button>
  )
}

/**
 * 树里的**目录行**：收藏的分组、节点的「文档」、工作区的每一层目录，都是这一种行。
 * 文件夹图标自己是开 / 合的状态（与一份份带类型色的文档行区分开），行尾数量标记
 * 常驻（数得出来就画，工作区目录要列过一次盘才有），最右一根旋转箭头管开合——
 * 从前收藏分组没有这根箭头、也没有高度动画，是全侧栏动画表现里掉队的那一个。
 */
export function FolderRow({
  label,
  hint,
  open,
  count,
  dropActive,
  revealKey,
  trailing,
  dragChip,
  onDragExtra,
  onClick,
  onMenu,
}: {
  label: string
  hint?: string
  open: boolean
  /** 目录里的条数；不给（还没数清，比如工作区目录还没列过盘）就不画 */
  count?: number
  /** 拖着东西悬在本目录上：整行亮成落点 */
  dropActive?: boolean
  /** 页签定位的目标键（data-reveal）；目录行自己不是页签目标，一般不给 */
  revealKey?: string
  /** 行尾插槽：数量标记之外再摆的东西（动作钮等，悬停现身由调用方自己做） */
  trailing?: ReactNode
  /** 目录能拖出去的引用（工作区子目录可以；收藏分组不行） */
  dragChip?: () => ChipPayload | null
  /** 拖动开始时的附加数据（工作区行用它再塞一份「移动 / 复制」的 MIME） */
  onDragExtra?: (e: React.DragEvent<HTMLDivElement>) => void
  onClick: () => void
  onMenu?: (x: number, y: number) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={hint}
      draggable={!!dragChip}
      onDragStart={(e) => {
        const p = dragChip?.()
        if (!p) return
        e.dataTransfer.setData('application/x-moji-chip', chipJson(p))
        e.dataTransfer.effectAllowed = 'copyMove'
        onDragExtra?.(e)
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault()
              onMenu(e.clientX, e.clientY)
            }
          : undefined
      }
      data-reveal={revealKey}
      className={
        'flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1.5 transition ' +
        (dropActive ? 'bg-seal/10 ring-1 ring-seal/50' : 'hover:bg-line/40')
      }
    >
      <DocFolderIcon open={open} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{label}</span>
      {count != null && count > 0 && <CountBadge n={count} />}
      {trailing}
      <ChevronRight
        size={12}
        className={
          'shrink-0 text-ink-faint transition-transform duration-200 ease-out motion-reduce:transition-none ' +
          (open ? 'rotate-90' : '')
        }
      />
    </div>
  )
}
