/**
 * Vim :open / :o 下拉候选列表组件：
 * 展示可打开的目标项（教学文档、大纲导读、笔记、考试记录、超级文档、视频、文件、项目中的文件、设置页签、用量页签、考试窗口），
 * 呈现专属图标、标题、副标题与类型徽章，支持拼音匹配高亮与键盘/鼠标选取。
 */

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
  if (targets.length === 0) {
    return (
      <div className="rounded-lg bg-[color-mix(in_srgb,var(--color-card,#181825)_92%,transparent)] backdrop-blur-md border border-[color-mix(in_srgb,var(--color-line,rgba(255,255,255,0.15)))] shadow-[0_20px_48px_-4px_rgba(0,0,0,0.65)] p-4 text-center text-[13px] text-ink-faint">
        {t('未找到匹配的可打开目标（支持输入拼音首字母或关键词）')}
      </div>
    )
  }

  return (
    <div
      className="max-h-[380px] overflow-y-auto rounded-lg bg-[color-mix(in_srgb,var(--color-card,#181825)_92%,transparent)] backdrop-blur-md border border-[color-mix(in_srgb,var(--color-line,rgba(255,255,255,0.15)))] shadow-[0_20px_48px_-4px_rgba(0,0,0,0.65)] py-1"
      role="listbox"
      aria-label={t('可打开选项列表')}
    >
      {targets.slice(0, 15).map((item, idx) => {
        const active = idx === selectedIndex
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={active}
            className={
              'flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] transition cursor-pointer ' +
              (active ? 'bg-seal/15 text-seal-light' : 'hover:bg-line/40 text-ink')
            }
            onClick={() => onSelect(item)}
          >
            {renderKindIcon(item.kind)}
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <span className={'truncate font-medium text-[13px] ' + (active ? 'text-seal font-semibold' : 'text-ink')}>
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
