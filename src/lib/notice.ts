/**
 * 远程公告（渲染层）：取、校验、判定、以及「本机状态」的读写。
 *
 * 一句话说清这块在做什么：**启动时从一条 HTTPS 地址取一份 JSON，按规则决定要不要
 * 弹给用户看**。取不到就当没有，绝不影响应用的主要功能。
 *
 * 分三层，各自的边界要守住：
 * 1. **纯函数**（parseNoticeFeed / parseNoticeItem / compareVersions / meetsMinVersion /
 *    shouldAutoShow）——只有输入输出、不碰网络也不碰 IPC，Node 探针里一条条钉得住
 *    （见 tests/notice.test.ts）。判定规则全部住在这里，界面与启动流程都不许自己再写一遍。
 * 2. **IO**（refreshNotice）——经 native().web.fetch 让主进程去取字节
 *    （渲染层受同源策略约束，抓不了任意站点）。失败一律收敛成一句可显示的原因。
 * 3. **本机状态**（store）——落在 appdata 的 global.yaml（跟机器走，见 shared/ipc 的
 *    NoticeSettings），经 native().notice 读写。渲染层不再自己存一份，避免两处不一致。
 *
 * 「每次更新后强制弹一次」为什么用版本号比对、而不是重置用户的选择：
 * 重置用户的选择是「用一个副作用换一个效果」——用户会发现自己的设置被悄悄改回去了。
 * 版本号比对没有这个问题：装上新版本之后版本号必然与存档不同，于是强制弹一次；
 * 弹完把版本号追平，之后完全按用户的设置走。用户的那份选择自始至终没被动过。
 *
 * 为什么是「一份公告文件里放多条」而不是「一条一个文件」：客户端每次启动只该发**一次**
 * 请求（见需求「不要通过高频轮询来强制刷新公告」），多条公告因此必须同车抵达；
 * 界面用页签把它们摊开（见 components/notice/NoticeDialog）。
 */

import { useSyncExternalStore } from 'react'
import { native, type NoticeSettings, type WebFetchResult } from './native'
import { NOTICE_TIMEOUT_MS, noticeUrlForRequest } from './noticeConfig'
import { precacheNoticeImages } from './noticeImageCache'
import { t } from '../i18n'

/* ---------- 数据形状 ---------- */

/**
 * 一条公告。
 *
 * `enabled` 在**单条**上是可选的（缺省 true）：一份文件里多条公告时，作者不该为了
 * 「这条要发」而在每条里都写一遍 `enabled: true`。整份文件的开关由 NoticeFeed 管。
 */
export interface RemoteNotice {
  /** 这一条要不要展示。false = 客户端直接跳过它 */
  enabled: boolean
  /** 唯一标识。用来记「这条我已经看过了」。**改了内容要换新 id** */
  id: string
  /** 标题（页签上显示的就是它） */
  title: string
  /** 正文（Markdown；渲染时必须消毒，见 lib/markdown 的 renderNote） */
  content: string
  /** 发布日期（YYYY-MM-DD，仅用于展示） */
  publishedAt?: string
  /** 可选的最低适用软件版本：当前版本低于它就不展示（见 meetsMinVersion） */
  minVersion?: string
}

/**
 * 一份公告文件：一个总开关 + 一组公告。
 *
 * 两种写法都认（见 parseNoticeFeed）：
 * - **新式**：`{ enabled, notices: [ {...}, {...} ] }` —— 多条公告，界面用页签摊开；
 * - **旧式**：`{ enabled, id, title, content, ... }` —— 单条公告（第一版就是这个形状，
 *   线上可能还留着），读成「只有一条的 notices」。
 * 兼容旧式不是洁癖：客户端与线上文件是**分开升级**的，读不动旧文件就会出现
 * 「更新了客户端反而看不到公告」。
 */
export interface NoticeFeed {
  enabled: boolean
  notices: RemoteNotice[]
}

/** 公告在本机的状态（与主进程 global.yaml 里的那一份同形，见 shared/ipc） */
export type NoticeStore = NoticeSettings

/** 默认值：每次打开都弹、没弹过、没读过任何一条 */
export const DEFAULT_NOTICE_STORE: NoticeStore = { autoShow: true, shownVersion: '', readIds: [] }

/* ---------- 校验（纯函数） ---------- */

/** 正文长度上限：公告是「一句话」，不是文档。超长的一律当无效，避免异常内容把弹窗撑爆 */
const MAX_CONTENT = 20_000
const MAX_TITLE = 200
const MAX_ID = 128
/** 一份文件最多几条公告：页签排得下、也不会有人真的一次发二十条 */
const MAX_NOTICES = 20

