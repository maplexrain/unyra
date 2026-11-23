// @vitest-environment node
/**
 * 提示词暴露面与实际持面的对账（用户铁律：暴露的 api 与工作流取决于声部本身持有哪些）。
 * 每位声部的系统提示词：持有的组必须出现在速查里、没持有的绝不出现；顶层函数、
 * 引用/交付段、工作流规程同口径。提示词装配或分工面改动跑这里。
 */
import { describe, expect, it } from 'vitest'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildDispatcherSystem, buildExaminerSystem, buildDesignerSystem, buildResearcherSystem, buildFixerSystem } from '../src/learn/ai/agentTeamSystem'
import { AGENT_API_PLANES, type AgentVoice } from '../src/agent/agentProfile'

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
      const all = ['node', 'memory', 'schedule', 'tmp', 'workspace', 'userInfo', 'method', 'wf', 'chip', 'delivery', 'web', 'browser', 'mcp', 'ui', 'subagent', 'permission', 'files', 'process', 'skill', 'video', 'project', 'team', 'exam', 'classroom', 'design']
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
      // **不变量**：team 是被委托方收口交付（api.team.complete）的唯一通道——
      // 每一位执行声部都必须持有，谁丢了 team 谁就无法交付
      expect(held).toContain('team')
      expect(text).toContain('api.team.complete')
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
