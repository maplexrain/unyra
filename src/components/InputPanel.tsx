/**
 * 设置 → 输入：快捷键设置与按键映射。
 *
 * 提供清晰的快捷键分类、搜索筛选、拟真键帽（Kbd）展示、交互式改键与冲突防护。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Edit2,
  Keyboard,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { pane } from './Pane'
import {
  comboFromEvent,
  comboLabel,
  formatCombo,
  resetAllShortcuts,
  resetShortcut,
  setShortcut,
  setShortcutRecording,
  shortcutRows,
  type ShortcutRow,
} from '../lib/shortcuts'
import { t } from '../i18n'

interface Props {
  onToast: (msg: string) => void
}

type FilterCategory = 'all' | 'doc' | 'view'

/** 拟真物理键帽微组件 */
function KeyCap({
  children,
  isPending = false,
}: {
  children: React.ReactNode
  isPending?: boolean
}) {
  return (
    <kbd
      className={`inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-semibold select-none transition-colors ${
        isPending
          ? 'animate-pulse border-dashed border-seal/60 bg-seal/10 text-seal-deep'
          : 'border-line-strong/80 bg-paper-deep text-ink-strong shadow-[0_1.5px_0_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-elevated dark:shadow-[0_1.5px_0_rgba(0,0,0,0.4)]'
      }`}
    >
      {children}
    </kbd>
  )
}

/** 组合键展示组件：按键帽风格分割显示 */
function KeyComboDisplay({ comboText }: { comboText: string }) {
  const parts = comboText
    .split(' + ')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      {parts.map((p, idx) => (
        <span key={idx} className="flex items-center gap-1">
          {idx > 0 && <span className="text-[10px] text-ink-faint">+</span>}
          <KeyCap>{p}</KeyCap>
        </span>
      ))}
    </div>
  )
}

