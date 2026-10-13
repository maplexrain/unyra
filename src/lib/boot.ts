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
import { hydrateFreeChat } from '../learn/freeChat'
import { t } from '../i18n'
import { bootstrapUsers } from '../user/store'
import { reconcileBackgroundAssets } from '../user/background'
import { restoreSession, type Session } from '../user/session'
import { hydrateLearnStore } from '../learn/store'
import { loadPlugins } from './plugins'
// 内置功能性插件要在 loadPlugins 之前完成登记（开关按 id 认它，见 lib/plugins）
import './voice/plugin'
import { refreshVoiceGpuDefault } from './voice/settings'
import { loadSkillsFromDisk } from '../agent/skill/fs'
import { startupMark } from './startupTrace'
import { vfsBus } from '../vfs'
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
  // 自由聊天的会话同样跟着用户走（users/{uid}/free-chat.json，learn/freeChat）
  await hydrateFreeChat(uid)
  await hydrateLearnStore(uid)
  startupMark('r:learn-done')
  refreshAppearance()
  /*
   * 全局背景图对账：把老设置里那段 base64 背景迁进 assets/，顺手清掉没人引用的旧文件。
   * 放在这里是因为这一刻才同时具备三件事：设置已经读进来（知道引用了哪几张）、
   * 用户作用域已经设好（知道往谁的 assets/ 里写）、而界面还没渲染（第一帧就该用上新地址）。
   *
   * **不 await**：它要读要写好几张图，几十毫秒起步，而背景图晚一拍显示出来没人看得出来；
   * 卡在启动链上却是实打实的。写完之后 setAppearance 会通知订阅者，界面自己会跟上来。
   */
  void reconcileBackgroundAssets()
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
  // 技能独立目录初始化与预扫描
  void loadSkillsFromDisk()
  // 设备上有没有显卡：语音输入的「GPU 加速」默认值跟着它（见 lib/voice/settings）
  await refreshVoiceGpuDefault()
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

  // 绑定 VFS 真实文件变动监听（来自主进程或外部修改）
  const filesApi = window.mojiNative?.files ?? window.mojiNative?.base?.files
  if (filesApi?.onChanged) {
    filesApi.onChanged((payload) => {
      vfsBus.notifyExternalChange({
        path: payload.path,
        action: payload.action as 'write' | 'edit' | 'delete',
        content: payload.content,
        source: 'watcher',
      })
    })
  }
}

installFlushHooks()
