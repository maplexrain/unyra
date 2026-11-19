import type { TeamAgent, TeamMessage } from './types'

export const DEFAULT_TEAM_AGENTS: TeamAgent[] = [
  {
    id: 'agent-tutor',
    name: '云枢导师 (Lead Tutor)',
    role: '主控架构导师',
    roleType: 'leader',
    avatar: '🎓',
    avatarBg: 'bg-gradient-to-br from-indigo-500 to-blue-600',
    color: 'indigo',
    status: 'active',
    model: 'deepseek-chat',
    systemPrompt:
      '你是学习目标的主控架构导师，负责拆解知识点脉络、调度下游专家智能体、汇总收口学习成果，并对学习者进行宏观引导。',
    capabilities: ['意图解析', '知识树拆解', '任务编排', '全局收口'],
    description: '负责教学目标顶层设计、多智能体任务拆解、全局编排与成果交付。',
    isLeader: true,
  },
  {
    id: 'agent-researcher',
    name: '溯源专员 (Research Agent)',
    role: '全网检索与查证员',
    roleType: 'researcher',
    avatar: '🔍',
    avatarBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    color: 'emerald',
    status: 'idle',
    model: 'deepseek-chat',
    systemPrompt:
      '你是文献与知识检索专员，擅长使用 web.search 与论文抓取工具获取权威定义、学术公式、前沿进展与典型实际案例。',
    capabilities: ['全网深度检索', '学术论文查证', '概念对比', '数据清洗'],
    description: '深入互联网与权威文献数据库，检索权威定义、背景推导与真实应用案例。',
  },
  {
    id: 'agent-writer',
    name: '墨笔作家 (Content Writer)',
    role: '结构化正文作家',
    roleType: 'writer',
    avatar: '✍️',
    avatarBg: 'bg-gradient-to-br from-violet-500 to-purple-600',
    color: 'violet',
    status: 'idle',
    model: 'deepseek-chat',
    systemPrompt:
      '你是内容呈现专家，精通通俗易懂的知识点讲解，严格遵循严谨规范的 Markdown 排版、KaTeX 数学公式与直观可运行代码示例。',
    capabilities: ['教学内容通俗化', 'KaTeX 公式精排', '算法代码编写', '图文卡片设计'],
    description: '将晦涩理论转化为通俗生动的结构化讲义，配齐标准 LaTeX 公式与交互式卡片。',
  },
  {
    id: 'agent-examiner',
    name: '考评官 (Assessment Agent)',
    role: '随堂测验与答疑官',
    roleType: 'examiner',
    avatar: '🎯',
    avatarBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
    color: 'amber',
    status: 'idle',
    model: 'deepseek-chat',
    systemPrompt:
      '你是学习效果诊断与出题专家，负责提炼核心易错点、高频考点，设计情境化随堂练习与自适应题目，并给出深刻解析。',
    capabilities: ['易错点提炼', '阶梯题型生成', '诊断反馈', '反思引导'],
    description: '针对核心概念提炼陷阱题与互动问答，量化学习者理解深度并即时答疑。',
  },
  {
    id: 'agent-reviewer',
    name: '准绳质检 (Quality Reviewer)',
    role: '严谨性与公式验算员',
    roleType: 'reviewer',
    avatar: '🛡️',
    avatarBg: 'bg-gradient-to-br from-rose-500 to-pink-600',
    color: 'rose',
    status: 'idle',
    model: 'deepseek-reasoner',
    systemPrompt:
      '你是严谨性把关与防幻觉审核专家，负责核实数学公式推导、代码边界测试、术语前后一致性，并对交付物进行最终质量认证。',
    capabilities: ['公式推导验算', '代码试跑核查', '防幻觉质检', '一致性校验'],
    description: '以推理模型执行严格推导检验，查核公式边界、代码可用性与格式合规。',
  },
]

