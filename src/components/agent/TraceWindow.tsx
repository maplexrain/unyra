import { useEffect, useState } from 'react'
import { Minus, Square, X } from 'lucide-react'
import ContextTrace from './ContextTrace'
import type { Conversation } from '../../agent/types'
import { isElectron, isMac } from '../../lib/native'
import { t } from '../../i18n'

/**
 * 上下文轨迹窗口那一侧的根组件（`?contextTrace=1` 分支，见 main.tsx 与 electron/app/traceWindow）。
 *
 * 它是**纯只读**的：主窗口把当前会话的原始数据整份推过来（traceGuest.onState），这里
 * 只负责收下并交给 ContextTrace 渲染。没有写盘通道、没有回发通道——会话数据永远归
 * 主窗口所有，这条窗口只是「看得见」的那一扇。
 *
 * 顶部自绘 topbar：轨迹窗口与考试窗口一样是 frameless（Windows 下 `frame: false`），
 * 拖动、最小化、最大化、关闭都靠它——拖动区是 app-drag，三个窗控按钮是 button 自动
 * no-drag；控制走 preload 的 window 组，主进程按「当前聚焦窗口」执行，点按钮那一刻
 * 按钮所在的窗口必然正聚焦。macOS 的红绿灯由系统画（hiddenInset），左侧留出位置。
 *
 * 首份数据靠主进程在 did-finish-load 时补发（可能落在监听挂上之前而漏掉）——漏了也无妨，
 * 主窗口侧在数据变化时持续 push，第一份会话数据很快就会到；空态的文案也照这个现实写。
 */
export default function TraceWindow() {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const off = window.mojiNative?.traceGuest?.onState((payload) => {
      // 主进程不看载荷，形状由两侧约定：一条完整的 Conversation（可能为 null = 当前没有会话）
      setConversation(payload && typeof payload === 'object' && Array.isArray((payload as Conversation).messages) ? (payload as Conversation) : null)
    })
    return off
  }, [])

  // 最大化状态跟随（topbar 的最大化/还原按钮据此换图标）；非 Electron 环境（预览）不订
  const native = isElectron() ? window.mojiNative : null
  useEffect(() => {
    if (!native) return
    void native.window.isMaximized().then(setMaximized)
    return native.window.onMaximizeChange(setMaximized)
  }, [native])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink dark:bg-card/30">
      {/* 自绘 topbar：整条可拖，右端三个窗控按钮（app-drag 里的 button 自动 no-drag） */}
      <header
        className={
          'app-drag flex h-10 shrink-0 select-none items-center gap-2 border-b border-line bg-card/90 pr-1 ' +
          (native && isMac() ? 'pl-[76px]' : 'pl-3')
        }
      >
        <ListTreeMark />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-strong">
          {t('归一 Unyra · 上下文轨迹')}
        </span>
        {native && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => native.window.minimize()}
              className="flex h-10 w-11 items-center justify-center text-ink-soft transition hover:bg-line/60 hover:text-ink"
              aria-label={t('最小化')}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={() => native.window.toggleMaximize()}
              className="flex h-10 w-11 items-center justify-center text-ink-soft transition hover:bg-line/60 hover:text-ink"
              aria-label={maximized ? t('还原') : t('最大化')}
            >
              {maximized ? <CopyIconRestore /> : <Square size={11} />}
            </button>
            <button
              type="button"
              onClick={() => native.window.close()}
              className="flex h-10 w-11 items-center justify-center text-ink-soft transition hover:bg-red-500/90 hover:text-white"
              aria-label={t('关闭')}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 select-text">
        <ContextTrace conversation={conversation} />
      </div>
    </div>
  )
}

/** topbar 左侧的小图标：与 ContextTrace 内容头同一个视觉记号（不用再引一份 lucide） */
function ListTreeMark() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-seal/10 text-seal">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6h13" />
        <path d="M3 12h9" />
        <path d="M3 18h5" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </span>
  )
}

/** 最大化态的「还原」图标（两叠方框）——lucide 没有现成的，两笔 path 拼一个 */
function CopyIconRestore() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="1" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  )
}