/** 取一个「非空字符串」字段；不是字符串或全空白返回 null */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > max) return null
  return s
}

/** 取一个「可选字符串」字段：缺省或空串返回 undefined；给了但不是字符串则判无效 */
function optionalText(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === '') return undefined
  return text(v, max)
}

/**
 * 校验**一条**公告；不合法返回 null。
 *
 * 严格到什么程度：`id` / `title` / `content` 必须是非空字符串，可选字段给了就必须是
 * 字符串，`enabled` 给了就必须是布尔。**不做「缺字段就补默认值」的宽容解析**——那会把
 * 「发布时写错了」和「本来就该这样」混在一起，用户看到的是一份半残的公告，
 * 而发布者永远不知道自己写错了。
 *
 * defaultEnabled：单条没写 `enabled` 时按什么算。单条公告（旧式）要求必须写；
 * 数组里的条目允许不写（缺省 true）。
 */
export function parseNoticeItem(raw: unknown, defaultEnabled: boolean | null = null): RemoteNotice | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  let enabled: boolean
  if (o.enabled === undefined || o.enabled === null) {
    // 没写：旧式单条要求必填，数组里的条目按 defaultEnabled 算
    if (defaultEnabled === null) return null
    enabled = defaultEnabled
  } else if (typeof o.enabled === 'boolean') {
    enabled = o.enabled
  } else {
    // **写了但不是布尔**：这是笔误（比如写成 "true" 字符串），不能悄悄按默认值放过去
    return null
  }

  const id = text(o.id, MAX_ID)
  const title = text(o.title, MAX_TITLE)
  const content = text(o.content, MAX_CONTENT)
  if (id === null || title === null || content === null) return null
  const publishedAt = optionalText(o.publishedAt, 40)
  const minVersion = optionalText(o.minVersion, 40)
  if (publishedAt === null || minVersion === null) return null
  return { enabled, id, title, content, publishedAt, minVersion }
}

/**
 * 校验**一份**公告文件；不合法返回 null。
 *
 * 顶层形状不对（不是对象、`enabled` 不是布尔、`notices` 不是数组且也不像旧式单条）
 * 一律判无效；**数组里个别条目写坏了则只丢那一条**，其余照常展示——一条笔误不该让
 * 全部公告一起消失。工作流那一侧是严格校验的（见 docs/notice-repo 的 deploy.yml），
 * 所以正常情况下这里根本遇不到坏条目；这一层宽容是「万一」的兜底。
 */
export function parseNoticeFeed(raw: unknown): NoticeFeed | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.enabled !== 'boolean') return null

  if (Array.isArray(o.notices)) {
    if (o.notices.length > MAX_NOTICES) return null
    const notices: RemoteNotice[] = []
    const seen = new Set<string>()
    for (const item of o.notices) {
      const parsed = parseNoticeItem(item, true)
      // 同一份文件里 id 重复：后一条会顶掉前一条的已读记录，直接当无效丢掉更安全
      if (parsed && !seen.has(parsed.id)) {
        seen.add(parsed.id)
        notices.push(parsed)
      }
    }
    return { enabled: o.enabled, notices }
  }

  // 旧式：顶层直接就是一条公告
  const single = parseNoticeItem(o, null)
  return single ? { enabled: o.enabled, notices: [single] } : null
}

/**
 * 版本号比较：a < b 返回 -1，相等 0，a > b 返回 1。
 *
 * 只按 `.` 切段做**数值**比较（1.10.0 > 1.9.0），够用且不引第三方 semver：
 * 本应用自己的版本号就是 `X.Y.Z`（尝鲜版是 `X.Y.Z-beta.N`，见 lib/update），
 * 段里的非数字尾巴（`0-beta`）按 0 计——公告的 minVersion 只需要「不低于某个正式版」
 * 这一档判断，不需要预发布的先后语义。
 */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function versionParts(v: string): number[] {
  return String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((s) => {
      const n = Number.parseInt(s, 10)
      return Number.isFinite(n) ? n : 0
    })
}

/**
 * 当前版本够不够格看这条公告。
 * 没写 minVersion = 对哪个版本都适用；写了就要求当前版本 **不低于** 它。
 */
export function meetsMinVersion(current: string, minVersion?: string): boolean {
  if (!minVersion) return true
  return compareVersions(current, minVersion) >= 0
}

/**
 * 从一份文件里挑出**这次真正该看的**公告：整份文件启用、单条启用、且版本够格。
 * 页签与判定都吃这个列表——「该不该弹」和「弹出来有几页」必须同源，否则会出现
 * 「判定说该弹，打开却是空的」。
 */
