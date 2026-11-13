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
