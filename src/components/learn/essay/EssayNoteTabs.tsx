/**
 * 笔记 Tab 的两页（搬自 EssayDock，纯搬运）：
 *
 * 一级是**当前目标**下的笔记列表（不跨目标，见 LearnWorkspace 的 dockNotes），带搜索；
 * 二级是笔记的编辑 / 预览（自由切换模式，不可提交），顶部有节点归属的面包屑。
 * 只做展示：数据与回调逐项从宿主（EssayDock）传进来，去抖写入与流转在 useEssayEditor。
 */
import { ArrowLeft, BookOpen, Edit3, ExternalLink, Eye, Search, Trash2 } from 'lucide-react'
import type { DockNoteItem } from '../../../learn/types'
import { essayPreview } from '../../../learn/essays'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'
import MarkdownView from '../../MarkdownView'
import EssayEditor from './EssayEditor'
import { timeLabel } from './essayLabels'

/** 正在看的笔记：null = 笔记列表（一级页面） */
type NoteTarget = { nodeId: string; noteName: string; goalId?: string }

interface Props {
  /** 搜索过滤词（受控） */
  noteSearch: string
  onSearchChange: (next: string) => void
  /** 过滤后的笔记（一级列表用） */
  filteredNotes: DockNoteItem[]
  /** 打开指定笔记编辑/预览（二级页面） */
  onOpenNote: (item: DockNoteItem) => void
  noteTarget: NoteTarget | null
  /** noteTarget 对应的笔记条目（面包屑用；笔记刚被外部删掉时为 null） */
  currentNoteItem: DockNoteItem | null
  /** 笔记正文（受控） */
  noteText: string
  onNoteTextChange: (next: string) => void
  /** 二级页面模式：预览 / 编辑（可自由切换） */
  noteViewMode: 'edit' | 'preview'
  onToggleViewMode: () => void
  /** 返回笔记列表（一级页面） */
  onBackToList: () => void
  /** 在主工作区打开这份笔记 */
  onOpenInWorkspace: (nodeId: string, noteName: string) => void
  /** 删除这份笔记（宿主没给就不摆删除按钮） */
  onDeleteNote?: (nodeId: string, noteName: string) => void
}

