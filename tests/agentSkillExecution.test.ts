import { describe, expect, it } from 'vitest'
import { formatSkillsDiscoveryPrompt, setLoadedSkills } from '../src/agent/skill/registry'
import { promptModuleByKey } from '../src/learn/ai/promptModules'
import { buildApi } from '../src/agent/sandbox/api'
import type { SandboxCall, SandboxOptions } from '../src/agent/sandbox/types'

describe('Agent Skill 渐进式开示与执行机制测试', () => {
  it('formatSkillsDiscoveryPrompt 仅生成轻量发现层索引，不泄露全量 instructions', () => {
    const skills = [
      {
        id: 'test-skill',
        name: '测试专用技能',
        description: '用于测试发现层索引',
        whenToUse: '执行自动化测试断言',
        instructions: '【机密指令：必须以笑脸表情开头回答】',
        enabled: true,
        scripts: [{ name: 'check.js', description: '代码断言' }],
      },
    ]

    const prompt = formatSkillsDiscoveryPrompt(skills)
    // 包含轻量元数据与触发时机
    expect(prompt).toContain('可用专业技能库 (Available Skills)')
    expect(prompt).toContain('[test-skill] 测试专用技能: 执行自动化测试断言')
    expect(prompt).toContain('专属脚本: check.js')
    expect(prompt).toContain('api.skill.read(id)')
    expect(prompt).toContain('api.skill.run(id, script, args)')

    // 严禁将 instructions 全量文本塞进发现层提示词
    expect(prompt).not.toContain('【机密指令：必须以笑脸表情开头回答】')
  })

  it('promptModuleByKey 支持动态按需读取 skill:<id> 完整指令规范', () => {
    setLoadedSkills([
      {
        id: 'dynamic-test',
        name: '动态测试技能',
        description: '动态装载测试',
        instructions: '这是动态注入到上下文的完整指南。',
        enabled: true,
      },
    ])

    // 读取不存在的技能返回 null
    expect(promptModuleByKey('skill:non-existent')).toBeNull()

    // 读取已加载的技能
    const mod = promptModuleByKey('skill:dynamic-test')
    expect(mod).not.toBeNull()
    expect(mod?.key).toBe('skill:dynamic-test')
    expect(mod?.title).toContain('动态测试技能')
    expect(mod?.text).toContain('这是动态注入到上下文的完整指南。')
  })

  it('沙箱 api.skill.list / api.skill.read / api.skill.run 正常工作并触发按需注入', async () => {
    const promptModulesCalled: string[] = []
    const log: SandboxCall[] = []

    const testSkill = {
      id: 'sample-skill',
      name: '示例技能',
      description: '用于沙箱 API 测试',
      whenToUse: '进行沙箱测试',
      instructions: '## 示例技能执行规范\n1. 遵循严谨逻辑。',
      enabled: true,
      scripts: [{ name: 'test.js', description: '测试脚本' }],
    }
    setLoadedSkills([testSkill])

    const mockOpts: SandboxOptions = {
      nodeId: () => 'node-1',
      resolveNode: () => ({ ok: true, ref: { id: 'node-1', title: '节点1', path: 'docs/test' } as any }),
      resolveDoc: () => ({ ok: true, ref: { id: 'node-1', kind: 'teaching', docLabel: 'docs/test/test.md' } as any }),
      docOps: {
        read: () => '',
        write: () => ({ ok: true, content: '' }),
        replace: () => ({ ok: true, content: '' }),
        append: () => ({ ok: true, content: '' }),
        annotate: () => ({ ok: true, content: '' }),
      },
      nodeOps: {
        list: () => [],
        read: () => null,
        create: () => ({ ok: true, content: '' }),
        update: () => ({ ok: true, content: '' }),
        remove: () => ({ ok: true, content: '' }),
        move: () => ({ ok: true, content: '' }),
      },
      onPromptModule: (key) => {
        promptModulesCalled.push(key)
      },
    }

    const { api } = buildApi(mockOpts, log)
    const skillApi = (api as any).skill
    expect(skillApi).toBeDefined()
    expect(typeof skillApi.list).toBe('function')
    expect(typeof skillApi.read).toBe('function')
    expect(typeof skillApi.run).toBe('function')

    // 1. api.skill.list()
    const listRes = await skillApi.list()
    expect(listRes.ok).toBe(true)
    expect(Array.isArray(listRes.skills)).toBe(true)
    expect(listRes.skills.some((s: any) => s.id === 'sample-skill')).toBe(true)

    // 2. api.skill.read(id)
    const readRes = await skillApi.read('sample-skill')
    expect(readRes.ok).toBe(true)
    expect(readRes.id).toBe('sample-skill')
    expect(readRes.instructions).toContain('遵循严谨逻辑')
    // 验证触发了 onPromptModule 回调以注入上下文
    expect(promptModulesCalled).toContain('skill:sample-skill')

    // 3. 读取不存在技能
    const readFail = await skillApi.read('unknown-skill')
    expect(readFail.ok).toBe(false)
    expect(readFail.error).toContain('未找到技能')

    // 4. api.skill.run(id, script, args) 在非原生/测试环境中回退为 mock
    const runRes = await skillApi.run('sample-skill', 'test.js', { param: 123 })
    expect(runRes.ok).toBe(true)
    expect(runRes.output).toContain('[mock]')
  })
})
