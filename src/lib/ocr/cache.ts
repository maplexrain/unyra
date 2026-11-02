/**
 * OCR 识别结果缓存管理（内存 + 磁盘持久化）。
 *
 * 规范：
 * 1. 采用「内存优先、磁盘兜底」的双层缓存设计；
 * 2. 避免对同一份 PDF 重复耗费 CPU/GPU 算力进行 OCR 解析；
 * 3. 缓存键根据文件路径、页码和模型版本计算。
 */

import { native, type OcrPageResult } from '../native'

const memoryCache = new Map<string, OcrPageResult>()

/** 构造单页 OCR 缓存的唯一键 */
export function buildOcrCacheKey(docPath: string, pageNum: number, modelId = 'default'): string {
  const norm = docPath.replace(/\\/g, '/').toLowerCase()
  return `${norm}#page${pageNum}#m:${modelId}`
}

/** 获取单页 OCR 结果（优先内存，其次磁盘） */
export async function getCachedOcrResult(key: string): Promise<OcrPageResult | null> {
  // 1. 内存高速缓存
  const inMem = memoryCache.get(key)
  if (inMem) return inMem

  // 2. 磁盘缓存
  try {
    const fromDisk = await native().ocr.getCache(key)
    if (fromDisk) {
      memoryCache.set(key, fromDisk)
      return fromDisk
    }
  } catch {}

  return null
}

/** 保存单页 OCR 结果至内存与磁盘 */
export async function setCachedOcrResult(key: string, data: OcrPageResult): Promise<void> {
  memoryCache.set(key, data)
  try {
    await native().ocr.setCache(key, data)
  } catch {}
}

/** 清空当前内存缓存条目 */
export function clearMemoryOcrCache(): void {
  memoryCache.clear()
}

/** 获取当前内存已缓存的页面数量 */
export function getMemoryOcrCacheCount(): number {
  return memoryCache.size
}
