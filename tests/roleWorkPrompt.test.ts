import { describe, expect, it } from 'vitest'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'
import { buildDesignerSystem, buildExaminerSystem, buildResearcherSystem } from '../src/learn/ai/agentTeamSystem'
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

  it('有 work 在跑必须写内嵌状态行；要用户拍板必须委派 work 发 ask', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('每个运行中 work 的独立一行 `[标题](work: work 名)`')
    expect(text).toContain('必须委派 work 用 `api.ask` 发起结构化表单')
    expect(text).toContain('禁止长时间静默')
  })

  it('role 对外内容只走 chat.send 的 text，并带结束闸门与工具诚实纪律', () => {
    const text = buildTeacherSystem()
    expect(text).toContain('面向用户的内容不得写入回复文本，只能作为 `api.chat.send` 的 `text` 参数')
    expect(text).toContain('每轮结束前核对回执')
    expect(text).toContain('本轮若有对外结论而无 `api.chat.send` 的 `ok:true` 回执')
    expect(text).toContain('不得声称调用过本轮回执清单里没有的工具')
    expect(text).toContain('工具回执后不要再输出与 `text` 内容重复的文本')
  })

  it('导师 / 设计提示词不再介绍调研龟，联网改用全员固定 web api', () => {
    for (const text of [buildTeacherSystem(), buildDesignerSystem()]) {
      expect(text).not.toContain('调研龟')
      expect(text).not.toContain('researcher')
      expect(text).toContain('api.web.search')
      expect(text).toContain('api.fetch')
      expect(text).toContain('role 不参与内容生产')
      expect(text).toContain('不要只凭自身知识把事实写成结论')
    }
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

  it('work 知道服务端联网工具，不会用客户端 curl 冒充', () => {
    for (const role of ['tutor', 'designer', 'dispatcher'] as const) {
      const text = buildWorkSystem(role)
      expect(text).toContain('deepseek_web_search')
      expect(text).toContain('deepseek_read_url')
      expect(text).toContain('直接调用它们')
      expect(text).toContain('抓网页来代替服务端搜索')
      expect(text).toContain('服务端联网工具未声明')
      expect(text).toContain('不要用客户端 curl / api.process 伪装成服务端搜索')
    }
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
    expect(tutor).toContain('**这些领域 api 不在 role 的沙箱里**')
    expect(tutor).toContain('只有 `tmp / web / work / chat / agent / delivery` + 顶层 `see / fetch / ask / compact`')
    expect(tutor).toContain('api.work.create')
    expect(tutor).toContain('api.work.send')
    expect(tutor).toContain('api.host.send')
    expect(tutor).toContain('直接调用领域方法会被判')
    expect(tutor).not.toContain('api.exam.read() / api.browser.waitFor()')

    const examSurface = workDelegationSectionFor('examiner')
    expect(examSurface).toContain('`exam`（')
    expect(examSurface).toContain('顶层 `see / fetch / ask / compact`')
    expect(workDelegationSectionFor('tutor')).not.toContain('`browser`（')
    const researchSurface = workDelegationSectionFor('researcher')
    expect(researchSurface).toContain('`browser`（内置浏览器）')
    expect(researchSurface).not.toContain('`exam`（')
    expect(buildResearcherSystem()).toContain('`browser`（内置浏览器）')
    expect(buildExaminerSystem()).toContain('`exam`（')
  })
})
