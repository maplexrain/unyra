import { useEffect, useMemo, useRef } from 'react'
import { CheckCircle2, ExternalLink, PackageCheck, Sparkles } from 'lucide-react'
import { usePresence } from '../../lib/presence'
import { formatBytes, notesHtml, openReleasePage, useUpdateState } from '../../lib/update'
import { useEscapeKey } from '../../lib/useEscape'
import { t } from '../../i18n'

/**
 * 顶栏的更新入口。
 *
 * 它**只在下载完成之后才出现**（phase === 'ready'）：发现新版本就开始下载，
 * 下载期间界面上什么都不显示。这样用户看到这颗按钮时，包已经躺在本地了——
 * 点下去是「确认安装」，不是「开始等几分钟」。
 *
 * 悬停展开更新说明（鼠标经过即开，移开就收，与账号菜单同一套手感）；
 * 点击才打开确认弹窗。不弹窗、不抢焦点、不打断手上的事。
 */

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1 的缝 */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐（略长一点，动画播完才卸载） */
const PANEL_EXIT_MS = 160

interface Props {
  /**
   * 打开确认弹窗。弹窗由 App 渲染而不是在这里：顶栏带 backdrop-blur，
   * 那会让 fixed 定位的后代以顶栏为参照，弹窗会缩在一条 56px 高的带子里。
   */
  onOpenUpdate: () => void
}

export default function UpdateButton({ onOpenUpdate }: Props) {
  const state = useUpdateState()
  const { setOpen, mounted, closing, open } = usePresence(false, PANEL_EXIT_MS)
  const closeTimer = useRef<number | null>(null)
  const notes = state?.notes
  const html = useMemo(() => notesHtml(notes), [notes])

  const openNow = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setOpen(true)
  }

  const closeSoon = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, HOVER_CLOSE_MS)
  }

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  // 按 Escape 收起面板（点外面不用管：移开指针本来就收）
  useEscapeKey(() => setOpen(false))

  // 还没下好就什么都不显示——包括「正在下载」也不显示，这是刻意的
  if (!state || state.phase !== 'ready') return null

  return (
    <div className="no-drag relative shrink-0" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        title={t('新版本 {0} 已下载完成，点击更新', state.version ?? '')}
        onClick={() => {
          setOpen(false)
          onOpenUpdate()
        }}
        onFocus={openNow}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          open ? 'text-seal-deep font-semibold' : 'text-seal-deep'
        }`}
      >
        <div className="relative flex items-center justify-center text-seal">
          <Sparkles size={13} className="animate-pulse" />
          <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
          </span>
        </div>
        <span className="font-semibold">{t('新版本')}</span>
        <span className="rounded-md bg-seal/15 px-1 py-0.2 font-mono text-[10.5px] font-medium text-seal">
          v{state.version}
        </span>
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`w-[360px] max-w-[85vw] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${
              closing ? 'moji-wipe-corner-out pointer-events-none' : 'moji-wipe-corner-in'
            }`}
          >
            {/* 顶部标题栏 */}
            <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-line/40">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-seal/15 text-seal shadow-2xs">
                  <PackageCheck size={15} />
                </span>
                <div>
                  <div className="text-[13px] font-semibold text-ink-strong truncate max-w-[190px]">
                    {state.releaseName?.trim() || t('归一 v{0}', state.version ?? '')}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                    <span>v{state.current}</span>
                    <span>→</span>
                    <span className="font-medium text-seal-deep">v{state.version}</span>
                  </div>
                </div>
              </div>

              <span className="rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-[10.5px] font-medium text-ok-deep shrink-0">
                {t('已就绪 · 可直接安装')}
              </span>
            </div>

            {/* 更新说明正文 */}
            <div className="mt-2.5 max-h-[38vh] overflow-y-auto rounded-xl border border-line/40 bg-paper/50 p-2.5 moji-scroll-none dark:bg-paper/20">
              {html ? (
                <div className="moji-agent-md text-[12px]" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <p className="text-[11.5px] leading-relaxed text-ink-faint">{t('这次发布没有附加更新说明。')}</p>
              )}
            </div>

            {/* 安装包信息 */}
            {state.fileName && (
              <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-ink-faint">
                <span className="truncate max-w-[200px]" title={state.fileName}>
                  {state.fileName}
                </span>
                {state.size && <span className="tabular-nums">{formatBytes(state.size)}</span>}
              </div>
            )}

            {/* 立即安装操作按钮 */}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onOpenUpdate()
              }}
              className="mt-2.5 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg bg-seal text-[12.5px] font-medium text-white shadow-sm transition-all hover:bg-seal-deep active:scale-[0.99]"
            >
              <CheckCircle2 size={13} />
              <span>{t('立即安装并重启')}</span>
            </button>

            {/* 底部附注与发布页链接 */}
            <div className="mt-2 flex items-center justify-between border-t border-line/30 pt-2 text-[10.5px] text-ink-faint">
              <span>{t('当前会话与笔记已实时就绪')}</span>
              {state.releaseUrl && (
                <button
                  type="button"
                  title={t('在浏览器里打开这次发布的页面')}
                  onClick={() => void openReleasePage()}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                >
                  <ExternalLink size={10} /> {t('GitHub 发布页')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
