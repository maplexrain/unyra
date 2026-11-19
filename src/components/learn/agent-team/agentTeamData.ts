import type { TeamAgent, TeamMessage } from './types'

export const DEFAULT_TEAM_AGENTS: TeamAgent[] = [
  {
    id: 'agent-tutor',
    name: '超级导师 (Super Tutor)',
    role: '超级导师',
    roleType: 'leader',
    avatar: '🧠',
    avatarBg: 'bg-gradient-to-br from-indigo-500 to-purple-600',
    color: 'indigo',
    status: 'active',
    model: 'deepseek-chat',
    systemPrompt:
      '你是学习目标下的超级导师，负责全流程知识答疑、教学讲义撰写、随堂测验与任务调度执行。',
    capabilities: ['概念答疑', '讲义撰写', '随堂测验', '代码沙箱', '全流程统筹'],
    description: '负责教学目标顶层设计、概念讲义、实战任务执行与学习成果收口。',
    isLeader: true,
  },
]

export const PRESET_SIMULATION_MESSAGES: TeamMessage[] = [
  {
    id: 'msg-demo-1',
    senderId: 'user',
    senderName: '学习者 (You)',
    avatar: '👤',
    content: '我想系统掌握「支持向量机（SVM）的核技巧（Kernel Trick）」，请团队协作帮我产出一份高质量讲义和配套习题！',
    timestamp: Date.now() - 350000,
    isGroupChat: true,
  },
  {
    id: 'msg-demo-2',
    senderId: 'agent-tutor',
    senderName: '超级导师 (Super Tutor)',
    senderRole: '超级导师',
    avatar: '🧠',
    color: 'indigo',
    thought:
      '学习者需要学习 SVM 核技巧。该概念属于机器学习核心，包含数学映射思想（Mercer 条件）、常见核函数选型、计算优化与代码实战。',
    content:
      '收到！SVM 核技巧是高维特征映射与计算效率完美结合的典范。\n\n**任务规划已就绪**：\n- 查证 Mercer 定理充分必要条件与高斯 RBF 核超参数 $\\gamma$ 的几何物理意义；\n- 以「低维线性不可分 → 高维线性可分」为叙事主线，撰写直观讲义与 Scikit-learn 代码；\n- 设计随堂思考题并严格验算对偶问题与核矩阵计算。',
    timestamp: Date.now() - 290000,
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
  if (typeof window === 'undefined') return []
  const key = `${STORAGE_KEY_PREFIX}${goalId || 'global'}:messages`
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TeamMessage[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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
