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
        // 展开靠指针经过；点一下也展开（键盘 Tab 过来回车走的就是这条）。
        // 不做「再点收起」——鼠标用户点的时候菜单本来就已经开着，再点一下反而把它关了
        {...buttonProps}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-md px-1.5 transition ${
          open ? 'bg-line/70' : 'hover:bg-line/70'
        }`}
      >
        {user && <UserAvatar profile={user.profile} seed={user.id} size={24} />}
        <span className="hidden max-w-[7em] truncate text-[12px] text-ink-soft sm:inline">
          {user ? displayName(user.profile) : t('账号')}
        </span>
      </button>

      {mounted && (
        /*
          pt-1 这一层是「桥」：菜单与头像之间那 4px 缝必须落在本组件内，
          否则指针穿过缝的一瞬间就会触发 wrapper 的 mouseleave，菜单当场收起。
          动画与外观都作用在里面真正的面板上。
        */
        <div className="absolute right-0 top-full z-30 pt-1">
          <div
            role="menu"
            className={`w-52 rounded-lg border border-line-strong bg-card p-1 shadow-[0_8px_28px_rgba(31,27,23,0.18)] ${panelProps.className}`}
          >
            {user && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <UserAvatar profile={user.profile} seed={user.id} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-strong">
                    {displayName(user.profile)}
                  </span>
                  {(user.profile.role || user.profile.major) && (
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">
                      {[user.profile.role, user.profile.major].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </div>
            )}
            <div className="my-1 h-px bg-line" />
            {showProfile && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onOpenUser()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-line/60"
              >
                <UserCog size={14} className="text-ink-faint" /> {t('用户')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onOpenSettings()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-line/60"
            >
              <Settings size={14} className="text-ink-faint" /> {t('设置')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onOpenUsage()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-line/60"
            >
              <ChartColumn size={14} className="text-ink-faint" /> {t('用量统计')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignOut()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-seal/10 hover:text-seal-deep"
            >
              <LogOut size={14} className="text-ink-faint" /> {t('退出登录')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