export default function InputPanel({ onToast }: Props) {
  const [rows, setRows] = useState<ShortcutRow[]>(shortcutRows)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<FilterCategory>('all')

  const refresh = useCallback(() => setRows(shortcutRows()), [])

  // 录键模式监听：按下新组合时实时录制
  useEffect(() => {
    if (!recordingId) return
    setShortcutRecording(true)

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecordingId(null)
        setError('')
        return
      }

      const combo = comboFromEvent(e)
      if (!combo) {
        // 仅按下了修饰键（Ctrl / Alt / Shift / Win）：先收集并渲染，等待主键
        const mods: string[] = []
        if (e.ctrlKey) mods.push('Ctrl')
        if (e.altKey) mods.push('Alt')
        if (e.shiftKey) mods.push('Shift')
        if (e.metaKey) mods.push('Win')
        setPending(mods.join(' + '))
        return
      }

      const text = formatCombo(combo)
      const res = setShortcut(recordingId, text)
      if (res.ok) {
        setRecordingId(null)
        setError('')
        onToast(t('快捷键已改成 {0}', comboLabel(text)))
        refresh()
        return
      }

      // 组合冲突或已被系统占用：保持在录键态并显示警告提示
      setError(res.error)
      setPending(text)
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setShortcutRecording(false)
    }
  }, [recordingId, onToast, refresh])

  const startRecording = (id: string) => {
    setError('')
    setPending('')
    setRecordingId(id)
  }

  const cancelRecording = () => {
    setRecordingId(null)
    setError('')
    setPending('')
  }

  // 分类与关键词过滤
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      // 分类筛选
      if (category === 'doc' && !row.id.startsWith('doc.') && row.id !== 'learn.save') return false
      if (
        category === 'view' &&
        row.id !== 'learn.closeTab' &&
        row.id !== 'agent.focus' &&
        row.id !== 'doc.zen' &&
        row.id !== 'web.newTab'
      )
        return false

      // 关键词筛选
      if (!q) return true
      const labelMatch = t(row.label).toLowerCase().includes(q)
      const hintMatch = t(row.hint).toLowerCase().includes(q)
      const comboMatch = row.combo.toLowerCase().includes(q)
      return labelMatch || hintMatch || comboMatch
    })
  }, [rows, search, category])

  const customCount = useMemo(() => rows.filter((r) => r.custom).length, [rows])

  return (
    <div className={pane(5, true)}>
      {/* 头部简介与全部重置 */}
      <div className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('快捷键设置')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('定制常用全局操作的键盘组合键，支持实时按键捕获与冲突检测。')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {customCount > 0 && (
            <button
              type="button"
              onClick={() => {
                resetAllShortcuts()
                setError('')
                cancelRecording()
                refresh()
                onToast(t('快捷键已全部恢复默认'))
              }}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
            >
              <RotateCcw size={12} />
              <span>{t('全部恢复默认')}</span>
              <span className="rounded-full bg-line px-1.5 py-0.2 text-[10px] text-ink-soft">
                {customCount}
              </span>
            </button>
          )}
          <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[11px] text-ok-deep">
            <Sparkles size={11} />
            <span>{t('即时生效 · 自动保存')}</span>
          </div>
        </div>
      </div>

      {/* 搜索栏与分类切换 */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* 分类标签 */}
        <div className="flex items-center gap-1 rounded-lg border border-line bg-card/60 p-0.5">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`rounded-md px-2.5 py-1 text-[11.5px] transition ${
              category === 'all'
                ? 'bg-seal/10 font-medium text-seal-deep'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('全部')} ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => setCategory('doc')}
            className={`rounded-md px-2.5 py-1 text-[11.5px] transition ${
              category === 'doc'
                ? 'bg-seal/10 font-medium text-seal-deep'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('文档操作')}
          </button>
          <button
            type="button"
            onClick={() => setCategory('view')}
            className={`rounded-md px-2.5 py-1 text-[11.5px] transition ${
              category === 'view'
                ? 'bg-seal/10 font-medium text-seal-deep'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t('界面与视图')}
          </button>
        </div>

        {/* 搜索筛选框 */}
        <div className="relative w-full sm:w-56">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('搜索快捷键或功能…')}
            className="w-full rounded-lg border border-line bg-card py-1.5 pl-7 pr-7 text-[12px] text-ink outline-none transition placeholder:text-ink-faint/70 focus:border-seal focus:ring-1 focus:ring-seal/30"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-2 rounded p-0.5 text-ink-faint hover:text-ink"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 快捷键列表卡片 */}
      <div className="flex flex-col gap-2">
        {filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line py-8 text-center text-ink-faint">
            <Keyboard size={24} className="mb-1.5 opacity-40" />
            <p className="text-[12px]">{t('没有找到匹配的快捷键')}</p>
          </div>
        ) : (
          filteredRows.map((row) => {
            const isRecording = recordingId === row.id

            return (
              <div
                key={row.id}
                className={`relative flex flex-col justify-between gap-3 rounded-xl border p-3 transition-all duration-200 sm:flex-row sm:items-center ${
                  isRecording
                    ? 'border-seal bg-seal/[0.04] ring-2 ring-seal/20'
                    : 'border-line bg-card hover:border-line-strong hover:bg-card/90'
                }`}
              >
                {/* 左侧：功能名称、描述与状态标签 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-strong">
                      {t(row.label)}
                    </span>
                    {row.custom && !isRecording && (
                      <span className="rounded-full bg-seal/10 px-1.5 py-0.2 text-[10px] font-medium text-seal-deep">
                        {t('已修改')}
                      </span>
                    )}
                    {row.conflict && (
                      <span className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-[10.5px] font-medium text-warn-deep">
                        <AlertTriangle size={11} />
                        <span>{t('与「{0}」冲突', row.conflict)}</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{t(row.hint)}</p>

                  {/* 录键中提示与错误说明 */}
                  {isRecording && (
                    <div className="mt-2 flex flex-col gap-1 text-[11px]">
                      <span className="text-ink-soft">
                        {t('直接在键盘上按下新的组合键（包含 Ctrl / Alt / Win，或 F1~F12 单键）。')}
                      </span>
                      {error && (
                        <span className="flex items-center gap-1 font-medium text-warn-deep">
                          <AlertCircle size={12} />
                          <span>{t(error)}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* 右侧：按键展示与操作按钮 */}
                <div className="flex shrink-0 items-center gap-2.5">
                  {isRecording ? (
                    <div className="flex items-center gap-2">
                      {pending ? (
                        <div className="flex items-center gap-1">
                          {pending
                            .split(' + ')
                            .map((s) => s.trim())
                            .filter(Boolean)
                            .map((p, idx) => (
                              <span key={idx} className="flex items-center gap-1">
                                {idx > 0 && <span className="text-[10px] text-ink-faint">+</span>}
                                <KeyCap>{p}</KeyCap>
                              </span>
                            ))}
                          <span className="text-[10px] text-ink-faint">+</span>
                          <KeyCap isPending>?</KeyCap>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-seal/50 bg-seal/10 px-2.5 py-1 text-[11px] font-medium text-seal-deep">
                          <Keyboard size={12} className="animate-pulse" />
                          <span>{t('按下组合键…')}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={cancelRecording}
                        className="flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
                      >
                        <X size={11} />
                        <span>{t('取消')}</span>
                        <kbd className="ml-0.5 rounded border border-line bg-paper px-1 py-0.2 font-mono text-[9.5px] text-ink-faint">
                          Esc
                        </kbd>
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* 当前绑定的键帽 */}
                      <KeyComboDisplay comboText={comboLabel(row.combo)} />

                      {/* 改键按钮 */}
                      <button
                        type="button"
                        onClick={() => startRecording(row.id)}
                        className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
                        title={t('修改此快捷键')}
                      >
                        <Edit2 size={11} className="text-ink-soft" />
                        <span>{t('改键')}</span>
                      </button>

                      {/* 恢复默认按钮 */}
                      {row.custom && (
                        <button
                          type="button"
                          onClick={() => {
                            resetShortcut(row.id)
                            setError('')
                            refresh()
                            onToast(t('快捷键已恢复为默认值'))
                          }}
                          className="flex items-center gap-1 rounded-lg border border-line bg-card px-2 py-1 text-[11.5px] text-ink-faint transition hover:border-line-strong hover:text-ink"
                          title={t('恢复默认 {0}', comboLabel(row.def))}
                        >
                          <RotateCcw size={11} />
                          <span>{t('重置')}</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 底部保护机制说明 */}
      <div className="rounded-xl border border-line bg-card/60 p-3.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="flex items-center gap-1.5 font-medium text-ink-strong">
          <AlertCircle size={13} className="text-seal" />
          <span>{t('快捷键安全保护说明')}</span>
        </div>
        <p className="mt-1">
          {t(
            '系统底层已占用的全局组合（如 Ctrl+C 复制、Ctrl+V 粘贴、F12 开发者工具等）不可改写，防止关键系统操作失效。此外，当焦点在正文编辑框或导师聊天输入框内时，非修饰键组合将被放行，保证文字打字不受干扰。'
          )}
        </p>
      </div>
    </div>
  )
}