export function applicableNotices(feed: NoticeFeed | null, currentVersion: string): RemoteNotice[] {
  if (!feed || !feed.enabled) return []
  return feed.notices.filter((n) => n.enabled && meetsMinVersion(currentVersion, n.minVersion))
}

/**
 * 这次启动要不要**自动弹出**。这是整块功能里唯一一处判定，界面与启动流程都调它。
 *
 * 两条规则，顺序即优先级：
 * 1. 版本变了（刚更新过）→ 强制弹一次。不看用户偏好——「更新后必弹一次」正是
 *    需求里唯一压过用户偏好的那一档。
 * 2. 用户关掉了自动弹出 → 不弹。
 * 都不拦 → 弹（默认行为：**每次打开都弹**）。
 *
 * ⚠️ 注意这里**不看 `readIds`**。曾经有一条「所有公告都读过了就不弹」的规则，
 * 那是照搬「已读不再重复弹出」的说法；但本项目的明确要求是「每次打开软件自动弹出」，
 * 两条同时成立会互相抵消——所以按明确要求来：已读只影响**红点**，不影响弹不弹。
 * 「有没有新东西」的信号交给红点（见 unreadNotices），不必再抢弹窗的活。
 *
 * 规则 1 只比对版本号，**不写** autoShow / readIds——用户的选择自始至终没被改动。
 */
export function shouldAutoShow(notices: RemoteNotice[], store: NoticeStore, currentVersion: string): boolean {
  const list = notices.filter((n) => n.enabled)
  if (!list.length) return false
  if (store.shownVersion !== currentVersion) return true
  if (!store.autoShow) return false
  return true
}

/**
 * 还没读过的公告。
 *
 * 这是顶栏红点的唯一依据：有未读 → 点一颗红点。它同时覆盖两种来源——
 * 启动时取到的、以及**轮询期间新到的**（后者正是要轮询的意义）。
 */
export function unreadNotices(notices: RemoteNotice[], store: NoticeStore): RemoteNotice[] {
  return notices.filter((n) => n.enabled && !store.readIds.includes(n.id))
}

/**
 * 打开弹窗时先落在哪一页：**第一条没读过的**；全读过就回到第一页。
 *
 * 为什么不是固定第一页：多条公告时，新发的那条往往排在最后/中间，
 * 每次都把用户丢回第一页，等于让他自己去找新的那条。
 */
export function firstUnreadIndex(notices: RemoteNotice[], store: NoticeStore): number {
  const i = notices.findIndex((n) => !store.readIds.includes(n.id))
  return i >= 0 ? i : 0
}

/* ---------- 取公告（IO） ---------- */

/** 这次没取到公告的原因。界面上翻成人话（见 noticeFailText） */
export type NoticeFailReason = 'no-bridge' | 'not-configured' | 'timeout' | 'network' | 'parse' | 'invalid'

export type NoticeFetchResult =
  /** ok 且 notices 为空 = 这次没有要显示的公告（未启用 / 不适用当前版本），**不是错误** */
  | { ok: true; notices: RemoteNotice[] }
  | { ok: false; reason: NoticeFailReason; detail?: string }

/** 超时哨兵：与 web:fetch 的返回值区分开，好让 race 的结果一眼可辨 */
const TIMED_OUT = Symbol('notice-timeout')

/**
 * 取一次公告。**任何失败都只是「这次没有公告」**，调用方据此走回退，
 * 不抛异常、不打断界面。
 */
export async function fetchNotice(): Promise<NoticeFetchResult> {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-bridge' }
  const url = noticeUrlForRequest()
  if (!url) return { ok: false, reason: 'not-configured' }

  let res: WebFetchResult | typeof TIMED_OUT
  try {
    res = await Promise.race<WebFetchResult | typeof TIMED_OUT>([
      native().web.fetch(url),
      new Promise<typeof TIMED_OUT>((resolve) => {
        globalThis.setTimeout(() => resolve(TIMED_OUT), NOTICE_TIMEOUT_MS)
      }),
    ])
  } catch (err) {
    return { ok: false, reason: 'network', detail: err instanceof Error ? err.message : String(err) }
  }
  if (res === TIMED_OUT) return { ok: false, reason: 'timeout' }
  // 非 2xx（404 / 403 / 5xx）在 web:fetch 那一侧已经收敛成 ok:false + 一句人话
  if (!res.ok) return { ok: false, reason: 'network', detail: res.error }

  let raw: unknown
  try {
    raw = JSON.parse(res.text)
  } catch {
    return { ok: false, reason: 'parse' }
  }
  const feed = parseNoticeFeed(raw)
  if (!feed) return { ok: false, reason: 'invalid' }
  return { ok: true, notices: applicableNotices(feed, appVersion()) }
}

