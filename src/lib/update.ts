/**
 * 自动更新的渲染层入口。
 *
 * 这一层**不做任何判定**——查没查到、下没下完、能不能装，全由主进程说了算
 * （见 electron/update.ts）。这里只做三件界面的事：
 *
 * 1. 把主进程推过来的状态收成一份快照，供组件订阅（桥只订阅一次，几处用都行）；
 * 2. 把失败原因翻译成人话——机器可读的原因归主进程，
 *    该说「检查一下网络」还是「作者还没发布过」，取决于界面上能给出什么动作；
 * 3. 把更新说明（GitHub Release 正文，**是 HTML**）消毒成能安全塞进 DOM 的东西。
 */

import DOMPurify from 'dompurify'
import { useSyncExternalStore } from 'react'
import { t } from '../i18n'
import { native, type UpdateFail, type UpdateState } from './native'

export type { UpdateFail, UpdateState }

/* ---------- 快照 ---------- */

let snapshot: UpdateState | null = null
const listeners = new Set<() => void>()
let started = false
let mockActive = false

function publish(next: UpdateState): void {
  snapshot = next
  for (const notify of listeners) notify()
}

/** 当前是否处于开发者模拟更新状态 */
export function isMockUpdateActive(): boolean {
  return mockActive && snapshot?.phase === 'ready'
}

/**
 * 开发者模式：模拟新版本下载完成推送（用于测试顶栏按钮、Tip 与更新弹窗 UI）。
 */
export function mockUpdatePush(custom?: Partial<UpdateState>): void {
  mockActive = true
  const mock: UpdateState = {
    phase: 'ready',
    current: snapshot?.current || '1.0.0',
    version: '1.2.0',
    releaseName: '归一 v1.2.0 重大更新',
    notes: `
      <h3>✨ 归一 v1.2.0 正式发布</h3>
      <p>本次版本全面升级了学习节奏系统与 AI 导师交互体验，并优化了多项视觉交互细节：</p>
      <h4>🚀 新增与改进</h4>
      <ul>
        <li><b>思考档位切换组件重构</b>：深度支持轻量思考与多级拆解，切换更平滑直观。</li>
        <li><b>顶栏学习节奏全景升级</b>：专注番茄钟、阅读时长、目标打卡日历与间隔复习卡片化微交互。</li>
        <li><b>浏览器历史记录智能补全</b>：地址栏输入时即时检索历史访问记录，支持键盘上下方向键导航与快捷删除。</li>
        <li><b>资源管理器全新灵动音频可视化</b>：更细腻自然的频段律动波形与流体动画。</li>
      </ul>
      <h4>🐞 问题修复与体验优化</h4>
      <ul>
        <li>修复「设置 - 更新」中自动更新开关圆球滑块溢出偏移的问题。</li>
        <li>修复内置浏览器中视频元素全屏还原后高度异常坍塌至 150px 的 Bug。</li>
        <li>大幅优化多页签切换时的渲染性能与本地缓存响应速度。</li>
      </ul>
    `,
    fileName: 'moji-notes-v1.2.0-setup.exe',
    size: 89_420_000,
    releaseUrl: 'https://github.com/maplexrain/unyra/releases',
    checkedAt: Date.now(),
    ...custom,
  }
  publish(mock)
}

/**
 * 清除开发者模拟更新状态并复位为空闲。
 */
export function clearMockUpdate(): void {
  mockActive = false
  const idle: UpdateState = {
    phase: 'idle',
    current: snapshot?.current || '1.0.0',
    checkedAt: Date.now(),
  }
  publish(idle)
}

/**
 * 桥只订阅一次。
 *
 * 顶栏的入口与确认弹窗都要读这份状态，各订阅一次的话主进程那边会多出一堆
 * 监听器（而且它们迟早会不同步）。这里收成模块级的一份快照，组件用
 * useSyncExternalStore 订阅它——与 lib/closeBehavior、lib/staticView 同一套路。
 */
