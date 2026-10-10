import { ChartColumn, LogOut, Settings, UserCog } from 'lucide-react'
import type { User } from '../../user/types'
import { displayName } from '../../user/profile'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'
import UserAvatar from './UserAvatar'

interface Props {
  user: User | null
  /** 打开用户弹窗（用户列表 + 画像表单） */
  onOpenUser: () => void
  /** 打开设置（AI / 外观） */
  onOpenSettings: () => void
  /** 打开用量统计页签（文档区的一枚页签，见 learn/types 的 kind 'usage'） */
  onOpenUsage: () => void
  onSignOut: () => void
  /** 菜单项：是否显示「用户」（登录页无此入口） */
  showProfile?: boolean
}

/** 指针离开后延后这么久再收：菜单与头像之间有一道缝，立刻收会在半路上被关掉 */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐（略长一点，动画播完才卸载） */
const MENU_EXIT_MS = 160

/**
 * 顶栏的账号入口：头像 + 昵称，**鼠标经过即展开**，移开就收起。
 * 展开是从右上角向左下「擦」出来的一块（见 index.css 的 .moji-wipe-corner-*）。
 * 目前只有学习页顶栏用它；showProfile 留着给没有用户管理入口的页面复用。
 */
export default function UserMenu({
  user,
  onOpenUser,
  onOpenSettings,
  onOpenUsage,
  onSignOut,
  showProfile = true,
}: Props) {
  // 浮层要等退场动画播完才卸载，所以展开状态交给 useHoverMenu 管（与顶栏那几个入口同一套时序）
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: MENU_EXIT_MS,
    buttonOpens: true,
  })

  return (
    // no-drag：本组件在顶栏的可拖拽区里。菜单是浮层，面板上的每一寸都该响应指针，
    // 否则移到菜单上会变成拖窗口（按钮虽有全局的 no-drag 兜底，面板空白处没有）
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={user ? t('{0} · 账号', displayName(user.profile)) : t('账号')}
        {...buttonProps}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-1.5 text-[12px] font-medium transition-all duration-150 ${
          open ? 'text-ink' : 'text-ink-soft hover:text-ink'
        }`}
      >
        {user && (
          <div className="shrink-0 overflow-hidden rounded-full ring-1 ring-line-strong/40">
            <UserAvatar profile={user.profile} seed={user.id} size={22} />
          </div>
        )}
        <span className="hidden max-w-[7.5em] truncate text-[12px] font-medium text-ink-strong sm:inline">
          {user ? displayName(user.profile) : t('账号')}
        </span>
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            role="menu"
            className={`w-56 rounded-2xl border border-line-strong/70 bg-card/95 p-1.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            {user && (
              <div className="mb-1 flex items-center gap-2.5 rounded-xl border border-line/40 bg-paper/50 p-2.5 dark:bg-paper/30">
                <div className="shrink-0 overflow-hidden rounded-full ring-2 ring-seal/20 shadow-2xs">
                  <UserAvatar profile={user.profile} seed={user.id} size={32} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-strong">
                    {displayName(user.profile)}
                  </span>
                  {(user.profile.role || user.profile.major) && (
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">
                      {[user.profile.role, user.profile.major].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-0.5">
              {showProfile && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    onOpenUser()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink transition-all hover:bg-line/60"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-line/40 text-ink-soft">
                    <UserCog size={13} />
                  </span>
                  <span>{t('用户画像')}</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onOpenSettings()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink transition-all hover:bg-line/60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-line/40 text-ink-soft">
                  <Settings size={13} />
                </span>
                <span>{t('设置')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onOpenUsage()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink transition-all hover:bg-line/60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-line/40 text-ink-soft">
                  <ChartColumn size={13} />
                </span>
                <span>{t('用量统计')}</span>
              </button>

              <div className="my-1 border-t border-line/40" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-soft transition-all hover:bg-warn/10 hover:text-warn-deep"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-line/30 text-ink-faint">
                  <LogOut size={13} />
                </span>
                <span>{t('退出登录')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
