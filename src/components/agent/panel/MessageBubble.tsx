/**
 * 一条消息长什么样：引文、气泡里的附件、操作按钮、编辑框，以及正文里的
 * 思考 / 工具调用 / 注入的提示词模块与文本块、提示块，外加列表右下角那颗「回到最新」。
 *
 * 层级与用色的规矩：**chat 层只有用户消息保留气泡本尊**（同色系、深一档的底色圆角）；
 * 其余一律无壳；mind 层连用户气泡也去掉。导师的正文、思考气泡、工具调用气泡
 * 都不带边框与底色，分层靠排版与缩进。思考、工具与提示词注入**逐项平铺**，
 * 不再先套一层「思考与工具 · N 步」的组容器。
 *
 * 全是纯展示组件——它们只认 props，不改任何状态；消息数据、编辑与删除
 * 都由 AgentPanel 通过 MessageList 传下来。
 *
 * 单条消息那一层（MessageRow）是 memo 过的：流式写作时每个 chunk 都让父组件重渲染一次，
 * 没变过的历史消息不该跟着把整棵子树重新 reconcile 一遍。
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Quote,
} from 'lucide-react'
import type { AgentPart, ConversationMessage, MessageImage, MessageQuote } from '../../../agent/types'
import MarkdownView from '../../MarkdownView'
import UsageLine from '../UsageLine'
import { renderNote } from '../../../lib/markdown'
import { focusQuote } from '../../../lib/quoteFocus'
import { BubbleFile } from './Images'
import { MessageMediaGrid } from './MessageMedia'
import { isVideoFile } from './messageMediaLayout'
import { DeliveryBlock } from './DeliveryBlock'
import { ToolCard } from './ToolCard'
import { lastLineOf } from './preview'
import { useFold } from './useFold'
import { isInterruptedNotice } from '../../../learn/agent/inflight'
import { flattenParts, type InjectItem } from './partGroups'
import { openChipRef, type ChipPayload } from '../../../lib/docChip'
import { MessageSpeakButton } from '../../tts/MessageSpeakButton'
import { chipLabel, chipSvg, chipToken, maskChipTokens, restoreChipTokens, splitChips } from '../../../lib/chipSyntax'
import { promptModuleTitleOf } from '../../../learn/ai/promptModules'
import { splitParagraphs } from './paragraphBuffer'
import { t, useLocale } from '../../../i18n'

/**
 * 一条消息在列表里的全部输入。
 *
 * 只传**这一条自己的**东西：整份 messages、整个 editing、confirmDel 都不下来——
 * 它们一变就换身份，memo 等于没加。faded / flash / confirming / editingText 都是
 * 父组件按这一条算好的值（算法与拆分前逐字相同）。
 */
export interface MessageRowProps {
  m: ConversationMessage
  /** 这一条在失活分界线之前：已经被折进摘要，只作显示（淡一档） */
  faded: boolean
  /** 刚从定位条跳过来的那一条：闪一下 */
  flash: boolean
  /**
   * 这一轮开始前注入的那几条提示词（人格 / 文档格式 / 技能库 / 提示词模块，
   * 见 agent/messageKind）。它们排在回复的最前面逐条平铺，与思考、工具调用
   * 同一层，而不是在对话流里单独画一条分界条。
   * 由 useMessageList 从隐藏消息合成，身份只在 messages 变了之后才换。
   */
  prelude?: InjectItem[]
  /** 每条消息的 DOM：定位条与缩放都要用（MindMessageRow 会把内层这一份登记进来） */
  msgRefs?: React.RefObject<Map<string, HTMLDivElement>>
  /** 点中断说明旁的「继续」：恢复被中断的一轮（见 AgentPanel；只挂在正文的 NoticeBlock 上） */
  onResumeNotice?: () => void
  setBubblePreview: React.Dispatch<React.SetStateAction<MessageImage | null>>
  /** 点击文件/图片附件时在标签页中打开 */
  onOpenFile?: (pathOrRel: string, title?: string) => void
  /** 目标 id：用于交付组件定位节点文档，避免多目标同名节点指针混淆 */
  goalId?: string
  /** 思维层：去掉聊天气泡与聊天操作，消息行头部另由 MindMessageRow 提供 */
  mind?: boolean
}

