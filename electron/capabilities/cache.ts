/**
 * 能力结果的本地磁盘缓存（一个 KV 目录，OCR 页文本 / TTS 音频 / STT 段落共用）。
 *
 * 为什么必须有它：TTS、STT、OCR 接入 DeepSeek 之后都是**按量计费**的能力——
 * 同一页 PDF 重新识别一次、同一段话重新合成一次，都是在花用户的钱。
 * 缓存键由渲染层拼好（能力 + 引擎指纹 + 内容指纹，见 src/lib/capsCache），
 * 这里只管「目录 + JSON 文件」的存取，不认识里面装的是什么。
 *
 * 三个刻意的设计：
 * - **不 import electron/**：根目录由调用方传进来（IPC 注册侧用 userData 目录，
 *   WebUI 的服务端路由用它自己的数据目录），这个文件才能被两边共用。
 * - key 直接做文件名：调用方传来的已是 sha256 十六进制（hashKey），没有路径注入面。
 * - 容量护栏：TTS 一段音频几百 KB，反复合成会把目录撑到看不见——每写 N 次
 *   检查一次总量，超限就按修改时间从最旧的开始删，直到回到限额内。
 */

import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'

/** 缓存目录的容量上限：256 MB 足够几千页 OCR 文本 + 几百段音频 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
/** 每写多少次做一次容量检查（全目录 stat 不便宜，不值得每次都做） */
const SWEEP_EVERY = 64

/** 缓存键：稳定 sha256。部件顺序就是语义（能力在前、内容指纹在后），换任何一个部件结果都变 */
export function hashKey(...parts: Array<string | number>): string {
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

function kvDir(root: string): string {
  return path.join(root, 'kv')
}

/** 读一条缓存；不存在或损坏返回 null（损坏的顺手删掉，别让它赖着） */
export async function cacheGet(root: string, key: string): Promise<unknown | null> {
  const file = path.join(kvDir(root), `${key}.json`)
  try {
    const raw = await fsp.readFile(file, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    // 解析失败=写盘时被打断的半个文件：删掉，下次重算
    if (!(code === 'EACCES' || code === 'EPERM')) {
      await fsp.unlink(file).catch(() => undefined)
    }
    return null
  }
}

/** 写一条缓存；顺手做容量护栏 */
export async function cacheSet(root: string, key: string, value: unknown): Promise<void> {
  const dir = kvDir(root)
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${key}.json`)
  // 写临时文件再 rename：半个 JSON 的缓存等于没有缓存，还让人以为识别坏了
  const tmp = `${file}.${Date.now().toString(36)}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(value ?? null), 'utf-8')
    await fsp.rename(tmp, file)
  } catch {
    await fsp.unlink(tmp).catch(() => undefined)
    return
  }
  sweepCount += 1
  if (sweepCount >= SWEEP_EVERY) {
    sweepCount = 0
    void sweepCache(dir).catch(() => undefined)
  }
}

let sweepCount = 0

/** 总量超限时按修改时间从最旧开始删，删到回到限额内为止 */
async function sweepCache(dir: string): Promise<void> {
  const entries = await fsp.readdir(dir).catch(() => [] as string[])
  const files: Array<{ name: string; size: number; mtimeMs: number }> = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const st = await fsp.stat(path.join(dir, name)).catch(() => null)
    if (st) files.push({ name, size: st.size, mtimeMs: st.mtimeMs })
  }
  let total = files.reduce((sum, f) => sum + f.size, 0)
  if (total <= MAX_TOTAL_BYTES) return
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const f of files) {
    if (total <= MAX_TOTAL_BYTES) break
    await fsp.unlink(path.join(dir, f.name)).catch(() => undefined)
    total -= f.size
  }
}
