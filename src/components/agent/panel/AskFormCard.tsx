/**
 * 结构化表单（api.ask）：导师问、用户答，答完交回去。
 *
 * 单独一个文件是因为它自带一整套作答状态（草稿、翻到第几题、翻页方向）——
 * 与对话列表、输入框都不相干，放在 AgentPanel 里只会把那两千行撑得更长。
 */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react'
import type { AskAnswers, AskFormPayload, AskQuestion } from '../../../agent/tools'
import { renderInline } from '../../../lib/markdown'
import { NO_AUTOFILL } from '../../../lib/autofill'
import { t } from '../../../i18n'

/* ---------- 结构化表单（api.ask） ---------- */

/** 一道题的本地作答：picked 存选项 id，other 是「其他」的补充输入，text 是简答正文 */
interface AskDraft {
  picked: string[]
  other: string
  text: string
}

const EMPTY_DRAFT: AskDraft = { picked: [], other: '', text: '' }

/**
 * api.ask 弹出的表单卡：单选 / 多选（都自动带一个「其他」，选了就能补充）与简答。
 *
 * **一次只问一道题**：答完这道（或点了下一题）再翻到下一道，也能翻回去改——
 * 一长串问题一次性铺开，人看到第三题就想关掉；一道一道来，每张卡只有一件事要 decision。
 * 翻题方向带着动画：前进从右边滑入、退回从左边滑入（见 index.css 的 moji-step-in-*），
 * 「刚才那题在后面」这个空间感靠方向撑着。
 *
 * **没有必答题**：任何一题都可以留空直接提交（用户懒得答的时候不该被拦着）；
 * 留空的题交回去只有 id/type/prompt，导师自己看情况处理。
 *
 * 题目上标了 userInfo 的（导师在问「你的教育程度？」这类画像字段）会带一枚「存进我的资料」小标：
 * 那一题的答案在提交时**直接写进用户资料**（见 learn/useAgent 的 applyAskToProfile），
 * 导师不必再调 api.userInfo.update。这事要让人看得见——用户有权知道哪一句回答会被存下来。
 *
 * 条件逻辑在渲染时现算：某道题的 when 引用前面某题的答案（选项 id、选项文字或
 * 「其他」补充的原文），命中才显示——前面选了什么，直接影响后面问什么。
 * 被条件藏起来的题目不会出现在交回去的答案里。
 */
export function AskFormCard({
  form,
  onSubmit,
  onCancel,
}: {
  form: AskFormPayload
  onSubmit: (answers: AskAnswers) => void
  onCancel: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, AskDraft>>(() =>
    Object.fromEntries(form.questions.map((q) => [q.id, EMPTY_DRAFT])),
  )
  /** 现在翻到第几题（**可见题目**里的下标）；dir 记录翻的方向，滑入动画跟着它走 */
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  /** 单选题选中后自动翻下一题的那颗定时器：再点别的选项、或卸载时要能收掉 */
  const advanceTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    },
    [],
  )

  const draftOf = (id: string): AskDraft => drafts[id] ?? EMPTY_DRAFT
  const patch = (id: string, next: Partial<AskDraft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_DRAFT), ...next } }))

  /** 当前答案下，一道题该不该显示 */
  const visibleOf = (q: AskQuestion): boolean => {
    if (!q.when) return true
    const ref = form.questions.find((x) => x.id === q.when!.id)
    if (!ref) return false
    const d = draftOf(ref.id)
    const values = [...d.picked, ...ref.options.filter((o) => d.picked.includes(o.id)).map((o) => o.label), d.other.trim()]
    return q.when.oneOf.some((v) => values.includes(v))
  }
  const visible = form.questions.filter(visibleOf)

  const toggle = (q: AskQuestion, id: string) => {
    const cur = draftOf(q.id)
    if (q.type === 'single') {
      patch(q.id, { picked: cur.picked.includes(id) ? [] : [id] })
    } else {
      patch(q.id, { picked: cur.picked.includes(id) ? cur.picked.filter((x) => x !== id) : [...cur.picked, id] })
    }
  }

  const OTHER_ID = '__other__'

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
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    if (!q || last) return
    const target = idx + 1
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null
      setDir(1)
      setStep(target)
    }, 240)
  }

  const submit = () => {
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
    <div className="moji-bloom-up-in mb-2 rounded-xl border border-seal/40 bg-card shadow-[0_8px_28px_rgba(31,27,23,0.14)]">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <HelpCircle size={13} className="shrink-0 text-seal" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
          {form.title || t('导师想先确认几件事')}
        </span>
        {visible.length > 0 && (
          <span className="shrink-0 tabular-nums text-[10.5px] text-ink-faint">
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
            {q.type !== 'short' ? (
              <div className="mt-1 flex flex-col gap-1">
                {q.options.map((o) => {
                  const checked = draftOf(q.id).picked.includes(o.id)
                  return (
                    <label
                      key={o.id}
                      className={
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition ' +
                        (checked
                          ? 'border-seal/50 bg-seal/[0.07] text-ink-strong'
                          : 'border-line bg-paper/60 text-ink hover:border-line-strong')
                      }
                    >
                      <input
                        type={q.type === 'single' ? 'radio' : 'checkbox'}
                        name={'moji-ask-' + q.id}
                        checked={checked}
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
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition ' +
                    (draftOf(q.id).picked.includes(OTHER_ID)
                      ? 'border-seal/50 bg-seal/[0.07] text-ink-strong'
                      : 'border-line bg-paper/60 text-ink hover:border-line-strong')
                  }
                >
                  <input
                    type={q.type === 'single' ? 'radio' : 'checkbox'}
                    checked={draftOf(q.id).picked.includes(OTHER_ID)}
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
                    onFocus={() => {
                      if (!draftOf(q.id).picked.includes(OTHER_ID)) toggle(q, OTHER_ID)
                    }}
                    onChange={(e) => patch(q.id, { other: e.target.value })}
                    placeholder={t('写在这里')}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
                    {...NO_AUTOFILL}
                  />
                </label>
              </div>
            ) : (
              <textarea
                value={draftOf(q.id).text}
                onChange={(e) => patch(q.id, { text: e.target.value })}
                rows={2}
                placeholder={t('在这里回答…')}
                className="mt-1 w-full resize-y rounded-lg border border-line bg-paper/60 px-2.5 py-1.5 text-[12px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50"
                {...NO_AUTOFILL}
              />
            )}
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
          {t('想答的答，懒得答的留空直接提交也可以')}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
        >
          {t('不回答了')}
        </button>
        {last || !q ? (
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
