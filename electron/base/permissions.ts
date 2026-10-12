/**
 * 基础文件与进程权限放行校验器。
 *
 * 核心安全规则：
 * 1. 目标目录（当前学习目标文档目录 / 工作区 / 数据根）拥有完全读写与执行权限；
 * 2. 外部真实路径必须经过用户在 Agent 设置「工具」页中显式放行（白名单模式）；
 * 3. 未放行路径一律安全拦截并返回友好的指引说明。
 */
import path from 'node:path'
import { currentRoot } from '../storage'

let allowedDirsCache: string[] = []

/**
 * 同步用户设置中放行的外部目录清单
 */
export function syncAllowedDirs(dirs: string[]): void {
  allowedDirsCache = Array.isArray(dirs)
    ? dirs.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean)
    : []
}

export function getAllowedDirs(): string[] {
  return [...allowedDirsCache]
}

/**
 * 校验目标绝对路径是否在允许访问的作用域内
 */
export function checkPathPermission(targetPath: string): {
  allowed: boolean
  normalized: string
  error?: string
} {
  if (!targetPath || typeof targetPath !== 'string') {
    return { allowed: false, normalized: '', error: '路径不合法' }
  }

  const normalized = path.resolve(targetPath)
  const roots = [currentRoot(), ...allowedDirsCache].filter(Boolean).map((d) => path.resolve(d))

  const allowed = roots.some((root) => {
    if (normalized === root) return true
    const prefix = root.endsWith(path.sep) ? root : root + path.sep
    return normalized.startsWith(prefix)
  })

  if (!allowed) {
    return {
      allowed: false,
      normalized,
      error: `权限受限：路径 "${normalized}" 超出目标目录及放行白名单范围。请在超级导师设置的「工具」页中添加该目录放行，或使用目标工作区路径。`,
    }
  }

  return { allowed: true, normalized }
}
