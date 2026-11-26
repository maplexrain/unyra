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
    expect(text).toContain('勿先否定再改口')
    expect(text).toContain('我看一下/我来读取')
    expect(text).toContain('这项我暂时做不了')
    expect(text).toContain('绝不提 role / work / 后台 / 转交')
    expect(text).not.toContain('我这边没有 xx 工具可调用')
    expect(text).not.toContain('工具在 work 层')
  })

  it('work 交付文案不把 role/work 分层写给用户看', () => {
    expect(buildWorkSystem('tutor')).toContain('对外由 role 统一成「我」')
    expect(buildWorkSystem('tutor')).not.toContain('role 只拿到附件元信息')
  })

  it('role 对用户汇报要求短句，交付物细节用 --- 分隔', () => {
    expect(buildTeacherSystem()).toContain('汇报必须短')
    expect(buildTeacherSystem()).toContain('单独一行 `---`')
    expect(buildFreeChatSystem()).toContain('单独一行 `---`')
  })

  it('role 遇到超出职责的问题先跨 role/work 对齐上下文，不凭当前记忆硬答', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('对齐上下文，严禁硬答')
    expect(text).toContain('严禁编造')
    expect(text).toContain('仅用户私聊来源的跨 role 协作才走')
    expect(text).toContain('群聊')
    expect(text).toContain('api.work.status')
    expect(text).toContain('只补上下文、不要执行新任务')
    expect(text).toContain('等待回复时先回用户')
    expect(text).toContain('我去确认一下，稍等')
  })

  it('work 主动用 ask，并知道调研缺口要交回 role', () => {
    const text = buildWorkSystem('tutor')
    expect(text).toContain('决策确认（`api.ask`）')
    expect(text).toContain('联网检索')
    expect(text).toContain('【需要转交】')
    expect(text).toContain('建议哪个 role')
  })

  it('role 提示词写入汇报/抄送、群聊三态、交付账与波浪线转义', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('汇报与抄送是两件事')
    expect(text).toContain('直接向用户汇报')
    expect(text).toContain('cc:["委派方roleId"]')
    expect(text).toContain('只汇报用户')
    expect(text).toContain('汇报 + 抄送委派方')
    expect(text).toContain('纯抄送')
    expect(text).toContain('主楼与评论串')
    expect(text).toContain('交付账必须含 `files` + `sources`')
    expect(text).toContain('整份交付账快照')
    expect(text).toContain('\\~')
  })

  it('role 看得到 work 的能力面，但明确自己调不到、只能委派', () => {
    const tutor = buildTeacherSystem()
    expect(tutor).toContain('### work 能做什么（只能委派，role 自己调不到）')
    expect(tutor).toContain('`node`（节点宇宙）')
    expect(tutor).toContain('**这些 api 不在 role 的沙箱里**')
    expect(tutor).toContain('只有 `tmp / work / chat / agent` + `compact`')
    expect(tutor).toContain('api.work.create')
    expect(tutor).toContain('api.work.send')
    expect(tutor).toContain('api.host.send')
    expect(tutor).toContain('直接调用会被判')
    expect(tutor).not.toContain('api.exam.read() / api.browser.waitFor()')

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