/** 失败原因 → 给用户看的一句话。只在界面上显示，不参与任何判定 */
export function noticeFailText(reason: NoticeFailReason | null, detail?: string): string {
  switch (reason) {
    case 'no-bridge':
      return t('公告功能需要在桌面应用里使用。')
    case 'not-configured':
      return t('还没有配置公告地址（见 src/lib/noticeConfig.ts）。')
    case 'timeout':
      return t('获取公告超时了。不影响使用，下次启动会自动再试。')
    case 'network':
      return detail ? t('没能获取公告：{0}', detail) : t('没能获取公告（网络或地址有问题）。')
    case 'parse':
      return t('公告不是合法的 JSON，已忽略。')
    case 'invalid':
      return t('公告缺少必需字段或字段类型不对，已忽略。')
    default:
      return ''
  }
}

/** 当前运行的版本号；取不到（Node 探针里没有 define）给一个中性值 */
function appVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/* ---------- 本机状态 + 快照（供组件订阅） ---------- */

export interface NoticeSnapshot {
  /** 这次取到的公告（已按启用 / 版本筛过）；空数组 = 没有要显示的 */
  notices: RemoteNotice[]
  /** 本机状态（要不要自动弹、上次弹时的版本号、读过哪些 id） */
  store: NoticeStore
  /** 正在取 */
  loading: boolean
  /** 上次取失败的原因；成功为 null */
  fail: NoticeFailReason | null
  failDetail?: string
}

let store: NoticeStore = { ...DEFAULT_NOTICE_STORE }
let notices: RemoteNotice[] = []
let loading = false
let fail: NoticeFailReason | null = null
let failDetail: string | undefined

let snapshot: NoticeSnapshot = { notices, store, loading: false, fail: null }
const listeners = new Set<() => void>()

function publish(): void {
  snapshot = { notices, store, loading, fail, failDetail }
  for (const cb of listeners) cb()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const getSnapshot = (): NoticeSnapshot => snapshot

/** 组件里读公告状态（notices / store / loading / fail） */
export function useNotice(): NoticeSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 同步读当前快照（非组件环境用） */
export function noticeSnapshot(): NoticeSnapshot {
  return snapshot
}

/** 读一次本机状态并装进快照。**幂等**：启动流程里调一次就够 */
export async function loadNoticeStore(): Promise<NoticeStore> {
  try {
    store = normalizeStore(await native().notice.get())
  } catch (err) {
    console.warn('[notice] 读取公告状态失败：', err)
  }
  publish()
  return store
}

/** 把从主进程读到的形状再收敛一次：跨进程边界过来的东西不能直接信 */
function normalizeStore(raw: NoticeStore | null | undefined): NoticeStore {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTICE_STORE }
  return {
    autoShow: typeof raw.autoShow === 'boolean' ? raw.autoShow : true,
    shownVersion: typeof raw.shownVersion === 'string' ? raw.shownVersion : '',
    readIds: Array.isArray(raw.readIds) ? raw.readIds.filter((id): id is string => typeof id === 'string') : [],
  }
}

/** 落盘本机状态（按字段合并，主进程侧语义见 setNoticeSettings） */
async function persistStore(patch: Partial<NoticeStore>): Promise<void> {
  try {
    store = normalizeStore(await native().notice.set(patch))
  } catch (err) {
    console.warn('[notice] 保存公告状态失败：', err)
    // 存不下来也先在本会话里生效，界面不会显示一个其实没动的开关
    store = normalizeStore({ ...store, ...patch })
  }
  publish()
}

/** 记下「自动弹出决策」生效时的版本号——**这是「更新后强制弹一次」的记账动作** */
export function markNoticeShown(version: string): Promise<void> {
  return persistStore({ shownVersion: version })
}

/**
 * 已读 id 的保留条数。
 *
 * readIds 是只增不减的（一条公告读过了就是读过了），但公告本身会被删掉，
 * 于是这个集合会慢慢攒下一堆再也不会出现的 id。留最近 200 条足够覆盖
 * 「线上同时挂着的公告 + 近期删掉的」；更早的丢掉，免得 global.yaml 无限长。
 */
const MAX_READ_IDS = 200

/** 把一批公告记成已读（红点据此熄灭）。重复调用、传空数组都是安全的空操作 */
export function markNoticesRead(ids: string[]): Promise<void> {
  const next = [...store.readIds]
  const seen = new Set(next)
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  if (next.length === store.readIds.length) return Promise.resolve()
  return persistStore({ readIds: next.slice(-MAX_READ_IDS) })
}