/**
 * 单条消息：用户气泡 / 导师回复 / 导师动作的分界条。原来写在 useMessageList 的 map 里，
 * 挪出来只为了能 memo——DOM 结构与类名一字未改（Fragment 换成组件，不多一层节点）。
 */
export const MessageRow = memo(function MessageRow({
  m,
  faded,
  flash,
  prelude,
  msgRefs,
  onResumeNotice,
  setBubblePreview: _setBubblePreview,
  onOpenFile,
  goalId,
  mind = false,
}: MessageRowProps) {
  useLocale()
  const fadedCls = faded ? ' opacity-55' : ''
  const messageText = m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n')

  if (m.role === 'user') {
    const hasMedia = Boolean(m.images?.length || (m.files ?? []).some((f) => isVideoFile(f)))
    const bubbleVisible = Boolean(messageText.trim() || hasMedia || m.quote)
    return (
      <div
        ref={(el) => {
          if (!msgRefs?.current) return
          if (el) msgRefs.current.set(m.id, el)
          else msgRefs.current.delete(m.id)
        }}
        className={
          'group flex gap-1.5 ' +
          (mind ? 'mb-1 items-start justify-start' : 'mb-3 items-end justify-end') +
          fadedCls
        }
      >
        {!mind && <MessageActions text={messageText} />}
        <div
          className={
            mind
              ? 'min-w-0 max-w-[450px]'
              : 'max-w-[450px] rounded-lg ' + (flash ? 'moji-msg-flash' : '')
          }
        >
          {m.quote && <QuoteChip quote={m.quote} />}
          {bubbleVisible ? (
            <div
              className={
                mind
                  ? 'text-[13px] leading-relaxed text-ink select-text'
                  : 'rounded-lg bg-bubble-user px-3.5 py-2 text-[13px] leading-relaxed text-ink-strong ring-1 ring-line/65 select-text'
              }
            >
              <Parts parts={m.parts} prelude={prelude} onResumeNotice={onResumeNotice} />
              {/* 图片 / 视频嵌在气泡内侧底部，与群聊、私聊相同一套宫格 */}
              <MessageMediaGrid images={m.images} files={m.files} />
            </div>
          ) : null}
          {/* 非图片 / 视频文件挂在气泡外底侧 */}
          {(m.files ?? []).some((f) => !isVideoFile(f)) && (
            <div className={'mt-1 flex flex-wrap gap-1.5 ' + (mind ? 'justify-start' : 'justify-end')}>
              {(m.files ?? [])
                .filter((f) => !isVideoFile(f))
                .map((file, idx) => (
                  <BubbleFile
                    key={file.uuid ?? `${file.name}-${idx}`}
                    file={file}
                    onOpen={() => {
                      const target = file.rel || file.path
                      if (target) onOpenFile?.(target, file.name)
                    }}
                  />
                ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 导师回复
  return (
    <div
      ref={(el) => {
        if (!msgRefs?.current) return
        if (el) msgRefs.current.set(m.id, el)
        else msgRefs.current.delete(m.id)
      }}
      className={'group relative ' + (mind ? 'mb-1' : 'mb-4') + fadedCls}
    >
      <Parts parts={m.parts} prelude={prelude} onResumeNotice={onResumeNotice} />
      {m.delivery && <DeliveryBlock delivery={m.delivery} onOpenFile={onOpenFile} goalId={goalId} />}
      {m.usage && !mind && (
        <div className="mt-1">
          <UsageLine usage={m.usage} />
        </div>
      )}
      {!mind && (
        <div className="mt-1 flex justify-start opacity-0 transition group-hover:opacity-100">
          <MessageActions text={messageText} />
        </div>
      )}
    </div>
  )
})
/**
 * 「询问」引文：显示在用户气泡上方，点击回到左侧文档把对应文字闪一下。
 * 用户看到的是引用内容本身，而不是一段看不懂的坐标。
 */
function QuoteChip({ quote }: { quote: MessageQuote }) {
  const [missed, setMissed] = useState(false)
  const excerpt = quote.text.length > 80 ? `${quote.text.slice(0, 80)}…` : quote.text
  const jump = () => {
    // 位置一并带上（start/end）：同一个词出现好几回时，只有坐标分得清用户划的是哪一处
    if (focusQuote({ text: quote.text, start: quote.start, end: quote.end })) setMissed(false)
    else setMissed(true)
  }
  return (
    <div className="mb-1 flex justify-end">
      <button
        type="button"
        onClick={jump}
        title={t('点击回到文档，高亮这段文字')}
        onMouseDown={(e) => e.preventDefault()}
        className={`group/quote flex max-w-full items-start gap-1.5 rounded-lg border px-2 py-1 text-left text-[12.5px] leading-snug transition ${
          missed
            ? 'border-warn/50 bg-warn/10 text-warn-deep'
            : 'border-seal/30 bg-seal/5 text-seal-deep hover:border-seal/55 hover:bg-seal/10'
        }`}
      >
        <Quote size={11} className="mt-[2px] shrink-0 opacity-70" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words">{excerpt}</span>
          <span className="mt-0.5 block text-[11px] opacity-70">
            {missed ? t('暂时无法定位这段文字（视图已切换或内容有改动）') : t('选自文档 · 点击定位')}
          </span>
        </span>
      </button>
    </div>
  )
}

function MessageActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.warn('[MessageActions] 复制失败：', err)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        title={copied ? t('已复制') : t('复制内容')}
        onClick={handleCopy}
        className={`flex h-6 items-center justify-center rounded px-1.5 transition text-ink-faint hover:bg-line/70 hover:text-ink cursor-pointer ${
          copied ? 'text-ok font-medium' : ''
        }`}
      >
        {copied ? (
          <span className="flex items-center gap-1 text-[11px] text-ok">
            <Check size={12} />
            <span>{t('已复制')}</span>
          </span>
        ) : (
          <Copy size={12} />
        )}
      </button>
      <MessageSpeakButton text={text} />
    </div>
  )
}
/**
 * 把一条消息的部件序列摊成一条条：提示词注入排在最前，思考、工具调用、提示词模块
 * 与正文、运行时提示各占一项，按原顺序平铺。归组规则在 panel/partGroups 里
 * （有单元用例钉着）——这里只管「怎么画」。
 *
 * 不再有组壳：每一项自己折叠、自己带一条细分隔线，用户不必先点开一层
 * 「思考与工具 · N 步」再看里面。
 */
function Parts({
  parts,
  prelude,
  onResumeNotice,
  streaming = false,
}: {
  parts: AgentPart[]
  prelude?: InjectItem[]
  onResumeNotice?: () => void
  streaming?: boolean
}) {
  /**
   * 过程件不再归组：思考、工具调用、提示词模块与轮开始时的提示词注入
   * 都按原顺序直接平铺。每项仍是自己的折叠块，但用户不必先点开一层组壳。
   */
  const items = flattenParts(parts, prelude)
  return (
    <div className="flex flex-col gap-2">
      {items.map((part, i) =>
        part.type === 'inject' ? (
          <InjectBlock key={'inject-' + part.id} item={part} />
        ) : (
          <SinglePart key={i} part={part} onResumeNotice={onResumeNotice} streaming={streaming} />
        ),
      )}
    </div>
  )
}

function SinglePart({
  part,
  onResumeNotice,
  streaming = false,
}: {
  part: AgentPart
  onResumeNotice?: () => void
  streaming?: boolean
}) {
  if (part.type === 'text') return <TextBlock text={part.text} streaming={streaming} />
  if (part.type === 'notice') return <NoticeBlock level={part.level} text={part.text} onResume={onResumeNotice} />
  if (part.type === 'thinking') return <ThinkingBlock text={part.text} />
  if (part.type === 'tool') return <ToolCard part={part} />
  if (part.type === 'prompt-module') return <PromptModuleBlock part={part} />
  if (part.type === 'channel-message') return <ChannelMessageBlock part={part} />
  return null
}

/**
 * 思考过程气泡（消息流的嵌套件，也可能落单独立成条）。**无壳**：没有边框与
 * 底色，展开区与收起行之间只靠缩进与一截淡淡的间距分开。收起时露一行预览：
 * **内容的最后一行**，不换行，一直往右滚到最新处。
 *
 * 为什么不是「思考中…」那样的静态字样：模型思考可能安静十几秒，静态字样与卡死长得一模一样。
 * 一行不断往左滚的字，一眼就能看出「它还在写」——这正是这个气泡存在的意义。
 * 展开就是完整正文，预览随之收起（那时整段话都看得见了）；高度过渡见 moji-fold，
 * 内容的挂载时机见 useFold，底部给一个「收起」，读完就地收起。
 *
 * **展开后的正文限高**（用户定的）：一段思考可以是几千字，全摊开会把下面的正文
 * 顶出好几屏——那一块本来只是「它怎么想的」的旁注。超过上限就在框内滚动，
 * 滚动条细一档（moji-scroll-thin）：用户得看得见「下面还有」，而不是以为到此为止。
 * 流式期间还在写的时候，只要读者本来就停在底部就继续跟着贴底（往上翻过就不抢，
 * 与消息列表同一条礼貌）。
 */
function ThinkingBlock({ text }: { text?: string }) {
  const { open, shown, toggle } = useFold()
  const safeText = typeof text === 'string' ? text : ''
  const tail = useMemo(() => lastLineOf(safeText), [safeText])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** 读者此刻是不是停在正文底部：流式续写时据此决定要不要跟着滚 */
  const atBottomRef = useRef(true)
  /** 上一次渲染的正文：只有它**变长了**才谈得上跟着滚（展开历史思考不该跳到末尾） */
  const prevText = useRef(safeText)

  useEffect(() => {
    const el = bodyRef.current
    const grew = safeText !== prevText.current
    prevText.current = safeText
    if (!el || !grew || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [safeText])

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 py-0.5 text-left text-[12.5px] text-ink-faint transition hover:text-ink-soft"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Brain size={12} className="shrink-0" />
        <span className="shrink-0">{t('思考过程')}</span>
        {!open && (
          <span className="flex min-w-0 flex-1 justify-end overflow-hidden">
            <span className="shrink-0 whitespace-nowrap opacity-75">{tail || '…'}</span>
          </span>
        )}
      </button>
      <div className={'moji-fold' + (open ? ' moji-fold-open' : '')}>
        <div>
          {shown && (
            <>
              <div
                ref={bodyRef}
                onScroll={(e) => {
                  const el = e.currentTarget
                  atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
                }}
                className="moji-scroll-thin max-h-[22rem] overflow-y-auto overscroll-contain whitespace-pre-wrap py-1 pr-1.5 text-[12.5px] leading-relaxed text-ink-soft"
              >
                {text}
              </div>
              <button
                type="button"
                onClick={toggle}
                className="text-[12px] text-ink-faint transition hover:text-ink-soft"
              >
                {t('收起')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 运行时提示：输出被截断、步数用尽、正在重试等——让「异常终止」可见 */
function NoticeBlock({
  level,
  text,
  onResume,
}: {
  level: 'warn' | 'info'
  text: string
  /** 提供时且这条是「应用退出被中断」的说明：末尾给一颗「继续」，一键恢复没跑完的 loop */
  onResume?: () => void
}) {
  const resumable = !!onResume && isInterruptedNotice(text)
  return (
    <div
      className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
        level === 'warn' ? 'border-warn/45 bg-warn/10 text-warn-deep' : 'border-line bg-line/25 text-ink-soft'
      }`}
    >
      {/*
        mt-[4px]：图标与文字的**第一行**居中对齐——12.5px 的 leading-relaxed 行高约 20px，
        12px 的图标上下各补 4px 才落在同一水平线上。
      */}
      <AlertTriangle size={12} className="mt-[4px] shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {resumable && (
        <button
          type="button"
          onClick={onResume}
          title={t('接着没跑完的地方继续这一轮')}
          className="ml-0.5 mt-[1px] shrink-0 rounded border border-warn/50 px-1.5 py-0.5 text-[11px] leading-none text-warn-deep transition hover:bg-warn/15"
        >
          {t('继续')}
        </button>
      )}
    </div>
  )
}

/**
 * 「新建对话」的图标（NewChatIcon）搬去了 components/icons.tsx：侧栏的新建学习目标、
 * 打开本地文件与它是同一批手画图标，放在一起才好对齐视觉语言。
 */

/**
 * 工作流指令的分界条（开讲 / 出卷 / 阅卷 / 压缩…）。不显示指令原文（那是内部
 * 提示词，不是给用户看的话），只标出「这里发生了什么」；定位条按它做锚点，
 * 点一下能跳回来。
 *
 * **只有工作流指令才画这一条**（判据见 agent/messageKind）：人格、文档格式、技能库、
 * 提示词模块这些「提示词注入」逐项排在回复里，不再挤到这里来——从前它们混在
 * 一起，几条连着注入时这一行字会被挤出边界（用户报的那个 bug）。
 *
 * **相邻的分界条融成一条**：工作流常连着触发（出卷 → 阅卷），各画各的就是
 * 两条紧贴的横线，中间只隔一行字高的空——空间上重复表达「这里有一次导师动作」。
 * 融合后一条横线串起全部动作名，动作之间用一截细竖线分开（不用「·」：动作名
 * 本身可能带「·」，如「导师人格 · 标准导师」）。每条消息仍各自往 msgRefs 里
 * 注册自己的 DOM（就是这同一条分界条）：定位条的锚点一个不少。
 *
 * 排版是**可折行**的：动作名一多（或名字本身很长）就换行，而不是把整条挤出容器。
 * 单个名字还给了上限并截断（title 里留着全文）——一个名字就能占满一整行时，
 * 让它独占一行比让它把两边的横线顶没更好看。
 */
export function HiddenDivider({
  msgs,
  faded,
  flash,
  msgRefs,
}: {
  msgs: ConversationMessage[]
  faded: boolean
  flash: boolean
  msgRefs: React.RefObject<Map<string, HTMLDivElement>>
}) {
  /** 展开的是哪一条工作流指令（相邻分界条融成一条，展开按消息各自记） */
  const [openId, setOpenId] = useState<string | null>(null)
  const openMsg = msgs.find((m) => m.id === openId) ?? null
  return (
    <div
      ref={(el) => {
        for (const m of msgs) {
          if (el) msgRefs.current.set(m.id, el)
          else msgRefs.current.delete(m.id)
        }
      }}
      className={'mb-3 flex flex-col gap-1 rounded px-1 py-0.5 text-[11px] text-ink-faint' +
        (faded ? ' opacity-55' : '') +
        (flash ? ' moji-msg-flash' : '')}
    >
      <div className="flex items-start gap-2">
        {/* mt-[7px]：让那截横线落在这一行文字的**垂直中线**上（11px 字、行高约 16px） */}
        <span aria-hidden="true" className="mt-[7px] h-px min-w-4 flex-1 bg-line" />
        <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {msgs.map((m, i) => {
            const label = t(m.mark ?? '导师动作')
            return (
              <span key={m.id} className="flex min-w-0 items-center gap-2">
                {i > 0 && <span aria-hidden="true" className="h-2.5 w-px shrink-0 bg-line-strong" />}
                <button
                  type="button"
                  onClick={() => setOpenId(openId === m.id ? null : m.id)}
                  title={t('点开看这次工作流的参数与完整指令')}
                  className={`flex min-w-0 max-w-[16rem] items-center gap-1 truncate transition hover:text-ink-soft ${
                    openId === m.id ? 'text-ink' : ''
                  }`}
                >
                  {openId === m.id ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                  <span className="truncate">{label}</span>
                </button>
              </span>
            )
          })}
        </span>
        <span aria-hidden="true" className="mt-[7px] h-px min-w-4 flex-1 bg-line" />
      </div>
      {openMsg && <WorkflowDetail msg={openMsg} />}
    </div>
  )
}

/**
 * 展开的「参数行 + 完整指令」：第一行列出这次工作流的启动实参（key = value 的小片），
 * 第二行是指令全文——指令里与实参对应的文字高亮，参数从哪来、落到了指令的哪句话上
 * 一眼对上。没有实参的工作流只有指令行。
 */
function WorkflowDetail({ msg }: { msg: ConversationMessage }) {
  const instruction = msg.parts
    .filter((p): p is Extract<AgentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
  const params = Object.entries(msg.wfParams ?? {})
  const segments = highlightParams(instruction, params)
  return (
    <div className="rounded border border-line bg-card/70 px-3 py-2">
      {params.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-ink-faint">{t('参数')}</span>
          {params.map(([key, value]) => (
            <span key={key} className="rounded bg-seal/10 px-1.5 py-[1px] text-seal-deep">
              {key} = {String(value)}
            </span>
          ))}
        </div>
      )}
      <div className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-soft">
        {segments.map((seg, i) =>
          seg.hit ? (
            <mark key={i} className="rounded bg-seal/20 px-0.5 text-seal-deep">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </div>
    </div>
  )
}

/** 把指令里与参数值相同的片段标出来；值太短（一两个字符）不高亮——到处都是误伤 */
function highlightParams(text: string, params: Array<[string, string | number]>): Array<{ text: string; hit: boolean }> {
  const values = params
    .map(([, v]) => String(v))
    .filter((v) => v.trim().length >= 2)
    .sort((a, b) => b.length - a.length)
  if (!values.length) return [{ text, hit: false }]
  const out: Array<{ text: string; hit: boolean }> = [{ text, hit: false }]
  for (const v of values) {
    for (let i = out.length - 1; i >= 0; i--) {
      const seg = out[i]
      if (seg.hit) continue
      const at = seg.text.indexOf(v)
      if (at < 0) continue
      const pieces = [
        { text: seg.text.slice(0, at), hit: false },
        { text: v, hit: true },
        { text: seg.text.slice(at + v.length), hit: false },
      ].filter((x) => x.text)
      out.splice(i, 1, ...pieces)
    }
  }
  return out
}

/**
 * 动态注入的提示词模块（见 learn/ai/promptModules）在回复**内部**的折叠块。
 *
 * 它与思考、工具调用是同一层——轮次进行中的一个片段，**不分割轮次**，也在 Parts 里
 * 逐项平铺：折叠时一行「提示词模块 · 界面操作 · 已注入上下文」
 * （与思考 / 工具同一套 chevron 词汇），展开看注入的全文。透明化是这套机制的立身之本：
 * 上下文里被注入了什么，用户随时点开就能看到。
 *
 * 自己**不画**下边框：整段过程已经逐项平铺，行与行之间只靠 Parts 的间距分开。
 */
function PromptModuleBlock({ part }: { part: Extract<AgentPart, { type: 'prompt-module' }> }) {
  const [open, setOpen] = useState(false)
  const title = promptModuleTitleOf(part.key) ?? part.key
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('收起模块全文') : t('点开查看注入的完整提示词')}
        className="flex w-full items-center gap-1.5 text-left text-[12.5px] text-ink-faint transition hover:text-ink-soft"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="shrink-0">{t('提示词模块 · {0}', title)}</span>
        <span className="shrink-0 opacity-75">{t('已注入上下文')}</span>
      </button>
      {open && (
        /*
          展开体按 Markdown 渲染：注入的模块全文本来就是按 Markdown 写的（围栏、列表、
          表格都有），裸 <pre> 只会把源码摆出来——渲染后才是它在上下文里的真实形态。
        */
        <div className="moji-in-soft moji-scroll-thin mt-1.5 max-h-80 overflow-auto rounded border border-line bg-card/70 p-2.5 text-left text-[11.5px] leading-relaxed text-ink-soft">
          <MarkdownView html={renderNote(part.text)} className="moji-agent-md moji-md-soft" />
        </div>
      )}
    </div>
  )
}

/**
 * 一条**通道消息**（Work / Agent 通道的跳边界注入，见 learn/roleWork）的折叠块。
 * 与 PromptModuleBlock 同一副样子：折叠时一行「通道消息 · id · 已注入上下文」，
 * 展开看全文（通道消息本来就是写给角色读的正文）。
 */
function ChannelMessageBlock({ part }: { part: Extract<AgentPart, { type: 'channel-message' }> }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('收起通道消息') : t('点开查看通道消息全文')}
        className="flex w-full items-center gap-1.5 text-left text-[12.5px] text-ink-faint transition hover:text-ink-soft"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="shrink-0">{t('通道消息 · {0}', part.channelId.slice(0, 8))}</span>
        <span className="shrink-0 opacity-75">{t('已注入上下文')}</span>
      </button>
      {open && (
        <div className="moji-in-soft moji-scroll-thin mt-1.5 max-h-80 overflow-auto rounded border border-line bg-card/70 p-2.5 text-left text-[11.5px] leading-relaxed text-ink-soft">
          <MarkdownView html={renderNote(part.text)} className="moji-agent-md moji-md-soft" />
        </div>
      )}
    </div>
  )
}

/**
 * 一条**提示词注入**（人格 / 文档格式 / 技能库 / 提示词模块）的折叠块。
 *
 * 与 PromptModuleBlock 是同一副样子、同一个道理：折叠时一行「导师人格 · ADHD 导师 ·
 * 已注入上下文」，展开看注入的全文。区别只在标题来源——模块块查模块表拿标题，
 * 这里直接用隐藏消息自己的 mark（那本来就是给人看的那句话）。
 *
 * 它取代的是从前那条分界条：一条分界条只说「导师动作」，而这几条根本不是动作，
 * 它们是**这一轮被补进上下文的提示词**——与思考、工具调用同一层。
 * 透明化不变：上下文里被注入了什么，用户随时点开就能看到。
 */
function InjectBlock({ item }: { item: InjectItem }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={open ? t('收起模块全文') : t('点开查看注入的完整提示词')}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-[12.5px] text-ink-faint transition hover:text-ink-soft"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="min-w-0 truncate" title={item.label}>
          {item.label}
        </span>
        <span className="shrink-0 opacity-75">{t('已注入上下文')}</span>
      </button>
      {open && (
        <div className="moji-in-soft moji-scroll-thin mt-1.5 max-h-80 overflow-auto rounded border border-line bg-card/70 p-2.5 text-left text-[11.5px] leading-relaxed text-ink-soft">
          <MarkdownView html={renderNote(item.text)} className="moji-agent-md moji-md-soft" />
        </div>
      )}
    </div>
  )
}

/**
 * 「回到最新」：脱离自动滚动后浮在列表右下角，点一下平滑滚到底并恢复跟随。
 *
 * 深色圆钮 + 向下箭头：它是一个「往下走」的动作，箭头比回旋镖更直白。
 * `unread > 0` 时上方顶一枚数字角标——人往上翻的时候，底下新到了几条要看得见；
 * 贴着底部（pinned）时调用方不渲染它，所以角标只在真正离开底部时出现。
 *
 * 位置由调用方给（`className`）：私聊要避开最右边的消息定位条（right-8），
 * 群聊没有定位条，贴右边即可（right-4）。
 */
export function FollowLatestButton({
  onClick,
  unread = 0,
  className = '',
}: {
  onClick: () => void
  /** 底下还没看过的消息条数；0 = 不显角标 */
  unread?: number
  /** 定位与间距（absolute / bottom / right 由调用方组合） */
  className?: string
}) {
  const badge = unread > 99 ? '99+' : String(unread)
  const label = unread > 0 ? t('回到最新消息（{0} 条新消息）', unread) : t('回到最新消息（恢复自动滚动）')
  return (
    <button
      type="button"
      data-follow-latest
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        'moji-in-soft absolute z-20 flex h-10 w-10 items-center justify-center rounded-full bg-ink-strong text-paper shadow-[0_8px_24px_rgba(31,27,23,0.28)] transition hover:bg-ink active:scale-95 ' +
        className
      }
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v13" />
        <path d="m6.5 12.5 5.5 5.5 5.5-5.5" />
      </svg>
      {unread > 0 ? (
        <span
          data-unread-badge
          className="absolute -top-2 left-1/2 min-w-[18px] -translate-x-1/2 rounded-full bg-teal-500 px-1 py-[1px] text-center text-[10px] font-semibold leading-[13px] text-white shadow-sm"
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/**
 * 一枚引用 chip（React 侧，用户消息的分词产物）：#[{…}] 语法的文本在这里渲染成
 * 可点击的引用，点击打开它指向的文档 / 试卷（opener 由 LearnWorkspace 登记，见 lib/docChip）。
 */
function ChipView({ payload }: { payload: ChipPayload }) {
  return (
    <button
      type="button"
      className="moji-chip"
      title={chipToken(payload)}
      onClick={(e) => {
        e.stopPropagation()
        openChipRef(payload)
      }}
    >
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: chipSvg(payload.type) }} />
      <span className="moji-chip-label">{chipLabel(payload)}</span>
    </button>
  )
}

/** 消息文本 → 文字与 chip 交替：解析得开的 #[{…}] 成为一枚引用，其余照旧是文字 */
function ChipText({ text }: { text: string }) {
  const segments = useMemo(() => splitChips(text), [text])
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'text' ? <span key={i}>{seg.text}</span> : <ChipView key={i} payload={seg.payload} />,
      )}
    </>
  )
}

/**
 * 单个独立段落：memo 包装。
 *
 * 为什么独立 memo：
 * 分段缓冲输出时，每多输出一段，历史已经渲染好的段落不会重新 reconcile 或重跑 marked.parse。
 * 新段落独立挂载并带有 moji-paragraph-in 渐进动画。
 */
const ParagraphBlock = memo(function ParagraphBlock({
  rawText,
  animate = false,
}: {
  rawText: string
  animate?: boolean
}) {
  const html = useMemo(() => {
    // 裸网址会被 GFM 自动链接包成 <a>，把 token 拆碎在相邻文本节点里、hydrate 凑不齐
    //（引用里带链接必踩）：渲染前把 token 掩蔽成哨兵，渲染后复原
    const { masked, tokens } = maskChipTokens(rawText)
    return restoreChipTokens(renderNote(masked), tokens)
  }, [rawText])

  return (
    <div className={animate ? 'moji-paragraph-in' : undefined}>
      <MarkdownView html={html} className="moji-agent-md" />
    </div>
  )
})

/**
 * 导师正文分段缓冲渲染：
 * 按照换行符（\n / \n\n）与 Markdown 块级语法切分为独立段落。流式输出时每累加一段即渲染一段，
 * 各段落通过 ParagraphBlock 独立 memo，追加新段落时已渲染的历史段落绝对不重渲染，
 * 每个段落初次挂载时带有渐进动画（moji-paragraph-in）。
 */
function TextBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const segments = useMemo(() => splitParagraphs(text, { streaming }), [text, streaming])

  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, idx) => (
        <ParagraphBlock key={idx} rawText={seg} animate={streaming} />
      ))}
    </div>
  )
}

export { QuoteChip, MessageActions, Parts, TextBlock, ParagraphBlock, ChipText }
