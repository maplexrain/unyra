import { useEffect, useMemo, useState } from 'react'
import { Eraser, GitCompareArrows, X } from 'lucide-react'
import {
  clearRecords,
  compareRecords,
  getRecords,
  subscribeRecords,
  type ContextDiff,
  type ContextRecord,
  type MessageDiff,
} from '../../agent/contextFilter'
import { t } from '../../i18n'

/**
 * 上下文比对调试器（超级导师设置 → 开发者 → 打开调试器）。
 *
 * 它吃的是 agent/contextFilter 在「上下文即将发往 API」那一刻记录的快照：
 * 选两份记录做逐条比对，把「两轮之间上下文差异出现在了哪个部位」直接摆出来——
 * 第几条消息、那条消息里的第几个字符、两侧各是什么。前缀缓存命中率极低的问题，
 * 几乎都是某段上下文在两轮之间悄悄变了；这个窗口把变化点变成肉眼可见的东西。
 *
 * 挂在 FloatWindow（可拖动的悬浮窗）里：调试时常常要一边看文档、一边看差异。
 */

interface Props {
  onClose: () => void
}

/** A/B 对比的落选方默认是「上上一次」；只有一份记录时禁用对比 */
export default function ContextDebugger({ onClose }: Props) {
  const [records, setRecords] = useState<ContextRecord[]>(() => [...getRecords()])
  useEffect(() => subscribeRecords(() => setRecords([...getRecords()])), [])

  /** 对比的两端：null = 跟随最新两份（渲染期派生，不必用 effect 追新记录） */
  const [aSeq, setASeq] = useState<number | null>(null)
  const [bSeq, setBSeq] = useState<number | null>(null)

  const pick = (side: 'a' | 'b') => (seq: number) => {
    if (side === 'a') setASeq(seq)
    else setBSeq(seq)
  }

  const a = records.find((r) => r.seq === (aSeq ?? (records.length >= 2 ? records[records.length - 2].seq : null))) ?? null
  const b =
    records.find((r) => r.seq === (bSeq ?? (records.length >= 1 ? records[records.length - 1].seq : null))) ?? null
  const diff: ContextDiff | null = useMemo(
    () => (a && b && a.seq !== b.seq ? compareRecords(a, b) : null),
    [a, b],
  )

  const time = (at: number): string => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 标题栏：拖动由 FloatWindow 接管（按在非交互元素上即可） */}
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
        <GitCompareArrows size={14} className="shrink-0 text-seal" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink-strong">{t('上下文比对调试器')}</div>
          <div className="text-[10.5px] leading-snug text-ink-faint">
            {t('每次把上下文发往 API 前记录一份快照；选两份比对，差异定位到消息与字符。')}
          </div>
        </div>
        <button
          type="button"
          title={t('清空记录')}
          onClick={() => {
            clearRecords()
            setASeq(null)
            setBSeq(null)
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
        >
          <Eraser size={13} />
        </button>
        <button
          type="button"
          title={t('关闭')}
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>

      {records.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-8 text-center">
          <p className="text-[12.5px] text-ink-soft">{t('还没有记录')}</p>
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            {t('在对话里发一条消息（或让导师跑一轮工具），每次请求发出前都会在这里留一份快照。')}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-3">
          {/* 记录列表：每行可被选为 A 或 B */}
          <div className="shrink-0 overflow-hidden rounded-lg border border-line">
            {records.map((r, i) => {
              const isA = r.seq === aSeq
              const isB = r.seq === bSeq
              return (
                <div
                  key={r.seq}
                  className={
                    'flex items-center gap-2 px-2.5 py-1.5 text-[11.5px] ' +
                    (i > 0 ? 'border-t border-line ' : '') +
                    (isA || isB ? 'bg-seal/[0.06]' : '')
                  }
                >
                  <span className="w-12 shrink-0 tabular-nums text-ink-faint">#{r.seq}</span>
                  <span className="w-16 shrink-0 tabular-nums text-ink-faint">{time(r.at)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft">
                    {t('系统 {0} 字 · {1} 条消息', r.systemChars.toLocaleString(), r.messages.length)}
                  </span>
                  <Radio checked={isA} disabled={false} onChange={() => pick('a')(r.seq)} label="A" />
                  <Radio checked={isB} disabled={isA} onChange={() => pick('b')(r.seq)} label="B" />
                </div>
              )
            })}
          </div>

          {diff && a && b && (
            <div className="mt-3 shrink-0 text-[11px] text-ink-faint">
              {t('比较 #{0} → #{1}：', a.seq, b.seq)}
              {diff.same ? (
                <span className="ml-1 font-medium text-ok-deep">{t('完全一致（前缀缓存可以命中）')}</span>
              ) : (
                <span className="ml-1 font-medium text-warn-deep">
                  {t('有差异')}
                  {diff.firstChangeIndex !== undefined && <>{t('，第一处落在第 {0} 条消息', diff.firstChangeIndex)}</>}
                  {diff.systemChanged && <>{t('（系统提示词也变了）')}</>}
                  {diff.toolsChanged && <>{t('（工具声明也变了）')}</>}
                </span>
              )}
            </div>
          )}

          {diff && a && b && !diff.same && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
              {diff.systemChanged && (
                <DiffRow
                  label={t('系统提示词')}
                  status="changed"
                  detail={diff.systemDiff ? t('第 {0} 字起变化', diff.systemDiff.at) : t('变了（老记录已裁掉原文，无法给出字符位置）')}
                  excerpt={
                    diff.systemDiff
                      ? { old: diff.systemDiff.old, new: diff.systemDiff.new }
                      : undefined
                  }
                />
              )}
              {diff.toolsChanged && (
                <DiffRow label={t('工具声明')} status="changed" detail={t('工具的 JSON Schema 变了（缓存也会从这里断开）')} />
              )}
              {diff.messages.map((m) =>
                m.status === 'same' ? null : (
                  <DiffRow
                    key={m.index}
                    label={t('#{0} · {1}', m.index, roleLabel(m.role))}
                    status={m.status}
                    detail={detailOf(m)}
                    excerpt={m.firstDiff ? { old: m.firstDiff.old, new: m.firstDiff.new } : undefined}
                  />
                ),
              )}
            </div>
          )}

          {diff && diff.same && (
            <div className="mt-2 rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
              {t('这两份上下文逐字节一致。命中率仍然低的话，问题不在这两份之间——往上翻更早的记录， 或确认服务端真的支持前缀缓存（部分中转不回传用量也不做缓存）。')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Radio({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={onChange}
      title={label === 'A' ? t('设为对比基准') : t('设为对比对象')}
      className={
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium transition ' +
        (checked
          ? 'border-seal bg-seal text-white'
          : disabled
            ? 'cursor-not-allowed border-line text-ink-faint opacity-40'
            : 'border-line-strong text-ink-faint hover:border-seal/60 hover:text-seal')
      }
    >
      {label}
    </button>
  )
}

const roleLabel = (role: string): string =>
  role === 'system'
    ? t('系统')
    : role === 'user'
      ? t('用户')
      : role === 'assistant'
        ? t('助手')
        : role === 'tool'
          ? t('工具结果')
          : role

function detailOf(m: MessageDiff): string {
  if (m.status === 'added') return t('这条是新增的（A 里没有）')
  if (m.status === 'removed') return t('这条没了（B 里没有）')
  return m.firstDiff
    ? t('第 {0} 字起变化（{1} → {2} 字）', m.firstDiff.at, m.oldChars.toLocaleString(), m.newChars.toLocaleString())
    : t('内容变了（{0} → {1} 字）；两份原文里有一份已裁掉，无法给出字符位置', m.oldChars.toLocaleString(), m.newChars.toLocaleString())
}

function DiffRow({
  label,
  status,
  detail,
  excerpt,
}: {
  label: string
  status: MessageDiff['status'] | 'changed'
  detail: string
  excerpt?: { old: string; new: string }
}) {
  // 增 / 删 / 改用不同的边框深浅：一屏扫过去先看到「哪几条动过、怎么动的」
  const tone =
    status === 'added' || status === 'removed'
      ? 'border-seal/40 bg-seal/[0.04]'
      : 'border-warn/40 bg-warn/[0.04]'
  const mark = status === 'added' ? t('＋ 新增') : status === 'removed' ? t('− 消失') : t('Δ 变化')
  return (
    <div className={'overflow-hidden rounded-lg border ' + tone}>
      <div className="flex items-baseline gap-2 px-2.5 py-1.5 text-[11.5px]">
        <span className="shrink-0 font-medium text-ink-strong">{label}</span>
        <span className="min-w-0 flex-1 text-ink-soft">{detail}</span>
        <span className="shrink-0 text-[10px] text-ink-faint">{mark}</span>
      </div>
      {excerpt && (
        <div className="space-y-1 border-t border-warn/25 px-2.5 py-2">
          <p className="break-all font-mono text-[10.5px] leading-relaxed text-ink-faint">
            <span className="mr-1 rounded bg-warn/10 px-1 py-px text-warn-deep">{t('旧')}</span>
            {excerpt.old}
          </p>
          <p className="break-all font-mono text-[10.5px] leading-relaxed text-ink-faint">
            <span className="mr-1 rounded bg-ok/10 px-1 py-px text-ok-deep">{t('新')}</span>
            {excerpt.new}
          </p>
        </div>
      )}
    </div>
  )
}
