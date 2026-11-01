/**
 * 公告弹窗（**竖屏比例**，546 × 818）。
 *
 * 尺寸是量出来的，不是拍脑袋：把界面上这颗弹窗截下来，按标注框量到 546 × 818
 * （宽高比 2:3）。截图与窗口是 1:1 的——同一张图里当前弹窗量到 380 × 656，
 * 与代码里的 max-w-[380px] / min(78vh, 660px) 对得上，所以标注框的像素数就是
 * CSS 像素数。小窗口下用 min() 收一收，别把弹窗顶出屏幕。
 *
 * 为什么是竖屏而不是常见的横条弹窗：公告是「一条一条读下去」的东西——标题、日期、
 * 几段正文、可能还有一张图。横条弹窗在宽屏上会把每行拉得很长（阅读时眼睛要来回扫），
 * 而竖屏的窄栏一行十来个字，接近手机上读一条通知的手感，长正文滚起来也自然。
 *
 * 多条公告用**页签**摊开（见 lib/notice 的 NoticeFeed）：打开时先落在「第一条没读过的」
 * 那一页，而不是永远回到第一页——新发的那条往往不在开头，每次都把用户丢回第一页，
 * 等于让他自己去找。
 *
 * 这个组件只做「画」：公告内容与失败原因都来自 lib/notice 的快照（useNotice），
 * 本组件不自己取、也不自己判断要不要弹——判定只有一处，在 lib/notice 的 shouldAutoShow。
 *
 * 正文走 renderNote（marked + DOMPurify 消毒，见 lib/markdown / lib/sanitize）再交给
 * MarkdownView：**公告是从网上取回来的**，绝不能当 HTML 直接执行，也不能当 JS 执行。
 * 用 MarkdownView 而不是裸的 dangerouslySetInnerHTML，还顺带拿到「外链交给系统浏览器」
 * 的点击处理——公告里的链接点一下不该把应用界面顶掉。
 *
 * 图片：公告里的图是**远程图**（放在公告仓库里、由 GitHub Pages 提供，正文用完整
 * https 地址引用）。为什么不能把图塞进公告 JSON：GitHub 的 Secret 有 48 KB 硬上限，
 * 一张截图 base64 之后轻松几十上百 KB，塞不下。CSP 的 img-src 已放行 https:（见
 * electron/csp.ts），宽度约束见 styles/markdown.css 的 .moji-agent-md img。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Check, Info, Loader2, Megaphone, RefreshCw, X } from 'lucide-react'
import { useLeaving } from '../../lib/presence'
import { renderNote } from '../../lib/markdown'
import ModalScrim from '../ModalScrim'
import MarkdownView from '../MarkdownView'
import Logo from '../Logo'
import { t } from '../../i18n'
import { firstUnreadIndex, markNoticesRead, noticeFailText, optOutOfNotices, refreshNotice, useNotice } from '../../lib/notice'
import { useNoticeContent } from '../../lib/noticeImageCache'

interface Props {
  /** 关闭弹窗。自动弹出与手动打开走的是同一条路（弹窗由 App 渲染） */
  onClose: () => void
}

/** 弹窗尺寸：标注框量到的就是这两个数（见文件头）。min() 只为小窗口兜底 */
const PANEL_W = 'min(546px, 92vw)'
const PANEL_H = 'min(818px, 88vh)'

