/**
 * 这个文件负责：侧栏里与知识树、右键菜单无关的那几块小零件——可折叠分区（Section / Collapse）、
 * 本地文件行（LocalRow）、以及「最近打开」那一段（RecentSection / RecentRow）。
 * 它们只被 ExplorerSidebar 直接渲染。
 */
import { useMemo } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { LearnStore, LocalFile } from '../../../learn/types'
import { recentOpens, type RecentOpen } from '../../../learn/recents'
import { useClock } from '../../../lib/clock'
import { relativeTime } from '../../../lib/time'
import { STATUS_META } from '../mastery'
import { DocTypeIcon } from '../docTypes'
import { t } from '../../../i18n'

/**
 * 「最近打开」：节点与本地文件混排（见 learn/recents），点一下接着看。
 *
 * 单独一个组件只为了一件事：那一列相对时间（「刚刚」→「3 分钟前」）要跟着真实时间走，
 * 而时钟只能订在**用到它的那一小块**上——订在外层，整棵节点树会跟着每 30 秒重渲染一遍
 * （见 lib/clock 的说明）。空列表整块不显示，与本地文件区同一条规矩。
 */
export function RecentSection({
  store,
  open,
  onToggle,
  onSelectNode,
  onOpenLocal,
}: {
  store: LearnStore
  open: boolean
  onToggle: () => void
  onSelectNode: (nodeId: string) => void
  onOpenLocal: (path: string) => void
}) {
  const now = useClock(30_000)
  const items = useMemo(() => recentOpens(store), [store])
  if (!items.length) return null
  return (
    <Section title={t('最近打开')} count={items.length} open={open} onToggle={onToggle}>
      <div className="px-2">
        {items.map((item) => (
          <RecentRow
            key={item.kind + ':' + item.id}
            item={item}
            now={now}
            onOpen={() => (item.kind === 'node' ? onSelectNode(item.id) : onOpenLocal(item.id))}
          />
        ))}
      </div>
    </Section>
  )
}

/**
 * 最近打开的一行：状态圆点（节点，与节点树同一套写法）/ 文件图标，标题，它在什么里面，
 * 以及相对时间。完整路径放 title——「我打开的是哪一个 notes.md」在这里同样要紧。
 */
export function RecentRow({ item, now, onOpen }: { item: RecentOpen; now: number; onOpen: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      title={item.tip}
      className="flex cursor-pointer items-center gap-1.5 py-1.5 pl-1.5 pr-1.5 transition hover:bg-line/40"
    >
      {item.kind === 'node' ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <span className={'h-[6px] w-[6px] rounded-full ' + STATUS_META[item.status ?? 'learning'].dot} />
        </span>
      ) : (
        <DocTypeIcon kind="local" size={13} />
      )}
      {/*
        标题与「在什么里面」挤在同一行里一起截断：标题在前，空间不够时先舍说明。
        分成两栏（标题一栏、说明一栏）会让两条都只剩一半，而这一行里最要紧的
        永远是「这是哪个东西」——同名的 `导数` 靠后面那句淡淡的说明分辨，完整路径在 title 上。
      */}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
        {item.title}
        {item.hint && <span className="text-[11px] text-ink-faint"> · {item.hint}</span>}
      </span>
      <span className="shrink-0 text-[10.5px] text-ink-faint">{relativeTime(item.at, now)}</span>
    </div>
  )
}

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
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
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

/** 一个可折叠的分区：标题一行 + 内容（见文件头对「为什么分区」的说明） */
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
  action?: React.ReactNode
  children: React.ReactNode
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
 * 本地文件列表里的一行。
 *
 * 显示的是文件名而不是完整路径（路径太长，侧栏只有 288px）；完整路径放 title，
 * 悬停就能看到——「我打开的到底是哪个 notes.md」是这一行最要紧的信息。
 */
export function LocalRow({
  file,
  onOpen,
  onRemove,
  onMenu,
}: {
  file: LocalFile
  onOpen: () => void
  onRemove: () => void
  onMenu: (x: number, y: number) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      title={file.path}
      className="group flex cursor-pointer items-center gap-1.5 py-1.5 pl-1.5 pr-1 transition hover:bg-line/40"
    >
      <DocTypeIcon kind="local" size={13} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{file.name}</span>
      <button
        type="button"
        title={t('从列表里移除（不会删除文件本身）')}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-seal group-hover:flex"
      >
        <X size={12} />
      </button>
    </div>
  )
}
