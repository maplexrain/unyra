/**
 * 输入区：整张卡片（附件列 + textarea + 底部工具条），以及卡片上方那几块
 * 「导师接下来的计划」（api.iwanna）、结构化表单与未配置 Key 的提示。
 *
 * 状态在 useComposer.ts（草稿与附件）、菜单在 usePlusMenu.tsx / PlusMenu.tsx，
 * 接线在 useComposerUi.tsx；这里只负责画和接。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Bot, ChevronRight, ListChecks, Square } from 'lucide-react'
import type { AskAnswers, AskFormPayload } from '../../../agent/tools'
import type { Conversation, MessageUsage, PendingImage } from '../../../agent/types'
import type { ReasoningEffort } from '../../../ai/types'
import ModelPicker from '../ModelPicker'
import ContextRing from '../ContextRing'
import { AskFormCard } from './AskFormCard'
import { FileChip, ImageThumb } from './Images'
import { PlusMenu } from './PlusMenu'
import { useSlashMenu, type SlashItem } from './useSlashMenu'
import type { ComposerApi } from './useComposer'
import type { MenuSub } from './types'
import { caretAtEnd, chipHtml, escapeHtml, placeCaretEnd, serializeEditable } from '../../../lib/composerDoc'
import { registerDocChipTarget } from '../../../lib/docChip'
import { t } from '../../../i18n'

export interface ComposerProps {
  composer: ComposerApi
  /**
   * 「+」菜单：状态机在 usePlusMenu 里，这里只把它画出来。
   * 拆成一个个 prop（而不是整个对象传下来）是为了绕开 react(refs) 的误报，见下面那段注释。
   */
  menuMounted: boolean
  menuClosing: boolean
  menuSub: MenuSub
  menuOpen: boolean
  menuLeaving: { sub: MenuSub; dir: 1 | -1 } | null
  menuDir: 1 | -1
  menuBodyH: number | null
  panelMount: (el: HTMLDivElement | null) => void
  panelBodyMount: (el: HTMLDivElement | null) => void
  buttonMount: (el: HTMLButtonElement | null) => void
  renderMenuPanel: (sub: MenuSub) => ReactNode
  goRoot: () => void
  toggle: () => void
  plusButtonClass: string
  running: boolean
  hasKey: boolean
  /** 当前提供商的显示名，仅用于「未配置」提示 */
  providerLabel: string
  /** 导师预告的接下来要做什么（api.iwanna）：只展示，不可勾选，一轮结束就消失 */
  iwanna: string[] | null
  /**
   * 待回答的结构化表单（api.ask 发起的）：显示在输入框上方，提交前沙箱一直阻塞着。
   * id 是这一次表单的身份（重开一张表单时 key 换掉，旧答案不会串）。
   */
  ask: { id: string; form: AskFormPayload } | null
  onAskSubmit: (answers: AskAnswers) => void
  onAskCancel: () => void
  /** 这个对话里所有回复的 token 账：圆环据此汇总 */
  usages: MessageUsage[]
  onModelChanged: () => void
  onStop: () => void
  onNewConversation: () => void
  conversations: Conversation[]
  conversation: Conversation | null
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onRecall: () => void
  onSuperLab: () => void
  onCheckin: () => void
  onCompact: () => void
  compacting: boolean
  /** 自动压缩阈值（0~1），菜单项上如实说明「到多少会自己压」 */
  compactThreshold: number
  onOpenAgentSettings: () => void
  /** 斜杠 /exam：跑内置工作流「出卷」（导师先问类型与难度） */
  onExam: () => void
  /** 全局推理等级（斜杠 /effort 的二级菜单读它画「当前」） */
  effort: ReasoningEffort
  onSetEffort: (e: ReasoningEffort) => void
  /** 点开输入框里的缩略图看大图 */
  onOpenPreview: (image: PendingImage) => void
  /**
   * 子会话模式：面板正看着一个子代理会话。输入框禁用（子会话只接受导师的调度），
   * 「+」菜单与模型选择器这些导师域的控件一并隐藏；「停止」保留——停的是整轮，
   * 会级联中止正在跑的子代理。
   */
  subMode?: { name: string; running: boolean }
  /** 子代理会话入口（按钮 + 弹出列表），插在模型选择器左侧；没有会话时不渲染 */
  subAgentSlot?: ReactNode
  /** 拖拽悬停：高亮输入框，告诉用户「松手就放这里」 */
  dragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}

