import { describe, expect, it } from 'vitest'
import {
  agentAssetsDirOf,
  agentConfigPathOf,
  agentPromptsDirOf,
  isSafeAgentId,
  safeAgentDirName,
} from '../src/agent/agentPaths'

describe('外部 agent 目录契约', () => {
  it('agent id 就是目录名，prompts / assets / agent.json 都在其下', () => {
    expect(agentPromptsDirOf('writer')).toBe('agents/writer/prompts')
    expect(agentAssetsDirOf('writer')).toBe('agents/writer/assets')
    expect(agentConfigPathOf('writer')).toBe('agents/writer/agent.json')
  })

  it('目录名过滤路径分隔符与非法字符，空名回退 agent', () => {
    expect(safeAgentDirName('我的/助手')).toBe('我的-助手')
    expect(safeAgentDirName('  a  b  ')).toBe('a-b')
    expect(safeAgentDirName('')).toBe('agent')
  })

  it('拒绝会穿目录的 id', () => {
    expect(isSafeAgentId('writer')).toBe(true)
    expect(isSafeAgentId('..')).toBe(false)
    expect(isSafeAgentId('a/b')).toBe(false)
    expect(isSafeAgentId('.hidden')).toBe(false)
  })
})
