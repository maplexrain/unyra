/**
 * 提交整理的三块子页面（搬自 EssayDock，纯搬运）：
 *
 * - **提交确认**（'commit'）：提交说明 + 全部随笔 vs 上一次提交的差异（新增 / 修改 /
 *   删除 / 未变化——差异口径在 learn/essayCommits 的 diffEssaysAgainst，宿主算好传进来，
 *   列表页的「可提交」用的是同一份）；
 * - **提交记录**（'history'）：timeline，每个节点只摆「日期 + 评论标题」；
 * - **提交详情**（'detail'）：整理评论、整理结果（动过的笔记）、这次封存的快照全文。
 *
 * 只做展示：数据与回调逐项从宿主（EssayDock）传进来；提交记录是**目标级**的
 * （每次提交都封存全部随笔，需求定的）。
 */
import { FileText, GitCommitHorizontal, Loader2, PenLine, RefreshCw } from 'lucide-react'
import type { EssayCommit, EssayEntry } from '../../../learn/types'
import { essayPreview } from '../../../learn/essays'
import { changesSummary, essayCommentTitle, type EssayDiff } from '../../../learn/essayCommits'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'
import MarkdownView from '../../MarkdownView'
import type { SubPanel } from './useEssayEditor'
import { dateLabelOfEssay, timeLabel, titleOf } from './essayLabels'

/** 状态徽章：整理中 / 已整理 / 整理失败 */
export function StatusBadge({ status }: { status: EssayCommit['status'] }) {
  const tone =
    status === 'done'
      ? 'bg-ok/10 text-ok-text'
      : status === 'error'
        ? 'bg-warn/10 text-warn-deep'
        : 'bg-line/70 text-ink-faint'
  const label = status === 'done' ? t('已整理') : status === 'error' ? t('整理失败') : t('整理中')
  return <span className={'shrink-0 rounded-none px-1.5 py-px text-[10px] leading-4 ' + tone}>{label}</span>
}

interface Props {
  /** 三块子页面里渲染哪一块（由宿主的 subPanel 决定；'main' 时不挂这个组件） */
  subPanel: SubPanel
  /** 这个目标的随笔（新的在前）：提交页的差异与字数、详情页都要 */
  essays: EssayEntry[]
  /** 这个目标的提交记录（新的在前，目标级——每次提交都封存全部随笔） */
  commits: EssayCommit[]
  /** 全部随笔 vs 上一次提交的差异（宿主算好：列表页的「可提交」与这里是同一份） */
  diff: EssayDiff
  /** 正在看哪一条提交；null = 详情页显示「这条提交记录已经不在了」 */
  activeCommit: EssayCommit | null
  /** 提交说明（受控） */
  commitMessage: string
  onMessageChange: (next: string) => void
  /** 提交全部并整理（宿主会拿返回的提交 id 打开详情） */
  onSubmit: () => void
  /** 从历史 timeline 打开某次提交的详情 */
  onOpenDetail: (id: string) => void
  /** 从提交详情里或笔记项打开一份笔记到主工作区 */
  onOpenNote: (nodeId: string, noteName: string) => void
  /** 重试一次失败的整理（快照还在，不必重新提交） */
  onRetryCommit: (id: string) => void
  /** 回到随笔列表（提交页的「取消」与详情页的「返回」共用） */
  onBackToMain: () => void
}

