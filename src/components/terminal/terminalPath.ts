/**
 * terminalPath: VS Code / IntelliJ IDEA 级集成终端的路径解析、工作目录维护与原生 Tab 补全引擎。
 */

export function isWindowsPlatform(): boolean {
  if (typeof window !== 'undefined') {
    const win = window as unknown as { unyraNative?: { platform?: string }; mojiNative?: { platform?: string } }
    const plat = win.unyraNative?.platform || win.mojiNative?.platform
    if (plat) return plat === 'win32'
  }
  return typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || '')
}

/** 规范化路径显示与比较 */
export function normalizeTerminalPath(p: string, isWin = isWindowsPlatform()): string {
  if (!p) return ''
  let trimmed = p.trim()
  if (isWin) {
    trimmed = trimmed.replace(/\//g, '\\')
    // 盘符大写归一化 (e:\ -> E:\)
    trimmed = trimmed.replace(/^([a-zA-Z]):\\?/, (_m, d) => `${d.toUpperCase()}:\\`)
    // 去除末尾冗余反斜杠（但保留根盘符如 E:\）
    if (/^[A-Z]:\\.+/.test(trimmed)) {
      trimmed = trimmed.replace(/\\+$/, '')
    }
    return trimmed
  }
  // POSIX
  trimmed = trimmed.replace(/\\/g, '/')
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    trimmed = trimmed.replace(/\/+$/, '')
  }
  return trimmed
}

/** 解析 cd 目标路径为绝对路径 */
export function resolveCdTarget(
  currentCwd: string,
  rawTarget: string,
  homeDir = '',
  isWin = isWindowsPlatform(),
): string {
  let target = rawTarget.trim()
  // 去除 Windows CMD 的 /d 参数
  if (/^\/d\s+/i.test(target)) {
    target = target.replace(/^\/d\s+/i, '').trim()
  }
  // 去除首尾成对引号
  if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
    target = target.slice(1, -1).trim()
  }

  // 1. 空或 ~: 切换到用户主目录
  if (!target || target === '~') {
    return normalizeTerminalPath(homeDir || currentCwd, isWin)
  }

  // 2. Windows 盘符切换 (如 D:, d:, E:)
  if (isWin && /^[a-zA-Z]:$/i.test(target)) {
    return `${target[0].toUpperCase()}:\\`
  }

  // 3. 切换到根目录 (/ 或 \)
  if (target === '/' || target === '\\') {
    if (isWin) {
      const drive = (currentCwd.match(/^([a-zA-Z]):/) || [])[1] || 'C'
      return `${drive.toUpperCase()}:\\`
    }
    return '/'
  }

  // 4. 绝对路径
  const isAbs = isWin
    ? /^[a-zA-Z]:[\\/]/.test(target) || /^\\\\/.test(target)
    : target.startsWith('/')

  if (isAbs) {
    return normalizeTerminalPath(target, isWin)
  }

  // 5. 相对路径 (含 .. 和 .)
  const base = currentCwd || (isWin ? 'C:\\' : '/')
  const parts = base.split(/[\\/]/).filter(Boolean)
  const targetSegs = target.split(/[\\/]/).filter(Boolean)

  for (const seg of targetSegs) {
    if (seg === '.') continue
    if (seg === '..') {
      if (parts.length > 1 || (!isWin && parts.length > 0)) {
        parts.pop()
      }
    } else {
      parts.push(seg)
    }
  }

  if (isWin) {
    if (parts.length === 1 && /^[a-zA-Z]:$/i.test(parts[0])) {
      return `${parts[0].toUpperCase()}\\`
    }
    const drive = parts[0]?.toUpperCase().endsWith(':') ? parts[0].toUpperCase() : `${parts[0]?.toUpperCase()}:`
    const rest = parts.slice(1).join('\\')
    return rest ? `${drive}\\${rest}` : `${drive}\\`
  }

  return '/' + parts.join('/')
}

