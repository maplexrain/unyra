/**
 * 这个文件负责什么：划词之后弹出来的那一条菜单——它有哪几项、数字键怎么标、询问态的输入框
 * 长什么样，以及它在视口里怎么摆（位置由 note/useSelectionMenu 量好后写进 style）。
 *
 * 动作本身**不在这里**：菜单只报「点了哪一项」（runAction），真正做什么收在上层那一个
 * switch 里——它们要读 ref、要改状态，散在数组里既不好读，也会让「渲染」与「做事」
 * 两份东西各走各的。
 */
import { Fragment, type ReactNode, type RefObject } from 'react'
import { BookOpen, Send, StickyNote, TextSearch } from 'lucide-react'
import { NO_AUTOFILL } from '../../../lib/autofill'
import { t } from '../../../i18n'

export interface SelectionMenu {
  /** 选区中心的视口 x（菜单以自身中心对齐此处） */
  x: number
  /** 选区上下边界（视口坐标），用于在下方空间不足时翻到上方 */
  anchorTop: number
  anchorBottom: number
  /** 选中的渲染态文字（原样的选区文字，给节点标题与 AI 看） */
  text: string
  /**
   * 注解词条：按选区的 DOM 重新取一遍（见 lib/annotation 的 selectionTerm）。
   * 与 text 分开是因为跨元素选择时 selection.toString() 会把公式的排版字符、
   * 块与块之间的换行也带进来，拿它当词条存下去就永远匹配不上正文。
   */
  term: string
  /**
   * 这次选中的是词条在正文里的第几次出现（从 0 起）。
   * 同一个词一段话里出现好几回时，只有记下这个序号，注解才会标在用户划的那一处。
   */
  occurrence: number
  /** 是否是「词条」级选区：短、无标点。过长/跨句的选区只提供「询问」 */
  concept: boolean
  /** 选区映射回 Markdown 源文的字符区间；映射失败为 null */
  loc: { start: number; end: number } | null
}

/** 选中文字菜单的一项。数组顺序 = 显示顺序 = 数字键 1..n（见组件里的 actions） */
export interface MenuAction {
  key: 'learn' | 'understand' | 'note' | 'ask'
  label: string
  icon: ReactNode
  /** 原生 title：每一项说清它做什么（动作在组件的 runAction 里，见那里的说明） */
  title: string
  disabled?: boolean
}

interface Props {
  /** 这一条菜单对应的选区；为 null 时不渲染（保留它，退场动画那一帧才不会读 null 崩掉） */
  menu: SelectionMenu | null
  /** 这份文档还在等导师写：此刻让它解释一个词，读到的是半篇 */
  pending: boolean
  /** 菜单容器：定位要量它的尺寸，数字键要按 [data-hotkey] 找按钮 */
  menuRef: RefObject<HTMLDivElement | null>
  /** 询问态的输入框（聚焦时要 preventScroll，见 note/useSelectionMenu） */
  inputRef: RefObject<HTMLInputElement | null>
  asking: boolean
  question: string
  setQuestion: (value: string) => void
  setAsking: (asking: boolean) => void
  /** 是否正在播退场动画（由上层那只 usePresence 管） */
  menuClosing: boolean
  /** 点某一项：动作表收在上层（见文件头） */
  runAction: (key: MenuAction['key']) => void
  /** 询问态里回车/点发送 */
  submitAsk: () => void
}

