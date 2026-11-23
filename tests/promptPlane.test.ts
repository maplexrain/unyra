// @vitest-environment node
/**
 * 提示词暴露面与实际持面的对账（用户铁律：暴露的 api 与工作流取决于声部本身持有哪些）。
 * 每位声部的系统提示词：持有的组必须出现在速查里、没持有的绝不出现；顶层函数、
 * 引用/交付段、工作流规程同口径。提示词装配或分工面改动跑这里。
 */
import { describe, expect, it } from 'vitest'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildDispatcherSystem, buildExaminerSystem, buildDesignerSystem, buildResearcherSystem, buildFixerSystem } from '../src/learn/ai/agentTeamSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import { AGENT_API_PLANES, FIXED_API_PLANE, type AgentVoice } from '../src/agent/agentProfile'

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

describe('提示词暴露面 = 实际持面', () => {
  for (const voice of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentVoice[]) {
    it(voice + ': 持有的组都在、没持有的绝不出现', () => {
      const text = build(voice)
      const held = AGENT_API_PLANES[voice].groups
      const all = ['node', 'memory', 'schedule', 'tmp', 'workspace', 'userInfo', 'method', 'wf', 'chip', 'delivery', 'web', 'browser', 'mcp', 'ui', 'work', 'chat', 'host', 'permission', 'files', 'process', 'skill', 'video', 'project', 'exam', 'classroom', 'design']
      for (const g of held) {
        expect(text).toContain('#### api.' + g + ' —')
      }
      for (const g of all.filter((g) => !held.includes(g))) {
        expect(text, voice + ' 不该出现 ' + g).not.toContain('#### api.' + g + ' —')
      }
      // 顶层函数按面：tutor 无 fetch；fixer 只有 wait/compact；researcher 有 fetch/see
      const top = AGENT_API_PLANES[voice].topLevel
      if (!top.includes('fetch')) expect(text).not.toContain('`fetch(url')
      if (!top.includes('see')) expect(text).not.toContain('`see(')
      if (!top.includes('ask')) expect(text).not.toContain('`ask({ title?, questions })`')
      if (!top.includes('tiktok')) expect(text).not.toContain('`tiktok()`')
      // 交付/引用段按持有
      if (!held.includes('chip')) expect(text).not.toContain('api.chip.build')
      if (!held.includes('delivery')) expect(text).not.toContain('api.delivery.submit')
      // **不变量**：每位 role 都能派 work、都能用 chat.send 对外发消息——
      // 谁丢了这两组，谁就不再有外发通道与工作层
      expect(held).toContain('work')
      expect(held).toContain('chat')
      expect(text).toContain('api.work.list')
      expect(text).toContain('api.chat.send')
    })
  }
  it('researcher: 有交付登记、无 chip；fixer: 两段都无', () => {
    expect(buildResearcherSystem()).toContain('交付登记纪律：')
    expect(buildResearcherSystem()).not.toContain('引用与交付登记纪律：')
    expect(buildFixerSystem()).not.toContain('交付登记纪律：')
    expect(buildFixerSystem()).not.toContain('引用与交付登记纪律：')
  })
  it('工作流规程按面：fixer 只有 plot-fix 节，课堂与实验只在设计师', () => {
    const fixer = buildFixerSystem()
    expect(fixer).toContain('【修复函数图像】')
    expect(fixer).not.toContain('【阅卷】')
    expect(fixer).not.toContain('【生成课堂】')
    expect(buildResearcherSystem()).not.toContain('【阅卷】')
    expect(buildResearcherSystem()).not.toContain('【生成课堂】')
    expect(buildExaminerSystem()).toContain('【阅卷】')
    expect(buildExaminerSystem()).not.toContain('【生成课堂】')
    const designer = buildDesignerSystem()
    expect(designer).toContain('【生成课堂】')
    expect(designer).toContain('【超级实验室】')
    expect(designer).not.toContain('【阅卷】')
  })
})

describe('固定组 / 非固定组：切分口径、顺序与缓存前缀', () => {
  it('固定能力面是六位执行 role 的交集（tmp / work / chat + wait / compact）', () => {
    expect(FIXED_API_PLANE.groups).toEqual(['tmp', 'work', 'chat'])
    expect(FIXED_API_PLANE.topLevel).toEqual(['wait', 'compact'])
  })

  it('API 段排在共同基础前缀之后、身份定位之前', () => {
    for (const voice of ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentVoice[]) {
      const text = build(voice)
      expect(text.startsWith(SHARED_AGENT_PREFIX)).toBe(true)
      const fixedAt = text.indexOf('### 固定组（全员共用）')
      const roleAt = text.indexOf('你是「归一 Unyra」')
      expect(fixedAt).toBeGreaterThan(SHARED_AGENT_PREFIX.length)
      expect(roleAt).toBeGreaterThan(fixedAt)
      // 六位执行声部都至少有一个专属域（fixer 的 node 也是非固定组）：非固定组同样落在身份定位之前
      const variableAt = text.indexOf('### 非固定组（本 role 专属）')
      expect(variableAt).toBeGreaterThan(fixedAt)
      expect(variableAt).toBeLessThan(roleAt)
    }
    // 仅聊天同样「API 先于身份」
    const free = buildFreeChatSystem()
    expect(free.indexOf('【工具与沙箱能力】')).toBeLessThan(free.indexOf('你是「归一 Unyra」的聊天龟'))
  })

  it('固定组段逐字节一致（六位执行声部共用同一缓存前缀）', () => {
    const fixedOf = (text: string): string => {
      const start = text.indexOf('### 沙箱 API 速查')
      const end = text.indexOf('\n\n### 非固定组（本 role 专属）')
      const tail = text.indexOf('\n\n- 以上就是你的全部 api 组与顶层函数')
      const stop = end >= 0 ? end : tail >= 0 ? tail : text.indexOf('\n\n你是「归一 Unyra」')
      return text.slice(start, stop)
    }
    const baseline = fixedOf(buildTeacherSystem())
    for (const voice of ['dispatcher', 'examiner', 'designer', 'researcher', 'fixer'] as AgentVoice[]) {
      expect(fixedOf(build(voice)), voice).toBe(baseline)
    }
  })

  it('内容声部共用排版指南：P0 之后、固定组 API 之前，且三声部逐字节一致', () => {
    const typographyOf = (text: string): string => {
      const start = text.indexOf('### 结构化教学排版组件（```component 围栏）')
      const stop = text.indexOf('### 沙箱 API 速查')
      return text.slice(start, stop)
    }
    const baseline = typographyOf(buildTeacherSystem())
    for (const voice of ['tutor', 'examiner', 'designer'] as AgentVoice[]) {
      const text = build(voice)
      const typoAt = text.indexOf('### 结构化教学排版组件（```component 围栏）')
      const fixedAt = text.indexOf('### 沙箱 API 速查')
      expect(typoAt).toBeGreaterThan(SHARED_AGENT_PREFIX.length)
      expect(typoAt).toBeLessThan(fixedAt)
      expect(typographyOf(text), voice).toBe(baseline)
    }
    // 非内容声部不背这段排版配方（避免给不出文档的声部灌噪声）
    for (const voice of ['dispatcher', 'researcher', 'fixer'] as AgentVoice[]) {
      expect(build(voice), voice).not.toContain('### 结构化教学排版组件（```component 围栏）')
    }
  })
})
