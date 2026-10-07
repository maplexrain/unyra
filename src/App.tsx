import { useCallback, useEffect, useRef, useState } from 'react'
import { createDefaultProvider, loadAiSettings, saveAiSettings } from './ai/settings'
import LearnWorkspace from './components/learn/LearnWorkspace'
import Toast, { type ToastData } from './components/Toast'
import KeyCast from './components/KeyCast'
import VoiceInput from './components/VoiceInput'
import CloseDialog from './components/CloseDialog'
import UserDialog from './components/user/UserDialog'
import LoginPage from './components/user/LoginPage'
import UpdateDialog from './components/update/UpdateDialog'
import { startupMark } from './lib/startupTrace'
import { userRepo } from './user/api'
import { removeUser, updateUser } from './user/store'
import { signIn as sessionSignIn, signOut as sessionSignOut, type Session } from './user/session'
import { guardRoute, type Route } from './lib/route'
import type { User, UserProfile } from './user/types'
import { enterUserScope, switchRoot, type BootResult } from './lib/boot'
import {
  decideClose,
  loadCloseBehavior,
  onCloseRequested,
  type CloseAction,
} from './lib/closeBehavior'
import { getLocale, setLocaleBridge, t, useLocale } from './i18n'

/**
 * 启动结果（用户列表 + 会话）由 main.tsx 读盘后传进来：
 * 磁盘是异步的，App 拿到的已经是「读完了」的状态（见 lib/boot.ts）。
 */
interface Props {
  boot: BootResult
}

