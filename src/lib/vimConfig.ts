import { Vim } from '@replit/codemirror-vim'
import { native } from './native'

/**
 * 确保用户目录下的 Vim 配置文件 (.vimrc) 存在（若不存在则自动创建一份标准注释模板），
 * 并返回其绝对路径。
 */
export async function ensureVimConfigFile(): Promise<string | null> {
  try {
    const bridge = native()
    if (bridge?.local?.ensureVimConfig) {
      const res = await bridge.local.ensureVimConfig()
      if (res.ok && res.path) {
        return res.path
      }
    }
  } catch {
    // 忽略异常，降级处理
  }
  return null
}

/**
 * 解析并应用单行 Vimrc 规则到 Vim 全局实例
 */
export function applyVimrcLine(line: string): void {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('"') || trimmed.startsWith('#')) return

  // 剥离行尾引号注释
  let code = trimmed
  const quoteIdx = code.indexOf('"')
  if (quoteIdx !== -1) {
    code = code.slice(0, quoteIdx).trim()
  }
  if (!code) return

  const tokens = code.split(/\s+/)
  if (tokens.length === 0) return
  const cmd = tokens[0].toLowerCase()

  try {
    // 1. 按键映射 (map / noremap)：严格区分非递归映射与递归映射，防止同键递归循环
    const isNoremap = cmd.includes('noremap')
    const mapFn = isNoremap ? Vim.noremap : Vim.map

    // 清洗 rhs：过滤 CodeMirror-Vim 不支持的末尾折叠命令（如 nzzzv / Nzzzv 中的 zv），
    // 兼容保留核心动作与平滑居中 (nzz / Nzz)，杜绝未识别键位序列导致按键阻断
    const sanitizeRhs = (rhs: string): string => {
      if (rhs.endsWith('zv')) return rhs.slice(0, -2)
      return rhs
    }

    if (cmd === 'inoremap' || cmd === 'imap') {
      if (tokens.length >= 3) mapFn(tokens[1], sanitizeRhs(tokens[2]), 'insert')
    } else if (cmd === 'nnoremap' || cmd === 'nmap') {
      if (tokens.length >= 3) mapFn(tokens[1], sanitizeRhs(tokens[2]), 'normal')
    } else if (cmd === 'vnoremap' || cmd === 'vmap') {
      if (tokens.length >= 3) mapFn(tokens[1], sanitizeRhs(tokens[2]), 'visual')
    } else if (cmd === 'cnoremap' || cmd === 'cmap') {
      if (tokens.length >= 3) mapFn(tokens[1], sanitizeRhs(tokens[2]), 'command')
    } else if (cmd === 'noremap' || cmd === 'map') {
      if (tokens.length >= 3) mapFn(tokens[1], sanitizeRhs(tokens[2]), 'normal')
    }
    // 2. 取消映射 (unmap)
    else if (cmd === 'iunmap') {
      if (tokens.length >= 2) Vim.unmap(tokens[1], 'insert')
    } else if (cmd === 'nunmap') {
      if (tokens.length >= 2) Vim.unmap(tokens[1], 'normal')
    } else if (cmd === 'vunmap') {
      if (tokens.length >= 2) Vim.unmap(tokens[1], 'visual')
    } else if (cmd === 'cunmap') {
      if (tokens.length >= 2) Vim.unmap(tokens[1], 'command')
    } else if (cmd === 'unmap') {
      if (tokens.length >= 2) Vim.unmap(tokens[1], 'normal')
    }
    // 3. 选项设置 (set)
    else if (cmd === 'set') {
      for (let i = 1; i < tokens.length; i++) {
        const item = tokens[i]
        if (!item) continue
        if (item.startsWith('no')) {
          const opt = item.slice(2)
          try {
            Vim.setOption(opt, false)
          } catch {
            // 忽略未识别选项
          }
        } else if (item.includes('=')) {
          const [key, val] = item.split('=')
          const num = Number(val)
          try {
            Vim.setOption(key, isNaN(num) ? val : num)
          } catch {
            // 忽略未识别选项
          }
        } else {
          try {
            Vim.setOption(item, true)
          } catch {
            // 忽略未识别选项
          }
        }
      }
    }
  } catch {
    // 容错处理，单行指令异常不中断整篇解析
  }
}

/**
 * 将整篇 vimrc 文本逐行应用到 Vim 实例
 */
export function applyVimrc(text: string): void {
  try {
    Vim.mapclear('insert')
    Vim.mapclear('normal')
    Vim.mapclear('visual')
    Vim.mapclear('command')
  } catch {
    // 忽略异常
  }

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    applyVimrcLine(line)
  }
}

/**
 * 读取本地 ~/.vimrc 并解析执行（或直接应用传入的文本内容）
 */
export async function loadAndApplyVimrc(content?: string): Promise<void> {
  if (typeof content === 'string') {
    applyVimrc(content)
    return
  }

  try {
    const configPath = await ensureVimConfigFile()
    if (!configPath) return
    const bridge = native()
    if (bridge?.local?.read) {
      const res = await bridge.local.read(configPath)
      if (res.ok && typeof res.content === 'string') {
        applyVimrc(res.content)
      }
    }
  } catch {
    // 忽略异常
  }
}
