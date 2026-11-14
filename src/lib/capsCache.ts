/**
 * 能力结果的通用缓存（内存 + 主进程磁盘 KV，见 electron/capabilities/cache.ts）。
 *
 * TTS / STT / OCR 走 DeepSeek 之后都是**按量计费**的能力——同一页 PDF 重新识别、
 * 同一段话重新合成都是在花用户的钱。缓存的 key 由调用方拼（能力 + 引擎指纹 +
 * 内容指纹），这里只负责「拼成 sha256 → 内存查 → 磁盘查 → 原样写回」。
 *
 * key 的生成用 Web Crypto（渲染层的 crypto.subtle），失败时回落纯 JS 的双 FNV：
 * 两边产的都是 64 位十六进制（主进程 KV 只认这个形状），只是散列质量不同——
 * fallback 只在非安全上下文（局域网 IP 访问 WebUI）出现，同一次会话内 key 一定
 * 自洽，跨上下文换算法的代价只是旧缓存作废。
 */

import { native } from './native'

const memoryCache = new Map<string, unknown>()

/** 纯 JS 回落：FNV-1a 跑两把不同种子，凑 64 个十六进制位 */
function fnvFallback(text: string): string {
  const mix = (seed: number): string => {
    let h = seed >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  const a = mix(0x811c9dc5)
  const b = mix(0xdeadbeef ^ text.length)
  return (a + b + a + b).slice(0, 64).padEnd(64, '0')
}

/** 缓存键：稳定 sha256（部件顺序就是语义，换任何一个部件结果都变） */
export async function capsHashKey(...parts: Array<string | number>): Promise<string> {
  const text = parts.join('\u0000')
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(text)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {}
  return fnvFallback(text)
}

/** 读一条缓存：内存优先，其次主进程磁盘；命中磁盘的回填内存 */
export async function capsCacheGet<T = unknown>(key: string): Promise<T | null> {
  if (memoryCache.has(key)) return memoryCache.get(key) as T
  try {
    const res = await native().caps.cacheGet(key)
    if (res.ok && res.value != null) {
      memoryCache.set(key, res.value)
      return res.value as T
    }
  } catch {}
  return null
}

/** 写一条缓存：内存与磁盘各写一份（磁盘失败不影响内存命中） */
export async function capsCacheSet(key: string, value: unknown): Promise<void> {
  memoryCache.set(key, value)
  try {
    await native().caps.cacheSet(key, value)
  } catch {}
}

/** 清空内存层（磁盘层不动——那是「别重复花钱」的本体） */
export function clearCapsMemoryCache(): void {
  memoryCache.clear()
}

/* ---------- 文档级缓存纪元（右键「清除本文档缓存」用） ---------- */

/**
 * 缓存键是不可逆的 sha256，磁盘上没法按文档枚举删除——所以「清掉这份 PDF 的缓存」
 * 用**纪元**实现：键里拼上该文档的 epoch，「清除」就是 epoch+1（旧条目全部失效，
 * 变成等护栏清走的垃圾），不用碰磁盘也不改 KV 结构。
 */
function epochKey(docPath: string): string {
  return `moji:caps-epoch:${docPath.replace(/\\/g, '/').toLowerCase()}`
}

export function docOcrEpoch(docPath: string): number {
  try {
    return Number(localStorage.getItem(epochKey(docPath))) || 0
  } catch {
    return 0
  }
}

/** 纪元 +1：这份文档的 OCR 缓存从此作废（下一次识别真花一次钱） */
export function bumpDocOcrEpoch(docPath: string): void {
  try {
    localStorage.setItem(epochKey(docPath), String(docOcrEpoch(docPath) + 1))
  } catch {}
  memoryCache.clear()
}
