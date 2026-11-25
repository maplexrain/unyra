import { describe, expect, it } from 'vitest'
import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'
import { buildWorkSystem } from '../src/learn/ai/workSystem'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'

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
    expect(text).toContain('api.chat.send({ channel: "agent"')
    expect(text).toContain('api.chat.send({ channel: "group"')
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
})
