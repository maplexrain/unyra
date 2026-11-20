/**
 * Vim :side / :sd 命令下拉候选列表组件：
 * 展示工作区中除当前活动页签以外的其他已打开页签，支持拼音首字母、全拼与关键字过滤，
 * 选定后在当前页签内部并排开启双栏传送对照。
 */

import { useEffect, useRef } from 'react'
import { ArrowLeftRight, FileText, X } from 'lucide-react'
import { TabTypeIcon } from '../tabbar/TabIcons'
import type { VimSideTarget } from '../../../lib/vimSideTargets'
import { t } from '../../../i18n'

interface Props {
  targets: VimSideTarget[]
  selectedIndex: number
  onSelect: (target: VimSideTarget) => void
}

function renderSideIcon(item: VimSideTarget) {
  if (item.actionType === 'swap') {
    return <ArrowLeftRight size={15} className="shrink-0 text-sky-400" />
  }
  if (item.actionType === 'close') {
    return <X size={15} className="shrink-0 text-seal" />
  }
  if (item.ref) {
    return <TabTypeIcon tab={item.ref} />
  }
  return <FileText size={15} className="shrink-0 text-ink-soft" />
}

export default function VimSideDropdown({ targets, selectedIndex, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (targets.length === 0) {
    return (
      <div className="p-4 text-center text-[12.5px] text-ink-faint">
        {t('当前没有其他已打开页签可并排对照')}
      </div>
    )
  }

  return (
    <div
      className="max-h-[360px] overflow-y-auto p-1.5 flex flex-col gap-0.5"
      role="listbox"
      aria-label={t('可并排对照页签列表')}
    >
      {targets.slice(0, 40).map((item, idx) => {
        const active = idx === selectedIndex
        return (
          <button
            key={item.id}
            ref={active ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={active}
            className={
              'flex w-full items-center gap-3 px-3 py-2 text-left rounded-lg text-[13px] transition cursor-pointer ' +
              (active ? 'bg-seal/15 text-seal-light' : 'hover:bg-line/40 text-ink')
            }
            onClick={() => onSelect(item)}
          >
            {renderSideIcon(item)}
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <span className={'truncate text-[13px] ' + (active ? 'text-seal font-semibold' : 'text-ink font-medium')}>
                {item.title}
              </span>
              {item.subtitle && (
                <span className="truncate text-[11px] text-ink-faint leading-tight">
                  {item.subtitle}
                </span>
              )}
            </div>
            <span
              className={
                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono border ' +
                (active
                  ? 'border-seal/40 bg-seal/10 text-seal'
                  : 'border-line/60 bg-paper/60 text-ink-faint')
              }
            >
              {item.badge}
            </span>
          </button>
        )
      })}
    </div>
  )
}
