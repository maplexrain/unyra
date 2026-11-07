/**
 * 工作流域类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 一条工作流（WorkflowEntry）与工作流登记表（WorkflowBook）。
 * 本文件不依赖其他 types/ 子模块。
 */

/**
 * 一条工作流（见 learn/workflows）：**不由用户消息直接驱动**的任务模板。
 * 关键边界与 mind 一致——它**不进系统提示词**；被触发时 instruction 才以一条
 * user 消息整段进入上下文（隐藏消息，界面是一条分界条）。
 */
export interface WorkflowEntry {
  /** 稳定 id（wf_ 前缀）；触发与删除都认它，名字也能指名（大小写不敏感） */
  id: string
  /** 列表与分界条上显示的名字；同级内唯一，同名登记即覆盖 */
  name: string
  /** 一句话说明它是干什么的（列表展示 + wf.list 给模型看） */
  description: string
  /** 触发时以 user 角色整段进入上下文的完整任务指令 */
  instruction: string
  /**
   * 规程提示词（**可选**，动态提示词注入）：每次触发都要在场的「这套流程怎么干」的稳定知识
   * 与 instruction 分开——它按 wf:<id> 作键注入，**同一上下文只注一次**；之后再次触发只发
   * instruction（见 useAgent.runWorkflow 与 learn/ai/promptModules）。没写就没有这一块。
   */
  prompt?: string
  createdAt: number
  updatedAt: number
}

/**
 * 工作流登记表：global 是**跨目标**的一层（跟着用户走，存 state.json）；
 * byGoal 按目标归档（存各自目标目录的 workflow.json，与 method.json 同层同纪律）。
 * 内置工作流不在这里——它们的指令在代码里（learn/workflows 的 BUILTIN_DEFS）。
 * 思考档位曾经有每条工作流的三态配置（workflows.efforts），2026-10-25 删除：
 * 档位全应用只有全局滑条一份（翻面会让服务商整体换缓存，见 learn/effortGuard）。
 */
export interface WorkflowBook {
  global: WorkflowEntry[]
  byGoal: Record<string, WorkflowEntry[]>
}