export default function App({ boot }: Props) {
  // 登录态与会话是状态（不是启动时的常量快照）：登录/登出都会改它。
  const [session, setSession] = useState<Session | null>(boot.session)
  const signedIn = session !== null
  // 当前想去的路由。真正渲染哪个页面一律由 guardRoute 在渲染期裁决，
  // 这样即便某处忘了走 navigate，未登录也绝不可能落到受保护的页面。
  const [wanted, setWanted] = useState<Route>('learn')
  const route = guardRoute(signedIn, wanted)
  const [userOpen, setUserOpen] = useState(false)
  /**
   * 更新确认弹窗。状态很薄：开不开这一件事，其余（有没有新版本、下没下完）
   * 都由主进程推过来的更新状态说了算（见 lib/update）——这里再存一份迟早会不一致。
   * 弹窗渲染在这一层而不是顶栏里：顶栏带 backdrop-blur，fixed 定位会被它捕获。
   */
  const [updateOpen, setUpdateOpen] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [users, setUsers] = useState<User[]>(boot.users)
  const [activeUserId, setActiveUserId] = useState<string | null>(boot.session?.userId ?? null)
  // 切换用户时自增，作为 LearnWorkspace 的 key，强制它按新作用域重新挂载
  const [userEpoch, setUserEpoch] = useState(0)
  const toastTimer = useRef<number | null>(null)
  // 界面语言：根部订阅（切换时整树重渲染），并把变化推给主进程——
  // 菜单与原生对话框说不了 React 的语言（见 electron/i18n）。桥断了就断：尽力而为。
  useLocale()
  useEffect(() => {
    const native = window as unknown as { mojiNative?: { setUiLocale?: (l: 'zh' | 'en') => void } }
    setLocaleBridge((l) => native.mojiNative?.setUiLocale?.(l))
    native.mojiNative?.setUiLocale?.(getLocale())
    return () => setLocaleBridge(null)
  }, [])

  /**
   * 关窗询问：策略为「询问」时，主进程拦下关闭并发消息过来，这里弹对话框
   * （见 lib/closeBehavior 与 electron/main.ts 的 attachCloseGuard）。
   *
   * 订阅挂在 App 上而不是某个页面里：登录页也要能关窗，两条路由都得有这个对话框。
   * 顺带读一次策略，把值装进模块缓存，设置面板打开时就能同步显示。
   */
  const [closeAsk, setCloseAsk] = useState(false)
  // 启动打点：App 的第一次提交（此刻界面的骨架已经在 DOM 里了）
  useEffect(() => startupMark('r:app-commit'), [])
  useEffect(() => {
    void loadCloseBehavior()
    return onCloseRequested(() => setCloseAsk(true))
  }, [])

  /**
   * 拖进窗口的图片：浏览器的默认行为是「打开这个文件」，整个界面会被它替换掉。
   * 全局挡下来，真正的落点交给聊天输入框自己处理（见 AgentPanel 的 onDrop）——
   * 用户拖偏了也只是没反应，不会把应用弄成一张图片。
   */
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const handleCloseDecision = useCallback((action: CloseAction, remember: boolean) => {
    setCloseAsk(false)
    void decideClose(action, remember)
  }, [])

  const activeUserRecord = users.find((u) => u.id === activeUserId) ?? users[0] ?? null

  const showToast = useCallback((msg: string, action?: ToastData['action']) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast({ msg, action, key: Date.now() })
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2400)
  }, [])

  /* ---------- 用户 ---------- */

  const handleCreateUser = useCallback(async (profile?: Partial<UserProfile>, apiKey?: string) => {
    const u = await userRepo().create(profile)
    // 先把作用域切到新用户，再碰任何配置：AI 设置是「谁的配置」由当前 uid 决定，
    // 顺序反了会把登录页填的 Key 写进上一位用户的 setting.yaml。
    await enterUserScope(u.id)
    //
    // 登录页的 Key 是选填的：填了才按默认提供商（DeepSeek 官方）建一条配置，
    // 并预置 deepseek-flash（1M 上下文、带视觉）；不填就什么都不建，
    // 用户之后可以在设置里自己创建任意提供商。
    const key = apiKey?.trim()
    if (key) {
      const cur = loadAiSettings()
      const provider = createDefaultProvider(key)
      saveAiSettings({
        ...cur,
        providers: [...cur.providers, provider],
        global: { ...cur.global, providerId: provider.id, model: provider.models[0]?.id ?? '' },
      })
    }
    const s = await sessionSignIn(u.id)
    setSession(s)
    setUsers((prev) => [...prev, u])
    setActiveUserId(u.id)
    setUserEpoch((n) => n + 1)
    setWanted('learn')
    return u
  }, [])

  const handleUpdateUser = useCallback((userId: string, patch: Partial<UserProfile>) => {
    void updateUser(userId, patch).then((updated) => {
      if (updated) setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)))
    })
  }, [])

  const handleDeleteUser = useCallback((userId: string) => {
    const wasActive = userId === activeUserId
    void removeUser(userId).then((next) => {
      if (!next) return
      setUsers(next.users)
      setActiveUserId(next.activeUserId)
      // 删的是当前用户时，store 已把作用域切到剩下的第一个用户
      if (wasActive) setUserEpoch((n) => n + 1)
    })
  }, [activeUserId])

  /* ---------- 登录 / 登出 ---------- */

  /** 登录：建立会话、设作用域、载入该用户的数据，再重挂载学习区 */
  const handleSignIn = useCallback(async (userId: string) => {
    const s = await sessionSignIn(userId)
    await enterUserScope(s.userId)
    setSession(s)
    setActiveUserId(s.userId)
    setUserEpoch((n) => n + 1)
    setUserOpen(false)
    setWanted('learn')
  }, [])

  /** 登出：清会话与作用域；学习数据已在切换前落盘（见 enterUserScope 前的 flush） */
  const handleSignOut = useCallback(async () => {
    await sessionSignOut()
    await enterUserScope(null)
    setSession(null)
    setActiveUserId(null)
    setUserOpen(false)
    // 主动登出应回到干净的登录页，而不是被守卫拦下的样子
    setWanted('login')
  }, [])

  /**
   * 换了用户数据目录：整份数据换了一套，用户列表与会话都要重新算。
   * 新目录里可能没有当前用户，那时会退回登录页——这是对的，不是错误。
   */
  const handleRootChanged = useCallback(async (dir?: string) => {
    const res = await switchRoot(dir)
    if (!res.ok) return res
    setUsers(res.boot.users)
    setSession(res.boot.session)
    setActiveUserId(res.boot.session?.userId ?? null)
    setUserEpoch((n) => n + 1)
    setUserOpen(false)
    setWanted(res.boot.session ? 'learn' : 'login')
    return res
  }, [])

  /* ---------- 视图 ---------- */

  if (route === 'login') {
    return (
      <div className="flex h-full flex-col">
        <LoginPage
          users={users}
          onSignIn={handleSignIn}
          onCreate={handleCreateUser}
          // 被守卫拦下时（想去受保护页面但未登录）给一句说明
          hint={!signedIn && wanted !== 'login' ? t('请先登录后再使用') : undefined}
        />
        {closeAsk && <CloseDialog onDecide={handleCloseDecision} />}
        <Toast toast={toast} onHide={() => setToast(null)} />
        <KeyCast />
        <VoiceInput />
      </div>
    )
  }

  return (
    <>
      <LearnWorkspace
        // 换用户时重挂载：学习数据按作用域从本地重新载入
        key={`user-${userEpoch}`}
        user={activeUserRecord}
        onRootChanged={handleRootChanged}
        onOpenUser={() => setUserOpen(true)}
        onSignOut={handleSignOut}
        onToast={showToast}
        onOpenUpdate={() => setUpdateOpen(true)}
      />
      {updateOpen && <UpdateDialog onClose={() => setUpdateOpen(false)} />}
      {userOpen && activeUserRecord && (
        <UserDialog
          users={users}
          activeUserId={activeUserId}
          onClose={() => setUserOpen(false)}
          onSelect={handleSignIn}
          onCreate={handleCreateUser}
          onUpdate={handleUpdateUser}
          onDelete={handleDeleteUser}
          onSignOut={handleSignOut}
          onToast={showToast}
        />
      )}
      {closeAsk && <CloseDialog onDecide={handleCloseDecision} />}
      <Toast toast={toast} onHide={() => setToast(null)} />
      {/* 教学模式下的按键浮层：跟着外观开关走，四个路由分支都挂着（见 KeyCast） */}
      <KeyCast />
      {/* 语音输入：光标在任意输入框里按住快捷键说话（见 VoiceInput / lib/voice） */}
      <VoiceInput />
    </>
  )
}