/** 划词菜单本体：fixed 定位的一条浮层，位置由上层量好写进 style */
export function SelectionMenuPopup({
  menu,
  pending,
  menuRef,
  inputRef,
  asking,
  question,
  setQuestion,
  setAsking,
  menuClosing,
  runAction,
  submitAsk,
}: Props) {
  /* ---------- 菜单项：渲染与数字键共用这一份 ---------- */

  /**
   * 菜单项。**一份数据两处用**：JSX 按它渲染，数字键按它触发（见下面那个监听）——
   * 分成两处写的话，加一项就会漏一处：要么屏幕上多一行按不动，要么按了数字没反应。
   * 数组顺序就是显示顺序，也就是 1..n。
   *
   * 「学习 / 了解」只对词条开放：它们要围绕一个概念建节点、写释义，选中整段话时
   * 这两个动作没有意义；「注解」与「询问」对任何选区都出现——尤其是「注解」：
   * 用户选中一段话往往正是想为它记点什么。
   */
  const actions: MenuAction[] = menu
    ? [
        ...(menu.concept
          ? ([
              {
                key: 'learn',
                label: t('学习'),
                icon: <BookOpen size={13} />,
                title: t('深入学习「{0}」：创建一个下级节点并展开讲解', menu.text),
              },
              {
                key: 'understand',
                label: t('了解'),
                icon: <TextSearch size={13} />,
                title: t('了解「{0}」：让导师在正文上划一条注解，不新建节点', menu.text),
                // 这份文档还在等导师写：此刻让它解释一个词，读到的是半篇
                disabled: pending,
              },
            ] satisfies MenuAction[])
          : []),
        {
          key: 'note',
          label: t('注解'),
          icon: <StickyNote size={12} />,
          title: t('为选中的这段文字写一条自己的注解（支持 Markdown，可修改/删除）'),
        },
        {
          key: 'ask',
          label: t('询问'),
          icon: <Send size={12} />,
          title: t('就选中的这段内容向 AI 提问'),
        },
      ]
    : []

  // 没有选区就没有这条菜单（退场动画那一帧 menu 还在，所以它照常渲染）
  if (!menu) return null

  return (
    <div
      ref={menuRef}
      style={{ left: menu.x, top: menu.anchorBottom + 8, transform: 'translateX(-50%)' }}
      className="fixed z-30"
    >
      {/*
        动画放在内层：外层用内联 transform 做水平居中，而动画的 fill-mode
        会把 transform 定格成 none，套在外层就把居中吃掉了。
      */}
      <div
        className={`flex items-center gap-0.5 rounded-lg border border-line-strong bg-card p-0.5 shadow-[0_8px_28px_rgba(31,27,23,0.16)] ${
          menuClosing ? 'moji-out' : 'moji-in-soft'
        }`}
      >
        {asking ? (
          <div className="flex w-[300px] max-w-[calc(100vw-24px)] items-center gap-1 px-0.5">
            <input
              ref={inputRef}
              value={question}
              {...NO_AUTOFILL}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submitAsk()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setAsking(false)
                  setQuestion('')
                }
              }}
              placeholder={t('输入你的疑问，回车发送')}
              className="min-w-0 flex-1 rounded-md border border-line bg-paper-deep/50 px-2 py-1.5 text-[12px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50"
            />
            <button
              type="button"
              title={t('发送（回车）')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={submitAsk}
              disabled={!question.trim()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-soft transition hover:bg-seal/10 hover:text-seal-deep disabled:pointer-events-none disabled:opacity-40"
            >
              <Send size={13} />
            </button>
          </div>
        ) : (
          <>
            {/* 每一项右侧那个小数字就是它的快捷键（见上面的数字键监听） */}
            {actions.map((it, i) => (
              <Fragment key={it.key}>
                {i > 0 && <span className="mx-0.5 h-4 w-px bg-line" />}
                <button
                  type="button"
                  // data-hotkey：数字键按它找按钮（见上面那个监听），屏幕上第几项就是几
                  data-hotkey={i + 1}
                  title={t('{0}（按 {1}）', it.title, i + 1)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runAction(it.key)}
                  disabled={it.disabled}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-ink transition hover:bg-seal/10 hover:text-seal-deep disabled:pointer-events-none disabled:opacity-50"
                >
                  {it.icon}
                  {it.label}
                  <span className="ml-0.5 text-[10px] font-normal tabular-nums text-ink-faint">
                    {i + 1}
                  </span>
                </button>
              </Fragment>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
