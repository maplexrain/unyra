import { diskPathKey } from '../../../lib/storage'

/**
 * 自身写盘抑制保护表：
 * 用于记录应用自身主动写盘（Ctrl+S、:w 或自动保存）的文件绝对路径与有效时间戳。
 * 当主进程的文件监视器（File Watcher）回传改动通知时，
 * 若变动属于自身刚落盘的内容（1500ms 窗口期内），直接抑制并消费该通知，
 * 彻底杜绝将「自身保存」误判为「外部第三方修改」而导致的页签重建与闪烁。
 */
const selfWritingMap = new Map<string, number>()

/** 登记当前路径正由应用自身主动写盘，保持 1500ms 保护期 */
export function markSelfWritingPath(path: string, durationMs = 1500): void {
  const key = diskPathKey(path)
  selfWritingMap.set(key, Date.now() + durationMs)
}

/**
 * 检查并消费自身写盘保护：
 * 若命中且在有效期内，返回 true（表示本次属于自身写盘，调用方应跳过重载），并清除记录；否则返回 false。
 */
export function consumeSelfWritingPath(path: string): boolean {
  const key = diskPathKey(path)
  const expire = selfWritingMap.get(key)
  if (!expire) return false

  const now = Date.now()
  if (now <= expire) {
    selfWritingMap.delete(key)
    return true
  }
  selfWritingMap.delete(key)
  return false
}
