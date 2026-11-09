import type { AiqaBlockHost } from './types'

let currentHost: AiqaBlockHost | null = null
const listeners = new Set<() => void>()

export function setAiqaBlockHost(host: AiqaBlockHost | null): void {
  if (currentHost === host) return
  currentHost = host
  for (const cb of listeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[aiqaBlock] host listener error', err)
    }
  }
}

export function aiqaBlockHost(): AiqaBlockHost | null {
  return currentHost
}

export function subscribeAiqaBlockHost(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
