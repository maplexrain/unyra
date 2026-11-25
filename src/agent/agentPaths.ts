/**
 * 外部 agent 的目录约定：`users/{uid}/agents/{agent-id}/`
 * - `agent.json`：独立配置（名称 / 简介 / 头像等）
 * - `prompts/`：该 agent 的专属提示词
 * - `assets/`：静态资源（头像等）
 *
 * 目录名就是 agent id；这里只负责拼路径与做最基本的目录名安全检查。
 */

export const AGENTS_DIR = 'agents'
export const COMMON_PROMPTS_DIR = 'prompts'

export function isSafeAgentId(id: string): boolean {
  const v = id.trim()
  return Boolean(v) && v !== '.' && v !== '..' && !v.startsWith('.') && !/[\\/]/.test(v)
}

export function agentDirOf(agentId: string): string {
  return `${AGENTS_DIR}/${agentId}`
}

export function agentConfigPathOf(agentId: string): string {
  return `${agentDirOf(agentId)}/agent.json`
}

export function agentPromptsDirOf(agentId: string): string {
  return `${agentDirOf(agentId)}/prompts`
}

export function agentAssetsDirOf(agentId: string): string {
  return `${agentDirOf(agentId)}/assets`
}

/** 把用户输入的名字变成可做目录名的 id；空名回退成 agent。 */
export function safeAgentDirName(raw: string): string {
  const base = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48)
  return base || 'agent'
}
