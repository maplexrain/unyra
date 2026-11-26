// @vitest-environment node
import { describe, expect, it, beforeEach } from 'vitest'
import { normalizeAgentSettings, loadAgentSettings, type AgentSettings } from '../src/agent/settings'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { buildDispatcherSystem, buildExaminerSystem, buildDesignerSystem, buildResearcherSystem, buildFixerSystem } from '../src/learn/ai/agentTeamSystem'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import {
  type AgentVoice,
  agentAvatarIdOf,
  agentRuntimeApiAllow,
  CONTENT_VOICES,
  DEFAULT_AGENT_NAME,
  agentWfGrant,
  resolveAgentGlobal,
  updateAgentProfile,
  resetAgentProfile,
  profileOf,
  AGENT_ROLE_IDS,
  AGENT_VOICES,
  AGENT_WORKFLOW_PLANES,
  DEFAULT_AGENT_AVATAR,
  voiceForWorkflow,
  type AgentProfileId,
} from '../src/agent/agentProfile'
import { hydrateUserSettings } from '../src/lib/userSettings'
import { roleOfConversation, roleConversationId } from '../src/learn/roleWork/roles'
import { migrateConversation } from '../src/learn/compact'
import { makeModelEntry, type AiSettings } from '../src/ai/settings'

/* ---------- 归一化：profiles 白名单 ---------- */

describe('AgentSettings.profiles 归一化', () => {
  it('逐字段白名单重建：认得的字段透传、空壳不存', () => {
    const next = normalizeAgentSettings({
      profiles: {
        tutor: { name: '小导师', avatar: 'bot', bio: '  负责主讲与协调  ', effort: 'low', junk: 'x' },
        free: { name: '' },
        ghost: { name: '不认识的声部整个丢弃' },
        broken: null,
      },
    })
    expect(next.profiles?.tutor).toEqual({ name: '小导师', avatar: 'bot', bio: '负责主讲与协调', effort: 'low' })
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
    updateAgentProfile('tutor', { effort: 'low' })
    expect(profileOf(loadAgentSettings(), 'tutor')).toEqual({ effort: 'low' })
    resetAgentProfile('tutor')
    expect(profileOf(loadAgentSettings(), 'tutor')).toEqual({})
    // 恢复一条本来就不存在的 profile 是无害空操作
    resetAgentProfile('examiner')
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
    expect(examiner.builtin.has('exam-grade')).toBe(true)
    expect(examiner.builtin.has('classroom')).toBe(false)
    expect(examiner.builtin.has('teach-node')).toBe(false)
    expect(examiner.registered?.size).toBe(0)
    const designer = agentWfGrant(settings(undefined), 'designer')
    expect(designer.builtin.has('classroom')).toBe(true)
    expect(designer.builtin.has('superlab')).toBe(true)
    expect(designer.builtin.has('compact')).toBe(true)
    expect(designer.builtin.has('exam')).toBe(false)
    const researcher = agentWfGrant(settings(undefined), 'researcher')
    expect(researcher.builtin.has('browser-use')).toBe(true)
    expect(researcher.builtin.has('compact')).toBe(true)
    expect(researcher.builtin.has('exam')).toBe(false)
    const fixer = agentWfGrant(settings(undefined), 'fixer')
    expect(fixer.builtin.has('plot-fix')).toBe(true)
    expect(fixer.builtin.has('compact')).toBe(true)
    expect(fixer.builtin.has('outline')).toBe(false)
    expect(agentWfGrant(settings({ examiner: { workflows: ['exam'] } }), 'examiner').registered?.size).toBe(0)
  })

  it('运行时 apiAllow：role 只有固定面，领域能力全在 work', () => {
    for (const voice of AGENT_VOICES) {
      const allow = agentRuntimeApiAllow(voice)
      expect(allow).toEqual(['tmp', 'work', 'chat', 'agent', 'compact'])
      expect(allow).not.toContain('core')
      expect(allow).not.toContain('node')
      expect(allow).not.toContain('exam')
      expect(allow).not.toContain('browser')
      expect(allow).not.toContain('classroom')
      expect(allow).not.toContain('fetch')
      expect(allow).not.toContain('see')
      expect(allow).not.toContain('wait')
      expect(allow).not.toContain('ask')
    }
    // work 面仍按 role 派生领域组（examiner 的 work 持有 exam）
    const examinerWork = buildWorkSystem('examiner')
    expect(examinerWork).toContain('#### api.exam —')
    expect(examinerWork).toContain('#### api.node —')
  })

  it('voiceForWorkflow：工作流统一经经理龟路由（AGENT_WORKFLOW_PLANES 只是规程面）', () => {
    expect(voiceForWorkflow('exam')).toBe('dispatcher')
    expect(voiceForWorkflow('exam-grade')).toBe('dispatcher')
    expect(voiceForWorkflow('plot-fix')).toBe('dispatcher')
    expect(voiceForWorkflow('browser-use')).toBe('dispatcher')
    expect(voiceForWorkflow('teach-node')).toBe('dispatcher')
    expect(voiceForWorkflow('wf_custom')).toBe('dispatcher')
    // 规程面仍在各声部（承接经理龟的委托照规程干），经理龟只有 compact
    expect(AGENT_WORKFLOW_PLANES.examiner).toContain('exam')
    expect(AGENT_WORKFLOW_PLANES.examiner).toContain('exam-grade')
    expect(AGENT_WORKFLOW_PLANES.designer).toContain('superlab')
    expect(AGENT_WORKFLOW_PLANES.dispatcher).toEqual(['compact'])
    // compact 是全员内置（自动压缩不分声部）
    for (const voice of AGENT_VOICES) {
      expect(AGENT_WORKFLOW_PLANES[voice]).toContain('compact')
    }
  })
})

