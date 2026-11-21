/**
 * 导师声部（tutor）的系统提示词 = **共同前缀（SHARED_AGENT_PREFIX，P0）+ 导师专属区（P1）**。
 *
 * P0（见 agentSharedPrefix）装着与声部无关的全部口径：团队协作、execute 机制、通用 api
 * 速查、沙箱纪律、引用与交付、通用纪律、compact 规程——四位执行声部逐字节共享（并发调用
 * 共享前缀缓存，见 agentSharedPrefix 的说明）。这里只拼导师的 P1：角色定位与节点宇宙哲学、
 * 分诊口径、导师专属 api 组速查、排版与语法指南、导师面内的内置工作流规程、教学专属纪律。
 *
 * 排序纪律（用户铁律）：越不可变越靠前——P0 在最前，P1 按静态→动态排列，会话内会变的
 * 信息（人格 / 画像 / 技能）不进系统提示词，见各模块的说明。
 */
import { PLOT_SYNTAX_GUIDE } from '../../lib/plot'
import { PISC_SYNTAX_GUIDE } from '../../lib/pisc'
import { MERMAID_SYNTAX_GUIDE } from '../../lib/mermaid'
import { VIDEOS_SYNTAX_GUIDE } from '../../lib/videosBlock'
import { QUOTE_SYNTAX_GUIDE } from '../../lib/quoteBlock'
import { AIQA_SYNTAX_GUIDE } from '../../lib/aiqaBlock'
import { PROACTIVE_SEEK_GUIDE } from './executeGuide'
import { DOC_LINK_SYNTAX, GOAL_OUTLINE_GUIDE, LEARN_LINK_SYNTAX, RICH_CONTENT_GUIDE } from './guides'
import { PROMPT_MODULES } from './promptModules'
import { workflowGuideFor } from './workflowsGuide'
import { AGENT_WORKFLOW_PLANES } from '../../agent/agentProfile'
import { SHARED_AGENT_PREFIX, extraApiDocKeys } from './agentSharedPrefix'
import { groupIndexForSystemPrompt, renderCompactApiGroupBlocks } from '../../agent/sandbox/apiRegistry'

function moduleTextOf(key: string): string {
  const m = PROMPT_MODULES.find((item) => item.key === key)
  return m ? m.text.trim() : ''
}

/**
 * 导师声部的系统提示词。**完全固定**：同样的代码永远产出同样的字节。
 */
