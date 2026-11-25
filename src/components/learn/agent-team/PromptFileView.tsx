/**
 * 内置提示词文件页：把某个内置分段当作一份**只读文档**打开。
 *
 * 内容与设置页列表同源（learn/ai/promptFiles → promptSections / workSystem），
 * 因此这里不做任何二次拼装，只按 agent + 层 + 文件 id 取回原段正文。
 * 外置提示词不走这里：它们本身就是 prompts/ 下的 md，用普通本地文件页签编辑。
 */
import { useMemo, useSyncExternalStore } from 'react'
import { FileText, Lock } from 'lucide-react'
import { DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import { loadAgentSettings, subscribeAgentSettings } from '../../../agent/settings'
import { listPromptFiles } from '../../../learn/ai/promptFiles'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'
import type { PromptFileLayer } from '../../../agent/promptFiles'
import type { AgentProfileId } from '../../../agent/agentProfile'

export function PromptFileView({
  agentId,
  layer,
  fileId,
}: {
  agentId: AgentProfileId
  layer: PromptFileLayer
  fileId: string
}) {
  const settings = useSyncExternalStore(subscribeAgentSettings, loadAgentSettings, loadAgentSettings)
  const file = useMemo(
    () => listPromptFiles(agentId, layer, settings.promptFiles).find((item) => item.id === fileId),
    [agentId, layer, settings.promptFiles, fileId],
  )

  if (!file) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-paper px-6 text-center text-[12.5px] leading-relaxed text-ink-faint">
        {t('这份内置提示词文件已经不在当前提示词清单里了。')}
      </div>
    )
  }

  const html = renderNote(file.content)
  const agentName = settings.profiles?.[agentId]?.name?.trim() || DEFAULT_AGENT_NAME[agentId]

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper">
      <header className="flex shrink-0 items-center gap-2 border-b border-line/70 px-4 py-2">
        <FileText size={14} className="shrink-0 text-seal" />
        <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink-strong">
          {t(file.name)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-line/45 px-2 py-0.5 text-[10.5px] text-ink-soft">
          <Lock size={10} />
          {t('内置 · 只读')}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
          {agentName} · {layer === 'role' ? t('role 层') : t('work 层')}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <article className="mx-auto w-full max-w-[820px] px-8 py-6">
          {file.content.trim() ? (
            <MarkdownView html={html} className="moji-agent-md" />
          ) : (
            <p className="text-[12.5px] text-ink-faint">{t('这一份提示词是空的。')}</p>
          )}
        </article>
      </div>
    </div>
  )
}
