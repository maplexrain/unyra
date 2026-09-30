/**
 * 学习状态面板：把「这个知识点他到底学到哪了」摊开给人看。
 *
 * 为什么值得单独一屏，而不是把掌握度塞进顶栏那个小圆点：这一屏是**给学习者自己看的**。
 * design 文档反复讲的一件事是——报告的目的不是制造学习 KPI，而是让他看见
 * 「我哪里在进步、哪里有问题、下一步该学什么」。所以这里把三样东西并排放在一起：
 * 系统估计的掌握度（附上依据）、他自己的自评（可改）、以及错题与检验的时间线。
 *
 * 掌握度只读：它是系统的估计，不是设置项。学习者能改的只有自评——那本来就是他的主观判断。
 *
 * 它现在是文档区右上角那颗「学习状态」**鼠标经过向下展开的 tip**（见 DocFloat），
 * 所以布局按 tip 的规矩来：
 * - **两栏**，不把五块信息竖着摞成一条：左边是「现在什么水平」（掌握度、自评），
 *   右边是「一路上的痕迹」（错误记忆、检验记录）。竖着摞起来，一块 tip 会长到要滚三屏。
 * - 两个动作（回忆一下 / 探个针）**放进标题栏**：它们是「现在就做」的事，
 *   摆在正文里既占竖向空间，又和「看状态」这件事混在一起。
 * - 配色与其它几块 tip 同一套：卡片 bg-card、井槽 bg-paper-deep/40、分隔线 border-line，
 *   不再自己用 bg-sunken 那一套（那扇独立窗口留下的）。
 */

import { Eraser, MessageCircleQuestion, Sparkles } from 'lucide-react'
import type { LearningState, SelfReport } from '../../learn/types'
import { SELF_REPORTS, SELF_REPORT_LABEL } from '../../learn/types'
import type { NodeStructure } from '../../learn/graph'
import { MASTERY_UNKNOWN, checkLine } from '../../learn/learning'
import { t } from '../../i18n'

/** 掌握度的分段配色：低/中/高三档，与节点状态那两个点用同一套色 */
function masteryTone(m: number): string {
  if (m >= 75) return 'bg-ok'
  if (m >= 40) return 'bg-warn'
  return 'bg-seal'
}

/** 一块井槽：tip 里的小分区。边框与底色取自番茄钟那块设置区，全站同一套 */
const WELL = 'rounded-md border border-line bg-paper-deep/40 px-2.5 py-2'

