import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Sparkles,
  Send,
  Trash2,
  ChevronDown,
  ChevronRight,
  Bot,
  ArrowLeft,
  AtSign,
  CheckCircle2,
  Wrench,
} from 'lucide-react'
import type { TeamAgent, TeamChatSelection, TeamMessage } from './types'
import { t } from '../../../i18n'

export interface AgentTeamChatProps {
  selected: TeamChatSelection
  agents: TeamAgent[]
  messages: TeamMessage[]
  onSendMessage: (content: string, mentions?: string[]) => void
  onSimulateWorkflow: () => void
  isSimulating: boolean
  onClearMessages: () => void
  onBackToGroup: () => void
  goalTitle?: string
}

export function AgentTeamChat({
  selected,
  agents,
  messages,
  onSendMessage,
  onSimulateWorkflow,
  isSimulating,
  onClearMessages,
  onBackToGroup,
  goalTitle,
}: AgentTeamChatProps) {
  const [inputText, setInputText] = useState('')
  const [selectedMention, setSelectedMention] = useState<string | null>(null)
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const isGroup = selected === 'group'
  const activeAgent = useMemo(() => {
    if (isGroup) return null
    return agents.find((a) => a.id === selected) || null
  }, [isGroup, agents, selected])

  // 过滤展示当前模式下的消息
  const displayedMessages = useMemo(() => {
    if (isGroup) {
      return messages.filter((m) => m.isGroupChat)
    }
    // 1对1 私聊模式
    return messages.filter(
      (m) =>
        !m.isGroupChat &&
        ((m.senderId === selected && m.targetAgentId === 'user') ||
          (m.senderId === 'user' && m.targetAgentId === selected)),
    )
  }, [messages, isGroup, selected])

  // 消息滚动触底
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayedMessages, isSimulating])

  const toggleThought = (msgId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }))
  };

  const handleSend = () => {
    const trimmed = inputText.trim()
    if (!trimmed) return

    const mentions: string[] = []
    if (selectedMention) {
      mentions.push(selectedMention)
    }

    onSendMessage(trimmed, mentions.length > 0 ? mentions : undefined)
    setInputText('')
    setSelectedMention(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const quickPrompts = isGroup
    ? [
        t('让检索员查阅相关论文与教材'),
        t('请导师拆解当前知识点教学步骤'),
        t('让正文作家撰写核心内容与公式'),
        t('让考评官生成 2 道随堂测验题'),
      ]
    : [
        t('请根据你的专业职责，对我提出的问题给出深度建议'),
        t('请列出你负责的工作步骤清单'),
        t('请检查当前内容是否存在遗漏'),
      ]

  return (
    <div className="flex flex-col h-full w-full bg-paper/50 overflow-hidden">
      {/* 顶栏：标题与操作 */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-line/60 bg-card/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          {!isGroup && (
            <button
              type="button"
              onClick={onBackToGroup}
              className="p-1.5 rounded-xl hover:bg-line/60 text-ink-soft hover:text-ink transition cursor-pointer"
              title={t('返回群聊大厅')}
            >
              <ArrowLeft size={16} />
            </button>
          )}

          {isGroup ? (
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-bold text-ink-strong">
                  {t('智能体协同群聊')}
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500 border border-indigo-500/20">
                  {t('多智能体协同广播')}
                </span>
              </div>
              <p className="text-[11.5px] text-ink-soft">
                {goalTitle ? `${goalTitle} · ` : ''}
                {t('所有智能体在此协同交互、派发任务与串联结果')}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div
                className={`w-8 h-8 rounded-xl ${activeAgent?.avatarBg} text-white flex items-center justify-center text-sm shadow-xs`}
              >
                {activeAgent?.avatar}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[15px] font-bold text-ink-strong">
                    {activeAgent?.name}
                  </h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-line/60 text-ink-soft">
                    {activeAgent?.role}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-paper-deep text-ink-faint font-mono">
                    {activeAgent?.model}
                  </span>
                </div>
                <p className="text-[11px] text-ink-soft line-clamp-1">
                  {activeAgent?.description}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 右侧动作按钮 */}
        <div className="flex items-center gap-2">
          {isGroup && (
            <button
              type="button"
              onClick={onSimulateWorkflow}
              disabled={isSimulating}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold transition shadow-xs cursor-pointer active:scale-95 border ${
                isSimulating
                  ? 'bg-line/40 text-ink-faint border-transparent cursor-not-allowed'
                  : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 hover:bg-indigo-500 hover:text-white'
              }`}
            >
              <Sparkles size={13} className={isSimulating ? 'animate-spin' : ''} />
              <span>{isSimulating ? t('协同演练中...') : t('模拟多智能体协同演练')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClearMessages}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl hover:bg-line/40 text-ink-faint hover:text-red-500 text-[11.5px] transition cursor-pointer"
            title={t('清空当前消息记录')}
          >
            <Trash2 size={13} />
            <span>{t('清空')}</span>
          </button>
        </div>
      </div>

      {/* 消息滚动流 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-5 space-y-4.5"
      >
        {displayedMessages.map((msg) => {
          const isUser = msg.senderId === 'user'

          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {/* 头像 */}
              <div
                className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center text-sm shadow-xs ${
                  isUser
                    ? 'bg-seal text-white font-bold'
                    : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
                }`}
              >
                {msg.avatar || (isUser ? '👤' : '🤖')}
              </div>

              {/* 气泡主体 */}
              <div
                className={`flex flex-col max-w-[82%] sm:max-w-[76%] ${
                  isUser ? 'items-end' : 'items-start'
                }`}
              >
                {/* 消息头 */}
                <div className="flex items-center gap-2 mb-1 text-[11px] text-ink-faint px-1">
                  <span className="font-bold text-ink-strong">{msg.senderName}</span>
                  {msg.senderRole && (
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-semibold bg-line/60 text-ink-soft">
                      {msg.senderRole}
                    </span>
                  )}
                  <span className="text-[10px]">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* 思考过程折叠栏 (如有) */}
                {msg.thought && (
                  <div className="w-full mb-1.5 rounded-xl border border-indigo-500/20 bg-indigo-500/5 overflow-hidden text-[11.5px]">
                    <button
                      type="button"
                      onClick={() => toggleThought(msg.id)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 cursor-pointer font-medium"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={11} />
                        <span>{t('深度思考与任务决策链')}</span>
                      </span>
                      {expandedThoughts[msg.id] ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                    </button>
                    {expandedThoughts[msg.id] && (
                      <div className="px-3 py-2 border-t border-indigo-500/15 text-ink-soft bg-paper-deep/40 leading-relaxed font-mono text-[11px]">
                        {msg.thought}
                      </div>
                    )}
                  </div>
                )}

                {/* 工具调用记录 (如有) */}
                {msg.toolsCalled && msg.toolsCalled.length > 0 && (
                  <div className="w-full mb-1.5 space-y-1">
                    {msg.toolsCalled.map((tool, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-paper-deep border border-line text-[11px] font-mono text-ink-soft"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Wrench size={11} className="text-seal shrink-0" />
                          <span className="font-bold text-ink-strong">{tool.name}</span>
                          <span className="truncate opacity-75">{tool.args}</span>
                        </div>
                        <CheckCircle2 size={12} className="text-emerald-500 shrink-0 ml-2" />
                      </div>
                    ))}
                  </div>
                )}

                {/* 消息正文 */}
                <div
                  className={`rounded-2xl p-4 text-[13px] leading-relaxed shadow-xs break-words ${
                    isUser
                      ? 'bg-seal text-white rounded-tr-none'
                      : 'bg-card border border-line/80 text-ink rounded-tl-none'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            </div>
          )
        })}

        {displayedMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center select-none text-ink-faint space-y-3">
            <Bot size={40} className="opacity-35" />
            <p className="text-[14px] font-medium">
              {isGroup ? t('协同群聊暂无消息') : t('与该智能体暂无对话')}
            </p>
            <p className="text-[12px]">
              {isGroup
                ? t('点击上方「模拟多智能体协同演练」或在下方发送任务指令')
                : t('在下方输入框向该智能体发送专业任务')}
            </p>
          </div>
        )}
      </div>

      {/* 底部输入框与控制区 */}
      <div className="p-4 border-t border-line/60 bg-card/60 backdrop-blur-md space-y-2.5">
        {/* @ 提及快捷标签 */}
        {isGroup && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
            <span className="text-ink-faint flex items-center gap-0.5 shrink-0">
              <AtSign size={11} />
              <span>{t('指定呼叫：')}</span>
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedMention(selectedMention === 'all' ? null : 'all')
              }
              className={`px-2 py-0.5 rounded-lg border transition cursor-pointer shrink-0 font-medium ${
                selectedMention === 'all'
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'bg-paper-deep text-ink-soft border-line hover:border-line-strong'
              }`}
            >
              @{t('全体智能体')}
            </button>
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() =>
                  setSelectedMention(selectedMention === a.id ? null : a.id)
                }
                className={`px-2 py-0.5 rounded-lg border transition cursor-pointer shrink-0 flex items-center gap-1 ${
                  selectedMention === a.id
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : 'bg-paper-deep text-ink-soft border-line hover:border-line-strong'
                }`}
              >
                <span>{a.avatar}</span>
                <span>@{a.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        )}

        {/* 快捷建议短语 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-[11px]">
          {quickPrompts.map((prompt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setInputText(prompt)}
              className="px-2.5 py-1 rounded-full bg-line/35 hover:bg-line/70 text-ink-soft hover:text-ink transition cursor-pointer shrink-0 truncate max-w-[240px]"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* 输入框与发送按钮 */}
        <div className="flex items-end gap-2 bg-paper-deep rounded-2xl border border-line p-2 focus-within:border-seal/60 transition">
          <textarea
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isGroup
                ? selectedMention
                  ? t('已指定 @{0}，输入具体任务指令（Ctrl+Enter 发送）...', selectedMention)
                  : t('在群聊中发布协同任务指令，支持 @智能体 协同响应（Ctrl+Enter 发送）...')
                : t('向 {0} 发送专业学习指令（Ctrl+Enter 发送）...', activeAgent?.name || '')
            }
            className="flex-1 bg-transparent border-0 text-[12.5px] text-ink placeholder:text-ink-faint focus:outline-none resize-none px-1"
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className={`p-2.5 rounded-xl transition cursor-pointer shrink-0 active:scale-95 ${
              inputText.trim()
                ? 'bg-seal text-white hover:bg-seal-deep shadow-xs'
                : 'bg-line/40 text-ink-faint cursor-not-allowed'
            }`}
            title={t('发送 (Ctrl+Enter)')}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
