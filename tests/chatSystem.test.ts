import { describe, expect, it } from 'vitest'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'

describe('自由对话系统提示词 (buildFreeChatSystem)', () => {
  it('包含自由对话独立页签身份与职责定义', () => {
    const prompt = buildFreeChatSystem()
    expect(prompt).toContain('自由对话')
    expect(prompt).toContain('不是某个学习目标下的团队角色')
    expect(prompt).toContain('api.agent.list()')
    expect(prompt).not.toContain('本龟')
    expect(prompt).not.toContain('龟门')
    expect(prompt).toContain('日常闲聊、答疑解惑、概念辨析、思路启发、自由问答与交流')
  })

  it('自由对话不是团队 agent：具体任务交给 work，不亲手做也不谎报完成', () => {
    const prompt = buildFreeChatSystem()
    expect(prompt).toContain('具体任务不要亲手闷头做')
    expect(prompt).toContain('编写讲义 / 文档')
    expect(prompt).toContain('生成知识图谱')
    expect(prompt).toContain('出卷判卷')
    expect(prompt).toContain('api.work.create / api.work.send')
    expect(prompt).toContain('api.chat.send')
    expect(prompt).not.toContain('任何任务指令在此页签均视为非法越界')
  })

  it('固定组文档列出 work / chat / see / ask / delivery 调用面', () => {
    const prompt = buildFreeChatSystem()
    expect(prompt).toContain('api.work.list()')
    expect(prompt).toContain('api.work.status(name)')
    expect(prompt).toContain('api.work.kill(name)')
    expect(prompt).toContain('api.chat.send({ channel')
    expect(prompt).toContain('to?, cc?, mention?, text')
    expect(prompt).toContain('api.delivery.submit')
    expect(prompt).toContain('see(url')
    expect(prompt).toContain('ask({ title?, questions })')
  })

  it('支持附加自定义系统提示词', () => {
    const prompt = buildFreeChatSystem({ extraSystemPrompt: '始终使用文言文作答' })
    expect(prompt).toContain('始终使用文言文作答')
    expect(prompt).toContain('用户附加自定义系统提示词')
  })
})
