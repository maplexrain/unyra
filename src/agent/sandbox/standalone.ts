/**
 * 这个文件负责什么：常驻 api 的构造口——超级文档的桥要反复执行 method 函数，
 * 每次都重建一套纯属浪费，所以这里建一次、之后一直用（见 learn/useAgent）。
 */
import { buildApi } from './api'
import type { SandboxOptions } from './types'

/**
 * 组装一份**常驻的** api（不跑编排，给超级文档的桥执行 method 函数用）。
 *
 * 为什么能常驻：createAgentOps 造出的每个闭包都是「现取最新 store」的
 * （见 learn/agentOps 的说明），api 对象本身不持有任何快照——建一次，
 * 之后每一次调用看到的都是当前数据。超级文档可能一天被点几十次，
 * 每次都重建一套纯属浪费。
 */
export function buildStandaloneApi(opts: SandboxOptions): Record<string, unknown> {
  return buildApi(opts, []).api
}