/**
 * work 系统提示词的组装用例（buildWorkSystem，见 src/learn/ai/workSystem）。
 *
 * 领域规则与围栏语法都属于 work：role 只负责沟通与调度，不再背这些执行细节。
 * **教学文档 / 笔记 / 超级文档 / 试卷之外的交付物统一进 workspace 目录**——
 * 规则在 work 系统提示词（每轮必在场，不靠按需注入）。
 */
import { describe, expect, it } from 'vitest'

import { buildWorkSystem } from '../src/learn/ai/workSystem'

const system = buildWorkSystem('tutor')

describe('产物归属规则（用户定的）', () => {
  it('非文档类产物统一进工作区：规则在系统提示词里，且给了准确路径出处', () => {
    expect(system).toContain('非文档类产物统一进工作区')
    // 准确的「怎么写」出处：api.workspace 组速查里的寻址规则（省略 path = 当前节点）
    expect(system).toContain('api.workspace.*')
    expect(system).toContain('省略 path 是当前节点')
  })

  it('路径索引里也有节点工作区一行（executeGuide 的组索引给出 api.workspace）', () => {
    expect(system).toContain('api.workspace — 工作区')
  })
})

describe('work 能力缺口与跨 role 转交', () => {
  it('work 明确知道自己缺能力时要交回 role，不能硬做；交接协议写进提示词', () => {
    expect(system).toContain('能力不够就交回 role 转交')
    expect(system).toContain('联网检索')
    expect(system).toContain('【需要转交】')
    expect(system).toContain('role 会转给对应 role')
    expect(system).toContain('交接请求')
    expect(system).toContain('最终交付')
  })
})

describe('内置围栏语法指引（plot / pisc / mermaid / videos / quote / aiqa）', () => {
  it('系统提示词包含全部内置围栏语法指引：plot、pisc、mermaid、videos、quote、aiqa', () => {
    expect(system).toContain('```plot')
    expect(system).toContain('```pisc')
    expect(system).toContain('```mermaid')
    expect(system).toContain('```videos')
    expect(system).toContain('```quote')
    expect(system).toContain('```aiqa')
    expect(system).toContain('@文件路径(起始行-结束行)')
  })
})
