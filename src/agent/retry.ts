/**
 * 本文件负责：一次 AI 请求失败之后「要不要重发、等多久再发」。
 *
 * 为什么单独一个文件：这两条是纯判据（入参只是一个错误对象 / 一个序号），
 * 而它们是整件事里唯一的两处开关——判错了一边是让用户干等五轮，另一边是把一次
 * 网络抖动当成分内失败。运行时（agent/runtime）只负责照它行事。
 *
 * 重试预算是**每一跳**的（一跳 = 一次请求，连同它带出的那一组工具调用）。
 * 为什么不按整轮算：一轮可能跑几十跳，按轮算的话前几跳就把额度花光了，
 * 后面同样一次抖动却直接报错；而「同一跳连挂六次」基本等于这条线这会儿真的不通。
 */
import { AiRequestError } from '../ai/types'
import { PrefixGateError } from './prefixGate'

/** 一次请求最多重试几次（不含第一次） */
export const MAX_REQUEST_RETRIES = 5

/** 退避的基数与封顶：800 → 1600 → 3200 → 4000 → 4000，五档合计约 13.6 秒 */
const RETRY_BASE_MS = 800
const RETRY_CAP_MS = 4000

/**
 * 这个错值得重发一次吗。
 *
 * 判断顺序是「先认死、再放行」：
 * 1. 服务端**明确说过**状态码的 4xx 里，只有超时（408）、冲突（409）、过早（425）、
 *    限流（429）值得再试——401 / 403 / 404 / 422 是这条请求本身就不对，
 *    重发五次也不会变绿，那只是让用户干等；
 * 2. 5xx 一律重试：那是服务端自己那边的事，过一会儿常常就好了；
 * 3. **没有状态码的一律重试**：网络失败、流读到一半断了、没给数据流、网关中途
 *    中止……这些恰恰是最值得重试的一类，而它们都没有状态码。
 *    这条默认值也让「某个适配点忘了带 status」退化成多试几次，
 *    而不是退化成「明明能恢复的错却直接报错」。
 *
 * 唯一主动放弃的是 PrefixGateError：那是**我们自己的**上下文不变量被破坏
 * （见 agent/prefixGate），同样的上下文再发一次只会再犯一次，重试是白等。
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof PrefixGateError) return false
  if (err instanceof AiRequestError && err.status !== undefined) {
    const s = err.status
    return s === 408 || s === 409 || s === 425 || s === 429 || s >= 500
  }
  return true
}

/** 第 n 次重试（n 从 1 起）之前要等多久：两倍递增，封顶 4 秒 */
export function retryDelayMs(n: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, n - 1))
}

/**
 * 等一会儿再发。
 *
 * 能被中止打断：退避最长 4 秒，用户点了「停止」不该还要干等完这一档。
 * 可注入替身（AgentRunOptions.sleep），测试因此不必真的等。
 */
export function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done)
  })
}
