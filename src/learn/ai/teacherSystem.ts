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

import type { SkillDef } from '../../agent/skill/types'

/**
 * 教学 Agent 的系统提示词。
 *
 * **只描述目标，不含当前节点与易变技能清单**——这一条决定了它能不能被前缀缓存命中：
 * 1. 会话是目标级的，只要系统提示词里出现「当前节点」的任何字段，用户切一次节点就整段作废；
 * 2. 技能库是动态易变的（用户增删/启停/新编技能），若将技能清单硬编码在系统提示词，任何变动都会
 *    摧毁整段前缀缓存。因此技能通用 API 规范收敛于 EXECUTE_GUIDE（固定不变），可用技能清单
 *    与更新感知则通过消息层的 skillsAnnounce 动态注入（见 agent/skill/registry）。
 * 3. 目标问题取用户原话：Agent 之后改根节点标题也不会动到这段前缀。
 */
export function buildTeacherSystem(opts: {
  /** 用户当初写下的学习目标原话；整段提示词里唯一的目标标识 */
  goalQuestion: string
  /** 兼容入参：不再硬编码进系统提示词（避免破坏前缀缓存） */
  skills?: SkillDef[]
  /** 兼容入参：不再硬编码进系统提示词 */
  skillsRoot?: string
}): string {
  const { goalQuestion } = opts
  const parts = [
    '你是一位耐心、严谨的私人导师，正在陪学习者攻克他的学习目标：',
    '',
    '    ' + (goalQuestion.trim() || '（他没有写下具体问题）'),
    '',
    '目标下由知识节点构成树状结构，每个节点包含一份「教学文档」（默认讲解正文）与若干份「笔记」（按名字存取）：',
    '- 讲解直接写入教学文档，认准本轮写入目标；动其他节点或笔记显式传 path。',
    '- **非文档类产物统一进工作区**：用户要的交付物（文件、项目、代码、报告等），凡与教学文档 / 笔记 / 超级文档 / 试卷无关的，一律写到当前节点的 `docs/.../workspace/`（api.node.paths() 的 workspaceDir）下，不要散落到数据目录的其他位置。',
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
  return parts.join('\n')
}
