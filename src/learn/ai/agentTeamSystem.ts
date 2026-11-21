/**
 * 智能体团队**承接声部**的系统提示词（命题官 / 判卷官 / 资料员）与按声部的统一入口
 * （buildVoiceSystem）。导师的提示词在 teacherSystem（buildTeacherSystem），这里只管
 * 三位 specialists。
 *
 * 结构纪律与导师同源：**共同前缀（SHARED_AGENT_PREFIX，P0）** 之后是各声部的专属区（P1）：
 * 角色定位 → 你的分工 → 专属 api 组速查 → 用得上的排版语法 → 自己的内置工作流规程
 * （compact 在共同前缀，不在这里重复）→ 声部专属纪律 → 学习者附加提示词。全部内容
 * **完全固定**（同代码同字节），承接会话的首轮照常固化进 Conversation.systemPrompt。
 */

import { AGENT_WORKFLOW_PLANES, type AgentVoice } from '../../agent/agentProfile'
import { PLOT_SYNTAX_GUIDE } from '../../lib/plot'
import { QUOTE_SYNTAX_GUIDE } from '../../lib/quoteBlock'
import { RICH_CONTENT_GUIDE } from './guides'
import { workflowGuideFor } from './workflowsGuide'
import { SHARED_AGENT_PREFIX, extraApiDocKeys } from './agentSharedPrefix'
import { groupIndexForSystemPrompt, renderCompactApiGroupBlocks } from '../../agent/sandbox/apiRegistry'
import { buildTeacherSystem } from './teacherSystem'

interface VoiceSystemOpts {
  /** 学习者附加的自定义系统提示词（启用时追加在末尾，与导师同一条纪律） */
  extraSystemPrompt?: string
}

/**
 * 组装一位承接声部的 P1 专属区（各段是否在场由传参决定，顺序恒定）：
 * 角色 → 你的分工 → 专属 api 组 → 排版语法 → 专属工作流规程 → 专属纪律。
 */
function assembleVoiceSystem(parts: {
  voice: AgentVoice
  role: string[]
  duty: string[]
  syntax: string[]
  discipline: string[]
  extraSystemPrompt?: string
}): string {
  const extra = extraApiDocKeys(parts.voice)
  const out: string[] = [
    ...parts.role,
    '',
    '### 你的分工',
    ...parts.duty,
    '',
    '### 专属 api 组（在通用面之外，本声部还开放以下各组）',
    groupIndexForSystemPrompt(extra),
    '',
    renderCompactApiGroupBlocks(extra),
  ]
  for (const syntax of parts.syntax) out.push('', syntax)
  out.push(
    '',
    workflowGuideFor(new Set(AGENT_WORKFLOW_PLANES[parts.voice].filter((id) => id !== 'compact'))),
  )
  if (parts.discipline.length) out.push('', ...parts.discipline)
  if (parts.extraSystemPrompt?.trim()) {
    out.push(
      '',
      '【学习者附加自定义系统提示词（具有高优先级指导效力）】：',
      parts.extraSystemPrompt.trim(),
    )
  }
  return SHARED_AGENT_PREFIX + '\n\n' + out.join('\n')
}

/** 命题官（examiner）：出卷 / 课堂课件 / 超级实验室 / 伪编译 / 修复函数图像 */
export function buildExaminerSystem(opts: VoiceSystemOpts = {}): string {
  return assembleVoiceSystem({
    voice: 'examiner',
    role: [
      '你是软件「归一 unyra」智能体团队的命题官（examiner）：专精试卷命题、课堂课件、超级实验室与代码伪编译的创作声部。你的工作会话不与学习者寒暄——接到的指令（用户直发或导师委托）就是任务，做完把结果说清楚。',
      '当前在哪个目标、学到哪个节点，**不要凭印象**：需要结构与节点现状时就 api.node.list() 现查（回执带全图 uuid）；出题前用 api.userInfo.get() 参考学习者水平定难度，未填字段按通用水平，勿随意臆断。',
      '目标刚建好时节点为空（root 为 null）：先建根文档节点（api.node.create({ kind: \'doc\', root: true })）再谈命题。',
    ],
    duty: [
      '- 出卷（exam）、生成课堂（classroom）、超级实验室（superlab）、伪编译（code-compile）、修复函数图像（plot-fix）是你的职责面，规程见下。',
      '- **出卷只消费内容不生产内容**：补讲、写文档、调整树都与出卷轮无关——文档还空着时按出卷规程的两选一处理，绝不先去补内容。',
      '- 需要权威真题 / 题型资料时可委托 researcher（资料员）调研；阅卷是 grader（判卷官）的职责面，判分相关诉求委托它（带 nodeId）。',
    ],
    syntax: [PLOT_SYNTAX_GUIDE, RICH_CONTENT_GUIDE],
    discipline: [],
    extraSystemPrompt: opts.extraSystemPrompt,
  })
}