export function NodeStatePanel({
  node,
  structure,
  onSetSelf,
  onClearMistake,
  onRecall,
  onProbe,
  busy,
}: {
  /** 面板只用到标题与学习状态，所以收窄成这两样——调用方传整个节点也照样成立 */
  node: { id: string; title: string; learning?: LearningState }
  /** 结构位次（层级、前置、上层）；由调用方算好——这块面板不持有 store */
  structure: NodeStructure
  onSetSelf: (self: SelfReport) => void
  onClearMistake: (pattern: string) => void
  onRecall: () => void
  onProbe: () => void
  /** Agent 正在跑：这时候再发隐藏指令只会排队，按钮先禁掉 */
  busy: boolean
}) {
  const st = node.learning
  const checks = [...(st?.checks ?? [])].reverse()
  const mistakes = [...(st?.mistakes ?? [])].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  // 掌握度：没评估过时是 undefined，取出来成一个可判空的值（下面用它决定要不要画进度条）
  const mastery = typeof st?.mastery === 'number' ? st.mastery : null

  /** 结构那一行（压在底部，一行放不下就截断，title 里有全文） */
  const structLine =
    t('第 {0} 层（离学习目标 {1} 步依赖）', structure.depth, structure.depth) +
    (structure.parents.length ? t(' · 上级：{0}', structure.parents.join('、')) : '') +
    (structure.prereqs.length ? t(' · 前置：{0}', structure.prereqs.join('、')) : t(' · 还没有前置知识')) +
    t('（层数说的是知识依赖，不是你的基础）')

  return (
    <div className="flex max-h-[min(70vh,540px)] w-[520px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-card p-2.5 shadow-[0_12px_36px_rgba(31,27,23,0.22)]">
      {/* 标题栏：两个动作也在这里——它们是「现在就做」的事，占正文的竖向空间最不划算 */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="shrink-0 text-[11.5px] font-medium text-ink-strong">{t('学习状态')}</span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint" title={node.title}>
          {node.title}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onRecall}
          title={t('合上文档，用自己的话讲一遍；导师会指出漏掉的与说错的')}
          className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1.5 text-[11px] text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
        >
          <Sparkles size={12} />
          {t('回忆一下')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onProbe}
          title={t('让导师出一道极短的问题，验证你是不是真的会（不是出卷）')}
          className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1.5 text-[11px] text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
        >
          <MessageCircleQuestion size={12} />
          {t('探个针')}
        </button>
      </div>

      {/* 两栏：左「现在什么水平」，右「一路上的痕迹」。竖向只在各自栏里长 */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 items-start gap-2">
          <div className="flex min-w-0 flex-col gap-2">
            {/* --- 掌握度：系统估计，只读 --- */}
            <section className={WELL}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] text-ink-soft">{t('掌握度')}</span>
                <span className="ml-auto text-[17px] font-medium leading-none text-ink-strong">
                  {mastery === null ? t(MASTERY_UNKNOWN) : mastery}
                </span>
                {mastery !== null && <span className="text-[10.5px] text-ink-faint">/100</span>}
              </div>
              {mastery !== null && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line/60">
                  <div className={'h-full rounded-full ' + masteryTone(mastery)} style={{ width: mastery + '%' }} />
                </div>
              )}
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                {st?.masteryNote
                  ? t('依据：{0}', st.masteryNote)
                  : mastery !== null
                    ? t('导师还没写这次给分的依据。')
                    : t('还没评估过——做过探针、考试或主动回忆之后才会有数字。')}
              </p>
            </section>

            {/* --- 自评：学习者自己改，四档 --- */}
            <section className={WELL}>
              <div className="flex items-baseline gap-1.5">
                <span className="shrink-0 text-[11.5px] text-ink-soft">{t('你的自评')}</span>
                <span className="ml-auto min-w-0 truncate text-[10.5px] text-ink-faint">
                  {st?.self
                    ? t(SELF_REPORT_LABEL[st.self]) + (st.selfBy === 'user' ? t(' · 你确认过') : t(' · 导师推断'))
                    : t('还没问过你')}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {SELF_REPORTS.map((s) => {
                  const active = st?.self === s
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSetSelf(s)}
                      title={t('你的判断：它决定导师接下来是补课、还是直接往下走')}
                      className={
                        'rounded-md border px-2 py-0.5 text-[11.5px] transition ' +
                        (active
                          ? 'border-seal/50 bg-seal/10 font-medium text-seal-deep'
                          : 'border-line bg-paper text-ink-soft hover:border-line-strong hover:text-ink')
                      }
                    >
                      {t(SELF_REPORT_LABEL[s])}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">{t('自评是线索，不直接改上面的掌握度。')}</p>
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            {/* --- 错误记忆 --- */}
            <section className={WELL}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] text-ink-soft">{t('错误记忆')}</span>
                {mistakes.length > 0 && (
                  <span className="ml-auto text-[10.5px] text-ink-faint">{t('{0} 类', mistakes.length)}</span>
                )}
              </div>
              {mistakes.length === 0 ? (
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                  {t('还没有记录：做题、答疑里暴露出来的错法会记在这里，同一个错法再犯只累加次数。')}
                </p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {mistakes.map((m) => (
                    <li key={m.pattern} className="flex items-start gap-1.5 rounded bg-inset/70 px-1.5 py-1">
                      <span className="mt-px shrink-0 rounded bg-warn/15 px-1 text-[10.5px] font-medium text-warn-deep">
                        {'×' + m.count}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] leading-snug text-ink">{m.pattern}</span>
                        {m.cause && (
                          <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-faint">
                            {t('成因：{0}', m.cause)}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => onClearMistake(m.pattern)}
                        title={t('这个错法已经改掉了，删掉这条记录')}
                        className="shrink-0 rounded p-0.5 text-ink-faint transition hover:bg-line/70 hover:text-ink"
                      >
                        <Eraser size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* --- 检验时间线 --- */}
            <section className={WELL}>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11.5px] text-ink-soft">{t('检验记录')}</span>
                {checks.length > 0 && (
                  <span className="ml-auto text-[10.5px] text-ink-faint">{t('最近 {0} 次', checks.length)}</span>
                )}
              </div>
              {checks.length === 0 ? (
                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                  {t('还没有检验过：考一次试、做一次主动回忆，或者让导师探个针，结果都会落在这里。')}
                </p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {checks.map((c, i) => (
                    <li key={String(c.at) + '-' + i} className="rounded bg-inset/70 px-1.5 py-1">
                      <div className="text-[10.5px] leading-snug text-ink">{t(checkLine(c))}</div>
                      {c.question && (
                        <div className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">{t('问：{0}', c.question)}</div>
                      )}
                      {c.answer && (
                        <div className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">{t('答：{0}', c.answer)}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* 结构：一行说完，放不下就截断（它回答的是「这个知识点在图里站哪儿」，不是主线信息） */}
      <div
        title={structLine}
        className="mt-2 shrink-0 truncate border-t border-line pt-1.5 text-[10.5px] text-ink-faint"
      >
        {structLine}
      </div>
    </div>
  )
}
