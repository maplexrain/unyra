import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Copy, ListTree, X } from 'lucide-react'
import { deriveTraceNodes, type TraceNode } from '../../agent/contextTrace'
import { t } from '../../i18n'

/**
 * 上下文轨迹视图：读对话原数据，**平铺不分组**。
 *
 * 一条消息就是一个轨迹节点，按对话的原始顺序排列，每个节点标题标明它的 `role` 字段值
 * （user / assistant），隐藏指令与提示词注入带类别徽标。数据由调用方给（主窗口传当前
 * 会话，独立轨迹窗口走 IPC 收推），这里只管展示。
 *
 * 三条铁律：原文一律以 <pre> 纯文本呈现**不渲染成元素**（这里看的是进出模型的字节，
 * 不是模型吐出的成品）；语法高亮只染色不改造（JSON 与指令标记染出层次，文本一个字
 * 都不动）；**节点默认全部展开**（轨迹是核对用的，展开才是它的常态，收起是例外）。
 */

interface Props {
  /** 当前正在看的对话（主窗口传激活会话；轨迹窗口收 IPC 推来的同一份形状） */
  conversation: import('../../agent/types').Conversation | null
  /** 关窗回调：独立窗口有、悬浮窗没有 */
  onClose?: () => void
}

/* ---------- 轻量语法高亮：只染 React span，绝不动原文一个字 ---------- */

interface Tok {
  text: string
  cls?: string
}

const JSON_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],])/g

/** JSON 染色：键 / 字符串 / 数字 / 布尔 / 标点（工具调用的参数与结果都是 JSON） */
function tokenizeJson(src: string): Tok[] {
  const out: Tok[] = []
  let last = 0
  for (const m of src.matchAll(JSON_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: src.slice(last, i) })
    if (m[1] && m[2]) out.push({ text: m[1], cls: 'text-sky-600 dark:text-sky-300' }, { text: m[2], cls: 'text-ink-faint' })
    else if (m[1]) out.push({ text: m[1], cls: 'text-emerald-700 dark:text-emerald-300' })
    else if (m[3]) out.push({ text: m[3], cls: 'text-purple-600 dark:text-purple-300' })
    else if (m[4]) out.push({ text: m[4], cls: 'text-amber-700 dark:text-amber-300' })
    else out.push({ text: m[5] ?? '', cls: 'text-ink-faint' })
    last = i + m[0].length
  }
  if (last < src.length) out.push({ text: src.slice(last) })
  return out
}

/** 指令文本染色：只认几类显眼结构（【标记】、围栏、[role] 行、标签），其余原样 */
const PLAIN_LINE_RE = /^(\s*)(【[^】]*】|\[[a-z_]+(?: → [^\]]+)?\]|(<\/?[a-zA-Z][^>]*>|```[a-z]*))/

function tokenizePlain(src: string): Tok[] {
  const out: Tok[] = []
  for (const line of src.split('\n')) {
    const m = line.match(PLAIN_LINE_RE)
    if (!m) {
      out.push({ text: line + '\n' })
      continue
    }
    const cls = m[2].startsWith('【')
      ? 'text-seal font-semibold'
      : m[2].startsWith('[')
        ? 'text-indigo-600 dark:text-indigo-300'
        : m[2].startsWith('```')
          ? 'text-emerald-700 dark:text-emerald-300'
          : 'text-sky-600 dark:text-sky-300'
    out.push({ text: m[1] }, { text: m[2], cls }, { text: line.slice(m[0].length) + '\n' })
  }
  return out
}

/** 统一入口：能 parse 的当 JSON 染，否则按指令文本染 */
function highlight(text: string): Tok[] {
  const head = text.slice(0, 64).trimStart()
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(text)
      return tokenizeJson(text)
    } catch {
      /* 不是完整 JSON：按纯文本走 */
    }
  }
  return tokenizePlain(text)
}

/** <pre> 里的染色块：text 不变，span 只上色，支持划词复制与一键复制 */
function Code({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const toks = useMemo(() => highlight(text), [text])

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 降级使用 document.execCommand
    }
  }

  return (
    <div className="group/code relative select-text">
      <pre className="max-h-[420px] overflow-auto rounded-lg border border-line bg-paper-deep/40 p-2.5 font-mono text-[10.5px] leading-[1.55] whitespace-pre-wrap break-all text-ink select-text cursor-text">
        {toks.map((tok, i) => (tok.cls ? <span key={i} className={tok.cls}>{tok.text}</span> : <span key={i}>{tok.text}</span>))}
      </pre>
      <button
        type="button"
        onClick={copy}
        title={copied ? t('已复制') : t('复制')}
        aria-label={copied ? t('已复制') : t('复制')}
        className="absolute top-2 right-2 flex h-6 w-6 select-none items-center justify-center rounded border border-line/60 bg-card/90 text-ink-soft shadow-xs opacity-0 backdrop-blur-xs transition group-hover/code:opacity-100 hover:bg-line/60 hover:text-ink focus-visible:opacity-100"
      >
        {copied ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={12} />}
      </button>
    </div>
  )
}