export function EssayNoteTabs({
  noteSearch,
  onSearchChange,
  filteredNotes,
  onOpenNote,
  noteTarget,
  currentNoteItem,
  noteText,
  onNoteTextChange,
  noteViewMode,
  onToggleViewMode,
  onBackToList,
  onOpenInWorkspace,
  onDeleteNote,
}: Props) {
  if (noteTarget === null) {
    /* ----- 笔记一级页面：当前目标下的笔记列表（不跨目标，见 LearnWorkspace 的 dockNotes） ----- */
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        {/* 操作与搜索栏 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line/80 px-3 py-2 bg-paper/40">
          <span className="shrink-0 text-[11.5px] font-medium text-ink-strong">
            {t('笔记列表')}
            <span className="ml-1 text-[10.5px] font-normal text-ink-faint">({filteredNotes.length})</span>
          </span>
          <div className="relative min-w-0 flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={noteSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('搜索笔记或节点…')}
              className="h-6 w-full rounded-none border border-line bg-paper/70 pl-6 pr-2 text-[11px] text-ink outline-none transition focus:border-seal/50"
            />
          </div>
        </div>

        {/* 笔记列表项 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {filteredNotes.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center text-ink-faint">
              <BookOpen size={28} className="text-line-strong/60 mb-2" />
              <p className="text-[12px]">{noteSearch ? t('未找到匹配的笔记') : t('当前目标还没有笔记')}</p>
              <p className="text-[10.5px] text-ink-faint mt-1 max-w-[260px]">
                {t('笔记是节点级的，只列当前目标下的节点；在学习文档或右键菜单中可为节点记笔记。')}
              </p>
            </div>
          ) : (
            filteredNotes.map((item) => (
              <div
                key={item.nodeId + '\u0000' + item.name}
                onClick={() => onOpenNote(item)}
                className="group relative cursor-pointer rounded-none border border-line bg-paper/60 p-2.5 transition hover:border-seal/45 hover:bg-paper hover:shadow-xs"
              >
                {/* 只列当前目标：只需标明是哪个节点的笔记 */}
                <div className="flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                  <span className="truncate max-w-[220px] rounded-none bg-line/60 px-1 py-0.5 text-[10px] font-medium text-ink-soft">
                    {item.nodeTitle || t('未知节点')}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-[10px] text-ink-faint">
                    {timeLabel(item.updatedAt)}
                  </span>
                </div>

                <div className="mt-1 truncate text-[12px] font-medium text-ink-strong">
                  {item.name}
                </div>

                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-soft">
                  {essayPreview(item.content, 140) || t('（空笔记）')}
                </p>

                <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-faint">
                  <span>{t('{0} 字', item.content.length)}</span>
                  <span className="text-seal/80 opacity-0 group-hover:opacity-100 transition text-[10.5px]">
                    {t('查看 / 编辑 →')}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  /* ----- 笔记二级页面：笔记编辑 / 预览（自由切换预览与编辑模式，不可提交） ----- */
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {/* 二级顶栏 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-card/70 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onBackToList}
          title={t('返回列表')}
          aria-label={t('返回列表')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
        >
          <ArrowLeft size={13} />
        </button>

        {/* 节点归属面包屑 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[10px] text-ink-faint truncate">
            <span>{currentNoteItem?.goalTitle || t('未知目标')}</span>
            <span>/</span>
            <span className="font-medium text-ink-soft">{currentNoteItem?.nodeTitle || t('未知节点')}</span>
          </div>
          <div className="truncate text-[12px] font-medium text-ink-strong leading-none mt-0.5">
            {noteTarget.noteName}
          </div>
        </div>

        {/* 自由切换浏览页面或者编辑页面 */}
        <button
          type="button"
          onClick={onToggleViewMode}
          title={noteViewMode === 'preview' ? t('切换到编辑页面') : t('切换到浏览页面')}
          className="flex h-6 shrink-0 items-center gap-1 rounded-none border border-line bg-paper/80 px-2 text-[10.5px] font-medium text-ink-soft transition hover:border-seal/40 hover:text-seal-deep"
        >
          {noteViewMode === 'preview' ? (
            <>
              <Edit3 size={11} className="text-seal" />
              {t('编辑')}
            </>
          ) : (
            <>
              <Eye size={11} className="text-seal" />
              {t('预览')}
            </>
          )}
        </button>

        {/* 在工作区中打开 */}
        <button
          type="button"
          onClick={() => onOpenInWorkspace(noteTarget.nodeId, noteTarget.noteName)}
          title={t('在主工作区打开此笔记')}
          aria-label={t('在工作区打开')}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
        >
          <ExternalLink size={12} />
        </button>

        {onDeleteNote && (
          <button
            type="button"
            onClick={() => {
              onDeleteNote(noteTarget.nodeId, noteTarget.noteName)
              onBackToList()
            }}
            title={t('删除这份笔记')}
            aria-label={t('删除')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* 笔记展示区：预览模式 vs 编辑模式 */}
      {noteViewMode === 'preview' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 bg-paper/40">
          {noteText.trim() ? (
            <MarkdownView
              html={renderNote(noteText)}
              className="moji-md text-[12.5px] leading-relaxed text-ink"
            />
          ) : (
            <p className="text-[11.5px] text-ink-faint py-4">{t('（笔记内容为空，点击上方「编辑」开始记录）')}</p>
          )}
        </div>
      ) : (
        <EssayEditor
          value={noteText}
          onChange={onNoteTextChange}
          placeholder={t('写点笔记…（支持 Markdown，停手即存）')}
        />
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1 text-[10.5px] text-ink-faint">
        <span>{noteViewMode === 'edit' ? t('已自动保存') : t('只读浏览页面')}</span>
        <span className="ml-auto tabular-nums">{noteText.length ? t('{0} 字', noteText.length) : ''}</span>
      </div>
    </div>
  )
}
