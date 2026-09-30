/**
 * 自动更新里**不依赖 Electron** 的那部分：失败原因归类、更新说明整理、发布页地址。
 *
 * 为什么单独一个文件：scripts/update.test.ts
 * 要能在普通 Node 里直接跑它。真正必须在主进程里做的事——联网、下载、状态、IPC——
 * 都在 update.ts 里。
 *
 * 这里还有一条**跨文件的一致性**要守：发布仓库的地址同时出现在两个地方——
 * 本文件的 RELEASE_REPO（界面上「查看更新说明」指向它）与 electron-builder.yml 的
 * publish 配置（安装包真的去那里取更新）。两边写岔了不会报任何错，只会表现为
 * 「检查更新永远说已是最新」或「详情链接 404」，所以测试里有一条专门比对这两处。
 */

/** 发布仓库（开源，就是本仓库）。安装包与版本元数据都在它的 Releases 里 */
export const RELEASE_REPO = 'maplexrain/unyra'

/**
 * 更新状态机的相位。放在这里而不是 update.ts：它是**纯描述**，
 * 渲染层、preload、主进程三处都要它，而 update.ts 一旦被 import 就会把 electron 拖进来。
 *
 *   disabled     这个构建不参与自动更新（开发运行、非 Windows）
 *   idle         还没查过，或已是最新
 *   checking     正在问更新源
 *   available    查到了新版本，但还没开始下（只有「不自动下载」时才会停在这一档）
 *   downloading  后台下载中
 *   ready        下载完成、校验通过，等用户点安装
 *   installing   正在拉起安装程序
 *   error        出错了（只影响这次更新，当前版本照常用）
 */
export type UpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

/** 启动后多久开始查。给窗口让路：首屏与数据载入都在这几秒里发生 */
export const FIRST_CHECK_DELAY_MS = 3000

/**
 * 之后每 5 分钟再问一次。
 *
 * 为什么要有轮询：只在启动时查一次的话，「开着应用挂一整天」的人永远等不到新版本——
 * 而这个应用恰恰会被长期开着（关窗行为还能收进托盘，进程一直活着）。
 * 一次检查就是几个 HTTP 请求，代价可以忽略。
 */
export const POLL_INTERVAL_MS = 5 * 60 * 1000

/** 这次检查是谁要求的 */
export type CheckReason = 'auto' | 'manual'

/**
 * 这次该不该真的去问一次。
 *
 * - auto（启动时那次 + 每 5 分钟的轮询）：用户关掉了「自动检查更新」就不问，
 *   「不打扰」必须包括不产生网络请求；
 * - manual（设置里点「检查最新版本」）：任何时候都问——那正是用户明确要求的一次；
 * - 正在忙（检查中 / 下载中 / 安装中）不重复问；已经下好了也不问，
 *   否则每 5 分钟都会把同一个版本再报一遍，界面上像是出了什么问题。
 */
export function shouldCheck(phase: UpdatePhase, reason: CheckReason, autoUpdate: boolean): boolean {
  if (phase === 'disabled') return false
  if (reason === 'auto' && !autoUpdate) return false
  return phase !== 'checking' && phase !== 'downloading' && phase !== 'installing' && phase !== 'ready'
}

/**
 * 更新失败的原因。
 *
 * 分这么细是因为它们对应**完全不同的下一步**：「连不上 GitHub」让人去查网络，
 * 「仓库里还没有正式发布」是作者那边的事，而「校验对不上」是要认真对待的一条
 * （下载被换了，或者发布时两个文件不同步）。糊成一句「更新失败」，用户只能来问。
 */
export type UpdateFail =
  /** DNS / 连接 / 超时：多半是没有外网，或者这个时段 GitHub 不通 */
  | 'network'
  /** 发布仓库里一个正式发行版都没有（还没发过，或者全存成了草稿） */
  | 'no-release'
  /** 有发行版，但里面缺更新元数据（latest.yml 没传上去） */
  | 'not-found'
  /** 下回来的包和发布时登记的哈希对不上 */
  | 'checksum'
  /** 下载或写盘失败：磁盘满了、被杀软锁住之类 */
  | 'download'
  /** 包下好了，但安装程序拉不起来 */
  | 'install'
  /** 别的 HTTP 错误（5xx 等） */
  | 'http'
  | 'unknown'

