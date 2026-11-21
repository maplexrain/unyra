// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest'
import { normalizeAgentSettings, loadAgentSettings, type AgentSettings } from '../src/agent/settings'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { buildExaminerSystem, buildGraderSystem, buildResearcherSystem } from '../src/learn/ai/agentTeamSystem'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import {
  agentAvatarIdOf,
  agentRuntimeApiAllow,
  agentWfGrant,
  resolveAgentGlobal,
  updateAgentProfile,
  resetAgentProfile,
  profileOf,
  AGENT_TEAM_IDS,
  AGENT_WORKFLOW_PLANES,
  DEFAULT_AGENT_AVATAR,
  voiceForWorkflow,
  type AgentProfileId,
} from '../src/agent/agentProfile'
import { hydrateUserSettings } from '../src/lib/userSettings'
import { voiceOfConversation, voiceConversationId } from '../src/learn/agentTeam/voiceConvs'
import { migrateConversation } from '../src/learn/compact'
import { makeModelEntry, type AiSettings } from '../src/ai/settings'

/* ---------- 归一化：profiles 白名单 ---------- */

describe('AgentSettings.profiles 归一化', () => {
  it('逐字段白名单重建：认得的字段透传、空壳不存', () => {
    const next = normalizeAgentSettings({
      profiles: {
        tutor: { name: '小导师', avatar: 'bot', effort: 'low', junk: 'x' },
        free: { name: '' },
        ghost: { name: '不认识的声部整个丢弃' },
        broken: null,
      },
    })
    expect(next.profiles?.tutor).toEqual({ name: '小导师', avatar: 'bot', effort: 'low' })
    expect(next.profiles?.free).toBeUndefined()
    expect((next.profiles as Record<string, unknown>)['ghost']).toBeUndefined()
    expect((next.profiles as Record<string, unknown>)['broken']).toBeUndefined()
  })

  it('apiGroups 已定稿作废：存了也不透传；workflows 清单照常保留', () => {
    const next = normalizeAgentSettings({
      profiles: {
        tutor: {
          apiGroups: ['web', 3, '  ', 'node'],
          workflows: ['wf_missing'],
          effort: 'ultra',
          providerId: ' p1 ',
          model: ' m1 ',
        },
      },
    })
    // execute 能力面由架构固定（全部恒开放只读）：旧版存的清单在归一化里静默作废
    expect((next.profiles?.tutor as Record<string, unknown>)['apiGroups']).toBeUndefined()
    expect(next.profiles?.tutor?.workflows).toEqual(['wf_missing'])
    expect(next.profiles?.tutor?.effort).toBeUndefined()
    expect(next.profiles?.tutor?.providerId).toBe(' p1 ')
    expect(next.profiles?.tutor?.model).toBe(' m1 ')
  })

  it('只剩作废字段的 profile 整条不存（空壳不落盘）', () => {
    const next = normalizeAgentSettings({ profiles: { tutor: { apiGroups: ['web'] } } })
    expect(next.profiles?.tutor).toBeUndefined()
  })

  it('没传 profiles 时给空对象（缺什么补什么）', () => {
    expect(normalizeAgentSettings({}).profiles).toEqual({})
    expect(normalizeAgentSettings(null).profiles).toEqual({})
  })
})

/* ---------- 读写 ---------- */

describe('agentProfile 读写', () => {
  beforeEach(async () => {
    await hydrateUserSettings(null)
  })

  it('updateAgentProfile 合并覆盖、清除字段、空壳删除', () => {
    updateAgentProfile('tutor', { name: '小导师', avatar: 'bot' })
    expect(loadAgentSettings().profiles?.tutor).toEqual({ name: '小导师', avatar: 'bot' })

    // undefined = 清除该覆盖；还剩 name，所以整条保留
    updateAgentProfile('tutor', { avatar: undefined })
    expect(loadAgentSettings().profiles?.tutor).toEqual({ name: '小导师' })

    // 最后一个字段清掉 → 整条删除，不留空壳
    updateAgentProfile('tutor', { name: undefined })
    expect(loadAgentSettings().profiles?.tutor).toBeUndefined()
  })

  it('resetAgentProfile 整条恢复默认；profileOf 缺省给空对象', () => {
    updateAgentProfile('free', { effort: 'low' })
    expect(profileOf(loadAgentSettings(), 'free')).toEqual({ effort: 'low' })
    resetAgentProfile('free')
    expect(profileOf(loadAgentSettings(), 'free')).toEqual({})
    // 恢复一条本来就不存在的 profile 是无害空操作
    resetAgentProfile('tutor')
    expect(loadAgentSettings().profiles).toEqual({})
  })

  it('agentAvatarIdOf 认不出的 id 回默认头像', () => {
    expect(agentAvatarIdOf(undefined, 'tutor')).toBe(DEFAULT_AGENT_AVATAR.tutor)
    expect(agentAvatarIdOf({ avatar: 'flask' }, 'free')).toBe('flask')
    expect(agentAvatarIdOf({ avatar: 'nope' }, 'free')).toBe(DEFAULT_AGENT_AVATAR.free)
  })
})

