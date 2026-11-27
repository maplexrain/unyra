/**
 * 结构化表单（api.ask）：导师问、用户答，答完交回去。
 *
 * 单独一个文件是因为它自带一整套作答状态（草稿、翻到第几题、翻页方向）——
 * 与对话列表、输入框都不相干，放在 AgentPanel 里只会把那两千行撑得更长。
 */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, FileText, HelpCircle, Upload, X } from 'lucide-react'
import type { AskAnswer, AskAnswers, AskFileAttachment, AskFormPayload, AskQuestion } from '../../../agent/tools'
import { renderInline } from '../../../lib/markdown'
import { NO_AUTOFILL } from '../../../lib/autofill'
import { t } from '../../../i18n'

/* ---------- 结构化表单（api.ask） ---------- */

/** 一道题的本地作答 */
interface AskDraft {
  picked: string[]
  other: string
  text: string
  sliderValue?: number
  rangeValue?: [number, number]
  files?: AskFileAttachment[]
}

const OTHER_ID = '__other__'

function initDraft(q: AskQuestion): AskDraft {
  const min = q.min ?? 0
  const max = q.max ?? 100
  return {
    picked: [],
    other: '',
    text: '',
    sliderValue: q.type === 'slider' ? (typeof q.defaultValue === 'number' ? q.defaultValue : min) : undefined,
    rangeValue: q.type === 'dual_slider' ? (Array.isArray(q.defaultValue) ? q.defaultValue : [min, max]) : undefined,
    files: q.type === 'upload' ? [] : undefined,
  }
}