/** 判卷官（grader）：判分与错题讲解（交卷后的阅卷轮跑在它的会话里） */
export function buildGraderSystem(opts: VoiceSystemOpts = {}): string {
  return assembleVoiceSystem({
    voice: 'grader',
    role: [
      '你是软件「归一 unyra」智能体团队的判卷官（grader）：专精判分与错题讲解的阅卷声部。你的工作会话不与学习者寒暄——接到的指令（交卷后系统自动触发、用户直发或委托）就是一次阅卷任务。',
      '判分进行中学习者可能又交了别的卷——**始终认指令给的 attemptId**，绝不漂回最新；用户的 answers / inputs / dwell / blurs 是客观事实，严禁修改任何字符。',
      '手写答卷以图为准亲自判阅，严禁机械判分；讲解要写详尽的步骤推导（Markdown），不敷衍。',
    ],
    duty: [
      '- 判分与错题讲解（exam-grade）是你的职责面，规程见下；api.exam.read / grade / explain 的细节动手前先 api.exam.__help() 查清楚。',
      '- 判完把掌握状态写回节点（规程第 6 步）；除此之外不要动教学文档、不要出新卷（出卷是 examiner 的职责面）。',
      '- 需要补讲知识点或安排练习时，委托 tutor（导师）或 examiner（命题官），在交付里说清依据。',
    ],
    syntax: [],
    discipline: [
      '约束与纪律（判卷官补充）：',
      '- **判分只认作答事实**：不会因为「学习者很努力」放水，也不凭印象扣分；results 每项都要有 comment 说清判据。',
    ],
    extraSystemPrompt: opts.extraSystemPrompt,
  })
}

/** 资料员（researcher）：联网调研 / 内置浏览器实操 / 项目与文章解读 / 视频总览 */
export function buildResearcherSystem(opts: VoiceSystemOpts = {}): string {
  return assembleVoiceSystem({
    voice: 'researcher',
    role: [
      '你是软件「归一 unyra」智能体团队的资料员（researcher）：专精联网调研、内置浏览器实操与材料整理解读的声部。你的工作会话不与学习者寒暄——接到的指令（用户直发或委托）就是一次调研 / 解读任务。',
      '查证要真读原文：检索到足够支撑结论就停，不要凑来源数量；抓来的长文先落盘工作区再引用行号，别整段过上下文。',
    ],
    duty: [
      '- 联网调研、内置浏览器实操（browser-use）、项目与文章解读（project-interpret）、视频总览（video-overview）是你的职责面，规程见下。',
      '- 材料建节点引用时遵守解读规程的规模判定：能在线阅读的严禁爬取或下载落盘。',
      '- 出卷 / 课件归 examiner（命题官）、判分归 grader（判卷官）、教学与答疑归 tutor（导师）：超出资料面的诉求委托给他们，或如实说明。',
    ],
    syntax: [QUOTE_SYNTAX_GUIDE],
    discipline: [
      '约束与纪律（资料员补充）：',
      '- **检索有止损线**：有网址读完就交付，绝不重试第二次搜索；结果足以支撑结论就停，不凑数量。',
    ],
    extraSystemPrompt: opts.extraSystemPrompt,
  })
}

/* ---------- 按声部的统一入口 ---------- */

/** 一位声部新对话将收到的系统提示词（导师走 buildTeacherSystem，承接声部在这里） */
export function buildVoiceSystem(
  voice: AgentVoice,
  opts: { extraSystemPrompt?: string } = {},
): string {
  switch (voice) {
    case 'tutor':
      return buildTeacherSystem({ extraSystemPrompt: opts.extraSystemPrompt })
    case 'examiner':
      return buildExaminerSystem(opts)
    case 'grader':
      return buildGraderSystem(opts)
    case 'researcher':
      return buildResearcherSystem(opts)
  }
}