describe('profiles 声部 id 契约', () => {
  it('认六位团队 role；free 只保留为无目标自由对话的运行形态', () => {
    const ids: AgentProfileId[] = ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer']
    for (const id of ids) {
      expect(DEFAULT_AGENT_AVATAR[id]).toBeTruthy()
    }
    expect(AGENT_ROLE_IDS).toEqual(ids)
    expect(DEFAULT_AGENT_NAME.free).toBe('自由对话')
    expect(DEFAULT_AGENT_AVATAR.free).toBeTruthy()
    // 所有声部都可直接交流；内容生成标签只给需要注入写作策略与画像的声部
    for (const id of ['tutor', 'examiner', 'designer'] as AgentVoice[]) {
      expect(CONTENT_VOICES.has(id)).toBe(true)
    }
    for (const id of ['dispatcher', 'researcher', 'fixer'] as AgentVoice[]) {
      expect(CONTENT_VOICES.has(id)).toBe(false)
    }
    // 经理龟与所有 role 一样：只有沟通 + 调度固定面，活交给 work
    const dispatcher = agentRuntimeApiAllow('dispatcher')
    expect(dispatcher).toEqual(['tmp', 'work', 'chat', 'agent', 'compact'])
    expect(dispatcher).not.toContain('node')
    expect(dispatcher).not.toContain('web')
    expect(dispatcher).not.toContain('delivery')
    expect(dispatcher).not.toContain('ask')
  })
})

/* ---------- 系统提示词：按声部分工拼装 ---------- */

