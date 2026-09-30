/** 这个文件负责什么：内容指纹——优先 SHA-256（crypto.subtle）、取不到时退回 FNV-1a；同一份内容只存一遍靠它。 */

import type { LearnStore } from '../types'
import { resourcesOf } from './ops'
import type { StaticResource } from './types'

/* ---------- 内容指纹 ---------- */

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * 算一份内容的指纹。
 *
 * 优先 SHA-256（crypto.subtle）：它是浏览器自带、够快也够稳的。取不到时
 * （非安全上下文、老环境）退回 FNV-1a——去重只要求「同样的字节给出同样的值」，
 * 32 位对「几百份资源里撞一次」来说够用，而且它完全是同步的、不依赖任何 API。
 */
export async function hashBytes(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      // slice() 复制到一段新的 ArrayBuffer 上：subtle 要的是 BufferSource，
      // 而传进来的 view 可能坐在 SharedArrayBuffer 上（类型上不允许，运行时也没必要）
      const digest = await subtle.digest('SHA-256', data.slice().buffer)
      return toHex(new Uint8Array(digest))
    } catch {
      // 落到下面的兜底
    }
  }
  let h = 0x811c9dc5
  for (const b of data) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 'fnv1a-' + h.toString(16).padStart(8, '0')
}

export const hashOfText = (text: string): Promise<string> => hashBytes(new TextEncoder().encode(text))

/** 列表里只显示指纹的前 12 位：够认出「这两条一样」，又不占地方 */
export const shortHash = (hash: string): string => (hash ? hash.slice(0, 12) : '')

/** 目标里已有一份同样内容的资源？有就返回它（去重的唯一入口） */
export function findByHash(store: LearnStore, goalId: string, hash: string): StaticResource | null {
  if (!hash) return null
  return resourcesOf(store, goalId).find((r) => r.hash && r.hash === hash) ?? null
}
