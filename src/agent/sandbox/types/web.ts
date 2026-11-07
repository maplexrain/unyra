/**
 * 这个文件负责什么：沙箱类型契约的**web（网络搜索与网页抓取）**组——WebOps 的宿主实现
 * （见 learn/webDocs）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/**
/**
 * 网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）。
 */
export interface WebOps {
  /** 抓一页（完全支持 DeepSeek Fetch API）：url 或 { url } → { title, content } */
  fetch: (arg: unknown) => Promise<unknown>
  /**
   * 网络搜索（完全支持 DeepSeek Search API）：
   * query/opts 或 { query, count?, ori_question?, localization?, need_content? }
   */
  search?: (queryOrArgs: unknown, opts?: Record<string, unknown>) => Promise<unknown>
}