export default function NoticeDialog({ onClose }: Props) {
  const { notices, store, loading, fail, failDetail } = useNotice()
  const { leaving, close: leave } = useLeaving(onClose)
  /** 「不再自动弹出」：先只改本地，真正落盘在关闭那一下（见 close） */
  const [noAuto, setNoAuto] = useState(false)
  /** 当前看的是第几页 */
  const [active, setActive] = useState(0)

  /**
   * 首次拿到公告时把页签落在「第一条没读过的」。
   *
   * 只做一次（initialised 挡住后续）：公告列表因为重取而换了个数组引用时，
   * 不该把用户已经翻到的页签又拽回去。
   */
  const initialised = useRef(false)
  useEffect(() => {
    if (initialised.current || !notices.length) return
    initialised.current = true
    setActive(firstUnreadIndex(notices, store))
  }, [notices, store])

  // 列表变短时（重取、或某条被停用）别把下标指到界外
  const index = Math.min(active, Math.max(notices.length - 1, 0))
  const current = notices[index] ?? null
  const currentId = current?.id ?? null

  /**
   * 显示出来的这条立刻记成已读——顶栏那颗红点据此熄灭。
   *
   * 放在 effect 里而不是渲染期：写盘是副作用。切页签时也会走这里，
   * 所以「翻过哪几条」就是「哪几条不亮了」，页签上的小圆点会跟着实时消失。
   */
  useEffect(() => {
    if (currentId) void markNoticesRead([currentId])
  }, [currentId])

  const { resolvedContent } = useNoticeContent(current?.content)
  const html = useMemo(() => (resolvedContent ? renderNote(resolvedContent) : ''), [resolvedContent])

  /**
   * 关闭的唯一出口：记已读 → 需要时落盘「不再自动弹出」→ 播退场动画。
   * 右上角的 ✕、底部按钮、Esc、点遮罩四条路径全部走它——
   * 少走一条，那条路径上的勾选就会被悄悄丢掉。
   *
   * 关掉弹窗时把**这次看到的所有公告**都记成已读：用户已经有机会看过了，
   * 红点不该在他关掉之后还亮着。新到的公告（轮询取回来的）不在这次列表里，
   * 所以红点该亮还是会亮。
   */
  const close = () => {
    const ids = notices.map((n) => n.id)
    if (ids.length) {
      // 勾了「不再自动弹出」时走 optOut——它自己也会把这几条记成已读，
      // 一次写盘搞定两件事，不必再调一次 markNoticesRead 去和它抢同一个字段
      if (noAuto) void optOutOfNotices(ids)
      else void markNoticesRead(ids)
    }
    leave()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // close 每次都重建（闭包里带着 noAuto / notices），这里只关心「挂上 / 摘下」这一对
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noAuto, notices])

  return (
    <ModalScrim z="z-[60]" leaving={leaving} onClose={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('公告')}
        style={{ width: PANEL_W, height: PANEL_H }}
        className={
          'relative flex flex-col overflow-hidden rounded-[20px] border border-line-strong bg-paper ' +
          'shadow-[0_28px_70px_rgba(31,27,23,0.32)] ' +
          (leaving ? 'moji-dialog-out' : 'moji-dialog-in')
        }
      >
        <NoticeHeader count={notices.length} onClose={close} />

        {notices.length > 1 && (
          <NoticeTabs notices={notices} active={index} readIds={store.readIds} onPick={setActive} />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <NoticeBody
            loading={loading}
            fail={fail}
            failDetail={failDetail}
            html={html}
            current={current}
            hasAny={notices.length > 0}
          />
        </div>

        <NoticeFooter noAuto={noAuto} setNoAuto={setNoAuto} onClose={close} hasNotice={notices.length > 0} />
      </div>
    </ModalScrim>
  )
}

/* ---------- 头部：印章色的一小条 + 标题栏 ---------- */

function NoticeHeader({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="relative shrink-0 border-b border-line bg-gradient-to-b from-seal/12 to-transparent">
      {/* 顶上一条印章色渐变：一眼认得出「这是一条公告」，又不靠大面积上色（那在深色主题上不好读） */}
      <div className="h-1 w-full bg-gradient-to-r from-seal via-seal-deep to-seal" />
      {/* 角上两团柔光，纯装饰，不参与布局也不吃点击 */}
      <div className="pointer-events-none absolute -right-10 -top-8 h-28 w-28 rounded-full bg-seal/10 blur-xl" />
      <div className="pointer-events-none absolute -left-8 top-6 h-20 w-20 rounded-full bg-seal/5 blur-xl" />

      <div className="relative flex items-center gap-2 px-5 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-seal/15 text-seal">
          <Megaphone size={13} />
        </span>
        <span className="text-[11px] font-medium tracking-[0.22em] text-seal-deep">{t('公告')}</span>
        {count > 1 && (
          <span className="rounded-full bg-seal/12 px-1.5 py-0.5 text-[10.5px] text-seal-deep">
            {t('{0} 条公告', count)}
          </span>
        )}
        <button
          type="button"
          title={t('关闭')}
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/70 hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

/* ---------- 页签：多条公告时才有 ---------- */

function NoticeTabs({
  notices,
  active,
  readIds,
  onPick,
}: {
  notices: Array<{ id: string; title: string }>
  active: number
  readIds: string[]
  onPick: (i: number) => void
}) {
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-line px-4 py-2">
      {notices.map((n, i) => {
        const on = i === active
        const unread = !readIds.includes(n.id)
        return (
          <button
            key={n.id}
            type="button"
            title={n.title}
            aria-selected={on}
            onClick={() => onPick(i)}
            className={
              'flex max-w-[190px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] transition ' +
              (on ? 'bg-seal/15 font-medium text-seal-deep' : 'text-ink-soft hover:bg-line/60 hover:text-ink')
            }
          >
            {/* 没读过的那几条点一个小红点：一眼看出「还有哪条没看」 */}
            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal" />}
            <span className="truncate">{n.title}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------- 正文：加载 / 失败 / 空 / 内容 ---------- */

function NoticeBody({
  loading,
  fail,
  failDetail,
  html,
  current,
  hasAny,
}: {
  loading: boolean
  fail: ReturnType<typeof useNotice>['fail']
  failDetail?: string
  html: string
  current: { title: string; publishedAt?: string; minVersion?: string } | null
  hasAny: boolean
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onImgError = (e: Event) => {
      const target = e.target as HTMLImageElement
      if (target && target.tagName === 'IMG') {
        target.dataset.noticeImgFailed = '1'
        target.classList.add('opacity-40', 'grayscale')
        if (!target.title) target.title = t('图片加载失败，请检查网络')
      }
    }
    el.addEventListener('error', onImgError, true)
    return () => el.removeEventListener('error', onImgError, true)
  }, [html])

  if (loading && !hasAny) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-faint">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-[12px]">{t('正在获取公告…')}</span>
      </div>
    )
  }

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
        <Logo size={34} />
        {fail ? (
          <>
            <p className="text-[12px] leading-relaxed text-warn-deep">
              {/* noticeFailText 内部已经过 t()，这里不再包一层 */}
              {noticeFailText(fail, failDetail)}
            </p>
            <button
              type="button"
              onClick={() => void refreshNotice()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              <RefreshCw size={12} />
              {t('重试')}
            </button>
          </>
        ) : (
          <>
            <p className="text-[13px] font-medium text-ink-soft">{t('暂时没有新的公告')}</p>
            <p className="text-[11.5px] leading-relaxed text-ink-faint">{t('有新的消息时会在这里显示。')}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <article>
      <h2 className="break-words text-[19px] font-semibold leading-snug text-ink-strong">{current.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
        {current.publishedAt && (
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={11} />
            {current.publishedAt}
          </span>
        )}
        {current.minVersion && (
          <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10.5px] text-ink-soft">
            {t('适用 v{0} 及以上', current.minVersion)}
          </span>
        )}
      </div>
      <div className="mt-3 h-px w-full bg-line/70" />
      <div ref={bodyRef}>
        <MarkdownView html={html} className="moji-agent-md mt-3 text-[13.5px] leading-relaxed text-ink" />
      </div>
    </article>
  )
}

/* ---------- 底部：不再自动弹出 + 知道了 ---------- */

function NoticeFooter({
  noAuto,
  setNoAuto,
  onClose,
  hasNotice,
}: {
  noAuto: boolean
  setNoAuto: (v: boolean) => void
  onClose: () => void
  hasNotice: boolean
}) {
  return (
    <div className="shrink-0 border-t border-line bg-card/60 px-4 py-3">
      {hasNotice && (
        <label
          title={t('勾选后启动时不再自动弹出公告；更新到新版本后仍会提示一次。')}
          className="mb-2.5 flex cursor-pointer select-none items-center gap-2 text-[11.5px] text-ink-soft transition hover:text-ink"
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={noAuto}
            onChange={(e) => setNoAuto(e.target.checked)}
          />
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-paper text-transparent transition peer-checked:border-seal peer-checked:bg-seal peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-seal/40">
            <Check size={11} strokeWidth={3.5} />
          </span>
          {t('不再自动弹出')}
        </label>
      )}

      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
          <Info size={11} />
          {t('更新到新版本后仍会提示一次')}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg bg-seal px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
        >
          {t('知道了')}
        </button>
      </div>
    </div>
  )
}