/** 把 electron-updater 抛出来的东西归到上面那几类里 */
export function failReasonOf(err: unknown): UpdateFail {
  const code = codeOf(err)
  if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') return 'no-release'
  if (code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') return 'no-release'
  if (code === 'ERR_UPDATER_RELEASE_NOT_FOUND') return 'no-release'
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return 'not-found'
  if (code === 'ERR_UPDATER_ASSET_NOT_FOUND') return 'not-found'
  if (code === 'ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND') return 'not-found'
  if (code === 'ERR_CHECKSUM_MISMATCH') return 'checksum'
  if (code === 'ERR_UPDATER_INVALID_SIGNATURE') return 'checksum'
  if (code === 'ERR_UPDATER_NO_CHECKSUM') return 'checksum'
  if (code === 'ERR_UPDATER_INVALID_RELEASE_FEED') return 'network'
  if (code === 'ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION') return 'unknown'
  if (NETWORK_CODES.has(code)) return 'network'
  if (code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return 'download'

  /*
   * 还有一种**没有 code** 的失败：发布仓库刚建好、一个正式版本都还没发过的时候，
   * electron-updater 会抛一个裸 Error（它的 XmlElement.element 在「找不到 entry
   * 且给了提示语」时直接 throw new Error(...)），只有一句话，没有 code。
   * 这条路是作者第一次发布之前每次启动都会走的，绝不能落进「认不出来」。
   *
   * 判据只能取整句文案——它是那个库里的固定字符串。真变了也只是退回 unknown，
   * 不会误报成别的类。这条是拿真实的空发布仓库试出来的
   * （见 docs/packaging-and-release.md「怎么验证更新链路」）。
   */
  if (messageOf(err) === 'No published versions on GitHub') return 'no-release'

  const status = statusOf(err)
  if (status === 404 || status === 403 || status === 401) return 'not-found'
  if (status >= 400) return 'http'
  return 'unknown'
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : ''
}

/** 归类之外，把原始那句话留给日志与「关于」页——排查时它比归类有用得多 */
export function failDetailOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_SOCKET_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
])

function codeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'statusCode' in err) {
    const status = (err as { statusCode?: unknown }).statusCode
    if (typeof status === 'number') return status
  }
  return 0
}

/**
 * 更新说明整理成一段 HTML。
 *
 * 来源是 GitHub Release 的正文：electron-updater 走的是仓库的 atom feed，
 * 里面的 content 就是 GitHub 渲染好的 HTML（不是 Markdown 原文）。
 * fullChangelog 关着，所以正常只会拿到一个字符串；数组那种形状（跨版本变更日志）
 * 也一并接住——取回来是什么样不该由调用方猜。
 *
 * **这里不做消毒**：消毒是渲染层的事（那边有 DOMPurify，见 lib/markdown.ts），
 * 主进程不该为了显示一段说明去解析 HTML。
 */
export function notesText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() || undefined
  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) =>
        item && typeof item === 'object' && typeof (item as { note?: unknown }).note === 'string'
          ? ((item as { note: string }).note ?? '')
          : '',
      )
      .filter(Boolean)
    const text = parts.join('\n').trim()
    return text || undefined
  }
  return undefined
}

/**
 * 这次更新对应的发布页地址。
 *
 * tag 用 electron-updater 从 atom feed 里读到的那个（GitHub 的 tag 未必正好是
 * v + version，比如手工打过 v1.0.0-beta.1）；拿不到就按本仓库的约定拼一个。
 */
export function releasePageUrl(info: { version: string; tag?: unknown }, repo = RELEASE_REPO): string {
  const tag = typeof info.tag === 'string' && info.tag.trim() ? info.tag.trim() : 'v' + info.version
  return 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(tag)
}