/* ---------- 运行时解析 ---------- */

const AI_BASE: AiSettings = {
  version: 3,
  providers: [
    {
      id: 'p1',
      kind: 'provider',
      label: 'P1',
      baseUrl: '',
      apiKey: 'k1',
      models: [makeModelEntry('m1', { contextWindow: 1000 }), makeModelEntry('m2')],
    },
    {
      id: 'p2',
      kind: 'custom',
      compat: 'openai',
      label: 'P2',
      baseUrl: 'https://p2.example',
      apiKey: 'k2',
      models: [makeModelEntry('m3')],
    },
  ],
  global: { providerId: 'p1', model: 'm1', effort: 'medium' },
}

describe('resolveAgentGlobal（提供商-模型-档位覆盖）', () => {
  it('无覆盖时与全局默认逐字一致', () => {
    const g = resolveAgentGlobal(AI_BASE, {})
    expect(g.provider.id).toBe('p1')
    expect(g.model).toBe('m1')
    expect(g.effort).toBe('medium')
  })

  it('显式覆盖生效：提供商 / 模型 / 档位各取各的', () => {
    const g = resolveAgentGlobal(AI_BASE, { providerId: 'p2', model: 'm3', effort: 'low' })
    expect(g.provider.id).toBe('p2')
    expect(g.model).toBe('m3')
    expect(g.effort).toBe('low')
  })

  it('只覆盖模型：提供商沿用全局，模型必须属于它', () => {
    const g = resolveAgentGlobal(AI_BASE, { model: 'm2' })
    expect(g.provider.id).toBe('p1')
    expect(g.model).toBe('m2')
    expect(g.effort).toBe('medium')
  })

  it('提供商覆盖指向不存在的 id：回落全局默认', () => {
    const g = resolveAgentGlobal(AI_BASE, { providerId: 'nope', model: 'm9' })
    expect(g.provider.id).toBe('p1')
    expect(g.model).toBe('m1')
  })

  it('模型不属于生效提供商：回落该提供商的默认模型', () => {
    const g = resolveAgentGlobal(AI_BASE, { providerId: 'p2', model: 'm1' })
    expect(g.provider.id).toBe('p2')
    expect(g.model).toBe('m3')
  })
})

/* ---------- 工作流白名单 ---------- */