export function Composer(props: ComposerProps) {
  /*
   * 全部拆成局部变量再进 JSX：composer 里有一个挂载回调要交给 textarea 的 ref 属性，
   * 而 react(refs) 规则一旦看见 `composer.xxx` 出现在 ref 位置上，就会把整个 composer
   * 当成 ref（之后每一次 composer.yyy 都报「渲染期访问 ref」）。拆开之后就没这回事。
   */
  const {
    composer,
    menuMounted,
    menuClosing,
    menuSub,
    menuOpen,
    menuLeaving,
    menuDir,
    menuBodyH,
    panelMount,
    panelBodyMount,
    buttonMount,
    renderMenuPanel,
    goRoot,
    toggle,
    plusButtonClass,
    running,
    hasKey,
    providerLabel,
    iwanna,
    ask,
    onAskSubmit,
    onAskCancel,
    usages,
    onModelChanged,
    onStop,
    onNewConversation,
    conversations,
    conversation,
    onSelectConversation,
    onCompact,
    compacting,
    onOpenAgentSettings,
    onExam,
    effort,
    onSetEffort,
    onSuperLab,
    onOpenPreview,
    subMode,
    subAgentSlot,
    dragOver,
    onDragOver,
    onDragLeave,
    onDrop,
  } = props
  const { value, images, files, submit, setValue, pasteImages, removeImage, removeFile, clearAttachments } = composer

  /**
   * 输入框自己的 ref：斜杠菜单的项被点掉之后把焦点送回去（点菜单项会把焦点带到
   * 按钮上，菜单一卸载焦点就落进 body——下一个命令就得先点一下输入框才打得进去）。
   */
  const editorRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const editorMount = (el: HTMLDivElement | null) => {
    composer.editorMount(el)
    editorRef.current = el
  }

  /** 任何编辑（打字、粘贴、接受补全、拖进页签）之后同步一次镜像：斜杠菜单、占位符与发送键都读它 */
  const onEdit = () => {
    const el = editorRef.current
    if (el) setValue(serializeEditable(el))
  }

  /** 外部清空（发送、斜杠命令执行、Esc）走 setValue('')：镜像归零，这里跟着把编辑区清掉 */
  useEffect(() => {
    if (value !== '') return
    const el = editorRef.current
    if (el && el.innerHTML !== '') el.innerHTML = ''
  }, [value])

  /**
   * 幽灵补全的那截灰字：直接操作 DOM（页签栏的棱形同款做法）——它跟着光标逐键挪，
   * 走 state 既会把整块面板带上重渲染，也撞「effect 里 setState」的 lint。
   */
  const ghostRef = useRef<HTMLSpanElement | null>(null)

  /**
   * 登记成页签的落点：文档区的页签真正拖出来之后，落在输入卡片上就变成一枚引用
   * （发送时按登记的路径信息展开，见 lib/composerDoc）。子会话模式不登记——那里的输入框只读。
   * 悬停高亮用本地 state：值不变时 setState 自己 bail，指针压着也不会每帧重渲染。
   */
  const [chipHover, setChipHover] = useState(false)
  useEffect(() => {
    // 登记的是整张输入卡片（附件列、工具条都算落点），不是只有正文那一块
    const el = cardRef.current
    if (!el || subMode) return
    registerDocChipTarget({
      el,
      hover: setChipHover,
      receive: (doc) => {
        const box = editorRef.current
        if (!box) return
        placeCaretEnd(box)
        document.execCommand('insertHTML', false, chipHtml(doc))
        box.dispatchEvent(new Event('input', { bubbles: true }))
      },
    })
    return () => registerDocChipTarget(null)
  }, [subMode])

  /** 粘贴：图片走附件那条路；纯文本拍平了插进来（contenteditable 默认会粘成带样式的 HTML） */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const data = e.clipboardData
    if (!data) return
    if ([...data.items].some((it) => it.kind === 'file' && it.type.startsWith('image/'))) {
      pasteImages(e)
      return
    }
    const text = data.getData('text/plain')
    if (!text) return
    e.preventDefault()
    document.execCommand('insertHTML', false, escapeHtml(text).split('\n').join('<br>'))
  }

  /**
   * 斜杠命令菜单（见 useSlashMenu）：状态机在这里，画在下面输入卡片上方那一块。
   * 清输入走 setValue('')——命令不是消息，执行完草稿里不该还留着「/compact」。
   */
  const slash = useSlashMenu({
    value,
    clear: () => setValue(''),
    running,
    hasKey,
    compacting,
    effort,
    conversations,
    conversation,
    onCompact,
    onNewConversation,
    onSelectConversation,
    onSetEffort,
    onOpenAgentSettings,
    onExam,
    onSuperLab,
  })

  /*
   * 幽灵补全：斜杠菜单开着、且高亮的那条命令还有没打出来的后半截时，把那半截
   * 以灰字画在光标后面，Tab（或光标在末尾时的 →）收进输入框。与斜杠菜单同一条
   * 判据（整段输入就是这截命令），另外只在光标位于末尾时出现——半截命令本来就打在末尾。
   */
  const ghostText = (() => {
    if (!slash.active || slash.level !== 'root') return ''
    const item = slash.items[slash.highlight]
    if (!item || item.disabled || item.sub) return ''
    const typed = value.startsWith('/') ? value.slice(1).toLowerCase() : ''
    return item.key.startsWith(typed) ? item.key.slice(typed.length) : ''
  })()

  useLayoutEffect(() => {
    const el = editorRef.current
    const measurable = !!ghostText && !!el && document.activeElement === el && caretAtEnd(el)
    const sel = measurable ? window.getSelection() : null
    const rect =
      sel && sel.rangeCount > 0 && sel.isCollapsed && el!.contains(sel.anchorNode)
        ? sel.getRangeAt(0).getBoundingClientRect()
        : null
    if (!ghostText || !rect || (!rect.left && !rect.top)) {
      ghostRef.current?.remove()
      ghostRef.current = null
      return
    }
    let g = ghostRef.current
    if (!g) {
      g = document.createElement('span')
      g.className =
        'pointer-events-none fixed z-40 select-none whitespace-pre text-[13px] leading-relaxed text-ink-faint/80'
      document.body.appendChild(g)
      ghostRef.current = g
    }
    g.textContent = ghostText
    g.style.left = rect.left + 'px'
    g.style.top = rect.top + 'px'
  }, [ghostText, value, subMode])

  /** 收下幽灵：把半截命令补成完整的「/命令」，光标留末尾——菜单继续开着，回车即执行 */
  const acceptGhost = () => {
    const item = slash.items[slash.highlight]
    const el = editorRef.current
    if (!el || slash.level !== 'root' || !item || item.disabled) return
    el.textContent = '/' + item.key
    placeCaretEnd(el)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 斜杠命令先接：Enter / 方向键 / Esc / 退格（二级）都归它，剩下的才是补全与发送
    if (slash.onKeyDown(e)) return
    if (
      ghostRef.current &&
      (e.key === 'Tab' || (e.key === 'ArrowRight' && editorRef.current && caretAtEnd(editorRef.current)))
    ) {
      e.preventDefault()
      acceptGhost()
      return
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      // contenteditable 的默认 Enter 会插进一个 div 壳，序列化还得另算一层——两键都拦下自己插
      if (e.shiftKey) document.execCommand('insertLineBreak')
      else submit()
    }
  }

  /** 斜杠菜单的一行。一级带 /命令 的等宽小字，二级带「当前」角标（历史 / effort 共用一张表结构） */
  const slashItem = (item: SlashItem, i: number) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      title={item.hint}
      onClick={() => {
        slash.pick(item)
        editorRef.current?.focus()
      }}
      onMouseEnter={() => slash.hover(i)}
      className={
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink transition disabled:pointer-events-none disabled:opacity-40 ' +
        (i === slash.highlight ? 'bg-line/60' : '')
      }
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-faint">{item.icon}</span>
      {slash.level === 'root' && (
        <span className="w-[72px] shrink-0 font-mono text-[11.5px] text-ink-soft">/{item.key}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.current && (
        <span className="shrink-0 rounded bg-seal/15 px-1 py-px text-[10px] text-seal-deep">{t('当前')}</span>
      )}
      {slash.level === 'root' && item.hint && (
        <span className="shrink-0 text-[10.5px] text-ink-faint">{item.hint}</span>
      )}
      {item.sub && <ChevronRight size={13} className="shrink-0 text-ink-faint" />}
    </button>
  )

  return (
    <>
      {/* 导师预告的计划（api.iwanna）：紧贴输入区，回答问题时余光也看得见 */}
      {iwanna && iwanna.length > 0 && (
        <div className="moji-in-soft mb-2 rounded-xl border border-seal/25 bg-seal/[0.05] px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-seal-deep">
            <ListChecks size={12} />
            {t('导师接下来的计划')}
          </div>
          <ol className="mt-1 space-y-0.5 pl-1">
            {iwanna.map((item, i) => (
              <li key={i} className="flex items-baseline gap-1.5 text-[11.5px] leading-relaxed text-ink">
                <span className="shrink-0 tabular-nums text-ink-faint">{i + 1}.</span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* 结构化表单（api.ask）：压在输入框上方，提交之前沙箱一直等着 */}
      {ask && (
        <AskFormCard key={ask.id} form={ask.form} onSubmit={onAskSubmit} onCancel={onAskCancel} />
      )}

      {!hasKey && (
        <div className="mb-2 rounded-lg border border-seal/25 bg-seal/5 px-2.5 py-1.5 text-[11.5px] text-seal-deep">
          {t('尚未配置「{0}」的 API Key，请到顶栏设置中填写（也可在那里更换提供商）。', providerLabel)}
        </div>
      )}

      {/*
        输入区与目标创建页保持同一套观感：
        整张卡片 = 加高的输入框 + 底部一条工具条（无分割线）。
        右下角依次是模型选择器与圆形发送键。

        外面这一层 relative 只管一件事：当「+」菜单的定位参照。菜单 absolute 弹在卡片上方，
        宽度与卡片一致（见 PlusMenu 里的 left-0 right-0）——所谓「等宽且不占位」就是它。
      */}
      <div className="relative">
      {/*
        斜杠命令菜单：输入框里是「/ + 一截字母」时出现，弹在卡片上方（与「+」菜单同一块地皮，
        同一个定位参照——外面这层 relative）。定位与观感照搬「+」菜单：等宽、不占位、
        往上长；它是打字打出来的，不点别处收起，Esc / 发空 / 选中即走。
      */}
      {slash.active && (
        <div
          role="menu"
          className="moji-bloom-up-in absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_12px_36px_rgba(31,27,23,0.22)]"
        >
          <div className="flex items-center gap-1 border-b border-line bg-paper-deep/60 px-2.5 py-1.5 text-[11px]">
            {slash.level === 'root' ? (
              <span className="font-medium text-ink-strong">{t('斜杠命令')}</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    slash.back()
                    editorRef.current?.focus()
                  }}
                  className="text-ink-soft transition hover:text-ink"
                >
                  {t('命令')}
                </button>
                <ChevronRight size={11} className="text-ink-faint" />
                <span className="truncate font-medium text-ink-strong">{slash.title}</span>
              </>
            )}
            <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
              {slash.level === 'root' ? t('↑↓ 选 · Enter 执行 · Esc 取消') : t('↑↓ 选 · Enter 执行 · 退格返回')}
            </span>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {slash.items.length === 0 ? (
              <p className="px-2.5 py-3 text-center text-[11.5px] text-ink-faint">{slash.emptyHint}</p>
            ) : (
              slash.items.map((item, i) => slashItem(item, i))
            )}
          </div>
        </div>
      )}
      <div
        ref={cardRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`rounded-2xl border bg-card shadow-sm transition ${
          dragOver || chipHover
            ? 'border-seal/60 ring-2 ring-seal/20'
            : 'border-line focus-within:border-seal/50 focus-within:ring-2 focus-within:ring-seal/10'
        }`}
      >
        {/*
          附件列在**文字输入区的上方**：横向一条，输入框整体因此向上撑开，
          文字区的位置不因为贴了附件而跳动。横向滚动条隐藏（moji-scroll-x），
          滚轮或触控板横划都能翻。

          图片与文件排在同一条上：对用户来说它们都是「要一起发出去的东西」，
          分成两行只会把输入框顶得更高。区别体现在外观上——图是缩略图，文件是名字。
        */}
        {(images.length > 0 || files.length > 0) && (
          <div className="flex items-center gap-2 border-b border-line/60 px-2.5 py-2">
            <div className="moji-scroll-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {images.map((img) => (
                <ImageThumb
                  key={img.id}
                  image={img}
                  onOpen={() => onOpenPreview(img)}
                  onRemove={() => removeImage(img.id)}
                />
              ))}
              {files.map((file) => (
                <FileChip key={file.id} file={file} onRemove={() => removeFile(file.id)} />
              ))}
            </div>
            <button
              type="button"
              onClick={clearAttachments}
              title={t('移除全部附件')}
              className="shrink-0 rounded-md px-1.5 py-1 text-[10.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
            >
              {t('清空')}
            </button>
          </div>
        )}

        {/*
          输入框是一块 contenteditable：页签拖进来要落成一枚**元素**（可整体删、不可拆开
          编辑），textarea 装不下第二形态。它是非受控的——真正的正文住在 DOM 里，
          composer.value 只是每次编辑后同步过来的「序列化镜像」（斜杠菜单与发送键读它；
          发送时页签已经展开成路径信息，见 lib/composerDoc 的 serializeEditable）。
        */}
        <div className="relative">
          {/* 删空之后 Chromium 会留一根 <br> 当光标锚，所以占位按 trim 判，不能按「空串」判 */}
          {value.trim() === '' && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-2.5 max-w-full truncate text-[13px] leading-relaxed text-ink-faint"
            >
              {subMode
                ? t('子会话只接受导师的调度——回到导师对话给它派任务。')
                : t('向超级导师提问…（/ 可用斜杠命令，可拖入文件、页签、图片）')}
            </span>
          )}
          <div
            ref={editorMount}
            contentEditable={!subMode}
            role="textbox"
            aria-multiline="true"
            spellCheck={false}
            suppressContentEditableWarning
            onInput={onEdit}
            onPaste={onPaste}
            onBlur={() => {
              ghostRef.current?.remove()
              ghostRef.current = null
            }}
            onKeyDown={onKeyDown}
            className={
              'block max-h-56 min-h-[42px] w-full overflow-y-auto rounded-t-2xl bg-transparent px-3.5 pt-2.5 pb-2 text-[13px] leading-relaxed text-ink outline-none ' +
              (subMode ? 'cursor-not-allowed opacity-55' : '')
            }
          />
        </div>

        <div className="flex items-center gap-2 rounded-b-2xl px-2.5 py-2">
          {/*
            左下角那颗「+」：点开在输入框**上方**弹出一块与它等宽的菜单。
            菜单是绝对定位的（不占位），因此它弹出时输入框不会跳动。

            它**必须画在这一行里**（PlusMenu 渲染的是「面板 + 按钮」两件事，按钮在流内）：
            面板靠上面那层 relative 定位，按钮则是这一行 flex 的第一个孩子——放到卡片外面去，
            按钮就会掉到卡片上方（2026-09 拆 panel/ 时就是这么错位的）。
            子会话模式下不画：那些动作都是导师域的。
          */}
          {!subMode && (
            <PlusMenu
              menuMounted={menuMounted}
              menuClosing={menuClosing}
              menuSub={menuSub}
              menuOpen={menuOpen}
              menuLeaving={menuLeaving}
              menuDir={menuDir}
              menuBodyH={menuBodyH}
              panelMount={panelMount}
              panelBodyMount={panelBodyMount}
              buttonMount={buttonMount}
              renderMenuPanel={renderMenuPanel}
              goRoot={goRoot}
              toggle={toggle}
              plusButtonClass={plusButtonClass}
            />
          )}
          {subMode && (
            <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-faint">
              <Bot size={13} className="shrink-0 text-seal" />
              <span className="truncate font-medium text-ink-soft">{subMode.name}</span>
              <span className="shrink-0">· {t('子会话只读')}</span>
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {/*
              这里原先有一颗「添加图片」的按钮，现在**没有它**了：附件统一从
              左下角「更多 → 文件」进——那个入口不设扩展名过滤，图片本来就是它的一部分。
              两颗按钮做同一件事，只会让人猜「图片走哪条、文件走哪条」。
              贴图这条路照旧：拖进来、Ctrl+V 都行，本来就是习惯动作，不必有按钮。
            */}
            {subAgentSlot}
            {!subMode && <ModelPicker onChanged={onModelChanged} />}
            {!subMode && <ContextRing usages={usages} />}
            {running ? (
              <button
                type="button"
                title={t('停止')}
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-paper text-ink-soft shadow-sm transition hover:border-seal/50 hover:text-seal"
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                type="button"
                title={t('发送（Enter）')}
                onClick={submit}
                /*
                 * 斜杠命令打着的时候发不得：那截文字是命令，不是消息（Enter 在斜杠菜单里
                 * 已经被拦下，这颗按钮是同一道闸的鼠标侧）。
                 */
                disabled={!!subMode || slash.active || (!value.trim() && !images.length && !files.length)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-paper shadow-sm transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-35"
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </>
  )
}
