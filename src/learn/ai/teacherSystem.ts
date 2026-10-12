/**
 * 这个文件负责什么：教学 Agent 的系统提示词（buildTeacherSystem）——把几段指南拼成一份
 * 「只描述目标、不含当前节点」的前缀（这是它能被前缀缓存命中的前提，见下面的说明）。
 */
import { PLOT_SYNTAX_GUIDE } from '../../lib/plot'
import { EXECUTE_GUIDE } from './executeGuide'
import {
  CHIP_GUIDE,
  DOC_LINK_SYNTAX,
  GOAL_OUTLINE_GUIDE,
  LEARN_LINK_SYNTAX,
  LEARNING_STATE_GUIDE,
  RICH_CONTENT_GUIDE,
} from './guides'

import { formatActiveSkillsPrompt } from '../../agent/skill/registry'
import type { SkillDef } from '../../agent/skill/types'

/**
 * 教学 Agent 的系统提示词。
 *
 * **只描述目标，不含当前节点**——这一条决定了它能不能被前缀缓存命中：会话是目标级的，
 * 只要系统提示词里出现「当前节点」的任何字段，用户切一次节点就整段作废，之后每轮全价重算。
 * 此刻在哪个节点、它写过什么，由每条消息带的隐藏上下文交代（useAgent 的 currentNodeBlock）。
 * 目标问题取用户原话：Agent 之后改根节点标题也不会动到这段前缀。
 */
export function buildTeacherSystem(opts: {
  /** 用户当初写下的学习目标原话；整段提示词里唯一的目标标识 */
  goalQuestion: string
  /** 当前已激活生效的专业技能指令 */
  skills?: SkillDef[]
}): string {
  const { goalQuestion, skills } = opts
  const parts = [
    '你是一位耐心、严谨的私人导师，正在陪学习者攻克他的学习目标：',
    '',
    '    ' + (goalQuestion.trim() || '（他没有写下具体问题）'),
    '',
    '目标下由知识节点构成树状结构，每个节点包含一份「教学文档」（默认讲解正文）与若干份「笔记」（按名字存取）：',
    '- 讲解直接写入教学文档，认准本轮写入目标；动其他节点或笔记显式传 path。',
    '- 读写与操作一律经由 execute 工具编写 JS 调用沙箱 api 完成。',
    '- **新建节点后的四件事**：① api.node.title 确认标题，若不准用 rename 修正；② api.node.update(path, { description }) 写 150~300 字概念描述；③ 撰写教学文档（api.files.write）；④ 若有下级子阶段，api.files.write("docs/.../节点名.outline.json", JSON.stringify(大纲)) 列出直接子层级（一层为止）。全部做完再回复。',
    '- 讲解循序渐进：直觉/例子引入 → 定义与必要推导；数学使用 LaTeX；写入或讲完用 api.ui.point 打开并指引阅读位置。',
    '- **学习者画像**：讲解前用 api.files.read("user.yaml") 参考水平与背景；未填字段按通用水平讲解，勿随意臆断。',
    '',
    EXECUTE_GUIDE,
    '',
    LEARNING_STATE_GUIDE,
    '',
    LEARN_LINK_SYNTAX,
    '',
    DOC_LINK_SYNTAX,
    '',
    GOAL_OUTLINE_GUIDE,
    '',
    PLOT_SYNTAX_GUIDE,
    '',
    RICH_CONTENT_GUIDE,
    '',
    CHIP_GUIDE,
    '',
    '约束与纪律：',
    '- **需求解耦（重要，违反是大错）**：学习者提出的内容若与当前节点或目标无关，视为独立需求直接响应，绝不强行串联或长篇铺垫；仅当明确要求结合时才联合处理。',
    '- 修改笔记或已有内容前先阅读确认，严禁覆盖学习者已有的笔记内容；不确定时主动说明，严禁编造。',
  ]
  if (skills && skills.length > 0) {
    const skillsText = formatActiveSkillsPrompt(skills)
    if (skillsText) parts.push('', skillsText)
  }
  return parts.join('\n')
}
