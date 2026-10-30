/**
 * 一条消息长什么样：引文、气泡里的附件、操作按钮、编辑框，以及正文里的
 * 消息组（思考 / 工具调用 / 注入的提示词模块）/ 文本块 / 提示块，外加列表右下角那颗「回到最新」。
 *
 * 层级与用色的规矩：**只有用户消息保留气泡本尊**（同色系、深一档的底色圆角）；其余一律无壳——
 * 导师的正文、思考气泡、工具调用气泡、消息组的收拢容器都不带边框与底色，
 * 分层靠排版与缩进。相邻至少两条的过程件才收进消息组，落单的不成组，
 * 自己就是一条气泡。
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
  Pencil,
  Quote,
  Trash2,
  X,
} from 'lucide-react'
import type { AgentPart, ConversationMessage, MessageImage, MessageQuote } from '../../../agent/types'
import MarkdownView from '../../MarkdownView'
import UsageLine from '../UsageLine'
import { renderNote } from '../../../lib/markdown'
import { focusQuote } from '../../../lib/quoteFocus'
import { NO_AUTOFILL } from '../../../lib/autofill'
import { BubbleFile, BubbleImage } from './Images'
import { DeliveryBlock } from './DeliveryBlock'
import { ToolCard } from './ToolCard'
import { lastLineOf } from './preview'
import { toolLabel } from './toolLabel'
import { useFold } from './useFold'
import { isInterruptedNotice } from '../../../learn/agent/inflight'
import { groupParts, isProcessPart, type InjectItem, type ProcessPart } from './partGroups'
import { openChipRef, type ChipPayload } from '../../../lib/docChip'
import { chipLabel, chipSvg, chipToken, maskChipTokens, restoreChipTokens, splitChips } from '../../../lib/chipSyntax'
import { promptModuleByKey } from '../../../learn/ai/promptModules'
import { splitParagraphs } from './paragraphBuffer'
import { t, useLocale } from '../../../i18n'

/**
 * 一条消息在列表里的全部输入。
 *
 * 只传**这一条自己的**东西：整份 messages、整个 editing、confirmDel 都不下来——
 * 它们一变就换身份，memo 等于没加。faded / flash / confirming / editingText 都是
 * 父组件按这一条算好的值（算法与拆分前逐字相同）。
 */
interface MessageRowProps {
  m: ConversationMessage
  /** 这一条在失活分界线之前：已经被折进摘要，只作显示（淡一档） */
  faded: boolean
  /** 刚从定位条跳过来的那一条：闪一下 */
  flash: boolean
  /** 待确认删除的就是这一条：删除按钮变成「确认」 */
  confirming: boolean
  /** 这一条正在编辑时的文本；没在编辑就是 null */
  editingText: string | null
  /**
   * 这一轮开始前注入的那几条提示词（人格 / 文档格式 / 技能库 / 提示词模块，
   * 见 agent/messageKind）。它们并进回复里的「思考、工具与提示词」过程组——
   * 与思考、工具调用同一层，而不是在对话流里单独画一条分界条。
   * 由 useMessageList 从隐藏消息合成，身份只在 messages 变了之后才换。
   */
  prelude?: InjectItem[]
  /** 每条消息的 DOM：定位条与缩放都要用 */
  msgRefs: React.RefObject<Map<string, HTMLDivElement>>
  /** 点中断说明旁的「继续」：恢复被中断的一轮（见 AgentPanel；只挂在正文的 NoticeBlock 上） */
  onResumeNotice?: () => void
  /** 保存编辑：id 与文本由这一行自己带上去（见 AgentPanel 里 saveEdit 的说明） */
  onSaveEdit: (id: string, text: string) => void
  /** 删除：第一次点只是请人再确认一次，判据在 AgentPanel 的 clickDelete 里 */
  onDelete: (id: string) => void
  setEditing: React.Dispatch<React.SetStateAction<{ id: string; text: string } | null>>
  setBubblePreview: React.Dispatch<React.SetStateAction<MessageImage | null>>
  /** 点击文件/图片附件时在标签页中打开 */
  onOpenFile?: (pathOrRel: string, title?: string) => void
  /** 目标 id：用于交付组件定位节点文档，避免多目标同名节点指针混淆 */
  goalId?: string
}

