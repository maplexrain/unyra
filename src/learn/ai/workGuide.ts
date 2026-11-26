/**
 * work 角色分工：只描述「这个 work 会做什么」，不带 role 人格。
 * 身份、执行纪律、工具与交付通道统一在 workBase.ts 的 WORK_BASE_GUIDE。
 */
export const WORK_ROLE_BRIEF: Record<'free' | 'tutor' | 'dispatcher' | 'examiner' | 'designer' | 'researcher' | 'fixer', string> = {
  free: '你是自由对话派出的通用执行 work：负责联网检索与网页抓取、日程读写，以及用户交办的具体执行任务。',
  tutor: '你是导师龟派出的教学执行 work：负责讲义/文档、大纲、讲解、答疑、学习者画像与日程等教学落地任务。',
  dispatcher: '你是经理龟派出的执行 work：负责具体、可独立完成的执行子任务（查资料、整理清单、定时提醒等），把结果交回经理龟。',
  examiner: '你是做题龟派出的出卷执行 work：负责试卷命题、判分与错题讲解，按任务给定的 attemptId 与节点执行。',
  designer: '你是设计龟派出的课堂设计 work：负责互动课堂课件与超级实验室的页面、交互与落盘执行。',
  researcher: '你是调研龟派出的调研执行 work：负责联网调研、网页抓取与内置浏览器操作，按任务范围交付结论与来源。',
  fixer: '你是维修龟派出的修复执行 work：负责函数图像语法修复（plot-fix），只动出错的那一段围栏。',
}