export const PRESET_SIMULATION_MESSAGES: TeamMessage[] = [
  {
    id: 'msg-demo-1',
    senderId: 'user',
    senderName: '学习者 (You)',
    avatar: '👤',
    content: '我想系统掌握「支持向量机（SVM）的核技巧（Kernel Trick）」，请团队协作帮我产出一份高质量讲义和配套习题！',
    timestamp: Date.now() - 360000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-2',
    senderId: 'agent-tutor',
    senderName: '云枢导师 (Lead Tutor)',
    senderRole: '主控架构导师',
    avatar: '🎓',
    color: 'indigo',
    thought: '学习者需要学习 SVM 核技巧。该概念属于机器学习核心，包含数学映射思想（Mercer 条件）、常见核函数选型、计算优化与代码实战。任务拆解：1. 由溯源专员查证 Mercer 定理与常见核公式；2. 由墨笔作家撰写通俗讲义与 Python 示例；3. 考评官出 2 道核心概念思考题；4. 质检员验算对偶问题与核矩阵计算。',
    content:
      '收到！SVM 核技巧是高维特征映射与计算效率完美结合的典范。\n\n**团队任务分工协同启动**：\n- @溯源专员：检索 Mercer 定理充分必要条件与高斯 RBF 核超参数 $\\gamma$ 的几何物理意义；\n- @墨笔作家：以「低维线性不可分 → 高维线性可分」为叙事主线，撰写直观讲义与 Scikit-learn 代码；\n- @考评官：设计关于「维数灾难」与「无穷维希尔伯特空间」的随堂思考题；\n- @准绳质检：全程监控公式推导与对偶形式内积表达。',
    mentions: ['agent-researcher', 'agent-writer', 'agent-examiner', 'agent-reviewer'],
    timestamp: Date.now() - 300000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-3',
    senderId: 'agent-researcher',
    senderName: '溯源专员 (Research Agent)',
    senderRole: '全网检索与查证员',
    avatar: '🔍',
    color: 'emerald',
    toolsCalled: [
      {
        name: 'api.web.search',
        args: '{"query": "SVM Mercer condition RBF kernel definition"}',
        result: '查证返回 5 条权威结果：Mercer 定理保证了核函数对应某一高维空间的内积，核矩阵必须半正定。',
        ok: true,
      },
    ],
    content:
      '查证完毕！关键数学结论已沉淀：\n1. **核心本质**：核技巧无需显式计算映射函数 $\\phi(x)$，而是直接在原始低维空间计算内积 $K(x, z) = \\langle\\phi(x), \\phi(z)\\rangle$；\n2. **Mercer 定理**：只要连续对称函数 $K(x,z)$ 对应的 Gram 矩阵半正定，即可作为合法核函数；\n3. **高斯核 (RBF)**：$K(x, z) = \\exp(-\\gamma ||x - z||^2)$，将特征隐式映射到无穷维空间，$\\gamma$ 越大高斯钟形越窄，模型越容易过拟合。\n\n材料已交付给 @墨笔作家。',
    mentions: ['agent-writer'],
    timestamp: Date.now() - 240000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-4',
    senderId: 'agent-writer',
    senderName: '墨笔作家 (Content Writer)',
    senderRole: '结构化正文作家',
    avatar: '✍️',
    color: 'violet',
    toolsCalled: [
      {
        name: 'api.node.create',
        args: '{"title": "SVM核技巧精讲"}',
        result: '已在知识树中新建讲义草稿节点',
        ok: true,
      },
    ],
    content:
      '讲义核心正文已梳理完成，摘要如下：\n\n### 💡 核心直觉：升维不用真升维\n想象二维纸面上红蓝点呈同心圆分布，无论怎么画直线都分不开；但如果把纸面中心向下顶起成碗状，切一刀平面就能完美分离！这就是高维映射。\n\nSVM 对偶目标函数只依赖样本内积：\n$$\\max_\\alpha \\sum_{i=1}^m \\alpha_i - \\frac{1}{2}\\sum_{i,j=1}^m \\alpha_i \\alpha_j y_i y_j K(x_i, x_j)$$\n使用核技巧直接计算 $K(x_i, x_j)$，彻底避开了显式升维的计算爆炸。\n\n请 @考评官 补充检验题目，请 @准绳质检 验算对偶式。',
    mentions: ['agent-examiner', 'agent-reviewer'],
    timestamp: Date.now() - 180000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-5',
    senderId: 'agent-examiner',
    senderName: '考评官 (Assessment Agent)',
    senderRole: '随堂测验与答疑官',
    avatar: '🎯',
    color: 'amber',
    content:
      '配套随堂测验已生成，共精炼出两道关键辨析题：\n\n**随堂思考 1**：\n高斯核（RBF Kernel）映射后的特征空间维数是多少？为什么计算时计算机不会内存溢出？\n> *考点点拨*：特征空间是无穷维，但核技巧只需计算样本间欧氏距离指数衰减，计算量仅为 $O(d)$。\n\n**随堂思考 2**：\n若将 SVM 的 RBF 核参数 $\\gamma$ 调节得极其巨大（如 $\\gamma = 10^5$），分类决策边界会发生什么现象？\n> *考点点拨*：每个训练样本周围形成狭窄的孤立孤岛，导致严重过拟合。',
    timestamp: Date.now() - 120000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-6',
    senderId: 'agent-reviewer',
    senderName: '准绳质检 (Quality Reviewer)',
    senderRole: '严谨性与公式验算员',
    avatar: '🛡️',
    color: 'rose',
    thought: '核对对偶公式符号：$\\alpha_i \\alpha_j y_i y_j K(x_i, x_j)$ 正确，约束条件 $0 \\le \\alpha_i \\le C$ 与 $\\sum \\alpha_i y_i = 0$ 符合标准 SMO 求解形式；RBF 展开泰勒级数验证其对应多项式无穷项，结论准确。',
    content:
      '✅ **质检通过报告**：\n1. 公式对偶表达严密无误；\n2. 高斯核与多项式核边界条件已复核；\n3. 思考题答案准确，陷阱具有教学区分度；\n\n已交付 @云枢导师 进行全流程收工。',
    mentions: ['agent-tutor'],
    timestamp: Date.now() - 60000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-7',
    senderId: 'agent-tutor',
    senderName: '云枢导师 (Lead Tutor)',
    senderRole: '主控架构导师',
    avatar: '🎓',
    color: 'indigo',
    content:
      '🎉 **团队协作成果已达成**！\n\n整份讲义已结构化落库，包含核心直觉、数学内核、实战代码与自我检验思考题。你可以随时在下方输入框继续追问，或指定特定智能体（如输入 `@墨笔作家`）深入探讨！',
    timestamp: Date.now() - 10000,
    isGroupChat: true,
  },
]