/** 格式化 cd 失败时的原生 Shell 错误提示 */
export function formatCdError(target: string, shell: 'powershell' | 'cmd' | 'bash'): string {
  if (shell === 'powershell') {
    return `Set-Location : 找不到路径“${target}”，因为该路径不存在。`
  }
  if (shell === 'cmd') {
    return '系统找不到指定的路径。'
  }
  return `bash: cd: ${target}: No such file or directory`
}

export interface TabCompletionResult {
  tokenStart: number
  tokenEnd: number
  candidates: string[]
  prefix: string
}

/**
 * 终端动态 Tab 补全：智能嗅探当前光标前的输入词法与物理文件系统
 */
export async function computeTabCompletions(
  inputVal: string,
  cursorPos: number,
  currentCwd: string,
  isWin = isWindowsPlatform(),
): Promise<TabCompletionResult | null> {
  if (cursorPos < 0 || cursorPos > inputVal.length) return null

  // 提取光标前的文本
  const beforeCursor = inputVal.slice(0, cursorPos)

  // 寻找当前词的起始位置（考虑未闭合引号或空格）
  let tokenStart = 0
  let inQuote: '"' | "'" | null = null
  for (let i = 0; i < beforeCursor.length; i++) {
    const ch = beforeCursor[i]
    if (ch === '"' || ch === "'") {
      if (inQuote === ch) {
        inQuote = null
      } else if (!inQuote) {
        inQuote = ch
        tokenStart = i
      }
    } else if (ch === ' ' && !inQuote) {
      tokenStart = i + 1
    }
  }

  const rawToken = beforeCursor.slice(tokenStart)
  const cleanToken = rawToken.replace(/^["']/, '')
  const tokenEnd = cursorPos

  // 分离目录部分与文件名/前缀部分
  const lastSepIdx = Math.max(cleanToken.lastIndexOf('\\'), cleanToken.lastIndexOf('/'))

  let dirPart = ''
  let filePrefix = cleanToken
  if (lastSepIdx >= 0) {
    dirPart = cleanToken.slice(0, lastSepIdx)
    filePrefix = cleanToken.slice(lastSepIdx + 1)
  }

  // 计算用于列取目录内容的绝对路径
  let lookupDir = currentCwd
  if (dirPart) {
    lookupDir = resolveCdTarget(currentCwd, dirPart, '', isWin)
  }

  const win = typeof window !== 'undefined' ? (window as unknown as { unyraNative?: any; mojiNative?: any }) : null
  const filesApi = win?.unyraNative?.files ?? win?.unyraNative?.base?.files ?? win?.mojiNative?.files ?? null

  if (!filesApi?.list) return null

  try {
    const res = await filesApi.list(lookupDir, { trusted: true })
    if (!res || !res.ok || !Array.isArray(res.entries)) return null

    const lowerPrefix = filePrefix.toLowerCase()
    const matches = res.entries.filter((e: { name: string }) =>
      e.name.toLowerCase().startsWith(lowerPrefix),
    )

    if (matches.length === 0) return null

    // 目录优先排序，其次按字母排序
    matches.sort((a: { isDirectory: boolean; name: string }, b: { isDirectory: boolean; name: string }) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })

    const candidates: string[] = matches.map((m: { name: string; isDirectory: boolean }) => {
      const sep = isWin ? '\\' : '/'
      const fullPathPart = dirPart ? `${dirPart}${sep}${m.name}` : m.name
      const suffix = m.isDirectory ? sep : ''
      const completed = `${fullPathPart}${suffix}`
      // 若包含空格且原输入无引号，则添加引号包裹
      if (completed.includes(' ') && !rawToken.startsWith('"') && !rawToken.startsWith("'")) {
        return `"${completed}"`
      }
      return completed
    })

    return {
      tokenStart,
      tokenEnd,
      candidates,
      prefix: filePrefix,
    }
  } catch {
    return null
  }
}
