import { useEffect, useMemo, useRef } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { usePresence } from '../../lib/presence'
import { notesHtml, openReleasePage, useUpdateState } from '../../lib/update'
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
  const { setOpen, mounted, closing } = usePresence(false, PANEL_EXIT_MS)
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
        className="flex h-8 items-center gap-1.5 rounded-md bg-seal/10 px-2 text-[12px] font-medium text-seal-deep transition hover:bg-seal/20"
      >
        <RefreshCw size={13} />
        {t('更新')}
      </button>

      {mounted && (
        /* pt-1 是「桥」：按钮与面板之间那 4px 缝必须落在本组件内，否则指针穿过缝会立刻收起 */
        <div className="absolute right-0 top-full z-30 pt-1">
          <div
            className={
              'w-[22rem] max-w-[80vw] rounded-lg border border-line-strong bg-card p-3 shadow-[0_8px_28px_rgba(31,27,23,0.18)] ' +
              (closing ? 'moji-wipe-corner-out pointer-events-none' : 'moji-wipe-corner-in')
            }
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-seal/12 text-seal">
                <RefreshCw size={11} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-strong">
                {state.releaseName?.trim() || t('归一 v{0}', state.version ?? '')}
              </span>
              <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] text-ok-deep">
                {t('已下载')}
              </span>
            </div>

            <div className="mt-2 max-h-[46vh] overflow-y-auto border-t border-line pt-2">
              {html ? (
                /*
                  更新说明来自 GitHub Release 正文，是 HTML：已过 DOMPurify（见 lib/update）。
                  复用文档那套排版（.moji-agent-md），标题、列表、代码块不必再写一遍样式。
                */
                <div className="moji-agent-md" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <p className="text-[12px] leading-relaxed text-ink-faint">{t('这次发布没有写更新说明。')}</p>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
              <span className="flex-1 text-[11px] text-ink-faint">
                {t('当前 v{0} · 点击这里立即更新', state.current)}
              </span>
              {state.releaseUrl && (
                <button
                  type="button"
                  title={t('在浏览器里打开这次发布的页面')}
                  onClick={() => void openReleasePage()}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
                >
                  <ExternalLink size={11} /> {t('发布页')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