const STORAGE_KEY_PREFIX = 'moji:agent-team:'

export function loadTeamAgents(goalId?: string): TeamAgent[] {
  if (typeof window === 'undefined') return DEFAULT_TEAM_AGENTS
  const key = `${STORAGE_KEY_PREFIX}${goalId || 'global'}:agents`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT_TEAM_AGENTS
    const parsed = JSON.parse(raw) as TeamAgent[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TEAM_AGENTS
  } catch {
    return DEFAULT_TEAM_AGENTS
  }
}

export function saveTeamAgents(agents: TeamAgent[], goalId?: string): void {
  if (typeof window === 'undefined') return
  const key = `${STORAGE_KEY_PREFIX}${goalId || 'global'}:agents`
  try {
    localStorage.setItem(key, JSON.stringify(agents))
  } catch (e) {
    console.warn('[agent-team] Failed to save agents:', e)
  }
}

export function loadTeamMessages(goalId?: string): TeamMessage[] {
  if (typeof window === 'undefined') return PRESET_SIMULATION_MESSAGES
  const key = `${STORAGE_KEY_PREFIX}${goalId || 'global'}:messages`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return PRESET_SIMULATION_MESSAGES
    const parsed = JSON.parse(raw) as TeamMessage[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : PRESET_SIMULATION_MESSAGES
  } catch {
    return PRESET_SIMULATION_MESSAGES
  }
}

export function saveTeamMessages(messages: TeamMessage[], goalId?: string): void {
  if (typeof window === 'undefined') return
  const key = `${STORAGE_KEY_PREFIX}${goalId || 'global'}:messages`
  try {
    localStorage.setItem(key, JSON.stringify(messages))
  } catch (e) {
    console.warn('[agent-team] Failed to save messages:', e)
  }
}
