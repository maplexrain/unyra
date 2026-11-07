/**
 * quote 块宿主（QuoteBlockHost）全局状态。
 *
 * 职责：维护全局唯一的宿主实例（由 LearnWorkspace 等注入），
 * 提供注册（setQuoteBlockHost）、读取（quoteBlockHost）与订阅（subscribeQuoteBlockHost）能力，
 * 供挂载模块（hydrate）在宿主就绪后读取文件内容与打开文件。
 */
import type { QuoteBlockHost } from './types'

let currentQuoteHost: QuoteBlockHost | null = null
const quoteHostListeners = new Set<() => void>()

export function setQuoteBlockHost(host: QuoteBlockHost | null): void {
  if (currentQuoteHost === host) return
  currentQuoteHost = host
  for (const cb of quoteHostListeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[quoteBlock] host listener error', err)
    }
  }
}

export function quoteBlockHost(): QuoteBlockHost | null {
  return currentQuoteHost
}

export function subscribeQuoteBlockHost(cb: () => void): () => void {
  quoteHostListeners.add(cb)
  return () => {
    quoteHostListeners.delete(cb)
  }
}