export function EssayCommitPanel({
  subPanel,
  essays,
  commits,
  diff,
  activeCommit,
  commitMessage,
  onMessageChange,
  onSubmit,
  onOpenDetail,
  onOpenNote,
  onRetryCommit,
  onBackToMain,
}: Props) {
  if (subPanel === 'commit') {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            {t('每次提交都会带上当前的全部随笔；AI 按与上次相比的新增、修改与删除，统一整理进对应节点的笔记，整理结果会记在这次提交上。')}
          </p>
          <label className="mt-3 block text-[11px] font-medium text-ink-soft" htmlFor="essay-commit-message">
            {t('提交说明')}
          </label>
          <input
            id="essay-commit-message"
            value={commitMessage}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder={t('这次随笔在整理什么？')}
            className="mt-1 w-full rounded-none border border-line bg-paper/70 px-2 py-1.5 text-[12px] text-ink outline-none transition focus:border-seal/50"
          />
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-[11px] font-medium text-ink-soft">{t('本次快照')}</span>
            <span className="text-[10.5px] text-ink-faint">{t('全部 {0} 条随笔', String(essays.length))}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-faint">
            <span>{t('新增 {0}', String(diff.added.length))}</span>
            <span>·</span>
            <span>{t('修改 {0}', String(diff.edited.length))}</span>
            <span>·</span>
            <span>{t('删除 {0}', String(diff.removed.length))}</span>
            <span>·</span>
            <span>{t('未变化 {0}', String(diff.unchanged.length))}</span>
          </div>
          <div className="mt-1.5 space-y-1.5">
            {!diff.changed ? (
              <p className="px-1 py-2 text-[11px] text-ink-faint">{t('和上次提交相比没有变化')}</p>
            ) : (
              <>
                {diff.added.map((essay) => (
                  <div key={essay.id} className="rounded-none border border-line bg-paper/60 px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-none bg-ok/10 px-1 py-px text-[9.5px] text-ok-deep">{t('新增')}</span>
                      <span className="truncate text-[10.5px] text-ink-faint">{titleOf(essay)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft">
                      {essayPreview(essay.text, 140)}
                    </p>
                  </div>
                ))}
                {diff.edited.map((essay) => (
                  <div key={essay.id} className="rounded-none border border-line bg-paper/60 px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-none bg-seal/10 px-1 py-px text-[9.5px] text-seal-deep">{t('已修改')}</span>
                      <span className="truncate text-[10.5px] text-ink-faint">{titleOf(essay)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft">
                      {essayPreview(essay.text, 140)}
                    </p>
                  </div>
                ))}
                {diff.removed.map((r) => (
                  <div key={r.id} className="flex items-center gap-1.5 rounded-none border border-line/70 bg-paper/40 px-2.5 py-2">
                    <span className="rounded-none bg-warn/10 px-1 py-px text-[9.5px] text-warn-deep">{t('已删除')}</span>
                    <span className="truncate text-[11px] text-ink-soft">{r.title || dateLabelOfEssay(r.createdAt)}</span>
                  </div>
                ))}
                {diff.unchanged.length > 0 && (
                  <p className="px-1 pt-1 text-[10.5px] leading-relaxed text-ink-faint">
                    {t('其余 {0} 条未变化，也会随快照一起交给 AI。', String(diff.unchanged.length))}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-line px-3 py-2">
          <button
            type="button"
            onClick={onBackToMain}
            className="h-7 rounded-none px-2.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('取消')}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!diff.changed}
            className="flex h-7 items-center gap-1.5 rounded-none bg-seal px-3 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:cursor-default disabled:opacity-40"
          >
            <GitCommitHorizontal size={13} />
            {t('提交全部并整理')}
          </button>
        </div>
      </div>
    )
  }

  if (subPanel === 'history') {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          {commits.length === 0 ? (
            <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-faint">
              {t('当前目标还没有随笔提交记录：提交一次，这里会沿时间轴留下快照与整理评论。')}
            </p>
          ) : (
            /*
             * timeline（用户定的）：一条竖线串起每次提交，节点上只摆
             * 「日期 + 评论标题」两行小字——细节（动过的笔记、快照原文、
             * 评论全文）点开详情再看，列表保持一眼能扫完。
             */
            <ol className="ml-1 border-l border-line pl-3.5">
              {commits.map((commit) => (
                <li key={commit.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[18.5px] top-2.5 h-2 w-2 rounded-none border border-seal/50 bg-seal/60"
                  />
                  <button
                    type="button"
                    onClick={() => onOpenDetail(commit.id)}
                    title={t('点击查看这次提交的详细记录')}
                    className="mb-1 block w-full rounded-none px-2 py-1.5 text-left transition last:mb-0 hover:bg-line/50"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
                        {essayCommentTitle(commit)}
                      </span>
                      <StatusBadge status={commit.status} />
                    </span>
                    <span className="mt-0.5 block text-[10.5px] tabular-nums text-ink-faint">
                      {timeLabel(commit.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    )
  }

  /** 这次提交封存的全部随笔（快照就挂在提交上，目标级——见 learn/essayCommits） */
  const scopedSnapshot = activeCommit ? activeCommit.snapshot : []

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {activeCommit ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
          <div className="text-[10.5px] text-ink-faint">
            {timeLabel(activeCommit.at)} · {t('{0} 条随笔', String(scopedSnapshot.length))}
          </div>

          {activeCommit.comment && (
            <section className="mt-3">
              <h4 className="text-[11px] font-medium text-ink-soft">{t('整理评论')}</h4>
              {/* Agent 对这次提交的评论（Markdown，首行是标题，见 learn/essayCommits） */}
              <MarkdownView
                html={renderNote(activeCommit.comment)}
                className="moji-agent-md mt-1.5 rounded-none border border-line bg-paper/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft"
              />
            </section>
          )}

          {activeCommit.status === 'running' && (
            <div className="mt-2 flex items-center gap-2 rounded-none border border-line bg-paper/60 px-2.5 py-2 text-[11px] text-ink-soft">
              <Loader2 size={12} className="animate-spin text-seal" />
              {t('正在整理…整理完成后这里会列出动过的笔记')}
            </div>
          )}

          {activeCommit.status === 'error' && (
            <div className="mt-2 rounded-none border border-warn/40 bg-warn/5 px-2.5 py-2 text-[11px] leading-relaxed text-warn-deep">
              <p>{activeCommit.error || t('整理失败，可以重试')}</p>
              <button
                type="button"
                onClick={() => onRetryCommit(activeCommit.id)}
                className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-none border border-warn/40 px-1.5 text-[10.5px] font-medium transition hover:bg-warn/10"
              >
                <RefreshCw size={11} />
                {t('重试整理')}
              </button>
            </div>
          )}

          {activeCommit.status !== 'running' && (
            <section className="mt-3">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-[11px] font-medium text-ink-soft">{t('整理结果')}</h4>
                <span className="text-[10px] text-ink-faint">{changesSummary(activeCommit.changes)}</span>
              </div>
              <div className="mt-1.5 space-y-1">
                {activeCommit.changes.length === 0 ? (
                  <p className="px-1 py-1.5 text-[11px] text-ink-faint">{t('这次整理没有改动任何笔记')}</p>
                ) : (
                  activeCommit.changes.map((c) => (
                    <button
                      key={c.nodeId + '\u0000' + c.noteName}
                      type="button"
                      onClick={() => onOpenNote(c.nodeId, c.noteName)}
                      title={t('打开这份笔记')}
                      className="flex w-full items-center gap-2 rounded-none border border-line bg-paper/60 px-2 py-1.5 text-left transition hover:border-seal/40 hover:bg-paper"
                    >
                      <FileText size={12} className="shrink-0 text-seal/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-ink">{c.nodeTitle || t('（未知节点）')}</span>
                        <span className="block truncate text-[10px] text-ink-faint">{t('笔记「{0}」', c.noteName)}</span>
                      </span>
                      <span className="shrink-0 rounded-none bg-line/60 px-1.5 py-px text-[9.5px] text-ink-faint">
                        {c.kind === 'created' ? t('新建') : t('更新')}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          )}

          <section className="mt-3">
            <h4 className="text-[11px] font-medium text-ink-soft">{t('快照')}</h4>
            {/* 这次提交封存的全部随笔（见上面的 scopedSnapshot） */}
            <div className="mt-1.5 space-y-1.5">
              {scopedSnapshot.length === 0 ? (
                <p className="px-1 py-1.5 text-[11px] text-ink-faint">
                  {t('这次提交里没有随笔')}
                </p>
              ) : (
                scopedSnapshot.map((essay) => (
                  <div key={essay.id} className="rounded-none border border-line bg-paper/50 px-2.5 py-2">
                    {/* 旧提交的快照没有标题：按提交日期回退（见 types 的 EssayCommit.snapshot） */}
                    <div className="truncate text-[10px] text-ink-faint">
                      {essay.title || dateLabelOfEssay(essay.createdAt)}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-soft">
                      {essay.text}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      ) : (
        <p className="px-3 py-4 text-[11px] text-ink-faint">{t('这条提交记录已经不在了')}</p>
      )}
      {activeCommit && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[10.5px] text-ink-faint">
          <span className="min-w-0 flex-1 truncate">
            {t('每次提交都带全部随笔；AI 只整理与上次相比新增、修改、删除的部分')}
          </span>
          <button
            type="button"
            onClick={onBackToMain}
            className="flex h-6 shrink-0 items-center gap-1 rounded-none bg-seal/10 px-2 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15"
          >
            <PenLine size={11} />
            {t('返回')}
          </button>
        </div>
      )}
    </div>
  )
}
