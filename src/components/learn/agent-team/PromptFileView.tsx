/**
 * 内置提示词文件页：把某个内置分段当作一份**只读文档**打开。
 *
 * 内容与设置页列表同源（learn/ai/promptFiles → promptSections / workSystem），
 * 因此这里不做任何二次拼装，只按 agent + 层 + 文件 id 取回原段正文。
 * 外置提示词不走这里：它们本身就是 prompts/ 下的 md，用普通本地文件页签编辑。
 *
 * 预览与「编辑（只读）」共用同一份正文：后者只是把源码铺进 SourceEditor，
 * 保留行号、折叠与 Vim 浏览，写入事务被 readOnly 挡住，不会产生草稿。
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, FileText, Lock } from 'lucide-react'
import { DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import { loadAgentSettings, subscribeAgentSettings } from '../../../agent/settings'
import { listPromptFiles } from '../../../learn/ai/promptFiles'
import MarkdownView from '../../MarkdownView'
import SourceEditor from '../SourceEditor'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'
import type { PromptFileLayer } from '../../../agent/promptFiles'
import type { AgentProfileId } from '../../../agent/agentProfile'

const ignoreReadOnlyChange = () => undefined

export function PromptFileView({
  agentId,
  layer,
  fileId,
  onBack,
}: {
  agentId: AgentProfileId
  layer: PromptFileLayer
  fileId: string
  /** 顶部「返回智能体页面并关闭当前页面」；不传就不画这枚按钮 */
  onBack?: () => void
}) {
  const settings = useSyncExternalStore(subscribeAgentSettings, loadAgentSettings, loadAgentSettings)
  const file = useMemo(
    () => listPromptFiles(agentId, layer, settings.promptFiles).find((item) => item.id === fileId),
    [agentId, layer, settings.promptFiles, fileId],
  )
  const [mode, setMode] = useState<'preview' | 'source'>('preview')

  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-paper px-6 text-center text-[12.5px] leading-relaxed text-ink-faint">
        {t('这份内置提示词文件已经不在当前提示词清单里了。')}
      </div>
    )
  }

  const html = renderNote(file.content)
  const agentName = settings.profiles?.[agentId]?.name?.trim() || DEFAULT_AGENT_NAME[agentId]
  const charCount = file.content.length

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line/70 px-4 py-2">
        <FileText size={14} className="shrink-0 text-seal" />
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink-strong">
          {t(file.name)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-line/45 px-2 py-0.5 text-[10.5px] text-ink-soft">
          <Lock size={10} />
          {t('内置 · 只读')}
        </span>
        <span
          data-prompt-char-count
          className="shrink-0 whitespace-nowrap text-[10.5px] tabular-nums text-ink-faint"
          title={t('这份文件的字符数')}
        >
          {t('{0} 字符', charCount)}
        </span>
        <span className="hidden shrink-0 text-[11px] text-ink-faint lg:inline">
          {agentName} · {layer === 'role' ? t('role 层') : t('work 层')}
        </span>
        <div data-prompt-actions className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5">
          <div
            role="group"
            aria-label={t('查看方式')}
            className="inline-flex shrink-0 items-center overflow-hidden rounded-md border border-line/70 bg-paper-deep/40 p-0.5"
          >
            <button
              type="button"
              data-prompt-mode="preview"
              aria-pressed={mode === 'preview'}
              onClick={() => setMode('preview')}
              className={`rounded px-2 py-0.5 text-[10.5px] transition ${
                mode === 'preview'
                  ? 'bg-ink-strong text-paper'
                  : 'text-ink-faint hover:bg-line/35 hover:text-ink-strong'
              }`}
            >
              {t('预览')}
            </button>
            <button
              type="button"
              data-prompt-mode="source"
              aria-pressed={mode === 'source'}
              onClick={() => setMode('source')}
              className={`rounded px-2 py-0.5 text-[10.5px] transition ${
                mode === 'source'
                  ? 'bg-ink-strong text-paper'
                  : 'text-ink-faint hover:bg-line/35 hover:text-ink-strong'
              }`}
            >
              {t('编辑（只读）')}
            </button>
          </div>
          {onBack && (
            <button
              type="button"
              data-prompt-back
              onClick={onBack}
              title={t('返回智能体页面并关闭当前页面')}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line/70 bg-paper px-2 py-1 text-[10.5px] text-ink-soft transition hover:border-line-strong hover:bg-line/30 hover:text-ink-strong"
            >
              <ArrowLeft size={12} />
              {t('返回智能体页面并关闭当前页面')}
            </button>
          )}
        </div>
      </header>
      {mode === 'source' ? (
        <div data-prompt-source className="moji-selectable flex min-h-0 flex-1 flex-col">
          <SourceEditor
            value={file.content}
            onChange={ignoreReadOnlyChange}
            state="saved"
            label={t(file.name)}
            ext=".md"
            readOnly
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <article
            data-prompt-preview-body
            className="moji-selectable mx-auto w-full max-w-[820px] px-8 py-6"
          >
            {file.content.trim() ? (
              <MarkdownView html={html} className="moji-agent-md" />
            ) : (
              <p className="text-[12.5px] text-ink-faint">{t('这一份提示词是空的。')}</p>
            )}
          </article>
        </div>
      )}
    </div>
  )
}
