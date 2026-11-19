import { useState, useMemo } from 'react'
import {
  Users,
  Search,
  Plus,
  Bot,
  Sparkles,
  Trash2,
  X,
  ChevronRight,
} from 'lucide-react'
import type { TeamAgent, TeamChatSelection } from './types'
import { t } from '../../../i18n'

export interface AgentTeamRosterProps {
  agents: TeamAgent[]
  selected: TeamChatSelection
  onSelect: (selection: TeamChatSelection) => void
  onAddAgent: (agent: TeamAgent) => void
  onDeleteAgent: (agentId: string) => void
  goalTitle?: string
  isTutorRunning?: boolean
}

export function AgentTeamRoster({
  agents,
  selected,
  onSelect,
  onAddAgent,
  onDeleteAgent,
  goalTitle,
  isTutorRunning,
}: AgentTeamRosterProps) {
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentRole, setNewAgentRole] = useState('')
  const [newAgentModel, setNewAgentModel] = useState('deepseek-chat')
  const [newAgentDesc, setNewAgentDesc] = useState('')
  const [newAgentCaps, setNewAgentCaps] = useState('')

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.capabilities.some((c) => c.toLowerCase().includes(q)),
    )
  }, [agents, search])

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAgentName.trim()) return

    const caps = newAgentCaps
      .split(/[,，、]/)
      .map((c) => c.trim())
      .filter(Boolean)

    const newAgent: TeamAgent = {
      id: `agent-custom-${Date.now()}`,
      name: newAgentName.trim(),
      role: newAgentRole.trim() || t('专属任务专员'),
      roleType: 'custom',
      avatar: '🤖',
      avatarBg: 'bg-gradient-to-br from-teal-500 to-cyan-600',
      color: 'teal',
      status: 'idle',
      model: newAgentModel,
      systemPrompt: newAgentDesc.trim() || t('你是一位专门负责特定垂直领域学习辅助任务的专家智能体。'),
      capabilities: caps.length > 0 ? caps : [t('专项分析'), t('按需辅助')],
      description: newAgentDesc.trim() || t('用户在当前目标中自定义登记的专家智能体。'),
      isCustom: true,
      createdAt: Date.now(),
    }

    onAddAgent(newAgent)
    setIsModalOpen(false)
    setNewAgentName('')
    setNewAgentRole('')
    setNewAgentDesc('')
    setNewAgentCaps('')
  }

  return (
    <div className="flex flex-col h-full w-full bg-card/65 backdrop-blur-md select-none">
      {/* 侧栏顶栏：标题与搜索 */}
      <div className="p-4 border-b border-line/60 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center border border-indigo-500/20">
              <Users size={16} />
            </div>
            <div>
              <h2 className="text-[14.5px] font-bold text-ink-strong leading-tight">
                {t('智能体团队')}
              </h2>
              <p className="text-[11px] text-ink-faint truncate max-w-[170px]">
                {goalTitle ? `${goalTitle}` : t('当前目标协作集群')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-seal/10 text-seal hover:bg-seal text-[11px] font-semibold hover:text-white transition cursor-pointer active:scale-95 border border-seal/20"
            title={t('向本目标添加新智能体')}
          >
            <Plus size={12} />
            <span>{t('新增')}</span>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-2.5 text-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('搜索智能体名称、职责或技能...')}
            className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-paper-deep/70 border border-line text-[12px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-seal/60"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2 text-ink-faint hover:text-ink cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 列表主体：置顶群聊 + 成员卡片 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 置顶项：多智能体协同群聊 */}
        <div>
          <div className="text-[10.5px] font-semibold text-ink-faint uppercase tracking-wider px-1 mb-1.5 flex items-center gap-1.5">
            <Sparkles size={11} className="text-indigo-400" />
            <span>{t('协作频道')}</span>
          </div>

          <div
            onClick={() => onSelect('group')}
            className={`group relative rounded-2xl p-3.5 transition-all duration-200 cursor-pointer border ${
              selected === 'group'
                ? 'bg-gradient-to-r from-indigo-500/15 via-purple-500/10 to-transparent border-indigo-500/40 shadow-sm ring-1 ring-indigo-500/20'
                : 'bg-card/70 hover:bg-card border-line/70 hover:border-indigo-500/30'
            }`}
          >
            <div className="flex items-start justify-between mb-1.5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-xs">
                  <Sparkles size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-bold text-ink-strong">
                      {t('协作频道')}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-line/80 text-ink-faint border border-line">
                      {t('待命')}
                    </span>
                  </div>
                  <span className="text-[11px] text-ink-faint line-clamp-1">
                    {t('多智能体协同广播与交互视口')}
                  </span>
                </div>
              </div>
              <ChevronRight
                size={14}
                className={`transition-transform duration-200 ${
                  selected === 'group'
                    ? 'text-indigo-500 translate-x-0.5'
                    : 'text-ink-faint group-hover:translate-x-0.5'
                }`}
              />
            </div>

            {/* 待命状态 */}
            <div className="flex items-center justify-between pt-2 border-t border-line/40 text-[10.5px]">
              <span className="text-ink-faint font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-ink-faint/40" />
                {t('协作频道暂无消息 (待命中)')}
              </span>
              <span className="text-[10px] text-ink-faint">{t('暂无多 Agent 任务')}</span>
            </div>
          </div>
        </div>

        {/* 成员列表 */}
        <div>
          <div className="text-[10.5px] font-semibold text-ink-faint uppercase tracking-wider px-1 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Bot size={11} />
              <span>{t('目标智能体 ({0})', filteredAgents.length)}</span>
            </span>
            <span className="text-[10px] text-ink-faint">{t('点击进入专属对话')}</span>
          </div>

          <div className="space-y-1.5">
            {filteredAgents.map((agent) => {
              const isSelected = selected === agent.id

              return (
                <div
                  key={agent.id}
                  onClick={() => onSelect(agent.id)}
                  className={`group relative rounded-2xl p-3 transition-all duration-150 cursor-pointer border ${
                    isSelected
                      ? 'bg-seal/10 border-seal/40 shadow-xs'
                      : 'bg-card/50 hover:bg-card border-line/60 hover:border-line-strong'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {/* 头像 */}
                    <div
                      className={`w-9 h-9 shrink-0 rounded-xl ${agent.avatarBg} text-white flex items-center justify-center text-base shadow-xs relative`}
                    >
                      <span>{agent.avatar}</span>
                      {agent.isLeader && isTutorRunning ? (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse ring-2 ring-card"
                          title={t('思考/执行中')}
                        />
                      ) : (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
                          title={t('在线')}
                        />
                      )}
                    </div>

                    {/* 信息区 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold text-ink truncate group-hover:text-seal transition-colors">
                          {agent.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-md ${
                              agent.isLeader
                                ? 'bg-indigo-500/15 text-indigo-500 border border-indigo-500/25'
                                : 'bg-line/50 text-ink-soft'
                            }`}
                          >
                            {agent.role}
                          </span>
                          {agent.isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onDeleteAgent(agent.id)
                              }}
                              className="p-1 text-ink-faint hover:text-red-500 transition opacity-0 group-hover:opacity-100 cursor-pointer"
                              title={t('注销该智能体')}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>

                      <p className="text-[11px] text-ink-soft line-clamp-1 mt-0.5">
                        {agent.description}
                      </p>

                      {/* 能力标签 */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {agent.capabilities.slice(0, 3).map((cap) => (
                          <span
                            key={cap}
                            className="text-[9.5px] px-1.5 py-0.2 rounded bg-paper-deep border border-line/50 text-ink-faint"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {filteredAgents.length === 0 && (
              <div className="text-center py-8 text-ink-faint text-[12px]">
                {t('未找到匹配的智能体')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新增智能体弹窗 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
          <form
            onSubmit={handleCreateAgent}
            className="w-full max-w-md bg-card border border-line-strong rounded-3xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between border-b border-line/60 pb-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-seal" />
                <h3 className="text-[15px] font-bold text-ink-strong">{t('登记新智能体')}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-ink-faint hover:text-ink cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3 text-[12px]">
              <div>
                <label className="block font-semibold text-ink-strong mb-1">{t('智能体名称')}</label>
                <input
                  type="text"
                  required
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder={t('例如：代码优化专家')}
                  className="w-full px-3 py-1.5 rounded-xl bg-paper-deep border border-line text-ink focus:outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink-strong mb-1">{t('专业职责定位')}</label>
                <input
                  type="text"
                  value={newAgentRole}
                  onChange={(e) => setNewAgentRole(e.target.value)}
                  placeholder={t('例如：算法重构与单元测试')}
                  className="w-full px-3 py-1.5 rounded-xl bg-paper-deep border border-line text-ink focus:outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink-strong mb-1">{t('专属能力标签')}</label>
                <input
                  type="text"
                  value={newAgentCaps}
                  onChange={(e) => setNewAgentCaps(e.target.value)}
                  placeholder={t('以逗号分隔，例如：代码重构, 静态检查, 性能压测')}
                  className="w-full px-3 py-1.5 rounded-xl bg-paper-deep border border-line text-ink focus:outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink-strong mb-1">{t('调用模型')}</label>
                <input
                  type="text"
                  value={newAgentModel}
                  onChange={(e) => setNewAgentModel(e.target.value)}
                  placeholder="deepseek-chat"
                  className="w-full px-3 py-1.5 rounded-xl bg-paper-deep border border-line text-ink focus:outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block font-semibold text-ink-strong mb-1">{t('专属指令与系统提示词')}</label>
                <textarea
                  rows={3}
                  value={newAgentDesc}
                  onChange={(e) => setNewAgentDesc(e.target.value)}
                  placeholder={t('请简述该智能体的任务范围、交付物规范与工作方式...')}
                  className="w-full px-3 py-1.5 rounded-xl bg-paper-deep border border-line text-ink focus:outline-none focus:border-seal resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-line/60">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-line/40 text-ink-soft text-[12px] hover:text-ink cursor-pointer"
              >
                {t('取消')}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl bg-seal text-white font-bold text-[12px] hover:bg-seal-deep transition cursor-pointer"
              >
                {t('确认创建')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
