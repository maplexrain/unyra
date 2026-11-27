// @vitest-environment node
/**
 * role / work 两层的提示词暴露面对账（用户定稿）：
 * - role 只拿「对外沟通 + 对内调度 + 固定联网」的固定面（tmp / web / work / chat + compact / fetch），
 *   其他领域组、语法、工作流规程、排版配方全部不下发到 role；
 * - work 拿本 role 的领域面 + 语法 + 工作流 + 纪律，是唯一执行层。
 * 任何能力面或提示词装配改动都跑这里。
 */
import { describe, expect, it } from 'vitest'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildDispatcherSystem, buildExaminerSystem, buildDesignerSystem, buildResearcherSystem, buildFixerSystem } from '../src/learn/ai/agentTeamSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import { AGENT_API_PLANES, FIXED_API_PLANE, type AgentProfileId, type AgentVoice } from '../src/agent/agentProfile'

const build = (v: AgentVoice): string =>
  v === 'tutor'
    ? buildTeacherSystem()
    : v === 'dispatcher'
      ? buildDispatcherSystem()
      : v === 'examiner'
        ? buildExaminerSystem()
        : v === 'designer'
          ? buildDesignerSystem()
          : v === 'researcher'
            ? buildResearcherSystem()
            : buildFixerSystem()

const ROLE_DOMAIN_GROUPS = [
  'node', 'memory', 'schedule', 'workspace', 'userInfo', 'method', 'wf', 'chip',
  'browser', 'mcp', 'ui', 'host', 'permission', 'files', 'process', 'skill', 'video',
  'project', 'exam', 'classroom', 'design',
]

describe('role 层：只暴露沟通与调度面', () => {
  for (const voice of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentVoice[]) {
    it(voice + ': 只有固定组与固定联网面，没有其他领域组', () => {
      const text = build(voice)
      const held = AGENT_API_PLANES[voice].groups
      expect(held).toEqual(['tmp', 'web', 'work', 'chat', 'agent', 'delivery'])
      expect(AGENT_API_PLANES[voice].topLevel).toEqual(['see', 'ask', 'compact', 'fetch'])
      for (const g of held) expect(text).toContain('#### api.' + g + ' —')
      for (const g of ROLE_DOMAIN_GROUPS) {
        expect(text, voice + ' 不该出现 ' + g).not.toContain('#### api.' + g + ' —')
      }
      // role 的对外通道与派活面恒在
      expect(text).toContain('api.work.list')
      expect(text).toContain('api.chat.send')
      // 角色 prompt 不再背执行规程、语法与排版配方
      expect(text).not.toContain('【开讲】')
      expect(text).not.toContain('【出卷】试卷命题')
      expect(text).not.toContain('【生成课堂】课堂课件生成')
      expect(text).not.toContain('【修复函数图像】Plot')
      expect(text).not.toContain('### 2. 结构化组件')
      expect(text).not.toContain('```plot')
      expect(text).not.toContain('### 非固定组（本 role 专属）')
    })
  }

  it('researcher / fixer 的 role 也固定持有交付登记（不再只在 work 面）', () => {
    expect(buildResearcherSystem()).toContain('#### api.delivery —')
    expect(buildFixerSystem()).toContain('#### api.delivery —')
    expect(buildResearcherSystem()).toContain('api.delivery.submit')
    expect(buildFixerSystem()).toContain('api.delivery.submit')
  })

  it('role 固定面是所有挂目标 role 的交集：tmp / web / work / chat / agent / delivery + see / ask / fetch / compact', () => {
    expect(FIXED_API_PLANE.groups).toEqual(['tmp', 'web', 'work', 'chat', 'agent', 'delivery'])
    expect(FIXED_API_PLANE.topLevel).toEqual(['see', 'ask', 'compact', 'fetch'])
  })
})

