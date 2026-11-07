/**
 * 这个文件负责什么：IPC 契约的**视频学习（实验）**通道组——video:fetch 与
 * video:openStream 的返回（见 electron/video-net.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 视频学习（实验） ---------- */

/**
 * video:fetch 的返回：主进程替来源插件发的一次 API 请求（只读 GET）。
 *
 * 与 web:fetch 的差别：允许插件声明 Referer / Cookie 等请求头——平台 API 大多有
 * 防盗链校验，不带就回 403。这也正是它必须**独立成频道**的原因：web:fetch 的三条
 * 自我约束（不带凭据）是给「agent 写的代码」设的，来源插件是用户自己装的，
 * 信任级别不同。体积与时间仍有硬上限（见 electron/video-net）。
 *
 * 谁在用：主进程 electron/video-net.ts（video:fetch），preload 的 video.fetch，
 * 渲染层 src/video/registry（插件的 ctx.fetch）。
 */
export type VideoApiFetchResult =
  | { ok: true; status: number; finalUrl: string; body: string }
  | { ok: false; error: string }

/**
 * video:openStream 的返回：媒体流的**中转地址**。
 *
 * 渲染层把插件给的流地址与请求头登记到主进程，换回一条
 * `media-relay://<id>/stream?u=<encoded>` 形式的中转 URL——`<video>` 元素改不了
 * 请求头，而平台 CDN 校验 Referer，必须由主进程的协议处理器（见
 * electron/media-relay.ts）注入后转发。**流地址有时效**（平台签名几小时过期），
 * 所以这个登记是「每次播放前调用」的：URL 永不落盘，转录缓存里只存媒体 id。
 *
 * 谁在用：主进程 electron/video-net.ts（video:openStream），preload 的 video.openStream，
 * 渲染层 src/components/video/VideoStudyTab。
 */
export type VideoStreamOpenResult =
  | { ok: true; relayUrl: string }
  | { ok: false; error: string }

