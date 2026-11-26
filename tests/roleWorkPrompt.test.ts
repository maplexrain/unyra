import { describe, expect, it } from 'vitest'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { buildExaminerSystem, buildResearcherSystem } from '../src/learn/ai/agentTeamSystem'
import { workDelegationSectionFor } from '../src/learn/ai/apiPromptSections'

describe('role / work 对外一体与汇报纪律', () => {
  it('role 共同提示词要求按团队整体回答能力，不甩内部层级、不先否认再改口', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('对外只有一个「我」')
    expect(text).toContain('不要先否定能力、下一轮再改口')
    expect(text).toContain('我看一下 / 我来读取')
    expect(text).toContain('这项我暂时做不了')
    expect(text).toContain('不解释是 role 还是 work 缺能力')
    expect(text).not.toContain('我这边没有 xx 工具可调用')
    expect(text).not.toContain('工具在 work 层')
  })

  it('work 交付文案不把 role/work 分层写给用户看', () => {
    expect(buildWorkSystem('tutor')).toContain('对外由 role 统一成「我」')
    expect(buildWorkSystem('tutor')).not.toContain('role 只拿到附件元信息')
  })

  it('role 对用户汇报要求一两句话，细节放 detail', () => {
    expect(buildTeacherSystem()).toContain('给用户的汇报必须短')
    expect(buildTeacherSystem()).toContain('一两句话')
    expect(buildFreeChatSystem()).toContain('text 控制在一两句话')
  })

  it('role 遇到超出职责的问题先跨 role/work 对齐上下文，不凭当前记忆硬答', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('超出职责就先去对齐上下文')
    expect(text).toContain('严禁凭记忆硬答')
    expect(text).toContain('私聊来源走 agent 通道')
    expect(text).toContain('群聊来源在群里')
    expect(text).toContain('api.work.status')
    expect(text).toContain('只补上下文、不要执行新任务')
    expect(text).toContain('拿到对方的回复后再回答用户')
    expect(text).toContain('我去确认一下，稍等')
  })

  it('work 主动用 ask，并在调研缺口时先回 role 转交 researcher', () => {
    const text = buildWorkSystem('tutor')
    expect(text).toContain('需要用户拍板就主动用 `api.ask`')
    expect(text).toContain('调研缺口先回 role')
    expect(text).toContain('【需要转交·调研】')
    expect(text).toContain('由 role 经当前通道委派 researcher')
  })

  it('role 看得到 work 的能力面，但明确自己调不到、只能委派', () => {
    const tutor = buildTeacherSystem()
    expect(tutor).toContain('### work 能做什么（只能委派，role 自己调不到）')
    expect(tutor).toContain('`node`（节点宇宙）')
    expect(tutor).toContain('**这些 api 不在 role 的沙箱里**')
    expect(tutor).toContain('只有 `tmp / work / chat` + `compact`')
    expect(tutor).toContain('api.work.create')
    expect(tutor).toContain('api.work.send')
    expect(tutor).toContain('api.host.send')
    expect(tutor).toContain('你只能 `work.create` / `work.send` 派，不能直接调')
    expect(tutor).toContain('`api.exam.read()` / `api.browser.waitFor()`')

    const examSurface = workDelegationSectionFor('examiner')
    expect(examSurface).toContain('`exam`（')
    expect(examSurface).toContain('`ask`')
    expect(workDelegationSectionFor('tutor')).not.toContain('`browser`（')
    const researchSurface = workDelegationSectionFor('researcher')
    expect(researchSurface).toContain('`browser`（内置浏览器）')
    expect(researchSurface).not.toContain('`exam`（')
    expect(buildResearcherSystem()).toContain('`browser`（内置浏览器）')
    expect(buildExaminerSystem()).toContain('`exam`（')
  })
})
