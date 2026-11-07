/**
 * 这个文件负责什么：沙箱类型契约的**video（视频资源与选集）**组——清单与信息查询
 * （见 learn/ops/video）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

export interface VideoEpisodeInfo {
  page: number
  title: string
  source: string
  durationMs?: number
}

export interface VideoInfoResult {
  ok: boolean
  id: string
  title: string
  hasEpisodes: boolean
  episodeCount: number
  episodes: VideoEpisodeInfo[]
  error?: string
}

export interface VideoOps {
  list: () => Array<{ id: string; title: string; plugin: string }>
  get: (target: string) => Promise<VideoInfoResult>
}

