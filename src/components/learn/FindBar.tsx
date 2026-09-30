import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react'
import { replaceAllIn, scanMatches } from '../../lib/findText'
import { visibleDocBody } from '../../lib/docDom'
import { t } from '../../i18n'

/**
 * 文档区里的查找 / 替换条（Ctrl+F 查找，Ctrl+H 替换）。
 *
 * 两种视图两套机制，因为可编辑性完全不同：
 *
 * - **源码视图**：正文是一个 textarea。命中位置靠扫字符串算（见 lib/findText），
 *   当前那一条用 `setSelectionRange` 选中——textarea 内部画不了高亮，这是它的硬限制，
 *   所以这里只报数、不逐条描边，不装一个假的高亮层。
 * - **预览视图**：正文是渲染好的 DOM。命中用 **CSS Custom Highlight API** 给 Range 上色：
 *   **一个 DOM 节点都不改**——往正文里插 <mark> 会打乱渲染期的注解（了解 / 注解）与
 *   React 的 reconciliation，下一次重渲染还会把插入的节点抹掉。预览是只读的，
 *   因此这里不给替换（要替换去源码视图，那里改的是源文，有撤销的余地）。
 *
 * 命中结果放在 state 里、只在**事件与观察者**里重算（输入、切换大小写、正文被改动、
 * 点上下一个）：效果里只做「画」这件事。这样既避开了「渲染期读 ref」，
 * 也避开了「effect 里同步 setState 引起级联渲染」。
 */

interface Props {
  /** 查找作用的那一格（文档内容容器）：里面是预览正文，或源码视图的 textarea */
  boxRef: RefObject<HTMLDivElement | null>
  /** 现在是不是源码视图（决定扫 textarea 还是扫 DOM） */
  source: boolean
  /**
   * 查找 / 替换两态由**上层**持有（不在这里自己存一份）：
   * Ctrl+F 与 Ctrl+H 是随时可能按下的，条子已经开着时再按 Ctrl+H 也要能展开替换行——
   * 内部再存一份状态就会出现「父组件说替换、条子还停在查找」的不一致。
   */
  mode: 'find' | 'replace'
  onModeChange: (mode: 'find' | 'replace') => void
  /** 每次按快捷键都 +1：条子已经开着时再按一次 Ctrl+F，焦点要回到查找框 */
  focusTick: number
  /**
   * 源码视图里把改好的全文写回去。本地文件没有这个回调（它的正文不归学习数据管），
   * 那时只做只读查找——按钮置灰并说明原因，而不是点了没反应。
   */
  onReplace?: (next: string) => void
  onClose: () => void
}

/** 预览里的两类高亮：全部命中一种颜色，当前那一条另一种 */
const HL_ALL = 'moji-find'
const HL_ACTIVE = 'moji-find-active'

type HighlightCtor = new (...ranges: Range[]) => unknown

/** 这个环境支持 CSS Custom Highlight 吗（老引擎降级为「只报数、不描边」） */
function highlightApi(): { set: (name: string, hl: unknown) => void; del: (name: string) => void } | null {
  const css = CSS as unknown as { highlights?: { set(k: string, v: unknown): void; delete(k: string): void } }
  const H = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight
  if (!css.highlights || !H) return null
  return {
    set: (name, hl) => css.highlights!.set(name, hl),
    del: (name) => css.highlights!.delete(name),
  }
}