describe('agentWfGrant（工作流授权面：内置规程面按分工固定 + 登记白名单只归导师）', () => {
  const settings = (profiles: AgentSettings['profiles']): AgentSettings =>
    normalizeAgentSettings({ profiles })

  it('导师：内置面 = 分工面；登记清单没配 = null（全部可用）', () => {
    const g = agentWfGrant(settings(undefined), 'tutor')
    expect(g.builtin.has('teach-node')).toBe(true)
    expect(g.builtin.has('exam')).toBe(false)
    expect(g.registered).toBeNull()
    expect(agentWfGrant(settings({ tutor: { name: 'x' } }), 'tutor').registered).toBeNull()
  })

  it('导师：清单 → 小写 id 集合；空清单 = 登记的一个都不许（内置面不受影响）', () => {
    const g = agentWfGrant(settings({ tutor: { workflows: ['Exam', ' recall '] } }), 'tutor')
    expect(g.registered?.has('exam')).toBe(true)
    expect(g.builtin.has('teach-node')).toBe(true)
    expect(agentWfGrant(settings({ tutor: { workflows: [] } }), 'tutor').registered?.size).toBe(0)
  })

  it('承接声部：内置面 = 各自分工面；登记条目一概不放（固定面）', () => {
    const examiner = agentWfGrant(settings(undefined), 'examiner')
    expect(examiner.builtin.has('exam')).toBe(true)
    expect(examiner.builtin.has('classroom')).toBe(true)
    expect(examiner.builtin.has('teach-node')).toBe(false)
    expect(examiner.registered?.size).toBe(0)
    const grader = agentWfGrant(settings(undefined), 'grader')
    expect(grader.builtin.has('exam-grade')).toBe(true)
    expect(grader.builtin.has('compact')).toBe(true)
    expect(grader.builtin.has('outline')).toBe(false)
    const researcher = agentWfGrant(settings(undefined), 'researcher')
    expect(researcher.builtin.has('browser-use')).toBe(true)
    expect(researcher.builtin.has('project-interpret')).toBe(true)
    expect(researcher.builtin.has('exam')).toBe(false)
    expect(agentWfGrant(settings({ examiner: { workflows: ['exam'] } }), 'examiner').registered?.size).toBe(0)
  })

  it('运行时 apiAllow：组名 + 顶层函数，core 不进运行时清单', () => {
    const allow = agentRuntimeApiAllow('examiner')
    expect(allow).toContain('node')
    expect(allow).toContain('classroom')
    expect(allow).toContain('fetch')
    expect(allow).toContain('see')
    expect(allow).not.toContain('core')
    expect(allow).not.toContain('exam')
    const grader = agentRuntimeApiAllow('grader')
    expect(grader).toContain('exam')
    expect(grader).not.toContain('web')
    expect(grader).not.toContain('fetch')
    expect(grader).toContain('wait')
    expect(grader).not.toContain('ask')
  })

  it('voiceForWorkflow：内置规程按分工面反查声部；登记条目归导师', () => {
    expect(voiceForWorkflow('exam')).toBe('examiner')
    expect(voiceForWorkflow('exam-grade')).toBe('grader')
    expect(voiceForWorkflow('browser-use')).toBe('researcher')
    expect(voiceForWorkflow('teach-node')).toBe('tutor')
    expect(voiceForWorkflow('wf_custom')).toBe('tutor')
    // 全部执行声部都内置 compact（自动压缩不分声部）
    expect(AGENT_WORKFLOW_PLANES.tutor).toContain('compact')
    expect(AGENT_WORKFLOW_PLANES.examiner).toContain('compact')
    expect(AGENT_WORKFLOW_PLANES.grader).toContain('compact')
    expect(AGENT_WORKFLOW_PLANES.researcher).toContain('compact')
  })
})

describe('profiles 声部 id 契约', () => {
  it('认 5 位声部（free / tutor / examiner / grader / researcher，与 agent team 左栏同形）', () => {
    const ids: AgentProfileId[] = ['free', 'tutor', 'examiner', 'grader', 'researcher']
    for (const id of ids) {
      expect(DEFAULT_AGENT_AVATAR[id]).toBeTruthy()
    }
    expect(AGENT_TEAM_IDS).toEqual(ids)
  })
})

/* ---------- 系统提示词：按声部分工拼装 ---------- */

