/**
 * 启动与用户作用域编排。
 *
 * 数据在磁盘上（见 electron/storage.ts 与 learn/files.ts），启动时一次性读进
 * 内存，之后各存储模块都是同步读内存——界面代码不必到处 await。所以顺序很要紧：
 *
 *   loadPlugins()         按开关装插件（文档渲染要用，见 lib/plugins，必须在首帧之前）
 *   bootstrapUsers()      列出 users/ 下的用户（一个都没有就建默认用户）
 *   restoreSession()      读会话，校验用户还在不在，设置当前作用域
 *   enterUserScope(uid)   读该用户的 setting.yaml（外观 + AI）与 docs/ 教学文档
 *
 * 四者必须在 render 之前完成，否则首帧会用到空配置。main.tsx 负责 await 它。
 */

import { refreshAppearance } from './appearance'
import { loadUiLocale } from './uiLocale'
import { refreshShortcuts } from './shortcuts'
import { flushCommits, flushCommitsSync, setRoot } from './storage'
import { hydrateUserSettings } from './userSettings'
import { hydrateUsageLog } from '../ai/usageLog'
import { t } from '../i18n'
import { bootstrapUsers } from '../user/store'
import { restoreSession, type Session } from '../user/session'
import { hydrateLearnStore } from '../learn/store'
import { loadPlugins } from './plugins'
import { startupMark } from './startupTrace'
import type { User } from '../user/types'

export interface BootResult {
  users: User[]
  session: Session | null
}

/**
 * 载入某个用户的数据（未登录传 null，回到中性默认值）。
 * 登录、切换用户、登出都走它——三处要换的是同一套东西。
 */
export async function enterUserScope(uid: string | null): Promise<void> {
  startupMark('r:scope-start')
  await hydrateUserSettings(uid)
  startupMark('r:settings-done')
  // 用量台账跟着用户走（users/{uid}/usage.json）：与设置同一时刻换作用域。
  // 待写的尾巴在这里先落掉（旧目录的数据不动），然后才清缓存读新的
  await hydrateUsageLog(uid)
  await hydrateLearnStore(uid)
  startupMark('r:learn-done')
  refreshAppearance()
  // 快捷键跟着用户走（见 lib/shortcuts）：与外观同一时刻载入，之后都是同步读内存
  refreshShortcuts()
}

/** 完整启动：用户 → 会话 → 该用户的数据 */
export async function bootApp(): Promise<BootResult> {
  startupMark('r:boot-entry')
  // 界面语言跟机器走（global.yaml）：先于一切渲染应用——登录页也得用上它
  await loadUiLocale()
  // 插件要在第一帧之前装好：renderNote 一旦跑过，没人认领的语法就只能当代码块显示了
  await loadPlugins()
  startupMark('r:plugins-done')
  const users = await bootstrapUsers()
  startupMark('r:users-done')
  const session = await restoreSession()
  startupMark('r:session-done')
  await enterUserScope(session?.userId ?? null)
  return { users, session }
}

export type SwitchRootResult =
  | { ok: true; root: string; boot: BootResult }
  | { ok: false; root: string; error: string }

/**
 * 切换用户数据目录。
 *
 * 关键在顺序：先把待写内容落到**旧**目录，再改根目录，最后重来一遍启动流程。
 * 反过来的话，队列里那批还没落盘的改动会写进新目录，把旧目录留在半新半旧的状态。
 *
 * 换目录就是换一整套数据（用户列表、设置、教学文档全在其中），所以之后要重新
 * bootstrap——新目录里没有当前用户是正常的，那时会退回登录页。**旧目录的数据不动**。
 */
export async function switchRoot(dir?: string): Promise<SwitchRootResult> {
  await flushCommits()
  const res = await setRoot(dir)
  if (!res.ok) return { ok: false, root: res.root, error: res.error ?? t('切换失败') }
  const boot = await bootApp()
  return { ok: true, root: res.root, boot }
}

/* ---------- 关窗前的兜底 ---------- */

let hooksInstalled = false

/**
 * 注册落盘兜底。
 *
 * beforeunload 里必须同步写：页面一卸载，异步队列就再也轮不到了。
 * 注意这里只兜「已经排进队列的」——useLearnStore 会先把自己的最新状态排进去，
 * 它注册得更晚，所以跑在更后面，顺序是对的。
 */
function installFlushHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true

  window.addEventListener('beforeunload', () => flushCommitsSync())
  // 切到后台/窗口失焦时顺手落一次：桌面应用被直接杀掉时不一定有 beforeunload
  const idle = (): void => {
    void flushCommits()
  }
  window.addEventListener('blur', idle)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') idle()
  })
}

installFlushHooks()