/** 预览正文里的命中：按文本节点逐个找（跨节点的命中不处理——Markdown 里极少见） */
function rangesIn(root: HTMLElement, query: string, caseSensitive: boolean): Range[] {
  const out: Range[] = []
  if (!query) return out
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement
      if (!el) return NodeFilter.FILTER_REJECT
      // 大纲是正文的副本（同一个标题出现两次会让人以为找错了），浮层与控件也不该被搜
      if (el.closest('aside, .moji-anno-pop, textarea, input, script, style')) return NodeFilter.FILTER_REJECT
      return (node.nodeValue ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  let node = walker.nextNode()
  while (node) {
    const text = node.nodeValue ?? ''
    for (const [start, end] of scanMatches(text, query, caseSensitive)) {
      const r = document.createRange()
      r.setStart(node, start)
      r.setEnd(node, end)
      out.push(r)
    }
    node = walker.nextNode()
  }
  return out
}

export default function FindBar({ boxRef, source, mode, onModeChange, focusTick, onReplace, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [index, setIndex] = useState(0)
  /** 命中总数 + 预览视图里的 Range 列表（源码视图只用总数） */
  const [hits, setHits] = useState<{ total: number; ranges: Range[] }>({ total: 0, ranges: [] })
  const inputRef = useRef<HTMLInputElement | null>(null)

  const textareaOf = useCallback(
    (): HTMLTextAreaElement | null => boxRef.current?.querySelector('textarea') ?? null,
    [boxRef],
  )

  /** 重扫一遍。入参给了就用入参的查询词（刚敲下的那个字还没进 state 时要用它） */
  const scan = useCallback(
    (nextQuery = query, nextCase = caseSensitive) => {
      const root = boxRef.current
      if (!root) return
      if (source) {
        const el = textareaOf()
        const total = el ? scanMatches(el.value, nextQuery, nextCase).length : 0
        setHits({ total, ranges: [] })
        return
      }
      // 页签常驻之后文档区里躺着好几片正文，只扫显示着的那一片（见 lib/docDom）
      const ranges = rangesIn(visibleDocBody() ?? root, nextQuery, nextCase)
      setHits({ total: ranges.length, ranges })
    },
    [boxRef, source, query, caseSensitive, textareaOf],
  )

  /**
   * 正文被改动（导师正在写、流式输出、别处改了源文）就重扫。
   * 300ms 防抖：流式输出时每一帧都会触发一次 MutationObserver。
   */
  useEffect(() => {
    const root = boxRef.current
    if (!root) return
    let timer = 0
    const obs = new MutationObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => scan(), 300)
    })
    obs.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      window.clearTimeout(timer)
      obs.disconnect()
    }
  }, [boxRef, scan])

  /* ---------- 画：只做副作用，不 setState ---------- */
  useEffect(() => {
    const api = highlightApi()
    if (!api) return
    if (!query || source || !hits.ranges.length) {
      api.del(HL_ALL)
      api.del(HL_ACTIVE)
      return
    }
    const H = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight
    api.set(HL_ALL, new H(...hits.ranges))
    const active = hits.ranges[Math.min(index, hits.ranges.length - 1)]
    if (active) api.set(HL_ACTIVE, new H(active))
    else api.del(HL_ACTIVE)
  }, [query, source, hits, index])

  // 关掉时把高亮清干净：它挂在全局注册表（CSS.highlights）上，不清理会跟着整份文档留着
  useEffect(
    () => () => {
      const api = highlightApi()
      api?.del(HL_ALL)
      api?.del(HL_ACTIVE)
    },
    [],
  )

  /** 当前那一条：源码视图选中它，预览视图把它滚到眼前 */
  const reveal = useCallback(
    (at: number, nextQuery = query, nextCase = caseSensitive) => {
      if (!nextQuery) return
      const el = textareaOf()
      if (el) {
        const list = scanMatches(el.value, nextQuery, nextCase)
        const hit = list[Math.min(at, list.length - 1)]
        if (!hit) return
        // 先让 textarea 拿到焦点再设选区：失焦状态下设的选区在界面上看不见
        el.focus()
        el.setSelectionRange(hit[0], hit[1])
        // 手动把它滚进可见区：setSelectionRange 不保证滚动，光标可能在视野之外
        const line = el.value.slice(0, hit[0]).split('\n').length - 1
        const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20
        const y = line * lineHeight
        if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - lineHeight) {
          el.scrollTop = Math.max(0, y - el.clientHeight / 2)
        }
        return
      }
      const active = hits.ranges[Math.min(at, hits.ranges.length - 1)]
      active?.startContainer.parentElement?.scrollIntoView({ block: 'center' })
    },
    [textareaOf, query, caseSensitive, hits],
  )

  // 打开时（以及每次按快捷键）把焦点放进查找框，并选中已有内容——连续按 Ctrl+F 可以直接改词
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTick])

  const changeQuery = (next: string) => {
    setQuery(next)
    setIndex(0)
    scan(next)
    reveal(0, next)
  }

  const step = (delta: number) => {
    if (hits.total <= 0) return
    const at = (((index + delta) % hits.total) + hits.total) % hits.total
    setIndex(at)
    reveal(at)
  }

  /** 替换当前这一条：改完重扫一遍（命中数会变），停在同一个下标上 */
  const replaceOne = () => {
    const el = textareaOf()
    if (!el || !onReplace || !query) return
    const list = scanMatches(el.value, query, caseSensitive)
    const hit = list[Math.min(index, list.length - 1)]
    if (!hit) return
    onReplace(el.value.slice(0, hit[0]) + draft + el.value.slice(hit[1]))
    // 等 React 把新正文写回 textarea 之后再扫：此刻读到的还是旧值
    window.requestAnimationFrame(() => {
      scan()
      reveal(index)
    })
  }

  const replaceAll = () => {
    const el = textareaOf()
    if (!el || !onReplace || !query) return
    const list = scanMatches(el.value, query, caseSensitive)
    if (!list.length) return
    onReplace(replaceAllIn(el.value, list, draft))
    setIndex(0)
    window.requestAnimationFrame(() => scan(query, caseSensitive))
  }

  const canReplace = !!onReplace && source

  return (
    <div
      /*
        top-14 而不是 top-2：正文右上角那一格被文档悬浮组占着（见 components/learn/DocFloat），
        查找条排在它下面，两者不叠在一起。窄文档列时悬浮组自己不出现，
        这时上面留出的那点空白无关紧要——它只在按 Ctrl+F 时出现一会儿。
      */
      className="no-print moji-in-soft absolute right-3 top-14 z-30 w-[380px] rounded-xl border border-line-strong bg-card/95 p-1.5 shadow-[0_12px_36px_rgba(31,27,23,0.22)] backdrop-blur"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (mode === 'replace' && (e.ctrlKey || e.metaKey)) replaceAll()
          else if (mode === 'replace' && e.altKey) replaceOne()
          else step(e.shiftKey ? -1 : 1)
        }
      }}
    >
      <div className="flex items-center gap-1">
        <Search size={13} className="ml-1 shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder={source ? t('在源码里查找') : t('在文档里查找')}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        <span className="shrink-0 tabular-nums text-[11px] text-ink-faint">
          {hits.total ? Math.min(index, hits.total - 1) + 1 + '/' + hits.total : query ? t('无匹配') : ''}
        </span>
        <button
          type="button"
          title={t('上一个（Shift+Enter）')}
          onClick={() => step(-1)}
          disabled={!hits.total}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:opacity-30"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          title={t('下一个（Enter）')}
          onClick={() => step(1)}
          disabled={!hits.total}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:opacity-30"
        >
          <ChevronDown size={14} />
        </button>
        <button
          type="button"
          title={caseSensitive ? t('区分大小写（已开）') : t('区分大小写')}
          aria-pressed={caseSensitive}
          onClick={() => {
            const next = !caseSensitive
            setCaseSensitive(next)
            setIndex(0)
            scan(query, next)
          }}
          className={
            'flex h-6 w-6 shrink-0 items-center justify-center rounded transition hover:bg-line/60 ' +
            (caseSensitive ? 'bg-seal/10 text-seal-deep' : 'text-ink-soft hover:text-ink')
          }
        >
          <CaseSensitive size={14} />
        </button>
        <button
          type="button"
          title={canReplace ? t('替换（Ctrl+H）') : t('替换要在源码视图里用（预览是只读的）')}
          disabled={!canReplace}
          onClick={() => {
            onModeChange(mode === 'replace' ? 'find' : 'replace')
            // 展开替换行会挤压正文高度，命中位置不变，但可视区变了
            window.requestAnimationFrame(() => reveal(index))
          }}
          className={
            'flex h-6 w-6 shrink-0 items-center justify-center rounded transition hover:bg-line/60 disabled:opacity-30 ' +
            (mode === 'replace' ? 'bg-seal/10 text-seal-deep' : 'text-ink-soft hover:text-ink')
          }
        >
          <Replace size={14} />
        </button>
        <button
          type="button"
          title={t('关闭（Esc）')}
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-soft transition hover:bg-line/60 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      {mode === 'replace' && (
        <div className="mt-1 flex items-center gap-1 border-t border-line/70 pt-1">
          <Replace size={13} className="ml-1 shrink-0 text-ink-faint" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('替换为')}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            type="button"
            title={t('替换这一处（Alt+Enter）')}
            onClick={replaceOne}
            disabled={!hits.total}
            className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink disabled:opacity-30"
          >
            {t('替换')}
          </button>
          <button
            type="button"
            title={t('全部替换（Ctrl+Enter）')}
            onClick={replaceAll}
            disabled={!hits.total}
            className="shrink-0 rounded-md bg-seal/10 px-2 py-1 text-[11.5px] text-seal-deep transition hover:bg-seal/20 disabled:opacity-30"
          >
            {t('全部')}
          </button>
        </div>
      )}
    </div>
  )
}
