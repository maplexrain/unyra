/**
 * 目标级知识库类型定义：
 * 存储于目标目录下的 knowledge.json 中，为整个学习目标所有文档共享。
 * 渲染时自动在正文中全局匹配字符，凡出现该词条之处均进行引用与标注。
 */

export interface GoalKnowledgeItem {
  id: string
  term: string
  summary: string
  sourceNodeId?: string
  createdAt: number
  updatedAt?: number
}