function ensureStarted(): void {
  if (started) return
  started = true
  try {
    const bridge = native()
    void bridge.update
      .state()
      .then(publish)
      .catch((err: unknown) => console.warn('[update] 读取更新状态失败：', err))
    bridge.update.onState(publish)
  } catch (err) {
    // 不在 Electron 里（比如直接用浏览器打开 dist/index.html）：没有更新这回事
    console.warn('[update] 没有原生桥，自动更新不可用：', err)
  }
}

function subscribe(notify: () => void): () => void {
  ensureStarted()
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

const getSnapshot = (): UpdateState | null => snapshot

/** 当前更新状态；null = 还没从主进程拿到（第一帧） */
export function useUpdateState(): UpdateState | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/* ---------- 动作 ---------- */

/** 手动查一次。已经有更新在下载时主进程会原样返回，不会重复下 */
export async function checkForUpdates(): Promise<UpdateState | null> {
  try {
    const next = await native().update.check()
    publish(next)
    return next
  } catch (err) {
    console.warn('[update] 检查更新失败：', err)
    return null
  }
}

/**
 * 下载查到的那个新版本。
 *
 * 只有关掉「自动检查更新」之后才会用得上：那时查到新版本会停在「可下载」，
 * 由用户点一下再下。开着自动更新时它已经在下或下好了，调用不会有任何效果。
 */
export async function downloadUpdate(): Promise<UpdateState | null> {
  try {
    const next = await native().update.download()
    publish(next)
    return next
  } catch (err) {
    console.warn('[update] 下载更新失败：', err)
    return null
  }
}

/* ---------- 自动更新开关（全局设置，跟机器走） ---------- */

/**
 * 读一次「自动检查更新」。**没有本地缓存**：这个开关只有一处界面在用，
 * 而真正按它办事的是主进程（启动检查与轮询都在那边），缓存一份只会多一处
 * 可能与主进程不一致的地方。
 */
export async function loadAutoUpdate(): Promise<boolean> {
  try {
    return await native().update.getAuto()
  } catch (err) {
    console.warn('[update] 读取自动更新开关失败：', err)
    return true
  }
}

/** 改开关；以主进程存盘后返回的值为准 */
export async function setAutoUpdate(value: boolean): Promise<boolean> {
  try {
    return await native().update.setAuto(value)
  } catch (err) {
    console.warn('[update] 保存自动更新开关失败：', err)
    return value
  }
}

/** 立即更新：主进程会关掉应用、静默安装、装完自动启动。返回后界面通常已经没了 */
export async function installUpdate(): Promise<{ ok: boolean }> {
  try {
    return await native().update.install()
  } catch (err) {
    console.warn('[update] 安装更新失败：', err)
    return { ok: false }
  }
}

/** 在系统浏览器里打开这次更新的发布页 */
export async function openReleasePage(): Promise<boolean> {
  try {
    return await native().update.openRelease()
  } catch (err) {
    console.warn('[update] 打开发布页失败：', err)
    return false
  }
}

/* ---------- 文案 ---------- */

/**
 * 更新失败 → 给用户看的一句话。
 *
 * 这些原因对应**完全不同的下一步动作**。
 * 「连不上 GitHub」让人去查网络，「仓库里还没有正式发布」是作者那边的事，
 * 而「校验对不上」要认真对待（下载被换过，或者发布时两个文件不同步）。
 * 全部说成「更新失败」，用户只能来问，而卖家也只能猜。
 */
/*
 * 失败原因 → 人话。静态分支的键已在 shell 分片登记，显示处（更新面板与弹窗）也包了 t()；
 * http 分支是「前缀 + detail」的动态拼接，显示侧包不住，在这里参数化并登记进 lib 分片。
 */
export function updateFailText(reason: UpdateFail | undefined, detail?: string): string {
  switch (reason) {
    case 'network':
      return t('连不上 GitHub。检查一下网络（这个功能要看能不能访问 github.com），下次启动会自动再试。')
    case 'no-release':
      return t('发布仓库里还没有可用的正式版本。如果你是从作者那里拿到的安装包，这属于正常情况；不是的话请联系作者。')
    case 'not-found':
      return t('找到了新版本，但发布里缺少更新所需的文件（多半是上传时漏了 latest.yml）。请联系作者重新发布。')
    case 'checksum':
      return t('下载回来的安装包和发布时登记的校验值对不上，已丢弃，不会安装。可能只是下载坏了，下次启动会自动再试。')
    case 'download':
      return t('下载或写入磁盘时失败了（磁盘空间、杀毒软件拦截都有可能）。当前版本不受影响，下次启动会自动再试。')
    case 'install':
      return t('安装程序没能拉起来。当前版本仍然可以用；可以自己下载新版本手动安装。')
    case 'http':
      return detail
        ? t('下载服务器返回了错误：{0}。下次启动会自动再试。', detail)
        : t('下载服务器返回了错误。下次启动会自动再试。')
    default:
      return t('这次检查更新没有成功。不影响当前版本的使用，下次启动会自动再试。')
  }
}

/**
 * 字节数 → 人话。用**十进制**单位（1 MB = 1000 KB）：发布页上 GitHub 显示的就是
 * 这个口径，两处数字对得上，用户不会以为下错了包。
 */
export function formatBytes(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '—'
  if (n < 1000) return n + ' B'
  if (n < 1e6) return (n / 1000).toFixed(0) + ' KB'
  if (n < 1e9) return (n / 1e6).toFixed(1) + ' MB'
  return (n / 1e9).toFixed(2) + ' GB'
}

/** 下载速度：与 formatBytes 同一口径，后面缀上 /秒 */
export function formatSpeed(n?: number): string {
  const text = formatBytes(n)
  return text === '—' ? text : text + '/s'
}

/** 「关于」页与弹窗里显示的那行小字：多久之前查的（键已在 shell 分片登记） */
export function updateCheckedText(checkedAt?: number): string {
  if (!checkedAt) return t('还没有检查过')
  const diff = Date.now() - checkedAt
  if (diff < 60_000) return t('刚刚检查过')
  const min = Math.floor(diff / 60_000)
  if (min < 60) return t('{0} 分钟前检查过', min)
  const hour = Math.floor(min / 60)
  if (hour < 24) return t('{0} 小时前检查过', hour)
  return t('{0} 天前检查过', Math.floor(hour / 24))
}

/* ---------- 更新说明 ---------- */

/**
 * 更新说明的白名单：只留 GitHub Release 正文里真正会出现的那几样。
 *
 * 为什么给这么窄的一张表（而不是复用文档那套宽松配置）：这段 HTML 是从网上取回来的，
 * 而它要贴进的是应用自己的界面。文档那套之所以放行 style/svg，是因为「Agent 写的内容
 * 可信」——那份内容写进的是用户自己的笔记。发布说明没有这个前提。
 */
const NOTES_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'strong', 'b', 'em', 'i', 'del', 's',
  'code', 'pre', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'img',
]
/** href/title 给链接，src/alt 给截图（发布说明里常带对比图）。故意**不放行** target/rel */
const NOTES_ATTR = ['href', 'title', 'src', 'alt']

/**
 * 消毒后的更新说明；没有内容时返回 null（界面上就别占那块地方了）。
 *
 * 链接一律补上 target=_blank：主进程给窗口装了 setWindowOpenHandler
 * （见 electron/main.ts），带这个属性的链接会交给系统浏览器打开；
 * 不补的话点一下会让当前页面直接跳走——应用界面被一个网页顶掉。
 */
export function notesHtml(notes?: string): string | null {
  const raw = notes?.trim()
  if (!raw) return null
  const purifier =
    typeof DOMPurify.sanitize === 'function'
      ? DOMPurify
      : typeof DOMPurify === 'function' && typeof window !== 'undefined'
        ? (DOMPurify as unknown as (w: unknown) => { sanitize: (html: string, config: unknown) => string })(window)
        : null

  const clean = purifier
    ? purifier.sanitize(raw, {
        ALLOWED_TAGS: NOTES_TAGS,
        ALLOWED_ATTR: NOTES_ATTR,
        FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'input', 'button'],
      })
    : raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')

  if (!clean.trim()) return null
  return clean.replace(/<a\s/gi, '<a target="_blank" rel="noreferrer" ')
}