/**
 * 用户点了「不再自动弹出」：关掉总开关，并把**这次看到的这几条**记成已读。
 *
 * 记 id 而不是只关开关，是为了「以后又把总开关打开」时，已经看过的那几条
 * 不会立刻让红点亮起来（见 unreadNotices）。
 */
export function optOutOfNotices(ids: string[]): Promise<void> {
  const next = new Set(store.readIds)
  for (const id of ids) if (id) next.add(id)
  return persistStore({ autoShow: false, readIds: [...next].slice(-MAX_READ_IDS) })
}

/** 只改「启动时自动弹出」这一个开关（不动已读记录） */
export function setNoticeAutoShow(autoShow: boolean): Promise<void> {
  return persistStore({ autoShow })
}

let inflight: Promise<NoticeFetchResult> | null = null
/** 上一次**真正发出去**的取公告时间；轮询与「窗口重新可见时补一次」都看它 */
let lastFetchAt = 0

/**
 * 取一次公告并更新快照。
 *
 * 并发去重：同一时刻只允许一次在飞（启动流程与用户手点可能撞上），
 * 第二个调用直接复用第一个的 Promise，不会打两次网络。失败只记在快照里，不抛。
 */
export function refreshNotice(): Promise<NoticeFetchResult> {
  if (inflight) return inflight
  inflight = runRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

async function runRefresh(): Promise<NoticeFetchResult> {
  loading = true
  fail = null
  failDetail = undefined
  lastFetchAt = Date.now()
  publish()
  let result: NoticeFetchResult
  try {
    result = await fetchNotice()
  } catch (err) {
    result = { ok: false, reason: 'network', detail: err instanceof Error ? err.message : String(err) }
  }
  loading = false
  if (result.ok) {
    notices = result.notices
    fail = null
    failDetail = undefined
    // 预热/缓存公告中出现的所有图片，避免网络原因导致图片时常加载不出来
    void precacheNoticeImages(notices)
  } else {
    fail = result.reason
    failDetail = result.detail
    // 取不到就沿用上一次的公告（手动入口仍能看上次那些），但失败原因照实记下来
  }
  publish()
  return result
}

/**
 * 启动时的一次完整流程：读本机状态 → 取公告。
 * 返回「要不要自动弹出」的判定结果，由调用方决定怎么弹（见 App.tsx）。
 */
export async function bootstrapNotice(): Promise<{ show: boolean }> {
  await loadNoticeStore()
  await refreshNotice()
  const version = appVersion()
  const show = shouldAutoShow(notices, store, version)
  if (show) await markNoticeShown(version)
  return { show }
}

/* ---------- 轮询 ---------- */

/**
 * 轮询间隔：**5 分钟**。
 *
 * 为什么要轮询：公告是「启动时取一次」之外还会变的——用户可能开着软件一整天，
 * 中途发了新公告。不轮询的话，只有重启才看得见；新到的那条也没机会让红点亮起来。
 *
 * 为什么是 5 分钟而不是更短：公告不是消息流，一天最多几条。5 分钟既能让新公告
 * 在几分钟内被看到，又只产生每天 288 次、每次几百字节的请求——对 Pages 的免费
 * 带宽来说可以忽略。（客户端每次都挂一个不同的查询串绕缓存，见 noticeConfig。）
 *
 * 失败不特殊处理：refreshNotice 内部把一切失败收敛成快照里的 fail，界面照旧，
 * 下一轮再试。
 */
export const NOTICE_POLL_MS = 5 * 60 * 1000

let pollTimer: ReturnType<typeof setInterval> | null = null
let onVisibility: (() => void) | null = null

/**
 * 开始轮询。返回一个停止函数（组件卸载时调用）。
 *
 * 除了定时器，还挂一个「窗口重新可见」的补取：应用被最小化 / 收进托盘 / 切到后台时，
 * 定时器照样在跑（Electron 的渲染进程不会被节流到停摆），但用户看不见的那段时间
 * 取的公告没有意义。回到前台时如果**已经超过一个周期没取过**，就立刻补一次——
 * 这样「切回来一看，红点已经亮了」，而不是还要再等几分钟。
 */
export function startNoticePolling(intervalMs: number = NOTICE_POLL_MS): () => void {
  stopNoticePolling()

  pollTimer = setInterval(() => {
    void refreshNotice()
  }, intervalMs)

  if (typeof document !== 'undefined') {
    onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchAt >= intervalMs) {
        void refreshNotice()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
  }

  return stopNoticePolling
}

/** 停掉轮询（重复调用安全） */
export function stopNoticePolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (onVisibility && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility)
    onVisibility = null
  }
}