describe('系统提示词（团队分工：导师分诊、承接声部各拿各的规程）', () => {
  it('导师提示词：教学规程与速查在场，创作域 / 阅卷域已分诊出去', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('#### api.web')
    expect(text).toContain('【开讲】教学文档生成（teach-node）')
    expect(text).toContain('你是软件「归一 unyra」的智能导师助手')
    // 团队协作与分诊口径在场
    expect(text).toContain('api.team.list()')
    expect(text).toContain('委托 examiner（命题官）')
    expect(text).toContain('委托 grader（判卷官')
    // 分出去的域：速查与规程都不在导师的提示词里
    expect(text).not.toContain('#### api.exam')
    expect(text).not.toContain('【出卷】试卷命题（exam）')
    expect(text).not.toContain('【生成课堂】课堂课件生成（classroom）')
  })

  it('命题官提示词：创作域规程齐、教学域不在', () => {
    const text = buildExaminerSystem()
    expect(text).toContain('命题官')
    expect(text).toContain('【出卷】试卷命题（exam）')
    expect(text).toContain('【生成课堂】课堂课件生成（classroom）')
    expect(text).toContain('【修复函数图像】Plot 错误快速纠偏（plot-fix）')
    expect(text).toContain('#### api.classroom')
    expect(text).toContain('api.team.complete')
    expect(text).not.toContain('【开讲】教学文档生成（teach-node）')
    expect(text).not.toContain('#### api.exam ')
  })

  it('判卷官提示词：阅卷规程在、出卷与联网不在', () => {
    const text = buildGraderSystem()
    expect(text).toContain('判卷官')
    expect(text).toContain('【阅卷】判分与讲解（exam-grade）')
    expect(text).toContain('#### api.exam')
    expect(text).not.toContain('【出卷】试卷命题（exam）')
    // 通用面在共同前缀里（api.web 等通用组四份都在场）；判卷官的专属面只有 exam
    expect(text).toContain('- api.exam — 考试（作答侧）')
    expect(text).not.toContain('- api.memory —')
    expect(text).not.toContain('- api.browser —')
    expect(text).toContain('始终认指令给的 attemptId')
  })

  it('资料员提示词：调研域规程齐、判卷不在', () => {
    const text = buildResearcherSystem()
    expect(text).toContain('资料员')
    expect(text).toContain('替用户操作内置浏览器')
    expect(text).toContain('【项目与文章解读】源码与文章逐段精读（project-interpret）')
    expect(text).toContain('#### api.browser')
    expect(text).not.toContain('【阅卷】判分与讲解（exam-grade）')
    expect(text).not.toContain('#### api.exam')
  })

  it('自由聊天提示词恒定（能力面由架构固定）', () => {
    const text = buildFreeChatSystem()
    expect(text).toContain('api.web.search')
    expect(text).toContain('api.schedule.*')
  })

  it('voiceOfConversation：voice 字段 > 确定性 id 里自带的声部 > 导师（漏标愈合）', () => {
    // 老数据 / 导师对话：没有 voice 字段兜导师
    expect(voiceOfConversation(undefined)).toBe('tutor')
    expect(voiceOfConversation({ id: 'uuid-1', goalId: 'g', messages: [] } as never)).toBe('tutor')
    // 承接声部字段在场
    expect(voiceOfConversation({ id: 'x', goalId: 'g', voice: 'grader', messages: [] } as never)).toBe('grader')
    // 漏标但确定性 id 自带声部：就地愈合（真机踩过：命题官会话被归进导师桶）
    expect(voiceOfConversation({ id: voiceConversationId('g', 'examiner'), goalId: 'g', messages: [] } as never)).toBe('examiner')
  })

  it('migrateConversation 载入修复：漏标 voice 的承接会话就地补标（幂等）', () => {
    const detId = voiceConversationId('g1', 'examiner')
    const healed = migrateConversation({
      id: detId,
      goalId: 'g1',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      systemPrompt: '固化提示词',
    })
    expect(healed.voice).toBe('examiner')
    // 再跑一遍幂等（字段已在）
    expect(migrateConversation(healed).voice).toBe('examiner')
    // uuid 老会话没有 voice、提示词也认不出声部：保持导师缺省
    const untouched = migrateConversation({
      id: 'uuid-2',
      goalId: 'g1',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      systemPrompt: '你是软件「归一 unyra」的智能导师助手',
    })
    expect(untouched.voice).toBeUndefined()
    // uuid 老会话 + 承接声部的固化提示词：按角色行修（中间版本漏标的口径）
    const byPrompt = migrateConversation({
      id: 'uuid-3',
      goalId: 'g1',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      systemPrompt: '## 智能体团队协作你是软件「归一 unyra」智能体团队的判卷官（grader）：专精判分与错题讲解的阅卷声部。',
    })
    expect(byPrompt.voice).toBe('grader')
  })

  it('四位执行声部共享逐字节相同的共同前缀（SHARED_AGENT_PREFIX）', () => {
    const prompts = [
      buildTeacherSystem(),
      buildExaminerSystem(),
      buildGraderSystem(),
      buildResearcherSystem(),
    ]
    for (const text of prompts) {
      expect(text.startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    }
    // 共同前缀里该有的九块都在：团队协作 / execute 机制 / 先查再用 / 应用数据 /
    // 沙箱纪律 / 通用速查 / 引用与交付 / 通用纪律 / compact 规程
    expect(SHARED_AGENT_PREFIX).toContain('## 智能体团队协作（team.*）')
    expect(SHARED_AGENT_PREFIX).toContain('核心执行工具是 execute')
    expect(SHARED_AGENT_PREFIX).toContain('**先查再用**')
    expect(SHARED_AGENT_PREFIX).toContain('**应用数据一律走 api 组，files.* 不许碰**')
    expect(SHARED_AGENT_PREFIX).toContain('**调用形态与沙箱纪律**')
    expect(SHARED_AGENT_PREFIX).toContain('### 沙箱 API 速查（签名 + 用法边界）')
    expect(SHARED_AGENT_PREFIX).toContain('引用与交付登记纪律：')
    expect(SHARED_AGENT_PREFIX).toContain('约束与纪律：')
    expect(SHARED_AGENT_PREFIX).toContain('【压缩上下文】长会话交接摘要（compact）')
    // 专属组不进共同前缀
    expect(SHARED_AGENT_PREFIX).not.toContain('#### api.exam —')
    expect(SHARED_AGENT_PREFIX).not.toContain('#### api.classroom —')
    expect(SHARED_AGENT_PREFIX).not.toContain('#### api.browser —')
  })
})