describe('系统提示词：role 只说话与调度，work 才带领域规程', () => {
  it('导师 role 提示词：人格与分诊在场，领域规程不在', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('你是「归一 Unyra」的导师龟')
    expect(text).toContain('api.chat.send')
    expect(text).toContain('examiner')
    expect(text).toContain('designer')
    expect(text).toContain('researcher')
    expect(text).toContain('api.work.create')
    expect(text).not.toContain('api.team.delegate')
    expect(text).not.toContain('【开讲】教学文档生成（teach-node）')
    expect(text).not.toContain('#### api.node')
    expect(text).not.toContain('#### api.exam')
    expect(text).not.toContain('【出卷】试卷命题（exam）')
    expect(text).not.toContain('【生成课堂】课堂课件生成（classroom）')
  })

  it('经理龟 role 提示词：路由表齐、执行规程不在', () => {
    const text = buildDispatcherSystem()
    expect(text).toContain('经理龟')
    expect(text).toContain('路由表')
    expect(text).toContain('tutor（导师龟）')
    expect(text).toContain('examiner（做题龟）')
    expect(text).toContain('designer（设计龟）')
    expect(text).toContain('researcher（调研龟）')
    expect(text).toContain('fixer（维修龟）')
    expect(text).toContain('api.chat.send')
    expect(text).toContain('api.work.create')
    expect(text).toContain('api.work.status')
    expect(text).not.toContain('team.delegate')
    expect(text).toContain('职责边界')
    expect(text).not.toContain('【出卷】试卷命题（exam）')
    expect(text).not.toContain('【生成课堂】课堂课件生成（classroom）')
    expect(text).not.toContain('#### api.exam')
    expect(text).not.toContain('#### api.classroom')
  })

  it('承接 role 提示词：只保留人格与分工，领域能力在 work', () => {
    for (const text of [
      buildExaminerSystem(),
      buildDesignerSystem(),
      buildResearcherSystem(),
      buildFixerSystem(),
    ]) {
      expect(text).toContain('api.chat.send')
      expect(text).toContain('api.work.create')
      expect(text).not.toContain('#### api.node')
      expect(text).not.toContain('#### api.exam')
      expect(text).not.toContain('#### api.classroom')
      expect(text).not.toContain('#### api.browser')
      expect(text).not.toContain('【出卷】')
      expect(text).not.toContain('【阅卷】')
      expect(text).not.toContain('【生成课堂】')
      expect(text).not.toContain('【修复函数图像】')
    }
    // 每位 work 才拿到自己的领域面
    expect(buildWorkSystem('examiner')).toContain('#### api.exam')
    expect(buildWorkSystem('designer')).toContain('#### api.classroom')
    expect(buildWorkSystem('researcher')).toContain('#### api.browser')
    expect(buildWorkSystem('fixer')).toContain('#### api.node')
  })

  it('自由聊天 role 提示词：只有 work / chat，联网与日程在 work', () => {
    const text = buildFreeChatSystem()
    expect(text).toContain('api.work.create')
    expect(text).toContain('api.chat.send')
    expect(text).not.toContain('api.web.search')
    expect(text).not.toContain('api.schedule.*')
    // 自由对话派出的 work 才带 web / schedule
    expect(buildWorkSystem('free')).toContain('web.search(')
    expect(buildWorkSystem('free')).toContain('schedule.')
  })

  it('roleOfConversation：voice 字段 > 确定性 id 里自带的声部 > 导师（漏标愈合）', () => {
    // 老数据 / 导师对话：没有 voice 字段兜导师
    expect(roleOfConversation(undefined)).toBe('tutor')
    expect(roleOfConversation({ id: 'uuid-1', goalId: 'g', messages: [] } as never)).toBe('tutor')
    // 已退役声部（判卷官）：voice 字段与 id 段都映射到承接者命题官
    expect(roleOfConversation({ id: 'x', goalId: 'g', voice: 'grader', messages: [] } as never)).toBe('examiner')
    expect(roleOfConversation({ id: 'cv:grader:g1', goalId: 'g1', messages: [] } as never)).toBe('examiner')
    // 漏标但确定性 id 自带声部：就地愈合（真机踩过：命题官会话被归进导师桶）
    expect(roleOfConversation({ id: roleConversationId('g', 'examiner'), goalId: 'g', messages: [] } as never)).toBe('examiner')
  })

  it('migrateConversation 载入修复：漏标 voice 的承接会话就地补标（幂等）', () => {
    const detId = roleConversationId('g1', 'examiner')
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
    expect(byPrompt.voice).toBe('examiner')
  })

  it('四位执行声部共享逐字节相同的共同前缀（SHARED_AGENT_PREFIX）', () => {
    const prompts = [
      buildTeacherSystem(),
      buildExaminerSystem(),
      buildDesignerSystem(),
      buildResearcherSystem(),
      buildFixerSystem(),
    ]
    for (const text of prompts) {
      expect(text.startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    }
    // 共同前缀只装对六位声部逐字为真的块：执行机制 / 先查再用 /
    // 应用数据守门 / 通用纪律 / 说话方式 / 协作 / 通道 / compact 规程
    expect(SHARED_AGENT_PREFIX).toContain('### 1. 执行工具与沙箱纪律')
    expect(SHARED_AGENT_PREFIX).toContain('核心工具：`execute(description, body)`')
    expect(SHARED_AGENT_PREFIX).toContain('先查再用')
    expect(SHARED_AGENT_PREFIX).toContain('应用数据一律走速查列出的 api 组')
    expect(SHARED_AGENT_PREFIX).toContain('写操作失败不抛异常')
    expect(SHARED_AGENT_PREFIX).toContain('### 2. 通用纪律')
    expect(SHARED_AGENT_PREFIX).toContain('长会话交接摘要（`api.compact`）')
    // api 速查与引用交付按持有进各声部的 P1：P0 里不该出现任何组文档块与 chip/delivery
    expect(SHARED_AGENT_PREFIX).not.toContain('#### api.')
    expect(SHARED_AGENT_PREFIX).not.toContain('### 沙箱 API 速查')
    expect(SHARED_AGENT_PREFIX).not.toContain('引用与交付登记纪律：')
    expect(SHARED_AGENT_PREFIX).not.toContain('api.chip.build')
    expect(SHARED_AGENT_PREFIX).not.toContain('api.delivery.submit')
  })
})

