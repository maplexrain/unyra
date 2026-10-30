import { describe, expect, it } from 'vitest'
import { buildFreeChatSystem } from '../src/learn/ai/chatSystem'

describe('固定聊天系统提示词 (buildFreeChatSystem)', () => {
  it('包含固定聊天独立页签身份与职责定义', () => {
    const prompt = buildFreeChatSystem()
    expect(prompt).toContain('固定聊天')
    expect(prompt).toContain('日常闲聊、答疑解惑、概念辨析、思路启发、自由问答与交流')
  })

  it('包含立即终止具体任务的红线铁律与明确话术', () => {
    const prompt = buildFreeChatSystem()
    expect(prompt).toContain('严禁处理具体任务（立即终止）')
    expect(prompt).toContain('编写、修改、整理学习讲义或教学文档')
    expect(prompt).toContain('生成、调整知识图谱、节点或学习大纲')
    expect(prompt).toContain('出试卷、测评、判卷或批改作业')
    expect(prompt).toContain('项目编码、修改工程代码、在工作区创建/读写文件')
    expect(prompt).toContain('你必须立即终止该任务')
    expect(prompt).toContain('当前页签仅作为聊天，无法处理具体的任务，请打开任务处理的页签（即上方带有 task 标识的页签）进行操作。')
  })

  it('支持附加自定义系统提示词', () => {
    const prompt = buildFreeChatSystem({ extraSystemPrompt: '始终使用文言文作答' })
    expect(prompt).toContain('始终使用文言文作答')
    expect(prompt).toContain('用户附加自定义系统提示词')
  })
})
