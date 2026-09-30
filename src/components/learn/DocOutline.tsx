import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ListTree } from 'lucide-react'
import { countOutline, flattenOutline, type OutlineNode } from '../../lib/outline'
import { renderInline } from '../../lib/markdown'
import { t } from '../../i18n'

interface Props {
  /** 正文大纲树（见 lib/outline） */
  items: OutlineNode[]
  /** 视口当前落在第几个标题上（-1 = 还没到第一个标题） */
  activeIndex: number
  /** 点某一项：交给文档列缓动滚到该标题处 */
  onJump: (index: number) => void
  /** 跳转之后把浮层收起来 */
  onDismiss: () => void
  /** 退场中：改播收回动画（见 motion.css 的 moji-tip-out），收回方向与出场相反 */
  closing?: boolean
}

/**
 * 标题大纲浮层：**从文档区右侧悬浮组的那颗按钮弹出**（入口在 DocFloat），
 * 一张浮在正文上的卡片，列出当前 markdown 的全部标题，点一条跳到那一节。
 *
 * 从前它常驻在正文左边（带「固定」功能的窄边栏），如今降级成按需出现的 tip：
 * 常驻的一列对短文档太重、对长文档又占地方，而「看看这份文档有什么、跳到某一节」
 * 本来就是偶尔才做的事。展开/收起与层级引导线照旧——大纲本身的样子没变，
 * 变的只是它什么时候出现。
 *
 * 带下级的标题可以收起；收起状态按标题序号记，因为正文每次流式更新都会
 * 重新抽取大纲、节点对象每次都是新的，拿对象当键会立刻失效。
 */
export default function DocOutline({ items, activeIndex, onJump, onDismiss, closing = false }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())
  const rows = useMemo(() => flattenOutline(items, collapsed), [items, collapsed])
  const total = useMemo(() => countOutline(items), [items])
  const navRef = useRef<HTMLElement | null>(null)

  /**
   * 标题要「再渲染一次」才好看：outline 抽出来的是源文本，标题里若有公式，
   * 它会以 $…$ 的形式躺在那里（见 lib/outline 的 headingText）。
   * 这里按行号缓存解析结果——展开收起会重渲染这一栏，每次重解析一遍公式是白花的力气。
   */
  const htmlOf = useMemo(() => {
    const map = new Map<number, string>()
    for (const row of rows) map.set(row.index, renderInline(row.text))
    return map
  }, [rows])

  const toggle = (index: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.delete(index)) return next
      next.add(index)
      return next
    })

  const jump = (index: number) => {
    onJump(index)
    onDismiss()
  }

  /**
   * 当前标题滚出浮层的可视范围时，把它带回来。
   * 不用 scrollIntoView：那会连带滚动所有祖先容器（整页都跟着动一下），
   * 这里让列表自己滚就够了。offsetTop 相对的是卡片（nav 不是定位元素），
   * 减掉 nav 自己的 offsetTop 才是列表内的位置。
   */
  useEffect(() => {
    const nav = navRef.current
    const el = nav?.querySelector<HTMLElement>('[data-active="true"]')
    if (!nav || !el) return
    const top = el.offsetTop - nav.offsetTop
    const bottom = top + el.offsetHeight
    if (top < nav.scrollTop) nav.scrollTop = top - 6
    else if (bottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = bottom - nav.clientHeight + 6
    // rows 变化（展开/收起）后当前项的位置也变了，一并重新对齐
  }, [activeIndex, rows])

  return (
    /*
      外层只管定位与气泡的小三角；圆角、边框、裁切都在内层的卡片上——
      overflow-hidden 会把探出去的三角裁掉，所以两者必须分开。
      卡片背景与正文同一张底色（bg-card），看起来才是「文档冒出来的气泡」
      而不是一片浮着的白纸；出场动画见 motion.css 的 .moji-tip-pop。
    */
    <div
      className={`no-print absolute right-0 top-[calc(100%+6px)] z-30 ${closing ? 'moji-tip-out' : 'moji-tip-pop'}`}
    >
      <span
        aria-hidden="true"
        className="absolute -top-1 right-3 z-10 h-2.5 w-2.5 rotate-45 rounded-[2px] border-l border-t border-line bg-card"
      />
      <div className="flex max-h-[min(60vh,480px)] w-[280px] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-[0_10px_30px_rgba(31,27,23,0.16)]">
      <header className="flex shrink-0 items-center gap-1 border-b border-line px-2.5 py-2">
        <ListTree size={13} className="shrink-0 text-ink-faint" />
        <span className="truncate text-[11.5px] font-medium tracking-wide text-ink">{t('本页标题')}</span>
        <span className="ml-auto pr-1 text-[10.5px] text-ink-faint">{total}</span>
      </header>

      <nav ref={navRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {rows.map((row) => {
          const active = row.index === activeIndex
          const expanded = !collapsed.has(row.index)
          const indent = (row.depth - 1) * 14
          return (
            <div key={row.index} className="relative" style={{ paddingLeft: `${indent}px` }}>
              {/* 层级引导线：缩进之外再给一条竖线，深层标题才看得出归属 */}
              {row.depth > 1 && (
                <span
                  className="pointer-events-none absolute inset-y-0 w-px bg-line"
                  style={{ left: `${indent - 8}px` }}
                  aria-hidden="true"
                />
              )}
              <div className="flex items-start">
                {row.hasChildren ? (
                  <button
                    type="button"
                    title={expanded ? t('收起下级标题') : t('展开下级标题')}
                    aria-expanded={expanded}
                    onClick={() => toggle(row.index)}
                    className="mt-[3px] flex h-4 w-[18px] shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
                  >
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                ) : (
                  <span className="w-[18px] shrink-0" aria-hidden="true" />
                )}
                <button
                  type="button"
                  data-active={active ? 'true' : undefined}
                  title={row.text}
                  aria-current={active ? 'location' : undefined}
                  onClick={() => jump(row.index)}
                  className={`min-w-0 flex-1 truncate rounded-md py-[3px] pl-1 pr-2 text-left transition ${
                    row.depth === 1 ? 'text-[12.5px]' : 'text-[12px]'
                  } ${
                    active
                      ? 'bg-seal/10 font-medium text-seal-deep'
                      : 'text-ink-soft hover:bg-line/50 hover:text-ink'
                  }`}
                >
                  {/* 内容来自 renderInline（已过 DOMPurify），公式与正文同款渲染；
                      内联公式在大纲里比正文小一号，跟着字号走才不会把行撑开 */}
                  <span
                    className="moji-outline-label [&_.katex]:text-[0.94em]"
                    dangerouslySetInnerHTML={{ __html: htmlOf.get(row.index) ?? row.text }}
                  />
                </button>
              </div>
            </div>
          )
        })}
      </nav>
      </div>
    </div>
  )
}
