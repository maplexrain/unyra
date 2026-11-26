/**
 * 提示词重构的架构约束：
 * 1. 每个 agent 的关键约束都有 XML 边界，不再用一条扁平长列表混写；
 * 2. 全员机械纪律只保留在 ROLE_WORK_GUIDE / 共同前缀一处，role 文案不复述；
 * 3. 自由对话的固定组 API 直接来自 apiRegistry，不再手写第二份签名；
 * 4. work 不再向模型承诺「不调用 host.send 会自动回传」的兜底。
 */
import { describe, expect, it } from 'vitest'
import { buildVoiceSystem } from '../src/learn/ai/agentTeamSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { FREE_CHAT_BOUNDARY } from '../src/learn/ai/freeChatCopy'
import { ROLE_CHANNEL_GUIDE, ROLE_WORK_GUIDE } from '../src/learn/ai/roleWorkGuide'
import { WORK_BASE_GUIDE } from '../src/learn/ai/workBase'
import { FIXED_API_PLANE } from '../src/agent/agentProfile'
import { renderSplitApiDocumentation } from '../src/agent/sandbox/apiPromptDoc'

const VOICES = ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as const

describe('提示词语义分区', () => {
  for (const voice of VOICES) {
    it(voice + ' role 提示词按身份 / 执行 / 通道 / 工具 / 委派分区', () => {
      const text = buildVoiceSystem(voice)
      for (const tag of [
        'agent_common',
        'collaboration_rules',
        'channel_rules',
        'compaction_rules',
        'tool_capabilities',
        'identity',
        'duties',
        'delegated_capabilities',
      ]) {
        expect(text).toContain('<' + tag + '>')
        expect(text).toContain('</' + tag + '>')
      }
    })
  }

  it('自由对话按身份 / 工具 / 边界分区', () => {
    const text = buildFreeChatSystem()
    for (const tag of ['agent_common', 'tool_capabilities', 'identity', 'boundaries']) {
      expect(text).toContain('<' + tag + '>')
      expect(text).toContain('</' + tag + '>')
    }
  })
})

describe('机械纪律去重', () => {
  for (const voice of VOICES) {
    it(voice + ' 不重复抄写「派完即回执」', () => {
      const text = buildVoiceSystem(voice)
      expect(text.split('派完即回执').length - 1).toBe(1)
    })
  }
})

describe('自由对话固定组 API 单一来源', () => {
  it('固定组签名来自 apiRegistry，不再手写第二份调用清单', () => {
    const fixed = renderSplitApiDocumentation(
      new Set([...FIXED_API_PLANE.groups, ...FIXED_API_PLANE.topLevel, 'core']),
      FIXED_API_PLANE,
    ).fixed
    const text = buildFreeChatSystem()
    expect(text).toContain(fixed.trim())
    expect(text).toContain('#### api.work — 工作会话')
    expect(text).not.toContain('• api.work.list()')
  })
})

describe('work 交付无兜底话术', () => {
  for (const role of VOICES) {
    it(role + ' work 不承诺自动回传', () => {
      expect(buildWorkSystem(role)).not.toContain('自动回传')
    })
  }

  it('work 基座与交付段不再重复抄工具签名', () => {
    expect(WORK_BASE_GUIDE).not.toContain('api.host.send({')
    expect(WORK_BASE_GUIDE).not.toContain('api.delivery.submit({')
  })
})

describe('协作文案不重复工具参数签名', () => {
  it('role 协作 / 通道 / free 边界只引用 api 名，参数形状留给速查', () => {
    for (const text of [ROLE_WORK_GUIDE, ROLE_CHANNEL_GUIDE, FREE_CHAT_BOUNDARY]) {
      expect(text).not.toContain('api.chat.send({')
    }
  })
})

describe('work 提示词语义分区', () => {
  for (const role of VOICES) {
    it(role + ' work 按基座 / 角色 / 工具 / 流程 / 纪律分区', () => {
      const text = buildWorkSystem(role)
      for (const tag of [
        'role',
        'execution_rules',
        'sandbox_and_tools',
        'delivery_rules',
        'work_role',
        'tool_capabilities',
        'workflow_procedures',
      ]) {
        expect(text).toContain('<' + tag + '>')
        expect(text).toContain('</' + tag + '>')
      }
    })
  }
})
