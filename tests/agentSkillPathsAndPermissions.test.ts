import { describe, expect, it } from 'vitest'
import { buildApi } from '../src/agent/sandbox/api'
import type { SandboxCall, SandboxOptions } from '../src/agent/sandbox/types'
import { setLoadedSkills, formatSkillsDiscoveryPrompt, getSkillsDigest, needsSkillsAnnounce, skillsAnnounceMessage } from '../src/agent/skill/registry'
import { getSkillsAbsPath } from '../src/agent/skill/fs'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'

describe('Agent Skill 路径感知与读写权限测试', () => {
  const dummyOpts: SandboxOptions = {
    nodeId: () => 'node-1',
    resolveNode: () => ({ ok: false, message: 'none' }),
    resolveDoc: () => ({ ok: false, message: 'none' }),
    docOps: {
      read: () => '',
      write: () => ({ ok: true, content: '' }),
      replace: () => ({ ok: true, content: '' }),
      append: () => ({ ok: true, content: '' }),
      annotate: () => ({ ok: true, content: '' }),
    },
    nodeOps: {
      list: () => [],
      read: () => ({ ok: false }),
      create: () => ({ ok: false, content: '' }),
      update: () => ({ ok: false, content: '' }),
      remove: () => ({ ok: false, content: '' }),
      move: () => ({ ok: false, content: '' }),
    },
  }

  it('api.skill.paths 支持获取技能根目录与各层级物理绝对路径', async () => {
    const log: SandboxCall[] = []
    const { api } = buildApi(dummyOpts, log)
    const skillApi = api.skill as {
      paths: (id?: string) => Promise<{ ok: boolean; root: string; dir?: string; scriptsDir?: string; referencesDir?: string; skillMd?: string }>
    }

    // 1. 无参调用：获取技能根目录
    const rootRes = await skillApi.paths()
    expect(rootRes.ok).toBe(true)
    expect(typeof rootRes.root).toBe('string')
    expect(rootRes.root).toContain('skills')

    // 2. 带 skillId 调用：获取指定技能的标准物理路径结构
    const detailRes = await skillApi.paths('my-new-skill')
    expect(detailRes.ok).toBe(true)
    expect(detailRes.root).toBe(rootRes.root)
    expect(detailRes.dir).toContain('my-new-skill')
    expect(detailRes.scriptsDir).toContain('scripts')
    expect(detailRes.referencesDir).toContain('references')
    expect(detailRes.skillMd).toContain('SKILL.md')
  })

  it('api.skill.list 与 api.skill.read 返回物理绝对路径字段', async () => {
    setLoadedSkills([
      {
        id: 'math-assistant',
        name: '数学辅导技能',
        description: '专门辅导高数与线性代数',
        instructions: '逐步分析，推导严谨。',
        enabled: true,
        scripts: [{ name: 'plot.py', description: '绘图' }],
      },
    ])

    const log: SandboxCall[] = []
    const { api } = buildApi(dummyOpts, log)
    const skillApi = api.skill as {
      list: () => Promise<{ ok: boolean; root: string; skills: Array<{ id: string; dir: string }> }>
      read: (id: string) => Promise<{ ok: boolean; id: string; dir: string; skillMd: string; instructions: string }>
    }

    // list 包含 root 以及各个 skill 的 dir
    const listRes = await skillApi.list()
    expect(listRes.ok).toBe(true)
    expect(listRes.root).toBeDefined()
    const target = listRes.skills.find((s) => s.id === 'math-assistant')
    expect(target).toBeDefined()
    expect(target?.dir).toContain('math-assistant')

    // read 包含详细物理路径信息
    const readRes = await skillApi.read('math-assistant')
    expect(readRes.ok).toBe(true)
    expect(readRes.dir).toBe(target?.dir)
    expect(readRes.skillMd).toContain('SKILL.md')
    expect(readRes.instructions).toBe('逐步分析，推导严谨。')
  })

  it('api.skill.write 与 api.skill.delete 具备结构化创建与删除技能的权限', async () => {
    const log: SandboxCall[] = []
    const { api } = buildApi(dummyOpts, log)
    const skillApi = api.skill as {
      write: (def: Record<string, unknown>) => Promise<{ ok: boolean; id: string; dir?: string }>
      delete: (id: string) => Promise<{ ok: boolean; id: string }>
    }

    const writeRes = await skillApi.write({
      id: 'unit-skill-test',
      name: '单元测试创建的技能',
      description: '动态创建技能',
      instructions: '技能执行内容',
    })
    expect(writeRes.ok).toBe(true)
    expect(writeRes.id).toBe('unit-skill-test')
    expect(writeRes.dir).toContain('unit-skill-test')

    const delRes = await skillApi.delete('unit-skill-test')
    expect(delRes.ok).toBe(true)
    expect(delRes.id).toBe('unit-skill-test')
  })

  it('api.files.* 能够正确识别与读写技能目录下的相对路径 (skills/...)', async () => {
    const log: SandboxCall[] = []
    const { api } = buildApi(dummyOpts, log)
    const filesApi = api.files as {
      write: (path: string, content: string) => Promise<{ ok: boolean; path: string }>
      read: (path: string) => Promise<{ ok: boolean; content: string }>
      list: (path: string) => Promise<{ ok: boolean; entries?: unknown[] }>
    }

    // 相对路径 skills/abc.md
    const writeRes = await filesApi.write('skills/test-custom/SKILL.md', '---\nname: 测试\n---\n内容')
    expect(writeRes.ok).toBe(true)
    // 写入路径必须位于根目录的 skills/ 下，不得错位到 users/<uid>/ 下
    const normalizedPath = writeRes.path.replace(/\\/g, '/')
    expect(normalizedPath).not.toContain('/users/')
    expect(normalizedPath).toMatch(/skills\/test-custom\/SKILL\.md$/)

    // 读取该路径
    const readRes = await filesApi.read('skills/test-custom/SKILL.md')
    expect(readRes.ok).toBe(true)
  })

  it('formatSkillsDiscoveryPrompt 系统提示词包含技能根目录与权限指导', async () => {
    const skillsRoot = await getSkillsAbsPath()
    const prompt = formatSkillsDiscoveryPrompt([], skillsRoot)

    expect(prompt).toContain('专业技能系统与可用专业技能库 (Available Skills)')
    expect(prompt).toContain(skillsRoot)
    expect(prompt).toContain('完全读写与执行权限')
    expect(prompt).toContain('api.skill.paths(id?)')
  })

  it('buildTeacherSystem 系统提示词保持恒定，绝不因技能增删修改而破坏前缀缓存', () => {
    const baseSystem = buildTeacherSystem({ goalQuestion: '学习量子力学' })

    // 无论技能列表如何变动，buildTeacherSystem 结果完全一致
    const systemWithSkills = buildTeacherSystem({
      goalQuestion: '学习量子力学',
      skills: [
        {
          id: 'new-skill',
          name: '新技能',
          description: '刚刚安装的技能',
          instructions: '不要把我看进系统提示词',
          enabled: true,
        },
      ],
      skillsRoot: 'C:\\Users\\test\\skills',
    })

    expect(systemWithSkills).toBe(baseSystem)
  })

  it('易变技能列表通过动态上下文消息按需注入，且在新技能产生时增量更新', () => {
    const initialSkills = [
      {
        id: 'skill-1',
        name: '技能一',
        description: '描述一',
        instructions: '执行一',
        enabled: true,
      },
    ]

    const digest1 = getSkillsDigest(initialSkills)
    expect(digest1).toBeTruthy()

    // 1. 初次会话，没有历史 skillsDigest，必须触发注入
    expect(needsSkillsAnnounce([], digest1)).toBe(true)

    // 2. 注入之后，下一轮在同一指纹下不再重复注入
    const msg1 = skillsAnnounceMessage(initialSkills, 'E:\\skills', Date.now(), 'uuid-1', digest1)
    expect(msg1.hidden).toBe(true)
    expect(msg1.skillsDigest).toBe(digest1)
    expect(needsSkillsAnnounce([msg1], digest1)).toBe(false)

    // 3. 用户动态新增或修改了技能，指纹变化，自动触发更新注入
    const updatedSkills = [
      ...initialSkills,
      {
        id: 'skill-2',
        name: '技能二',
        description: '描述二',
        instructions: '执行二',
        enabled: true,
      },
    ]
    const digest2 = getSkillsDigest(updatedSkills)
    expect(digest2).not.toBe(digest1)
    expect(needsSkillsAnnounce([msg1], digest2)).toBe(true)

    // 4. 更新注入的消息标记为已更新
    const msg2 = skillsAnnounceMessage(updatedSkills, 'E:\\skills', Date.now(), 'uuid-2', digest2, true)
    expect(msg2.mark).toBe('专业技能库已更新')
    expect(needsSkillsAnnounce([msg1, msg2], digest2)).toBe(false)
  })
})

