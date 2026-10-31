import { Crop, Video, Wrench } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1 的缝（与日程/专注一致） */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐 */
const PANEL_EXIT_MS = 160

export interface ToolsButtonProps {
  /** 触发截图 */
  onScreenshot: () => void
  /** 提示消息 */
  onToast: (msg: string) => void
}

export default function ToolsButton({ onScreenshot, onToast }: ToolsButtonProps) {
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: PANEL_EXIT_MS,
    buttonOpens: true,
  })

  return (
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={t('工具：截图与屏幕工具')}
        {...buttonProps}
        aria-expanded={open}
        className={
          'group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ' +
          (open ? 'text-ink' : 'text-ink-soft hover:text-ink')
        }
      >
        <span className="relative flex items-center justify-center">
          <Wrench
            size={14}
            className={
              open ? 'text-ink' : 'text-ink-faint group-hover:text-ink'
            }
          />
        </span>
        <span className="shrink-0 text-[12px]">{t('工具')}</span>
      </button>

      {/* 悬停下拉 Tip */}
      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`w-[230px] rounded-2xl border border-line-strong/70 bg-card/95 p-2 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            <div className="mb-1.5 flex items-center justify-between px-2 py-1 text-[11px] font-medium text-ink-faint">
              <span>{t('实用工具')}</span>
            </div>

            <div className="flex flex-col gap-1">
              {/* 截图选项 */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onScreenshot()
                }}
                className="group/item flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-line/60"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-seal/10 text-seal transition group-hover/item:scale-105 group-hover/item:bg-seal group-hover/item:text-white">
                  <Crop size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-ink-strong">{t('截图')}</span>
                  </div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {t('区域截屏、取色与批注')}
                  </div>
                </div>
              </button>

              {/* 录屏选项（占位） */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onToast(t('录屏功能正在规划中，敬请期待！'))
                }}
                className="group/item flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-line/40 opacity-80"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-line/60 text-ink-soft transition group-hover/item:text-ink">
                  <Video size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-ink">{t('录屏')}</span>
                    <span className="rounded bg-line/60 px-1 py-0.2 text-[9.5px] text-ink-faint">
                      {t('规划中')}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {t('屏幕录像与音画采集')}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
