/**
 * Vim :open / :o 下拉候选列表组件：
 * 展示可打开的目标项（教学文档、大纲导读、笔记、考试记录、超级文档、视频、文件、项目中的文件、设置页签、用量页签、考试窗口），
 * 呈现专属图标、标题、副标题与类型徽章，支持拼音匹配高亮与键盘/鼠标选取。
 */

import { useEffect, useRef } from 'react'
import {
  BookOpen,
  Compass,
  FileText,
  Award,
  FileCode,
  Video,
  File,
  FolderGit2,
  Sliders,
  BarChart2,
  GraduationCap,
} from 'lucide-react'
import type { VimOpenKind, VimOpenTarget } from '../../../lib/vimOpenTargets'
import { t } from '../../../i18n'

interface Props {
  targets: VimOpenTarget[]
  selectedIndex: number
  onSelect: (target: VimOpenTarget) => void
}

function renderKindIcon(kind: VimOpenKind) {
  switch (kind) {
    case 'teaching':
      return <BookOpen size={15} className="shrink-0 text-seal" />
    case 'outline':
      return <Compass size={15} className="shrink-0 text-emerald-400" />
    case 'guide':
      return <Compass size={15} className="shrink-0 text-sky-400" />
    case 'note':
      return <FileText size={15} className="shrink-0 text-amber-400" />
    case 'examRecord':
      return <Award size={15} className="shrink-0 text-purple-400" />
    case 'superdoc':
      return <FileCode size={15} className="shrink-0 text-pink-400" />
    case 'video':
      return <Video size={15} className="shrink-0 text-rose-400" />
    case 'file':
      return <File size={15} className="shrink-0 text-blue-400" />
    case 'ws':
      return <FolderGit2 size={15} className="shrink-0 text-indigo-400" />
    case 'settings':
      return <Sliders size={15} className="shrink-0 text-ink-soft" />
    case 'usage':
      return <BarChart2 size={15} className="shrink-0 text-teal-400" />
    case 'examWindow':
      return <GraduationCap size={15} className="shrink-0 text-amber-500" />
    default:
      return <FileText size={15} className="shrink-0 text-ink-soft" />
  }
}

export default function VimOpenDropdown({ targets, selectedIndex, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (targets.length === 0) {
    return (
      <div className="p-4 text-center text-[12.5px] text-ink-faint">
        {t('未找到匹配的可打开目标（支持输入拼音首字母或关键词）')}
      </div>
    )
  }

  return (
    <div
      className="max-h-[360px] overflow-y-auto p-1.5 flex flex-col gap-0.5"
      role="listbox"
      aria-label={t('可打开选项列表')}
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
            {renderKindIcon(item.kind)}
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