/**
 * 单条消息：用户气泡 / 导师回复 / 导师动作的分界条。原来写在 useMessageList 的 map 里，
 * 挪出来只为了能 memo——DOM 结构与类名一字未改（Fragment 换成组件，不多一层节点）。
 *
 * 为什么 memo 得住、又不会「数据变了却不重渲染」：**能变的东西全在 props 里**，
 * 而且都是按值或按身份比的——
 *   · m 是消息本体：store 改一条就换出新的那一个对象，没动过的历史消息还是原来那一个；
 *   · faded / flash / confirming / editingText 是父组件按这一条算出来的布尔与字符串；
 *   · msgRefs、setEditing、setBubblePreview 身份恒定（一个 ref 与两个 setState）；
 *   · onSaveEdit / onDelete 由 AgentPanel 用 useCallback 包成恒定身份，它们要的
 *     id 与文本由这一行带上去，因此**行为**永远是最新的那一份（见那边的注释）。
 * 于是流式写作时逐跳重渲染的只有正在长的那一条，历史消息整棵子树原地不动。
 */
export const MessageRow = memo(function MessageRow({
  m,
  faded,
  flash,
  confirming,
  editingText,
  prelude,
  msgRefs,
  onResumeNotice,
  onSaveEdit,
  onDelete,
  setEditing,
  setBubblePreview: _setBubblePreview,
  onOpenFile,
  goalId,
}: MessageRowProps) {
  // memo 挡住了 props 浅比较相等的重渲染：界面语言变化要自己订阅才跟得上
  useLocale()
  /** 失活的消息淡一档（与拆分前的 ' opacity-55' 逐字相同） */
  const fadedCls = faded ? ' opacity-55' : ''

  if (m.role === 'user') {
    return (
      <div
        ref={(el) => {
          if (el) msgRefs.current.set(m.id, el)
          else msgRefs.current.delete(m.id)
        }}
        className={'group mb-3 flex items-end justify-end gap-1.5' + fadedCls}
      >
        <MessageActions
          confirming={confirming}
          onEdit={() => setEditing({ id: m.id, text: m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('') })}
          onDelete={() => onDelete(m.id)}
        />
        {editingText !== null ? (
          <EditBox
            value={editingText}
            onChange={(v) => setEditing({ id: m.id, text: v })}
            onSave={() => onSaveEdit(m.id, editingText)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          // moji-msg-flash：定位条跳过来的那一条闪一下（圆角是为了让描边跟着气泡的形状走）
          <div
            className={
              'max-w-[85%] rounded-2xl ' + (flash ? 'moji-msg-flash' : '')
            }
          >
            {m.quote && <QuoteChip quote={m.quote} />}
            {/* 附件排在文字上方：与输入框里的排列一致，发出去前后看到的是同一个顺序 */}
            {!!m.images?.length && (
              <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                {m.images.map((img) => (
                  <BubbleImage
                    key={img.id}
                    image={img}
                    onOpen={() => {
                      const target = img.rel
                      if (target) onOpenFile?.(target, img.name)
                    }}
                  />
                ))}
              </div>
            )}
            {/* 外部文件附件回显：点击在标签页打开 */}
            {!!m.files?.length && (
              <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
                {m.files.map((file, idx) => (
                  <BubbleFile
                    key={file.uuid ?? `${file.name}-${idx}`}
                    file={file}
                    onOpen={() => {
                      const target = file.path || file.rel
                      if (target) onOpenFile?.(target, file.name)
                    }}
                  />
                ))}
              </div>
            )}
            {/* 只发了图没写字时不留一个空气泡。底色与列表同色系、只深一档（纸面上的同一族颜色），
                文字与导师正文同色——气泡只负责「这是你说的话」，不负责抢眼 */}
            {m.parts.some((p) => p.type === 'text' && p.text.trim()) && (
              <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-line/50 px-3 py-2 text-[13.5px] leading-relaxed text-ink">
                <ChipText text={m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')} />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={(el) => {
        if (el) msgRefs.current.set(m.id, el)
        else msgRefs.current.delete(m.id)
      }}
      className={'group relative mb-4' + fadedCls}
    >
      <Parts parts={m.parts} prelude={prelude} onResumeNotice={onResumeNotice} />
      {/* 这一轮的交付账：有登记才出现，一行一条（见 DeliveryBlock） */}
      {m.delivery && <DeliveryBlock delivery={m.delivery} onOpenFile={onOpenFile} goalId={goalId} />}
      {m.usage && (
        <div className="mt-1">
          <UsageLine usage={m.usage} />
        </div>
      )}
      <div className="mt-1 flex justify-start opacity-0 transition group-hover:opacity-100">
        <MessageActions
          confirming={confirming}
          onEdit={() => setEditing({ id: m.id, text: m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n') })}
          onDelete={() => onDelete(m.id)}
        />
      </div>
      {editingText !== null && (
        <EditBox
          value={editingText}
          onChange={(v) => setEditing({ id: m.id, text: v })}
          onSave={() => onSaveEdit(m.id, editingText)}
          onCancel={() => setEditing(null)}
        />
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

function MessageActions({
  confirming,
  onEdit,
  onDelete,
}: {
  confirming: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        title={t('编辑')}
        onClick={onEdit}
        className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
      >
        <Pencil size={12} />
      </button>
      <button
        type="button"
        title={confirming ? t('再点一次删除') : t('删除')}
        onClick={onDelete}
        className={`flex h-6 items-center justify-center rounded transition ${
          confirming
            ? 'bg-seal/10 px-1.5 text-[10.5px] font-medium text-seal ring-1 ring-seal/40'
            : 'w-6 text-ink-faint hover:bg-line/70 hover:text-seal'
        }`}
      >
        {confirming ? t('确认') : <Trash2 size={12} />}
      </button>
    </div>
  )
}

function EditBox({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="w-full">
      <textarea
        value={value}
        autoFocus
        rows={4}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSave()
          }
          if (e.key === 'Escape') onCancel()
        }}
        className="w-full resize-y rounded-lg border border-seal/40 bg-card px-2.5 py-2 text-[12.5px] leading-relaxed text-ink outline-none"
        {...NO_AUTOFILL}
      />
      <div className="mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSave}
          className="flex items-center gap-1 rounded-md bg-ink px-2 py-1 text-[11.5px] text-paper transition hover:bg-ink-strong"
        >
          <Check size={12} /> {t('保存')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/60"
        >
          <X size={12} /> {t('取消')}
        </button>
        <span className="ml-auto text-[10.5px] text-ink-faint">Ctrl/⌘ + Enter</span>
      </div>
    </div>
  )
}

/**
 * 把一条消息的部件序列排成一段段：**相邻的过程件**（思考 / 工具调用 / 注入的提示词模块）
 * 连成的候选组，以及其余独立成条的东西（正文、运行时提示）。归组规则本身是纯函数、
 * 住在 panel/partGroups 里（有单元用例钉着）——这里只管「怎么画」。
 *
 * prelude（轮开始前注入的那几条提示词）由 groupParts 排在最前面、与后面的过程件同组：
 * 于是这一轮从头到尾只有**一条**折叠标题，而不是「提示词注入」与「思考与工具」两行。
 *
 * 只有一个成员的组按单条画：孤零零一件没有可收拢的东西，硬套组壳等于多一次点击。
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
  const groups = groupParts(parts, prelude)
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g, i) => {
        if (g.kind === 'group' && g.items.length > 1) return <ProcessGroup key={i} items={g.items} />
        const part = g.kind === 'single' ? g.part : g.items[0]
        // 落单的提示词注入：与过程件同一副样子（折叠标题 + 展开看全文），也带那道下边框
        if (part.type === 'inject') {
          return (
            <div key={'inject-' + part.id} className="border-b border-line pb-2">
              <InjectBlock item={part} />
            </div>
          )
        }
        // 落单的过程件与组一样带一道下边框，和后面的正文分割开；正文与提示不带
        return isProcessPart(part) ? (
          <div key={i} className="border-b border-line pb-2">
            <SinglePart part={part} streaming={streaming} />
          </div>
        ) : (
          <SinglePart key={i} part={part} onResumeNotice={onResumeNotice} streaming={streaming} />
        )
      })}
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
  return null
}

/**
 * 消息组：**相邻且至少两条**的过程件（思考 / 工具调用 / 注入的提示词模块 / 轮开始时的
 * 提示词注入）合进来，默认折叠。组本身**不画壳**——没有边框、没有底色、没有内边距，
 * 收拢关系全靠标题行与展开后的缩进表达；底部一道下边框把它和后面的正文分割开。
 * 展开后里面是一条条独立的思考气泡（ThinkingBlock）、工具调用气泡（ToolCard）、
 * 提示词模块块（PromptModuleBlock）与注入块（InjectBlock），各自管各自的展开收起，
 * 底部还有组级的「收起」。
 *
 * 折叠态不是一行死标题——它持续显示组里**当前最后一件**的内容，与思考气泡
 * 同一个意图：模型可能安静十几秒，一行不断往左滚的字，一眼就能看出「它还在写」。
 * 思考件取最后一行（lastLineOf，只扫末尾窗口），工具件取那一步的标题，
 * 提示词模块取模块名；组里新进来一件，预览就跟着换过去。模型的正文永远在组外
 * （见 Parts 的归组规则），那才是用户要直接读的话。
 *
 * 标题里的「提示词」只在组里真有模块或注入时才写：常驻一个用不上的词，等于把
 * 「这一步是什么」这件事说糊（模块本来就是低频的十几条之一）。
 */
function ProcessGroup({ items }: { items: ProcessPart[] }) {
  const { open, shown, toggle } = useFold()
  const last = items[items.length - 1]
  const hasPrompt = items.some((p) => p.type === 'prompt-module' || p.type === 'inject')
  /**
   * 预览不进 useMemo：流式时 applyEvent 是**原地改 part 对象**的（setStreaming 只换
   * 数组壳，对象身份不变），认对象会让预览冻在第一帧——思考在长，组上却看不见。
   * lastLineOf 只扫末尾一个窗口，每次渲染现算也花不了几个钱。
   */
  const tail =
    last.type === 'thinking'
      ? lastLineOf(last.text) || '…'
      : last.type === 'prompt-module'
        ? t('提示词模块 · {0}', promptModuleByKey(last.key)?.title ?? last.key)
        : last.type === 'inject'
          ? last.label
          : toolLabel(last.name, last.args)

  return (
    <div className="border-b border-line pb-2">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 text-left text-[12.5px] text-ink-faint transition hover:text-ink-soft"
      >
        {/* 折叠指示：与思考气泡、工具气泡同一套 chevron 词汇 */}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="shrink-0">
          {hasPrompt ? t('思考、工具与提示词 · {0} 步', items.length) : t('思考与工具 · {0} 步', items.length)}
        </span>
        {!open && (
          /*
            一行预览，看的是组里最后一件。靠 CSS 贴右端而不是 useLayoutEffect 里写
            scrollLeft = scrollWidth：后者每挂一个气泡就强制一次整页排版，justify-end +
            overflow-hidden 让它在布局阶段就贴到右端——溢出到左边的那截正好被裁掉，
            效果一样，一分钱不花。
          */
          <span className="flex min-w-0 flex-1 justify-end overflow-hidden">
            <span className="shrink-0 whitespace-nowrap opacity-75">{tail}</span>
          </span>
        )}
      </button>
      <div className={'moji-fold' + (open ? ' moji-fold-open' : '')}>
        <div>
          {shown && (
            /* pl-3 是展开内容自己的缩进（嵌套的视觉），不是组容器的内边距 */
            <div className="flex flex-col gap-2 pt-2 pl-3">
              {items.map((p, i) =>
                p.type === 'thinking' ? (
                  <ThinkingBlock key={i} text={p.text} />
                ) : p.type === 'prompt-module' ? (
                  <PromptModuleBlock key={'m' + i} part={p} />
                ) : p.type === 'inject' ? (
                  <InjectBlock key={'i' + p.id} item={p} />
                ) : (
                  <ToolCard key={p.id || i} part={p} />
                ),
              )}
              <button
                type="button"
                onClick={toggle}
                className="self-start text-[12px] text-ink-faint transition hover:text-ink-soft"
              >
                {t('收起')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 思考过程气泡（消息组的嵌套件，也可能落单独立成条）。**无壳**：没有边框与
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
function ThinkingBlock({ text }: { text: string }) {
  const { open, shown, toggle } = useFold()
  const tail = useMemo(() => lastLineOf(text), [text])
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** 读者此刻是不是停在正文底部：流式续写时据此决定要不要跟着滚 */
  const atBottomRef = useRef(true)
  /** 上一次渲染的正文：只有它**变长了**才谈得上跟着滚（展开历史思考不该跳到末尾） */
  const prevText = useRef(text)

  useEffect(() => {
    const el = bodyRef.current
    const grew = text !== prevText.current
    prevText.current = text
    if (!el || !grew || !atBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [text])

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
 * 提示词模块这些「提示词注入」并进那一轮的过程组，不再挤到这里来——从前它们混在
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
 * 它与思考、工具调用是同一层——轮次进行中的一个片段，**不分割轮次**，也一起进消息组
 * （见 Parts 与 ProcessGroup）：折叠时一行「提示词模块 · 界面操作 · 已注入上下文」
 * （与消息组同一套 chevron 词汇），展开看注入的全文。透明化是这套机制的立身之本：
 * 上下文里被注入了什么，用户随时点开就能看到。
 *
 * 自己**不画**那道下边框：落单时由 Parts 的包裹层给，进组时由组给——同一处边框
 * 画两遍，组里就会多出一道把「过程」切成两截的横线。
 */
function PromptModuleBlock({ part }: { part: Extract<AgentPart, { type: 'prompt-module' }> }) {
  const [open, setOpen] = useState(false)
  const title = promptModuleByKey(part.key)?.title ?? part.key
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
 * 一条**提示词注入**（人格 / 文档格式 / 技能库 / 提示词模块）在过程组里的折叠块。
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
 * 图标是手画的 inline SVG（不走图标库）：一支回旋镖，去而复返地扎向下方——
 * 与发送、停止那些功能性图标不会看混。
 */
export function FollowLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('回到最新消息（恢复自动滚动）')}
      // right-8 而不是 right-3：最右边那条留给消息定位条，两者别叠在一起
      className="moji-in-soft absolute bottom-3 right-8 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-card/70 text-ink-soft shadow-[0_6px_20px_rgba(31,27,23,0.18)] transition hover:border-seal/50 hover:text-seal"
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6.5 4.5c7.5 0 10 3.8 10 10.5" />
        <path d="M12.2 10.8 16.5 15l4.3-4.2" />
      </svg>
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

export { QuoteChip, MessageActions, EditBox, Parts, TextBlock, ParagraphBlock }
