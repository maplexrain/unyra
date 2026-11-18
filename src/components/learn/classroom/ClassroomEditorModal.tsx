import { useState } from 'react'
import { X, Check, AlertCircle, Copy } from 'lucide-react'
import { t } from '../../../i18n'
import type { LessonCourse } from '../../../learn/classroom/types'
import { sanitizeCourse } from '../../../learn/classroom/sanitizer'

export interface ClassroomEditorModalProps {
  course: LessonCourse
  onClose: () => void
  onSave: (nextCourse: LessonCourse) => void
}

export default function ClassroomEditorModal({
  course,
  onClose,
  onSave,
}: ClassroomEditorModalProps) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(course, null, 2))
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleApply = () => {
    try {
      const parsed = JSON.parse(jsonText)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.scenes)) {
        setError(t('JSON 格式不合法：缺少 scenes 数组'))
        return
      }
      const sanitized = sanitizeCourse(parsed as LessonCourse)
      onSave(sanitized)
      onClose()
    } catch (err: unknown) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-4xl h-[80vh] rounded-2xl border border-line-strong bg-card shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line bg-paper/60">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold text-ink-strong">{t('课件 DSL 编辑器 (JSON)')}</span>
            <span className="text-[11px] text-ink-faint">
              {t('支持直接粘贴 AI 生成的 LessonCourse 结构')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer border border-line/40"
            >
              <Copy size={13} />
              <span>{copied ? t('已复制') : t('复制 JSON')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-500 text-[12px]">
            <AlertCircle size={14} className="shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* 编辑区 */}
        <div className="flex-1 min-h-0 p-3 bg-neutral-950">
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value)
              setError(null)
            }}
            spellCheck={false}
            className="w-full h-full resize-none font-mono text-[12.5px] leading-relaxed text-emerald-400 bg-transparent outline-none border-0 select-text p-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-neutral-800"
          />
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-line bg-paper/60">
          <div className="text-[12px] text-ink-faint">
            {t('编辑保存后将自动通过 Sanitizer 安全清洗并重新挂载')}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-xl border border-line text-[13px] font-medium text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer"
            >
              {t('取消')}
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-seal text-white text-[13px] font-bold hover:bg-seal-deep shadow-xs transition active:scale-95 cursor-pointer"
            >
              <Check size={15} />
              <span>{t('应用并重新开讲')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
