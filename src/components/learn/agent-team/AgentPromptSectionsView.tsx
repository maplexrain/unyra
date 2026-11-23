/**
 * 智能体设置页面的系统提示词切片折叠展示视图（AgentPromptSectionsView）
 *
 * 核心特性：
 * 1. 结构化切割不同部分的提示词（共同基础、角色定位、API 能力面、排版指南、工作流、纪律红线、用户附加等）。
 * 2. 每个部分都可以独立折叠/展开，并支持一键全部折叠 / 全部展开。
 * 3. 拥有醒目的编号索引（#01, #02...）与对应的多主题色彩标识徽章。
 * 4. 增大字体（MarkdownSyntaxViewer 内置 13px/13.5px），并提供纯语法高亮（非 HTML 解析）。
 * 5. 支持单节复制与全文复制。
 */

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Layers, ListCollapse, ListTree } from 'lucide-react'
import { getAgentPromptSections, type PromptSectionColor } from '../../../learn/ai'
import { t } from '../../../i18n'
import { MarkdownSyntaxViewer } from './MarkdownSyntaxViewer'
import type { AgentTeamMode } from './conversationList'

interface AgentPromptSectionsViewProps {
  agentId: AgentTeamMode
  extraSystemPrompt?: string
  isTutor: boolean
  personaLabel?: string
  docFormatLabel?: string
}

/** 颜色主题配置映射表 */
const COLOR_STYLES: Record<
  PromptSectionColor,
  {
    badge: string
    index: string
    border: string
    bgHeader: string
  }
> = {
  indigo: {
    badge: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
    index: 'text-indigo-600 dark:text-indigo-400 font-bold',
    border: 'border-indigo-500/30 hover:border-indigo-500/60',
    bgHeader: 'bg-indigo-500/5',
  },
  blue: {
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
    index: 'text-blue-600 dark:text-blue-400 font-bold',
    border: 'border-blue-500/30 hover:border-blue-500/60',
    bgHeader: 'bg-blue-500/5',
  },
  emerald: {
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
    index: 'text-emerald-600 dark:text-emerald-400 font-bold',
    border: 'border-emerald-500/30 hover:border-emerald-500/60',
    bgHeader: 'bg-emerald-500/5',
  },
  amber: {
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20',
    index: 'text-amber-600 dark:text-amber-400 font-bold',
    border: 'border-amber-500/30 hover:border-amber-500/60',
    bgHeader: 'bg-amber-500/5',
  },
  purple: {
    badge: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
    index: 'text-purple-600 dark:text-purple-400 font-bold',
    border: 'border-purple-500/30 hover:border-purple-500/60',
    bgHeader: 'bg-purple-500/5',
  },
  rose: {
    badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20',
    index: 'text-rose-600 dark:text-rose-400 font-bold',
    border: 'border-rose-500/30 hover:border-rose-500/60',
    bgHeader: 'bg-rose-500/5',
  },
  teal: {
    badge: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20',
    index: 'text-teal-600 dark:text-teal-400 font-bold',
    border: 'border-teal-500/30 hover:border-teal-500/60',
    bgHeader: 'bg-teal-500/5',
  },
  slate: {
    badge: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20',
    index: 'text-slate-600 dark:text-slate-400 font-bold',
    border: 'border-slate-500/30 hover:border-slate-500/60',
    bgHeader: 'bg-slate-500/5',
  },
}

