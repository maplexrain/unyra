import { describe, expect, it } from 'vitest'
import { BUILTIN_SKILLS } from '../src/agent/skill/builtins'
import {
  formatActiveSkillsPrompt,
  getActiveSkills,
  getEffectiveSkills,
} from '../src/agent/skill/registry'
import { MCP_PRESETS, type McpSettings } from '../src/agent/mcp/types'
import { createMcpAgentTools } from '../src/agent/mcp/agentTools'
import { normalizeAgentSettings } from '../src/agent/settings'

describe('Agent 技能 (Skills) 与 MCP 设施测试', () => {
  describe('Skills 聚合与系统提示词注入', () => {
    it('内置技能库包含 5 项核心技能', () => {
      expect(BUILTIN_SKILLS.length).toBeGreaterThanOrEqual(5)
      const ids = BUILTIN_SKILLS.map((s) => s.id)
      expect(ids).toContain('socratic-tutor')
      expect(ids).toContain('reverse-breakdown')
      expect(ids).toContain('feynman-simplifier')
      expect(ids).toContain('code-architect')
      expect(ids).toContain('paper-deep-dive')
    })

    it('无自定义配置时返回默认内置技能且开关生效', () => {
      const skills = getEffectiveSkills(null)
      expect(skills.length).toBe(BUILTIN_SKILLS.length)

      const active = getActiveSkills(null)
      // 苏格拉底、逆向拆解、费曼重构默认启用
      expect(active.length).toBeGreaterThan(0)
      expect(active.some((s) => s.id === 'socratic-tutor')).toBe(true)
    })

    it('用户自定义配置可覆盖内置技能状态，并支持新增自定义技能', () => {
      const customSkill = {
        id: 'custom-math',
        name: '数学公理验证师',
        description: '严格检查公理体系',
        instructions: '严格依据集合论推导',
        enabled: true,
      }

      const settings = {
        enabled: true,
        skills: [
          {
            ...BUILTIN_SKILLS[0],
            enabled: false, // 禁用苏格拉底导学
          },
          customSkill,
        ],
      }

      const effective = getEffectiveSkills(settings)
      const socratic = effective.find((s) => s.id === 'socratic-tutor')
      expect(socratic?.enabled).toBe(false)

      const math = effective.find((s) => s.id === 'custom-math')
      expect(math?.enabled).toBe(true)
      expect(math?.builtin).toBe(false)

      const prompt = formatActiveSkillsPrompt(effective)
      expect(prompt).toContain('数学公理验证师')
      expect(prompt).toContain('严格依据集合论推导')
      expect(prompt).not.toContain('苏格拉底式启发导学')
    })

    it('技能总开关为 false 时，getActiveSkills 返回空', () => {
      const active = getActiveSkills({ enabled: false, skills: [] })
      expect(active).toEqual([])
    })
  })

  describe('MCP 工具转原生 AgentTool', () => {
    it('预设列表中包含 fetch, filesystem 等标准服务', () => {
      expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(3)
      expect(MCP_PRESETS.some((p) => p.id === 'mcp-fetch')).toBe(true)
      expect(MCP_PRESETS.some((p) => p.id === 'mcp-filesystem')).toBe(true)
    })

    it('已启用的 MCP 服务工具可正确转化为 AgentTool 接口规范', () => {
      const mcpSettings: McpSettings = {
        enabled: true,
        servers: [
          {
            id: 'fetch-srv',
            name: 'FetchServer',
            transport: 'stdio',
            enabled: true,
            tools: [
              {
                name: 'fetch_url',
                description: '抓取指定网页内容',
                inputSchema: {
                  type: 'object',
                  properties: { url: { type: 'string' } },
                  required: ['url'],
                },
              },
            ],
          },
          {
            id: 'disabled-srv',
            name: 'DisabledServer',
            transport: 'sse',
            enabled: false,
            tools: [{ name: 'dummy' }],
          },
        ],
      }

      const agentTools = createMcpAgentTools(mcpSettings)
      expect(agentTools.length).toBe(1)
      expect(agentTools[0].name).toBe('mcp_fetch_srv_fetch_url')
      expect(agentTools[0].description).toContain('[MCP: FetchServer]')
      expect(agentTools[0].parameters).toHaveProperty('properties')
    })

    it('总开关关闭时，不输出任何 MCP 工具', () => {
      const mcpSettings: McpSettings = {
        enabled: false,
        servers: [
          {
            id: 'test',
            name: 'Test',
            transport: 'stdio',
            enabled: true,
            tools: [{ name: 't1' }],
          },
        ],
      }
      expect(createMcpAgentTools(mcpSettings)).toEqual([])
    })
  })

  describe('AgentSettings 针对 Skills 和 MCP 的归一化', () => {
    it('缺省时自动补充默认值，老版本配置平滑升级', () => {
      const normalized = normalizeAgentSettings({})
      expect(normalized.skills?.enabled).toBe(true)
      expect(normalized.skills?.skills).toEqual([])
      expect(normalized.mcp?.enabled).toBe(true)
      expect(normalized.mcp?.servers).toEqual([])
    })

    it('保留用户合法的 skills 和 mcp 配置', () => {
      const custom = {
        skills: {
          enabled: false,
          skills: [{ id: 's1', name: 'S1', description: '', instructions: '', enabled: true }],
        },
        mcp: {
          enabled: true,
          servers: [{ id: 'm1', name: 'M1', transport: 'sse' as const, enabled: true }],
        },
      }
      const normalized = normalizeAgentSettings(custom)
      expect(normalized.skills?.enabled).toBe(false)
      expect(normalized.skills?.skills.length).toBe(1)
      expect(normalized.mcp?.servers.length).toBe(1)
      expect(normalized.mcp?.servers[0].id).toBe('m1')
    })
  })

  describe('物理独立技能目录与 SKILL.md 读写规范', () => {
    it('正确解析带有标准 YAML Frontmatter 的 SKILL.md 文件', async () => {
      const { parseSkillMd, serializeSkillMd } = await import('../src/agent/skill/fs')

      const rawMd = `---
name: 深度反向批判
description: 通过层层反问识别认知偏差
category: learning
tags:
  - 批判思考
  - 逻辑学
icon: Sparkles
enabled: true
---

## 技能规范：反向批判
1. 识别前提假设
2. 构造反例
`
      const parsed = parseSkillMd(rawMd, 'critical-thinking')
      expect(parsed.id).toBe('critical-thinking')
      expect(parsed.name).toBe('深度反向批判')
      expect(parsed.description).toBe('通过层层反问识别认知偏差')
      expect(parsed.category).toBe('learning')
      expect(parsed.tags).toEqual(['批判思考', '逻辑学'])
      expect(parsed.enabled).toBe(true)
      expect(parsed.instructions).toContain('## 技能规范：反向批判')
      expect(parsed.instructions).toContain('1. 识别前提假设')

      // 测试序列化与往返解析
      const serialized = serializeSkillMd(parsed)
      expect(serialized).toContain('name: 深度反向批判')
      expect(serialized).toContain('category: learning')
      expect(serialized).toContain('## 技能规范：反向批判')

      const reparsed = parseSkillMd(serialized, 'critical-thinking')
      expect(reparsed.name).toBe(parsed.name)
      expect(reparsed.category).toBe(parsed.category)
      expect(reparsed.instructions).toBe(parsed.instructions)
    })

    it('无 Frontmatter 时安全回退为纯 Markdown 指令', async () => {
      const { parseSkillMd } = await import('../src/agent/skill/fs')
      const pureMd = '## 纯指令正文\n直接按步骤执行。'
      const parsed = parseSkillMd(pureMd, 'pure-skill')
      expect(parsed.id).toBe('pure-skill')
      expect(parsed.name).toBe('pure-skill')
      expect(parsed.instructions).toBe('## 纯指令正文\n直接按步骤执行。')
      expect(parsed.enabled).toBe(true)
    })

    it('技能目录标识 ID 规范化安全处理', async () => {
      const { sanitizeSkillId } = await import('../src/agent/skill/fs')
      expect(sanitizeSkillId('  My First Skill!  ')).toBe('my-first-skill')
      expect(sanitizeSkillId('deep__learning//v2')).toBe('deep__learning-v2')
      expect(sanitizeSkillId('---test---')).toBe('test')
    })
  })
})