/** 已提交答案 → 表单草稿：只读回看时把当时选中的项、填的字、滑杆值原样摆回去。 */
function draftFromAnswer(q: AskQuestion, answer?: AskAnswer): AskDraft {
  const base = initDraft(q)
  if (!answer) return base
  return {
    ...base,
    picked: [
      ...(answer.pickedIds ?? []),
      ...(answer.other ? [OTHER_ID] : []),
    ],
    other: answer.other ?? '',
    text: answer.text ?? '',
    sliderValue: answer.value ?? base.sliderValue,
    rangeValue: answer.rangeValue ?? base.rangeValue,
    files: answer.files ?? base.files,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * api.ask 弹出的表单卡：单选 / 多选（都自动带一个「其他」，选了就能补充）、简答、
 * 单滑块、双滑块（范围滑块）与文件上传附件。
 */
export function AskFormCard({
  form,
  onSubmit,
  onCancel,
  hideTitle = false,
  readOnly = false,
  submittedAnswers,
}: {
  form: AskFormPayload
  onSubmit: (answers: AskAnswers) => void
  onCancel: () => void
  /** 气泡外层已经有标题时，卡里不再重复一遍 */
  hideTitle?: boolean
  /** 已提交后的只读回看：控件不可改，只保留翻题与已填内容 */
  readOnly?: boolean
  /** 提交时的答案快照；只读模式用它回填 */
  submittedAnswers?: AskAnswers
}) {
  const answerById = new Map((submittedAnswers ?? []).map((a) => [a.id, a]))
  const [drafts, setDrafts] = useState<Record<string, AskDraft>>(() =>
    Object.fromEntries(form.questions.map((q) => [q.id, draftFromAnswer(q, answerById.get(q.id))])),
  )
  /** 现在翻到第几题（**可见题目**里的下标）；dir 记录翻的方向，滑入动画跟着它走 */
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 单选题选中后自动翻下一题的那颗定时器：再点别的选项、或卸载时要能收掉 */
  const advanceTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    },
    [],
  )

  const draftOf = (id: string): AskDraft => drafts[id] ?? initDraft(form.questions.find((x) => x.id === id) ?? { id, type: 'short', prompt: '', options: [] })
  const patch = (id: string, next: Partial<AskDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? initDraft(form.questions.find((x) => x.id === id) ?? { id, type: 'short', prompt: '', options: [] })), ...next } }))

  /** 当前答案下，一道题该不该显示 */
  const visibleOf = (q: AskQuestion): boolean => {
    if (!q.when) return true
    const ref = form.questions.find((x) => x.id === q.when!.id)
    if (!ref) return false
    const d = draftOf(ref.id)
    const values = [
      ...d.picked,
      ...ref.options.filter((o) => d.picked.includes(o.id)).map((o) => o.label),
      d.other.trim(),
      d.sliderValue !== undefined ? String(d.sliderValue) : '',
      ...(d.files ? d.files.map((f) => f.name) : []),
    ]
    return q.when.oneOf.some((v) => values.includes(v))
  }
  const visible = form.questions.filter(visibleOf)

  const toggle = (q: AskQuestion, id: string) => {
    if (readOnly) return
    const cur = draftOf(q.id)
    if (q.type === 'single') {
      patch(q.id, { picked: cur.picked.includes(id) ? [] : [id] })
    } else {
      patch(q.id, { picked: cur.picked.includes(id) ? cur.picked.filter((x) => x !== id) : [...cur.picked, id] })
    }
  }

  // 条件题的出现/消失会让 visible 变短：step 一律夹在合法范围里
  const idx = Math.min(step, Math.max(0, visible.length - 1))
  const q = visible[idx] ?? null
  const last = visible.length > 0 && idx === visible.length - 1

  const go = (next: number) => {
    if (next < 0 || next >= visible.length) return
    setDir(next > idx ? 1 : -1)
    setStep(next)
  }

  /** 单选题：选中就自动翻下一题（留一拍让人看见选中态）；最后一题停住等提交 */
  const scheduleAdvance = () => {
    if (readOnly) return
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    if (!q || last) return
    const target = idx + 1
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null
      setDir(1)
      setStep(target)
    }, 240)
  }

  const handleFiles = async (fileList: FileList | File[]) => {
    if (readOnly || !q || q.type !== 'upload') return
    const newFiles: AskFileAttachment[] = []
    const maxBytes = (q.maxSizeMb ?? 32) * 1024 * 1024
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]
      if (file.size > maxBytes) {
        continue
      }
      let dataUrl: string | undefined
      if (file.type.startsWith('image/') || file.size < 5 * 1024 * 1024) {
        try {
          dataUrl = await readFileAsDataUrl(file)
        } catch {
          // ignore
        }
      }
      const filePath = (file as unknown as { path?: string }).path || undefined
      newFiles.push({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        path: filePath,
        dataUrl,
      })
      if (!q.multipleFiles) break
    }
    const curFiles = q.multipleFiles ? (draftOf(q.id).files ?? []) : []
    patch(q.id, { files: q.multipleFiles ? [...curFiles, ...newFiles] : newFiles })
  }

  const submit = () => {
    if (readOnly) return
    const answers: AskAnswers = visible.map((q0) => {
      const d = draftOf(q0.id)
      const pickedIds = d.picked.filter((x) => x !== OTHER_ID)
      const picked = q0.options.filter((o) => pickedIds.includes(o.id)).map((o) => o.label)
      const choseOther = d.picked.includes(OTHER_ID)
      const other = d.other.trim()
      const base = { id: q0.id, type: q0.type, prompt: q0.prompt }
      if (q0.type === 'short') {
        return { ...base, ...(d.text.trim() ? { text: d.text.trim() } : {}) }
      }
      if (q0.type === 'slider') {
        return { ...base, value: d.sliderValue ?? (q0.min ?? 0) }
      }
      if (q0.type === 'dual_slider') {
        return { ...base, rangeValue: d.rangeValue ?? [q0.min ?? 0, q0.max ?? 100] }
      }
      if (q0.type === 'upload') {
        return { ...base, ...(d.files && d.files.length ? { files: d.files } : {}) }
      }
      return {
        ...base,
        ...(picked.length ? { picked } : {}),
        ...(pickedIds.length ? { pickedIds } : {}),
        ...(choseOther && other ? { other } : {}),
      }
    })
    onSubmit(answers)
  }

  return (
    <div
      className={
        'moji-bloom-up-in mb-2 rounded-xl border bg-card shadow-[0_8px_28px_rgba(31,27,23,0.14)] ' +
        (readOnly ? 'border-line-strong/70' : 'border-seal/40')
      }
      data-ask-form-readonly={readOnly ? 'true' : undefined}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        {!hideTitle && (
          <>
            <HelpCircle size={13} className="shrink-0 text-seal" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
              {form.title || t('导师想先确认几件事')}
            </span>
          </>
        )}
        {visible.length > 0 && (
          <span className={'shrink-0 tabular-nums text-[10.5px] text-ink-faint' + (hideTitle ? ' ml-auto' : '')}>
            {t('第 {0} / {1} 题', idx + 1, visible.length)}
          </span>
        )}
      </div>
      {/* 答题进度：一条 2px 的细线，翻一题长一段——余光里就知道还剩多少 */}
      {visible.length > 0 && (
        <div className="h-0.5 bg-line/60">
          <div
            className="h-full bg-seal/60 transition-[width] duration-200 ease-out"
            style={{ width: Math.round(((idx + 1) / visible.length) * 100) + '%' }}
          />
        </div>
      )}

      {/*
        题目本体：一次只有一道。key 带上题目 id 与方向——同一个题从另一个方向翻回来
        也要重放动画，人才能读出「这是往回翻」。
      */}
      {q ? (
        <div
          key={q.id + (dir === 1 ? ':f' : ':b')}
          className={'moji-step-in-' + (dir === 1 ? 'forward' : 'back') + ' max-h-[46vh] space-y-3 overflow-y-auto px-3 py-2.5'}
        >
          <div>
            <div className="flex items-baseline gap-1.5">
              {/* 题干与选项都可能带 $…$ 公式（模型写题时最常见的就是行内公式）。
                  走 renderInline 而不是纯文本：它把单个段落的 <p> 外壳去掉、又过了 DOMPurify，
                  与试卷窗口里选项的渲染完全同一套（见 components/exam/ExamWindow）。
                  回执给模型的仍是原文 o.label / q.prompt，这里只改「怎么显示」。 */}
              <span
                className="text-[12px] font-medium leading-relaxed text-ink"
                dangerouslySetInnerHTML={{ __html: renderInline(q.prompt) }}
              />
              {/*
                标了 userInfo 的题：答案在提交时会**直接写进用户资料**（见 learn/useAgent 的
                applyAskToProfile）。这件事必须当场说——用户有权知道哪一句回答会被存下来，
                而不是等他在设置里翻到资料变了才发现。
              */}
              {q.userInfo && (
                <span
                  title={t('这一题的答案会直接存进你的画像（头像菜单 →「用户」里能改、能清空），导师以后不用再问')}
                  className="shrink-0 rounded bg-seal/10 px-1.5 py-px text-[10px] text-seal-deep"
                >
                  {t('存进我的资料')}
                </span>
              )}
            </div>
            {q.type === 'single' || q.type === 'multiple' ? (
              <div className="mt-1 flex flex-col gap-1">
                {q.options.map((o) => {
                  const checked = draftOf(q.id).picked.includes(o.id)
                  /*
                    最后一题若是单选：选中的那一项**自己变成提交按钮**——再点它一下就带着
                    全部答案交卷。对错、二选一这类一秒能答完的题，省掉再瞄一眼右下角
                    「提交」的那一步；想换答案就点别的选项，选中态会跟着过去。
                  */
                  const quickSubmit = !readOnly && last && q.type === 'single' && checked && o.id !== OTHER_ID
                  if (quickSubmit) {
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={submit}
                        title={t('再点一下就提交全部答案')}
                        className="flex items-center gap-2 rounded-lg border border-seal bg-seal px-2.5 py-1.5 text-[12px] text-paper transition hover:bg-seal-deep"
                      >
                        <Check size={13} className="shrink-0" />
                        <span className="min-w-0 flex-1 text-left" dangerouslySetInnerHTML={{ __html: renderInline(o.label) }} />
                        <span className="shrink-0 text-[10.5px] font-medium opacity-90">{t('提交')}</span>
                      </button>
                    )
                  }
                  return (
                    <label
                      key={o.id}
                      className={
                        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition ' +
                        (readOnly ? 'cursor-default ' : 'cursor-pointer ') +
                        (checked
                          ? 'border-seal/50 bg-seal/[0.07] text-ink-strong'
                          : 'border-line bg-paper/60 text-ink hover:border-line-strong')
                      }
                    >
                      <input
                        type={q.type === 'single' ? 'radio' : 'checkbox'}
                        name={'moji-ask-' + q.id}
                        checked={checked}
                        disabled={readOnly}
                        onChange={() => {
                          toggle(q, o.id)
                          // 单选选完就往下走（见 scheduleAdvance）；取消选中不翻
                          if (q.type === 'single' && !checked) scheduleAdvance()
                        }}
                        className="accent-[var(--color-seal)]"
                      />
                      <span className="min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: renderInline(o.label) }} />
                      <span className="shrink-0 font-mono text-[10px] text-ink-faint">{o.id}</span>
                    </label>
                  )
                })}
                {/* 「其他」：选了就亮出补充输入框 */}
                <label
                  className={
                    'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition ' +
                    (readOnly ? 'cursor-default ' : 'cursor-pointer ') +
                    (draftOf(q.id).picked.includes(OTHER_ID)
                      ? 'border-seal/50 bg-seal/[0.07] text-ink-strong'
                      : 'border-line bg-paper/60 text-ink hover:border-line-strong')
                  }
                >
                  <input
                    type={q.type === 'single' ? 'radio' : 'checkbox'}
                    checked={draftOf(q.id).picked.includes(OTHER_ID)}
                    disabled={readOnly}
                    onChange={() => {
                      // 选中「其他」**不**自动翻题：用户还要在补充框里打字，
                      // 刚点上就被翻走是最气的交互；其余选项才走自动翻页
                      toggle(q, OTHER_ID)
                    }}
                    className="accent-[var(--color-seal)]"
                  />
                  <span className="shrink-0">{t('其他：')}</span>
                  <input
                    value={draftOf(q.id).other}
                    readOnly={readOnly}
                    onFocus={() => {
                      if (!readOnly && !draftOf(q.id).picked.includes(OTHER_ID)) toggle(q, OTHER_ID)
                    }}
                    onChange={(e) => patch(q.id, { other: e.target.value })}
                    placeholder={t('写在这里')}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
                    {...NO_AUTOFILL}
                  />
                </label>
              </div>
            ) : q.type === 'short' ? (
              <textarea
                value={draftOf(q.id).text}
                readOnly={readOnly}
                onChange={(e) => patch(q.id, { text: e.target.value })}
                rows={2}
                placeholder={t('在这里回答…')}
                className="mt-1 w-full resize-y rounded-lg border border-line bg-paper/60 px-2.5 py-1.5 text-[12px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50"
                {...NO_AUTOFILL}
              />
            ) : q.type === 'slider' ? (
              <div className="mt-1 rounded-lg border border-line bg-paper/50 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-ink-soft">{t('当前值')}</span>
                  <span className="inline-flex items-center gap-1 rounded bg-seal/10 px-2 py-0.5 text-[12px] font-bold text-seal-deep tabular-nums">
                    {draftOf(q.id).sliderValue ?? (q.min ?? 0)}
                    {q.unit && <span className="text-[10px] font-normal">{q.unit}</span>}
                  </span>
                </div>
                <div className="relative flex items-center py-1">
                  <input
                    type="range"
                    min={q.min ?? 0}
                    max={q.max ?? 100}
                    step={q.step ?? 1}
                    value={draftOf(q.id).sliderValue ?? (q.min ?? 0)}
                    disabled={readOnly}
                    onChange={(e) => patch(q.id, { sliderValue: Number(e.target.value) })}
                    className="w-full accent-seal cursor-pointer h-2 rounded-lg bg-line/80"
                  />
                </div>
                <div className="flex justify-between text-[10.5px] text-ink-faint tabular-nums">
                  <span>{q.min ?? 0}{q.unit}</span>
                  <span>{q.max ?? 100}{q.unit}</span>
                </div>
              </div>
            ) : q.type === 'dual_slider' ? (() => {
              const min = q.min ?? 0
              const max = q.max ?? 100
              const step = q.step ?? 1
              const range = draftOf(q.id).rangeValue ?? [min, max]
              const [low, high] = range
              const span = max - min || 1
              const lowPct = Math.max(0, Math.min(100, ((low - min) / span) * 100))
              const highPct = Math.max(0, Math.min(100, ((high - min) / span) * 100))

              return (
                <div className="mt-1 rounded-lg border border-line bg-paper/50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11.5px] font-medium text-ink-soft">{t('选择范围')}</span>
                    <span className="inline-flex items-center gap-1 rounded bg-seal/10 px-2 py-0.5 text-[12px] font-bold text-seal-deep tabular-nums">
                      <span>{low}</span>
                      <span className="text-ink-faint font-normal">~</span>
                      <span>{high}</span>
                      {q.unit && <span className="text-[10px] font-normal">{q.unit}</span>}
                    </span>
                  </div>
                  <div className="relative h-6 flex items-center">
                    <div className="absolute inset-x-0 h-2 rounded-lg bg-line/80" />
                    <div
                      className="absolute h-2 rounded-lg bg-seal/70"
                      style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }}
                    />
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={low}
                      disabled={readOnly}
                      onChange={(e) => {
                        const v = Math.min(Number(e.target.value), high)
                        patch(q.id, { rangeValue: [v, high] })
                      }}
                      className="absolute inset-x-0 w-full pointer-events-none appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-seal [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm z-10"
                    />
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={high}
                      disabled={readOnly}
                      onChange={(e) => {
                        const v = Math.max(Number(e.target.value), low)
                        patch(q.id, { rangeValue: [low, v] })
                      }}
                      className="absolute inset-x-0 w-full pointer-events-none appearance-none bg-transparent cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-seal [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm z-20"
                    />
                  </div>
                  <div className="flex justify-between text-[10.5px] text-ink-faint tabular-nums">
                    <span>{min}{q.unit}</span>
                    <span>{max}{q.unit}</span>
                  </div>
                </div>
              )
            })() : q.type === 'upload' ? (
              <div className="mt-1 space-y-2">
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setIsDragging(false)
                    if (e.dataTransfer.files?.length) {
                      void handleFiles(e.dataTransfer.files)
                    }
                  }}
                  onClick={() => { if (!readOnly) fileInputRef.current?.click() }}
                  className={
                    'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ' +
                    (readOnly
                      ? 'cursor-default border-line/60 bg-paper/30 text-ink-faint '
                      : 'cursor-pointer ') +
                    (isDragging && !readOnly
                      ? 'border-seal bg-seal/10 text-seal-deep'
                      : !readOnly
                        ? 'border-line/80 hover:border-seal/50 bg-paper/40 hover:bg-paper/70 text-ink-soft'
                        : '')
                  }
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple={q.multipleFiles}
                    accept={q.accept}
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        void handleFiles(e.target.files)
                      }
                      e.target.value = ''
                    }}
                    className="hidden"
                  />
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-seal/10 text-seal mb-2">
                    <Upload size={16} />
                  </div>
                  <div className="text-[12px] font-medium text-ink">
                    {readOnly ? t('已提交，附件不可更改') : t('点击或拖拽文件到此处上传')}
                  </div>
                  {!readOnly && (
                    <div className="text-[10.5px] text-ink-faint mt-0.5">
                      {q.accept ? `${t('支持格式：{0}', q.accept)} · ` : ''}
                      {t('最大 {0}MB', q.maxSizeMb ?? 32)}
                      {q.multipleFiles ? ` · ${t('可选多个文件')}` : ''}
                    </div>
                  )}
                </div>

                {draftOf(q.id).files && draftOf(q.id).files!.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <div className="text-[10.5px] font-semibold text-ink-soft">
                      {t('已添加附件 ({0})', draftOf(q.id).files!.length)}
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {draftOf(q.id).files!.map((file, fIdx) => (
                        <div
                          key={fIdx}
                          className="flex items-center gap-2 rounded-lg border border-line bg-card p-2 text-[11.5px]"
                        >
                          {file.type.startsWith('image/') && file.dataUrl ? (
                            <img
                              src={file.dataUrl}
                              alt={file.name}
                              className="h-8 w-8 rounded object-cover border border-line shrink-0"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-line/50 text-ink-soft shrink-0">
                              <FileText size={16} />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-ink" title={file.name}>
                              {file.name}
                            </div>
                            <div className="text-[10px] text-ink-faint tabular-nums">
                              {formatBytes(file.size)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const cur = draftOf(q.id).files ?? []
                              patch(q.id, { files: cur.filter((_, idx0) => idx0 !== fIdx) })
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded text-ink-faint hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                            title={t('移除附件')}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="px-3 py-2.5 text-[11.5px] text-ink-faint">
          {t('前面的选择让所有后续问题都跳过了，直接提交即可。')}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line px-3 py-2">
        <button
          type="button"
          onClick={() => go(idx - 1)}
          disabled={idx === 0}
          title={t('回到上一题（答案都留着）')}
          className="flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft size={12} />
          {t('上一题')}
        </button>
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint">
          {readOnly
            ? t('已提交 · 只读回看，答案都留在表单里')
            : t('想答的答，懒得答的留空直接提交也可以；一分钟没有任何操作会自动收起')}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            {t('不回答了')}
          </button>
        )}
        {readOnly ? (
          last || !q ? (
            <span className="shrink-0 rounded-lg bg-line/35 px-2.5 py-1 text-[11px] text-ink-faint">
              {t('已提交')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => go(idx + 1)}
              title={t('下一题（答案都留着）')}
              className="flex shrink-0 items-center gap-0.5 rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong"
            >
              {t('下一题')}
              <ChevronRight size={12} />
            </button>
          )
        ) : last || !q ? (
          <button
            type="button"
            onClick={submit}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong"
          >
            <Check size={12} />
            {t('提交')}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => go(idx + 1)}
            title={t('下一题（答案都留着）')}
            className="flex shrink-0 items-center gap-0.5 rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong"
          >
            {t('下一题')}
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
