/**
 * 系统提示词的组装用例（buildTeacherSystem，见 src/learn/ai/teacherSystem）。
 *
 * 目前只钉用户定下的一条产物归属规则：**教学文档 / 笔记 / 超级文档 / 试卷之外的
 * 交付物（文件、项目、代码等）统一进 workspace 目录**——模型不能把它们散落到
 * 数据目录别处。规则在系统提示词（每轮必在场，不靠按需注入），读写规范在
 * 「工作区」提示词模块（首次碰 workspace 时注入）。
 */
import { describe, expect, it } from 'vitest'

import { buildTeacherSystem } from '../src/learn/ai/teacherSystem'

const system = buildTeacherSystem({ goalQuestion: '我想弄懂微积分' })

describe('产物归属规则（用户定的）', () => {
  it('非文档类产物统一进工作区：规则在系统提示词里，且给了准确路径出处', () => {
    expect(system).toContain('非文档类产物统一进工作区')
    expect(system).toContain('workspaceDir')
    expect(system).toContain('workspace/')
  })

  it('路径索引里也有节点工作区一行（executeGuide 的那份清单）', () => {
    expect(system).toContain('docs/:goal/.../workspace/:filename')
  })
})
