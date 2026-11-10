import { Network } from 'lucide-react'
import { DocTypeIcon, type DocKindKey } from './docTypes'
import type { NodeRelations, RelationItem, RelationKind } from './docRelations/computeRelations'
import { t } from '../../i18n'

interface Props {
  relations: NodeRelations
  closing?: boolean
  onSelect: (item: RelationItem) => void
  onDismiss: () => void
}

const BADGE_COLOR_MAP: Record<RelationKind, string> = {
  doc: 'bg-sky-500/12 text-sky-700 dark:text-sky-300 border-sky-500/25',
  note: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/25',
  super: 'bg-purple-500/12 text-purple-700 dark:text-purple-300 border-purple-500/25',
  exam: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/25',
  video: 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-500/25',
  file: 'bg-stone-500/12 text-stone-700 dark:text-stone-300 border-stone-500/25',
}

function RelationRow({
  item,
  index,
  onSelect,
}: {
  item: RelationItem
  index: number
  onSelect: (item: RelationItem) => void
}) {
  const badgeStyle = BADGE_COLOR_MAP[item.kind] ?? BADGE_COLOR_MAP.doc
  const iconKind: DocKindKey =
    item.kind === 'doc' ? 'teach' : item.kind === 'file' ? 'local' : item.kind

  return (
    <button
      type="button"
      style={{ animationDelay: `${Math.min(index * 20, 240)}ms` }}
      onClick={() => onSelect(item)}
      title={`${item.badgeLabel} · ${item.title}`}
      className="group/row moji-outline-row flex w-full items-center gap-2 rounded-none px-2 py-1.5 text-left transition hover:bg-line/45 active:scale-[0.99] cursor-pointer"
    >
      {/* 类型徽标：直角紧凑，前置图标 + 类型文字（如 文档/笔记/超级文档/试卷） */}
      <span
        className={`flex shrink-0 items-center gap-1 rounded-none border px-1.5 py-0.5 text-[10.5px] font-medium leading-none select-none ${badgeStyle}`}
      >
        <DocTypeIcon kind={iconKind} size={11} />
        <span>{t(item.badgeLabel)}</span>
      </span>

      {/* 节点标题 */}
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft transition-colors group-hover/row:text-ink font-sans">
        {item.title}
      </span>

      {/* 试卷额外信息（如有） */}
      {item.kind === 'exam' && item.attemptsCount !== undefined && (
        <span className="shrink-0 text-[10px] text-ink-faint">
          {item.attemptsCount > 0 ? t('{0}次', item.attemptsCount) : t('未考')}
        </span>
      )}
    </button>
  )
}

function Section({
  title,
  items,
  emptyText,
  offsetIndex,
  onSelect,
}: {
  title: string
  items: RelationItem[]
  emptyText: string
  offsetIndex: number
  onSelect: (item: RelationItem) => void
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between border-b border-line/40 px-2 pt-1 pb-1 text-[11px] font-semibold text-ink-faint select-none">
        <span>{title}</span>
        <span className="font-mono text-[10px] text-ink-faint/80">{items.length}</span>
      </div>
      <div className="pt-0.5">
        {items.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-ink-faint/50 italic select-none">{emptyText}</div>
        ) : (
          items.map((item, idx) => (
            <RelationRow key={item.id} item={item} index={offsetIndex + idx} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * 关联节点浮层（悬停在 DocFloat 的关系按钮上展开）。
 * 抹平大纲层，按照上级、下级、同级分类，每项前标识属于什么类型（文档/笔记/超级文档/试卷等）。
 */
export default function DocRelations({ relations, closing = false, onSelect, onDismiss }: Props) {
  const pCount = relations.parents.length
  const cCount = relations.children.length

  return (
    <div
      className={`no-print absolute left-full top-0 ml-2 z-30 ${
        closing ? 'moji-outline-out' : 'moji-outline-pop'
      }`}
    >
      {/* 尖角指示器：直角纸质美学 */}
      <span
        aria-hidden="true"
        className="absolute -left-[5px] top-2.5 z-10 h-2.5 w-2.5 rotate-45 border-l border-b border-line bg-card"
      />
      <div className="flex max-h-[min(65vh,500px)] w-[290px] flex-col overflow-hidden rounded-none border border-line bg-card shadow-[0_10px_30px_rgba(31,27,23,0.16)]">
        {/* 标题栏 */}
        <header className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2 select-none">
          <Network size={13} className="shrink-0 text-seal" />
          <span className="truncate text-[11.5px] font-medium tracking-wide text-ink">{t('关联节点')}</span>
          <span className="ml-auto rounded bg-line/40 px-1.5 py-0.2 text-[10px] font-mono text-ink-faint">
            {relations.totalCount}
          </span>
        </header>

        {/* 关系分类列表（上级 / 下级 / 同级） */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          <Section
            title={t('上级')}
            items={relations.parents}
            emptyText={t('无上级节点')}
            offsetIndex={0}
            onSelect={(item) => {
              onSelect(item)
              onDismiss()
            }}
          />
          <Section
            title={t('下级')}
            items={relations.children}
            emptyText={t('无下级节点')}
            offsetIndex={pCount}
            onSelect={(item) => {
              onSelect(item)
              onDismiss()
            }}
          />
          <Section
            title={t('同级')}
            items={relations.siblings}
            emptyText={t('无同级节点')}
            offsetIndex={pCount + cCount}
            onSelect={(item) => {
              onSelect(item)
              onDismiss()
            }}
          />
        </nav>
      </div>
    </div>
  )
}
