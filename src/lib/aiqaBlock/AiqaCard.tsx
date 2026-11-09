import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, RotateCcw, SendHorizontal, AlertCircle } from 'lucide-react'
import { t } from '../../i18n'
import { renderNote } from '../markdown'
import { aiqaBlockHost, subscribeAiqaBlockHost } from './host'
import { streamAiqaAnswer } from './agent'
import type { AiqaChatMessage, AiqaChatSession } from './types'

export interface AiqaCardProps {
  id: string
  question: string
  system: string
  nodeId?: string
}

export default memo(function AiqaCard({ id, question, system, nodeId }: AiqaCardProps) {
  const [session, setSession] = useState<AiqaChatSession | null>(() => {
    const host = aiqaBlockHost()
    const effId = nodeId || host?.getActiveNodeId()
    if (effId && host) {
      return host.getNodeAiqaSession(effId, id)
    }
    return null
  })

  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)

  // 监听宿主变化，同步最新节点会话
  useEffect(() => {
    const sync = () => {
      const host = aiqaBlockHost()
      const effId = nodeId || host?.getActiveNodeId()
      if (effId && host) {
        const s = host.getNodeAiqaSession(effId, id)
        setSession(s)
      }
    }
    sync()
    return subscribeAiqaBlockHost(sync)
  }, [id, nodeId])

  // 滚动至底部
  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollAreaRef.current
    if (!el) return
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    })
  }, [])

  useEffect(() => {
    if (session?.messages?.length || streamText) {
      scrollToBottom(true)
    }
  }, [session?.messages?.length, streamText, scrollToBottom])

  const saveToHost = useCallback(
    (nextSession: AiqaChatSession | null) => {
      const host = aiqaBlockHost()
      const effId = nodeId || host?.getActiveNodeId()
      if (effId && host) {
        host.saveNodeAiqaSession(effId, id, nextSession)
      }
    },
    [id, nodeId],
  )

  // 终止在途流式输出
  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsStreaming(false)
    setStreamText('')
  }, [])

  // 重新回答：清空上下文并重置到回答前状态
  const handleReset = useCallback(() => {
    abortStream()
    setError(null)
    setInput('')
    setSession(null)
    saveToHost(null)
  }, [abortStream, saveToHost])

  // 发送回答与流式调用独立 Agent
  const sendAnswer = useCallback(
    async (answerText: string) => {
      const trimmed = answerText.trim()
      if (!trimmed || isStreaming) return

      setError(null)
      setInput('')

      // 提取既有消息或初始化
      const currentMessages: AiqaChatMessage[] =
        session?.messages && session.messages.length > 0
          ? session.messages
          : [{ role: 'assistant', content: question, createdAt: Date.now() }]

      const nextMessages: AiqaChatMessage[] = [
        ...currentMessages,
        { role: 'user', content: trimmed, createdAt: Date.now() },
      ]

      const intermediateSession: AiqaChatSession = {
        id,
        messages: nextMessages,
        updatedAt: Date.now(),
      }

      setSession(intermediateSession)
      setIsStreaming(true)
      setStreamText('')

      const ac = new AbortController()
      abortControllerRef.current = ac

      try {
        let acc = ''
        const reply = await streamAiqaAnswer({
          systemPrompt: system,
          messages: nextMessages,
          signal: ac.signal,
          onDelta: (delta) => {
            acc += delta
            setStreamText(acc)
          },
        })

        const finalContent = reply || acc
        const finalMessages: AiqaChatMessage[] = [
          ...nextMessages,
          { role: 'assistant', content: finalContent, createdAt: Date.now() },
        ]
        const finalSession: AiqaChatSession = {
          id,
          messages: finalMessages,
          updatedAt: Date.now(),
        }

        setSession(finalSession)
        saveToHost(finalSession)
        setStreamText('')
        setIsStreaming(false)
      } catch (err: unknown) {
        if (ac.signal.aborted) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setIsStreaming(false)
      } finally {
        abortControllerRef.current = null
      }
    },
    [id, isStreaming, question, saveToHost, session?.messages, system],
  )

  const isActivated = (session?.messages && session.messages.length > 0) || isStreaming

  // 默认未激活状态：无圆角卡片，第一行开场白，下方输入框 + 发送按钮
  if (!isActivated) {
    return (
      <div className="moji-aiqa my-4 rounded-none border border-line bg-surface/90 shadow-2xs font-sans transition-all duration-300 ease-in-out p-3.5 select-text">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-seal mb-2 select-none">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>{t('问答考察')}</span>
        </div>
        <div className="text-xs text-ink font-medium leading-relaxed mb-3 whitespace-pre-wrap select-text">
          {question}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendAnswer(input)
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            className="flex-1 rounded-none border border-line bg-paper/60 dark:bg-card/60 px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-seal transition-colors"
            placeholder={t('输入你的回答...')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="rounded-none bg-seal px-3.5 py-1.5 text-xs font-medium text-white hover:bg-seal-deep transition-colors disabled:opacity-40 cursor-pointer shrink-0 flex items-center gap-1 select-none"
          >
            <SendHorizontal className="w-3 h-3" />
            <span>{t('发送')}</span>
          </button>
        </form>
        {error && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-warn">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    )
  }

  // 激活状态：动画过渡展开，固定高度滚动聊天区
  return (
    <div className="moji-aiqa my-4 h-[360px] flex flex-col rounded-none border border-line bg-surface/90 shadow-2xs font-sans transition-all duration-300 ease-in-out select-text">
      {/* 顶部标题与重新回答按钮 */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-line/60 bg-surface select-none shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-seal">
          <MessageSquare className="w-3.5 h-3.5" />
          <span>{t('问答考察')}</span>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-ink-soft hover:text-ink hover:bg-line/40 rounded-none border border-line/60 transition-colors cursor-pointer select-none"
          title={t('清空问答记录，重新回答开场问题')}
        >
          <RotateCcw className="w-3 h-3" />
          <span>{t('重新回答')}</span>
        </button>
      </div>

      {/* 消息气泡滚动区 */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-3.5 space-y-3.5 select-text">
        {session?.messages?.map((msg, idx) => {
          const isUser = msg.role === 'user'
          return (
            <div key={idx} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-none text-xs leading-relaxed select-text shadow-2xs ${
                  isUser
                    ? 'border border-seal/30 bg-seal/15 text-seal-deep dark:bg-seal/25 dark:text-seal-light px-3.5 py-2 whitespace-pre-wrap'
                    : 'border border-line bg-paper/95 dark:bg-card/95 px-3.5 py-2.5 text-ink prose-sm'
                }`}
              >
                {isUser ? (
                  msg.content
                ) : (
                  <div
                    className="moji-aiqa-prose leading-relaxed space-y-1.5"
                    dangerouslySetInnerHTML={{ __html: renderNote(msg.content) }}
                  />
                )}
              </div>
            </div>
          )
        })}

        {/* 流式回复中的气泡 */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-none border border-line bg-paper/95 dark:bg-card/95 px-3.5 py-2.5 text-xs text-ink leading-relaxed shadow-2xs">
              {streamText ? (
                <div
                  className="moji-aiqa-prose leading-relaxed space-y-1.5"
                  dangerouslySetInnerHTML={{ __html: renderNote(streamText) }}
                />
              ) : (
                <span className="inline-flex items-center gap-1 text-ink-faint text-xs py-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-seal animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-seal animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-seal animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部报错栏（如有） */}
      {error && (
        <div className="px-3 py-1.5 border-t border-warn/30 bg-warn/10 text-warn flex items-center justify-between text-xs shrink-0 select-none">
          <div className="flex items-center gap-1.5 truncate">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[11px] underline hover:no-underline ml-2 shrink-0 cursor-pointer"
          >
            {t('关闭')}
          </button>
        </div>
      )}

      {/* 底部输入框 */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void sendAnswer(input)
        }}
        className="flex items-center gap-2 p-2 border-t border-line/60 bg-surface shrink-0"
      >
        <input
          type="text"
          className="flex-1 rounded-none border border-line bg-paper/60 dark:bg-card/60 px-3 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-seal transition-colors"
          placeholder={isStreaming ? t('AI 正在回答中…') : t('继续回答或追问...')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming}
          className="rounded-none bg-seal px-3.5 py-1.5 text-xs font-medium text-white hover:bg-seal-deep transition-colors disabled:opacity-40 cursor-pointer shrink-0 flex items-center gap-1 select-none"
        >
          <SendHorizontal className="w-3 h-3" />
          <span>{t('发送')}</span>
        </button>
      </form>
    </div>
  )
})
