/**
 * 这个文件负责什么：沙箱类型契约的**delivery（交付账）**组的宿主实现 DeliveryOps——
 * 把这一轮交付了什么记到本轮消息上（见 agent/delivery）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- delivery：这一轮的交付账 ---------- */

/**
 * api.delivery.submit 的宿主实现：把「这轮交付了什么」记到本轮消息上。
 *
 * 为什么不让模型在正文里复述：正文写法每次都不同，界面没法统一展示，也留不下来
 * （见 agent/delivery 的说明）。这里只收结构化数据，宿主按路径 / URL 去重合并。
 */
export interface DeliveryOps {
  /** { files?: [{ path, action?, note? }], sources?: [{ title, url }] } → { ok, files, sources, error? } */
  submit: (input: Record<string, unknown>) => unknown
}