/* ---------- 折叠块：默认展开（轨迹是核对用的，展开才是常态） ---------- */

function Fold({
  title,
  extra,
  children,
}: {
  title: ReactNode
  extra?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-xl border border-line bg-card/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full select-none items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-line/30"
      >
        <ChevronRight size={12} className={'shrink-0 text-ink-faint transition-transform ' + (open ? 'rotate-90' : '')} />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-strong">{title}</span>
        {extra !== undefined && <span className="shrink-0 text-[10px] text-ink-faint tabular-nums">{extra}</span>}
      </button>
      {open && <div className="border-t border-line/60 p-2.5 select-text">{children}</div>}
    </div>
  )
}

/* ---------- 轨迹节点 ---------- */

const fmt = (n: number): string => n.toLocaleString('en-US')

/** 一个轨迹节点 = 一条消息：标题标明 role 的值，默认全部展开 */
function NodeCard({ node, index }: { node: TraceNode; index: number }) {
  const [open, setOpen] = useState(true)
  const u = node.usage
  const rate = u && u.totalTokens > 0 ? Math.round((u.cacheReadTokens / u.totalTokens) * 100) : null
  return (
    <div className="rounded-2xl border border-line bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full select-none items-center gap-2 px-3 py-2 text-left hover:bg-line/20"
      >
        <ChevronRight size={13} className={'shrink-0 text-ink-faint transition-transform ' + (open ? 'rotate-90' : '')} />
        {/* role 的值原样标明：看轨迹的人在核对字节，缩写只会添乱 */}
        <span
          className={
            'shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ' +
            (node.role === 'user' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-sky-500/10 text-sky-600 dark:text-sky-300')
          }
        >
          {node.role}
        </span>
        {node.mark && (
          <span className="shrink-0 rounded bg-seal/15 px-1.5 py-0.5 text-[10px] font-semibold text-seal-deep dark:text-seal">
            {node.mark}
          </span>
        )}
        {node.kind !== 'chat' && (
          <span className="shrink-0 text-[10px] text-ink-faint">{node.kind === 'instruction' ? t('隐藏指令') : t('提示词注入')}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint tabular-nums">
          #{index + 1} · {new Date(node.ts).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
        {u && (
          <span className="shrink-0 text-[10.5px] text-ink-soft tabular-nums">
            {t('入 {0}', fmt(u.totalTokens))} · {t('出 {0}', fmt(u.outputTokens))}
            {rate !== null && <> · {t('命中 {0}%', String(rate))}</>}
            {u.estimated && <> · {t('估算')}</>}
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line/60 p-3 select-text">
          {u && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-line bg-paper-deep/30 px-2.5 py-1.5 text-[10.5px] tabular-nums select-text">
              <span><span className="text-ink-faint">{t('输入')}</span> <span className="font-medium text-ink-strong">{fmt(u.contextTokens)}</span></span>
              <span><span className="text-ink-faint">{t('总输入')}</span> <span className="font-medium text-ink-strong">{fmt(u.totalTokens)}</span></span>
              <span><span className="text-ink-faint">{t('输出')}</span> <span className="font-medium text-ink-strong">{fmt(u.outputTokens)}</span></span>
              <span><span className="text-ink-faint">{t('缓存命中输入')}</span> <span className="font-medium text-ink-strong">{fmt(u.cacheReadTokens)}</span></span>
              <span><span className="text-ink-faint">{t('缓存命中率')}</span> <span className="font-medium text-ink-strong">{rate === null ? '—' : rate + '%'}</span></span>
              <span className="text-ink-faint">{t('窗口 {0}', fmt(u.contextWindow))}</span>
            </div>
          )}
          {node.items.length === 0 ? (
            <div className="px-1 text-[11px] text-ink-faint">{t('这条消息没有可展示的原文')}</div>
          ) : (
            node.items.map((item, i) => (
              <Fold key={i} title={item.title} extra={fmt(item.chars) + ' 字符'}>
                <Code text={item.text} />
              </Fold>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function ContextTrace({ conversation, onClose }: Props) {
  const nodes = useMemo(() => (conversation ? deriveTraceNodes(conversation) : []), [conversation])

  return (
    <div className="flex h-full min-h-0 flex-col select-text">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
        <ListTree size={14} className="shrink-0 text-seal" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink-strong">
            {t('上下文轨迹')}
            {conversation?.title ? <span className="ml-1.5 font-normal text-ink-faint">· {conversation.title}</span> : null}
          </div>
          <div className="text-[10.5px] leading-snug text-ink-faint">
            {t('直接读这段对话的原始数据：每条消息一个节点，标明 role 与全部原文，token 账随回复落盘')}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex shrink-0 items-center rounded-lg border border-line p-1 text-ink-soft hover:bg-line/40 hover:text-ink"
            aria-label={t('关闭')}
          >
            <X size={13} />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 select-text">
        {nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11.5px] leading-relaxed text-ink-faint">
            {t('这段对话还没有消息：发一条消息或跑一轮工作流，轨迹就会在这里出现。')}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {nodes.map((node, i) => (
              <NodeCard key={node.id} node={node} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