describe('work 层：领域能力、语法与规程都在这里', () => {
  for (const role of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentProfileId[]) {
    it(role + ': work 提示词带本 role 的领域面', () => {
      const text = buildWorkSystem(role)
      expect(text).toContain('你是 role 派出的内部工作会话（work）')
      expect(text).toContain('api.host.send')
      // tutor work 要有 node / workspace；examiner work 要有 exam；designer 要有 classroom
      if (role === 'tutor') {
        expect(text).toContain('#### api.node —')
        expect(text).toContain('#### api.workspace —')
      }
      if (role === 'examiner') expect(text).toContain('#### api.exam —')
      if (role === 'designer') expect(text).toContain('#### api.classroom —')
      if (role === 'researcher') {
        expect(text).toContain('#### api.browser —')
        expect(text).toContain('`fetch(url')
      }
    })
  }

  it('每个 work 都固定持有 web 与 fetch', () => {
    for (const role of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentProfileId[]) {
      const text = buildWorkSystem(role)
      expect(text, role).toContain('#### api.web —')
      expect(text, role).toContain('api.web.search')
      expect(text, role).toContain('fetch(url')
    }
  })

  it('每个 work 都固定持有 see / ask / delivery（不只领域组）', () => {
    for (const role of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentProfileId[]) {
      const text = buildWorkSystem(role)
      expect(text).toContain('#### api.delivery —')
      expect(text).toContain('see(url |')
      expect(text).toContain('ask({ title?, questions })')
      expect(text).toContain('借用所属 role 的身份')
    }
  })

  it('工作流规程只在 work：fixer 有修复节，设计师有课堂与实验', () => {
    expect(buildWorkSystem('fixer')).toContain('【修复函数图像】')
    expect(buildWorkSystem('fixer')).not.toContain('【阅卷】')
    expect(buildWorkSystem('designer')).toContain('【生成课堂】')
    expect(buildWorkSystem('designer')).toContain('【超级实验室】')
    expect(buildWorkSystem('designer')).not.toContain('【阅卷】')
    expect(buildWorkSystem('examiner')).toContain('【阅卷】')
    expect(buildWorkSystem('examiner')).not.toContain('【生成课堂】')
  })

  it('排版配方与围栏语法只在内容类 work', () => {
    for (const role of ['tutor', 'examiner', 'designer'] as AgentProfileId[]) {
      const text = buildWorkSystem(role)
      expect(text).toContain('### 2. 结构化组件')
      expect(text).toContain('```plot')
    }
    for (const role of ['dispatcher', 'researcher', 'fixer'] as AgentProfileId[]) {
      expect(buildWorkSystem(role)).not.toContain('### 2. 结构化组件')
    }
  })
})

describe('装配顺序与缓存前缀', () => {
  it('API 段排在共同基础前缀之后、身份定位之前', () => {
    for (const voice of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentVoice[]) {
      const text = build(voice)
      expect(text.startsWith(SHARED_AGENT_PREFIX)).toBe(true)
      const fixedAt = text.indexOf('### 沙箱 API 速查')
      const roleAt = text.indexOf('你是「归一 Unyra」')
      expect(fixedAt).toBeGreaterThan(SHARED_AGENT_PREFIX.length)
      expect(roleAt).toBeGreaterThan(fixedAt)
      expect(text).not.toContain('### 非固定组（本 role 专属）')
    }
    const free = buildFreeChatSystem()
    expect(free.indexOf('【工具与沙箱能力】')).toBeLessThan(free.indexOf('你是「归一 Unyra」的自由对话助手'))
  })

  it('固定组段六位 role 逐字节一致', () => {
    const fixedOf = (text: string): string => {
      const start = text.indexOf('### 沙箱 API 速查')
      const stop = text.indexOf('<identity>')
      return text.slice(start, stop)
    }
    const baseline = fixedOf(buildTeacherSystem())
    for (const voice of ['dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentVoice[]) {
      expect(fixedOf(build(voice)), voice).toBe(baseline)
    }
  })
})