export function AgentPromptSectionsView({
  agentId,
  extraSystemPrompt,
  isTutor,
  personaLabel,
  docFormatLabel,
}: AgentPromptSectionsViewProps) {
  // 获取结构化切片列表
  const sections = useMemo(
    () => getAgentPromptSections(agentId, { extraSystemPrompt }),
    [agentId, extraSystemPrompt],
  )

  // 全文文本
  const fullText = useMemo(() => sections.map((s) => s.content).join('\n\n'), [sections])

  // 控制每个分段的展开/收起状态（默认全展开）
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({})

  // 复制反馈状态
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const toggleSection = (id: string) => {
    setCollapsedMap((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const collapseAll = () => {
    const next: Record<string, boolean> = {}
    for (const s of sections) next[s.id] = true
    setCollapsedMap(next)
  }

  const expandAll = () => {
    setCollapsedMap({})
  }

  const handleCopy = (text: string, key: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedKey(key)
        window.setTimeout(() => setCopiedKey(null), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 顶部配置注记与操作工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2 text-[11.5px] text-ink-soft">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {isTutor && personaLabel && (
            <span>
              {t('人格')}: <span className="font-medium text-ink-strong">{personaLabel}</span>
            </span>
          )}
          {isTutor && docFormatLabel && (
            <span>
              {t('文档格式')}: <span className="font-medium text-ink-strong">{docFormatLabel}</span>
            </span>
          )}
          <span>
            {t('追加提示词')}:{' '}
            <span className="font-medium text-ink-strong">
              {extraSystemPrompt ? t('已启用') : t('未启用')}
            </span>
          </span>
          <span className="text-ink-faint">
            {t('共 {0} 个部分 · {1} 字', sections.length, fullText.length)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            type="button"
            onClick={expandAll}
            className="flex items-center gap-1 rounded-md border border-line bg-card/60 px-2 py-1 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            title={t('展开所有部分')}
          >
            <ListTree size={12} />
            <span>{t('全部展开')}</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="flex items-center gap-1 rounded-md border border-line bg-card/60 px-2 py-1 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            title={t('折叠所有部分')}
          >
            <ListCollapse size={12} />
            <span>{t('全部折叠')}</span>
          </button>
          <button
            type="button"
            onClick={() => handleCopy(fullText, 'full')}
            className="flex items-center gap-1 rounded-md border border-line bg-card/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            title={t('复制完整的系统提示词')}
          >
            {copiedKey === 'full' ? (
              <>
                <Check size={12} className="text-emerald-500" />
                <span className="text-emerald-600 font-medium">{t('已复制全文')}</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>{t('复制全文')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 结构化提示词分节手风琴列表 */}
      <div className="flex flex-col gap-2.5">
        {sections.map((section) => {
          const isCollapsed = Boolean(collapsedMap[section.id])
          const style = COLOR_STYLES[section.color] || COLOR_STYLES.slate
          const formattedIndex = `#${String(section.index).padStart(2, '0')}`

          return (
            <div
              key={section.id}
              className={`overflow-hidden rounded-xl border bg-paper-deep/30 transition-all duration-200 ${style.border}`}
            >
              {/* 分节卡片头部 */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleSection(section.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleSection(section.id)
                  }
                }}
                className={`flex select-none items-center justify-between gap-3 px-3.5 py-2.5 cursor-pointer transition ${style.bgHeader} hover:bg-card/70`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* 折叠箭头 */}
                  <span className="text-ink-faint shrink-0">
                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </span>

                  {/* 序号索引标识 */}
                  <span className={`text-[12px] font-mono tracking-tight shrink-0 ${style.index}`}>
                    {formattedIndex}
                  </span>

                  {/* 类别彩色徽章 */}
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold leading-none ${style.badge}`}
                  >
                    {t(section.badge)}
                  </span>

                  {/* 标题 */}
                  <span className="truncate text-[12.5px] font-semibold text-ink-strong">
                    {t(section.title)}
                  </span>

                  {section.isCommon && (
                    <span
                      title={t('此部分为团队通用基座前缀')}
                      className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-ink-faint shrink-0"
                    >
                      <Layers size={10} className="text-indigo-500" />
                      <span>{t('多角色共用')}</span>
                    </span>
                  )}
                </div>

                {/* 右侧统计与复制小按钮 */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] tabular-nums text-ink-faint">
                    {t('{0} 字', section.content.length)}
                  </span>

                  <button
                    type="button"
                    title={t('复制本节内容')}
                    aria-label={t('复制本节内容')}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCopy(section.content, section.id)
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
                  >
                    {copiedKey === section.id ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>

              {/* 展开内容区：语法高亮查看器 */}
              {!isCollapsed && (
                <div className="border-t border-line/60 bg-card/60">
                  <MarkdownSyntaxViewer content={section.content} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