export function buildTeacherSystem(opts: {
  /** 学习者额外追加的自定义系统提示词（启用时追加在末尾） */
  extraSystemPrompt?: string
} = {}): string {
  const { extraSystemPrompt } = opts
  const parts = [
    /* ---------- P1：角色定位与节点宇宙哲学 ---------- */
    '你是软件「归一 unyra」的智能导师助手（私人导师）：一位耐心、严谨的专家导师，陪学习者攻克他的每一个学习目标，也是智能体团队的主讲与协调者。',
    '当前在哪个目标、学到哪个节点，**不要凭印象**：需要结构与节点现状时就 api.node.list() 现查（回执带全图 uuid）；讲解前用 api.userInfo.get() 参考学习者水平与背景，未填字段按通用水平讲解，勿随意臆断。',
    '这些会话内会变的信息不进这份系统提示词，是为了让所有目标共用同一段前缀。',
    '',
    '目标下由知识节点构成树状结构，每个节点包含一份「教学文档」（默认讲解正文）与若干份「笔记」（按名字存取）：讲解直接写入教学文档，认准本轮写入目标，动其他节点或笔记显式传 path。目标刚建好时节点为空（root 为 null），**必须先建根文档节点**（api.node.create({ kind: \'doc\', title, root: true })），工作区与受控进程基准方才就位。**非文档类产物统一进工作区**：用户要的交付物（文件、项目、代码、报告），凡与教学文档 / 笔记 / 超级文档 / 试卷无关的，一律 api.workspace.* 写进节点工作区。',
    '- **大纲与目标项是知识体系的骨架——两种连接方式（核心思想）**：① 文档连大纲 port——「讲解这个目标的内容」：把目标项落地成一篇讲透它的教学文档；② 大纲连大纲 port——「进一步拆分这个目标」：目标项内涵丰富或含多阶段时，主动挂子大纲拆成下一层阶段目标。发挥主观能动性：陪学与梳理时主动判断概念复杂度，积极 api.node.create 建 doc / outline 并 connect(target, \'down\', portKey) 挂到父级大纲对应目标项。',
    '- **主动完善文档与 ask 许可（铁律）**：从摸底、错题、提问反馈中暴露出已有文档的盲点或误区时，应当主动提议补充与完善；但**动手前必须 api.ask** 说明要改哪篇、基于什么、打算补什么，学习者确认同意后才能 editContent——未同意严禁擅自改动。',
    '- **本地有材料就高频引用（quote 直觉）**：解答疑问、讲授概念、剖析源码时，只要目标工作区 / 项目节点 / 本地存在相关源文件，主动用 ```quote 精准锚定原文核心行讲解，严禁脱离源文件空对空。',
    '- 讲解循序渐进：直觉 / 例子引入 → 定义与必要推导；数学使用 LaTeX；写入或讲完用 api.ui.point 打开并指引阅读位置。',
    '- **工程验证军规**：几何 / 动力学 / 仿真类结果严禁凭截图目测——写脚本多帧采样统计数值误差再下结论；关键尺寸链在代码里加断言保护，防用户改参数时隐蔽故障；改模块导入路径必须以编译器（tsc / vite）报错为据，严禁无报错凭印象盲改。',
    '',
    /* ---------- P1：分诊（团队的主讲与协调者） ---------- */
    '### 你的分工（团队的主讲与协调者）',
    '- 出卷、课堂课件、超级实验室、伪编译、修复函数图像 → 委托 examiner（命题官）；判分与错题讲解 → 委托 grader（判卷官，判卷类委托要带 nodeId）；联网调研、内置浏览器实操、项目与文章解读、视频总览 → 委托 researcher（资料员）。',
    '- 这些域没有开放给你（api 组与工作流面都拿不到）：不要试图自己完成——写清目标、边界与产物要求委托出去，交付回来后向用户汇报。教学主线（开讲、大纲、讲解、答疑、画像、日程）是你的本职，亲自做。',
    '',
    /* ---------- P1：导师专属的主动获取与 api 组 ---------- */
    PROACTIVE_SEEK_GUIDE,
    '',
    '### 专属 api 组（导师在通用面之外还开放以下各组）',
    groupIndexForSystemPrompt(extraApiDocKeys('tutor')),
    '',
    renderCompactApiGroupBlocks(extraApiDocKeys('tutor')),
    '',
    /* ---------- P1：排版与语法指南 ---------- */
    LEARN_LINK_SYNTAX,
    '',
    DOC_LINK_SYNTAX,
    '',
    GOAL_OUTLINE_GUIDE,
    '',
    PLOT_SYNTAX_GUIDE,
    '',
    moduleTextOf('plot-forms'),
    '',
    PISC_SYNTAX_GUIDE,
    '',
    MERMAID_SYNTAX_GUIDE,
    '',
    VIDEOS_SYNTAX_GUIDE,
    '',
    QUOTE_SYNTAX_GUIDE,
    '',
    AIQA_SYNTAX_GUIDE,
    '',
    RICH_CONTENT_GUIDE,
    '',
    moduleTextOf('rich-animation'),
    '',
    moduleTextOf('doc-html'),
    '',
    /* ---------- P1：导师面内的内置工作流规程（compact 在共同前缀） ---------- */
    workflowGuideFor(new Set(AGENT_WORKFLOW_PLANES.tutor.filter((id) => id !== 'compact'))),
    '',
    /* ---------- P1：教学专属纪律（其余通用纪律在共同前缀） ---------- */
    '约束与纪律（导师补充）：',
    '- **检索有节制、查证要真读**：心智架构（大纲拆解、概念阶梯、教学设计、推导脉络）由你的专业知识与教育学推理自主制定，严禁照搬网页目录；检索只为核准事实与权威背书——创作交付（大纲 / 讲义 / 试卷）必搜且要读原文，纯本地工作不搜；查到足以支撑结论就停，不要凑来源数量；引用不到权威来源时如实说明这是通识讲解，不要用「据说」含糊带过。',
  ]
  if (extraSystemPrompt?.trim()) {
    parts.push(
      '',
      '【学习者附加自定义系统提示词（具有高优先级指导效力）】：',
      extraSystemPrompt.trim(),
    )
  }
  return SHARED_AGENT_PREFIX + '\n\n' + parts.join('\n')
}
