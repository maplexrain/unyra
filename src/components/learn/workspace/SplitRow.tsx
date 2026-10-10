/*
 * 这个文件负责：学习区那「两列」的骨架——文档格、对话格、中间的分割线、
 * 骑在分割线上的收起按钮、拖动时的两个宽度读数。
 *
 * 它只是骨架：格子里装什么（左边的文档布局树、右边的 AgentPanel）由宿主以
 * docsSlot / agentSlot 传进来；状态与拖动机制在 useSideColumns，这里只把它给的
 * ref 挂到对应的元素上。谁在左谁在右、宽度几何、补间与裁剪，全都由 side 驱动。
 *
 * 这里还有第三种布局：**纯净阅读**（pure，见 LearnWorkspace 的 F11）。它要做的事
 * 只有一句——导师栏让位、文档栏独占整行——但两栏谁在左谁在右是用户定的，
 * 于是让位的手法跟着分两路：
 * - 导师栏在**右格**（!agentLeft）：走与「收起右侧栏」完全同一条路，那一格宽度补间到 0；
 * - 导师栏在**主位**（agentLeft，默认布局）：它没有定宽可补间，于是让它的框体向左滑出
 *   窗口（负外边距把自己的宽度从布局里收掉），宽度本身一点不变——里面的对话
 *   一个字都不会跟着重排。腾出来的地方由文档栏的宽度补间占住。
 * 两路都只碰宽度与位置；正文那一格**跟着格子一起长**（不冻，见 useSideColumns 的 pureMoving），
 * 所以看着是阅读区一路铺开，而不是先空出一块、等补间结束才一下填满。
 * 代价是它在这 300ms 里每帧重排一次——这是有意换来的，理由写在下面内层那一段。
 */

import type { CSSProperties, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AGENT_WIDTH_MAX, AGENT_WIDTH_MIN } from '../../../lib/appearance'
import { RESIZE_HINT_GAP, SIDE_TOGGLE_INSET } from './constants'
import type { SideColumnsApi } from './useSideColumns'
import { t } from '../../../i18n'

/**
 * 两列的骨架。
 *
 * 两列：文档区与超级导师对话栏。左格自适应（拿走剩下的宽度）、右格固定宽（--side-w，可拖）。
 * 宽度属于「格子」而不属于内容，所以对调时只换内容、不换宽度（见 lib/appearance 的 agentLeft）。
 * DOM 顺序始终是文档在前：靠 flex-row-reverse 反着排，打印（display 归位成 block）便不受对调影响。
 * 分隔线画在把手里，对调时因此不用改写任何边框类。
 */
export default function SplitRow({
  side,
  docsSlot,
  agentSlot,
}: {
  side: SideColumnsApi
  /** 文档格的内容：宿主把 renderLayout(docs.layout) 的结果交给它 */
  docsSlot: ReactNode
  /** 对话格的内容：AgentPanel 那一大棵接线树，仍归宿主管 */
  agentSlot: ReactNode
}) {
  const {
    agentLeft,
    agentWidth,
    sideCollapsed,
    sideClip,
    frozenMain,
    pure,
    pureMoving,
    resizingAgent,
    rowWidth,
    rowRef,
    docColRef,
    docInnerRef,
    agentColRef,
    agentInnerRef,
    handleRef,
    sideBtnRef,
    setHintRef,
    onAgentResizeDown,
    onAgentResizeMove,
    onAgentResizeUp,
    swapSides,
  } = side

  /** 导师栏正在让位（包括补间里那一段，见 useSideColumns 的 pureMoving） */
  const agentAway = pure || pureMoving

  /**
   * 文档栏是不是占着**主位**（用户双击分割线对调过之后就是这样）。
   *
   * 它决定分割线那条把手贴哪一边。文档栏占主位时它一直顶到分割线上，
   * 而它的纵向滚动条就长在那条边上（10px 宽，见 theme.css 里那条全局滚动条规则）；
   * 把手是**骑在线上**的（一半探进右边那一格），探进文档栏的那 4px 正好压在滚动条上，
   * 滑块按不住（用户报的就是这个）。
   *
   * 所以这种排布下把手整个挪到线的**右侧**（导师栏那一格里，见下面 translate-x-full）：
   * 线的位置一点不动，动的是把手贴在线的哪一侧。另一种排布（导师栏占主位）保持原来的
   * 骑线样子——那边探进去的是导师栏，它没有可见滚动条。
   */
  const keepDocEdge = !agentLeft

  return (
    <div
      ref={rowRef}
      className={
        'print-flat relative flex min-h-0 flex-1 ' +
        (agentLeft ? 'flex-col-reverse lg:flex-row-reverse' : 'flex-col lg:flex-row') +
        (resizingAgent ? ' select-none' : '')
      }
      // 自定义属性不在 CSSProperties 的已知键里，只能断言；它是 Tailwind 的 lg:w-[var(--side-w)] 要读的值。
      // 放在这一层：两格都可能用到它——对调之后装着文档的正是右格
      style={{ '--side-w': String(agentWidth) + 'px' } as CSSProperties}
    >
      {/*
        第一格：节点文档 / 考试面板（顶上是文档标签那一行）。
        未对调时它在左格，宽度自适应；对调后落进右格，改成固定宽度。
        窄屏下两格上下叠放，对调意味着文档排到下面，那根分隔线也归下面那格。
      */}
      <div
        ref={docColRef}
        // vt-doc-col：这一格对调时由浏览器补间到新位置，别删（见 index.css 的 View Transitions 一节）
        className={
          'vt-doc-col print-flat print-col flex min-h-0 flex-col ' +
          (agentLeft
            ? // 它占着**右格**（对话在左）
              (pure
                ? /*
                   * 纯净阅读：它反过来独占整行。宽度从 --side-w 补间到 100%——
                   * 两个都是确定值，所以这一步是真补间（不是「唰」一下换掉）；
                   * 导师栏那边同时把自己的宽度从布局里收掉（见下面那段），
                   * 两份位移严丝合缝地互补，中间不会露出空隙。
                   */
                  'w-full shrink-0 ' +
                  (resizingAgent
                    ? 'lg:transition-none '
                    : 'lg:transition-[width] lg:duration-300 lg:ease-out ') +
                  // 补间期间裁着溢出：正文此刻正跟着这一格长开 / 缩回，
                  // 一帧里多出来的排版不该溢到隔壁那一格上
                  (pureMoving ? 'lg:overflow-hidden ' : '')
                : // 平时：宽度可收（宽度补间到 0 + 补间期间裁掉溢出）。
                  // 拖动中不要过渡：宽度每帧都在变，过渡会让它慢半拍地追指针（见 onAgentResizeMove）
                  'w-full shrink-0 border-t border-line lg:border-t-0 ' +
                  (resizingAgent ? 'lg:transition-none ' : 'lg:transition-[width] lg:duration-300 lg:ease-out ') +
                  // 裁溢出：收起 / 展开右侧栏时要（见 sideClip），纯净阅读进出的那 300ms 也要——
                  // 那一段里正文正跟着格子一起变宽变窄，多出来的排版不该溢到隔壁那一格上
                  (sideClip || pureMoving ? 'lg:overflow-hidden ' : '') +
                  (sideCollapsed ? 'lg:w-0' : 'lg:w-[var(--side-w)]'))
            : // 它占着**主位**（对话在右）：宽度自适应；补间那 300ms 里
              // 反过来把它**冻住**（对面在动，正文不该跟着每帧重排，见 setSide）
              'min-w-0 flex-1 ' + (frozenMain !== null || pureMoving ? 'lg:overflow-hidden ' : ''))
        }
      >
        {/*
          内层平时**跟着 var 走**（lg:w-[var(--side-w)]，与外层同宽）：
          补间那 300ms 里主位定宽（frozenMain，见 setSide）；拖动期间则由
          paintDrag 逐帧直写内联宽度——内容实时跟着手，松手清掉内联回到 var。
          拖动/对调期间变量都不动，正文的重排次数因此只由「内容真的变宽变窄」决定。

          收起时再加 lg:invisible：宽度 0 只是看不见，里面那几十颗按钮还在 Tab 序列里。
          visibility 参与补间时是「到末尾才真的切过去」，所以它是等滑完了才失效的。

          纯净阅读是同一件事的另一面：宽度从 --side-w 换到整行宽（lg:w-full）。
          这里**不冻正文**（与主位那条 frozenMain 相反，是有意为之）：冻住的话，
          动画里格子长大了、正文还停在旧宽度上贴着一边，腾出来的那块地方就是一片空白，
          等补间结束才「唰」地填满。要的就是看着它一路长开，代价是正文跟着格子每帧重排一次
          ——`.doc-measure` 那一列有 800 的上限（见 typography.css），超过之后只是重新居中，
          真正在换行的只有 600→800 这一段。
          进出都要保持 lg:w-full：退出时它正从整行缩回 --side-w，那一路上也得跟着格子走。
        */}
        <div
          ref={docInnerRef}
          className={
            'flex min-h-0 flex-1 flex-col ' +
            (agentLeft
              ? 'lg:transition-[visibility] lg:duration-300 ' +
                (pure || pureMoving
                  ? 'lg:w-full '
                  : 'lg:w-[var(--side-w)] ' + (sideCollapsed ? 'lg:invisible ' : ''))
              : '')
          }
          // 补间那 300ms 里主位定宽（见 setSide）：对话流因此不跟着每帧重排
          style={!agentLeft && frozenMain !== null ? { width: frozenMain } : undefined}
        >
          {/*
            文档区：布局树由宿主的 renderLayout 渲染，叶子是一格完整的内容。
            没有分割时它就是从前的样子——一格、一条页签栏、一片正文，外观与行为都不变。
          */}
          {docsSlot}
        </div>
      </div>

      {/*
        两列中间那条线：拖动改右格宽度，双击对调两栏。
        它是**格子**的把手而不是某一栏的把手：定位用「离右边 --side-w」，
        于是两列谁在右边都落在同一条线上，拖动方向也始终是「往左 = 右格变宽」。
        分隔线由把手自己那条 1px 的线画出（原先写在文档栏的 border-r 上），
        对调位置时因此不用改任何边框类，打印时也自然跟着把手一起隐藏。
        指针划过时不加任何高亮：这条线一直是可见的，闪一下反而像在动；
        可操作这件事交给光标形状（cursor-col-resize）与 title 说。
        命中区 8px——一像素的线抓不住。lg 以下不显示：那时两列变一列，没有"中间"可拖。
        拖动时线两侧各浮一个宽度读数（见下面那两个 bubble）：分配比例这件事，
        光看线挪了多少猜不出两栏各是多少。
      */}
      <div
        ref={handleRef}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('拖动调整右侧{0}栏的宽度，双击对调两栏', agentLeft ? t('文档') : t('对话'))}
        title={
          t(
            '拖动调整右侧{0}栏的宽度（{1}~{2} px）· 双击对调两栏',
            agentLeft ? t('文档') : t('对话'),
            AGENT_WIDTH_MIN,
            AGENT_WIDTH_MAX,
          )
        }
        onPointerDown={onAgentResizeDown}
        onPointerMove={onAgentResizeMove}
        onPointerUp={onAgentResizeUp}
        onPointerCancel={onAgentResizeUp}
        onDoubleClick={swapSides}
        className={
          'no-print absolute inset-y-0 right-[var(--side-w)] z-[5] w-2 cursor-col-resize touch-none ' +
          // 文档栏占主位时整条挪到线的**右侧**（导师栏那一格里）：探进文档栏的那 4px
          // 正好压住它贴在分界线上的滚动条，鼠标按不住（用户报的）；骑线那种排布照旧
          (keepDocEdge ? 'translate-x-full ' : 'translate-x-1/2 ') +
          // 右侧栏收起时没有「宽度」可调，这条线跟着那一栏一起退场；
          // 纯净阅读里整行都是正文，也没有「中间」可言（补间期间同样不出现，否则它会停在错的地方）
          (sideCollapsed || agentAway ? 'hidden' : 'hidden lg:block ') +
          (resizingAgent ? ' bg-seal/40' : '')
        }
      >
        <span
          className={
            'absolute inset-y-0 w-px -translate-x-1/2 ' +
            // 线必须落在两格真正的分界上：骑线时它在把手正中，贴到线的右侧时在把手左沿
            (keepDocEdge ? 'left-0 ' : 'left-1/2 ') +
            (resizingAgent ? 'bg-seal/40' : 'bg-line')
          }
        />
      </div>

      {/*
        收起 / 展开右侧那一栏的按钮：**骑在两列中间那条线上**——一半在主区域、
        一半在右侧栏里（需求要的「延伸入主区域」）。收起之后它退到窗口右边留 4px，
        但仍然走同一个 right 的补间：收起与展开看着是同一颗按钮挪了一下，
        而不是「一颗消失、另一颗冒出来」。

        位置用 right 而不是 left：分割线本身就用 right 定位，两者因此永远粘在同一条线上，
        窗口怎么变、两栏怎么对调都不用另算。

        它压在分割线的**中段**上（那颗按钮 28px 高）：想拖宽度时从上下任何一处抓都行，
        中段这一小截被按钮占着——相比之下「收起这一栏」是更高频的动作，值得占这个位置。

        纯净阅读里它跟着分割线一起退场：那时候没有「右侧栏」可收可展，
        留着它骑在正文上只会是一块挡字的东西（要退出纯净阅读有页签栏那颗按钮与 Esc）。
      */}
      <div
        ref={sideBtnRef}
        /*
         * pointer-events-none：这一层是一条**整高、透明**的窄条，宽度由里面那颗按钮
         * 撑出来（20px），紧贴在分割线上。文档栏占主位时，文档栏的纵向滚动条正好长在
         * 这条线上——这一层会把整条滚动条盖住，鼠标点上去落在它身上，滑块于是怎么都拖不动
         * （用户报的「拖不了滚动条」）。
         *
         * 让它不吃指针事件，按钮自己再把点击收回来（见下面那颗按钮上的 pointer-events-auto）。
         * 它整高透明、又没有交互，本来就不该参与命中测试。
         */
        className={
          'no-print pointer-events-none absolute inset-y-0 z-10 items-center ' +
          (agentAway ? 'hidden ' : 'hidden lg:flex ') +
          (resizingAgent ? 'transition-none' : 'transition-[right] duration-300 ease-out')
        }
        style={{ right: sideCollapsed ? SIDE_TOGGLE_INSET + 'px' : 'var(--side-w)' }}
      >
        <button
          type="button"
          title={
            sideCollapsed
              ? t('展开右侧栏')
              : t('收起右侧{0}栏，给主区域让出地方', agentLeft ? t('文档') : t('对话'))
          }
          aria-label={sideCollapsed ? t('展开右侧栏') : t('收起右侧栏')}
          aria-expanded={!sideCollapsed}
          // toggleSide 由 useSideColumns 的机制层管（快捷键也走它）；这里只挂事件
          onClick={side.toggleSide}
          /*
           * -translate-y-7（28px）= 顶栏高度的一半（顶栏是 h-14）。
           * 这一格的 inset-y-0 是「顶栏以下的整块」，正中的位置因此比窗口正中低 28px——
           * 不抬这一下，那颗按钮看着就是偏下的。h-10 也让它在分割线上更好按。
           */
          /*
           * pointer-events-auto：外面那一层是 pointer-events-none（见那段说明），
           * 点击要在这里收回来，否则这颗按钮就点不动了。
           */
          className="pointer-events-auto flex h-10 w-5 -translate-y-7 translate-x-1/2 items-center justify-center rounded-full border border-line-strong bg-card text-ink-faint shadow-[0_1px_4px_rgba(31,27,23,0.18)] transition hover:border-seal/50 hover:text-ink"
        >
          {sideCollapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/*
        拖动时的宽度读数：分隔线两侧各一个，跟着指针上下走（纵向位置在按下那刻
        量好行几何后由 paintDrag 缓存推算，拖动期间不再碰布局）。
        左格自适应，宽度只能由「行宽 - 右格」算出来；右格就是 agentWidth。
        两段字塞不进 8px 宽的把手，所以并排挂在把手外面这一层。
        lg 以下没有那条线可拖，读数也不该出现，于是跟着把手一起 hidden lg:flex。
      */}
      {/*
        两个读数在**按下那一刻**就挂上（不是挪动之后才挂）：拖动期间一次都不重渲染，
        所以没有「挪动之后」这个渲染时机——数字与纵向位置由 paintDrag 直接写 DOM，
        没真的拖动时它们只是 visibility: hidden（见 onAgentResizeMove 里那 2px 的判据）。
      */}
      {resizingAgent && rowWidth > 0 && (
        <>
          <div
            ref={(el) => setHintRef.left(el)}
            className="no-print pointer-events-none absolute z-10 hidden -translate-y-1/2 items-baseline gap-1 rounded-md bg-ink/90 px-2 py-1 text-[11px] leading-none whitespace-nowrap text-paper shadow-sm lg:flex"
            style={{
              top: 0,
              visibility: 'hidden',
              right: 'calc(var(--side-w) + ' + RESIZE_HINT_GAP + 'px)',
            }}
          >
            <span className="opacity-60">{agentLeft ? t('对话') : t('文档')}</span>
            <span ref={(el) => setHintRef.leftNum(el)} className="font-medium tabular-nums" />
          </div>
          <div
            ref={(el) => setHintRef.right(el)}
            className="no-print pointer-events-none absolute z-10 hidden -translate-y-1/2 items-baseline gap-1 rounded-md bg-ink/90 px-2 py-1 text-[11px] leading-none whitespace-nowrap text-paper shadow-sm lg:flex"
            style={{
              top: 0,
              visibility: 'hidden',
              left: 'calc(100% - var(--side-w) + ' + RESIZE_HINT_GAP + 'px)',
            }}
          >
            <span className="opacity-60">{agentLeft ? t('文档') : t('对话')}</span>
            <span ref={(el) => setHintRef.rightNum(el)} className="font-medium tabular-nums" />
          </div>
        </>
      )}

      {/*
        AI Agent 聊天。默认在左格（对话在左、文档在右，见 lib/appearance 的 agentLeft），
        宽度因此是「剩下的都归它」；双击那条线对调之后它落到右格，
        变成可拖的固定宽度（400~800，默认 600，记在用户设置里）。
        宽度用 CSS 变量传进去而不是写死类名：窄屏下格子要整块铺开（w-full），
        而内联 style 没法做响应式——变量 + lg:w-[var(--side-w)] 才能两者兼得。

        纯净阅读里这一栏要让位，让位的手法见本文件开头那两段说明。
      */}
      <section
        ref={agentColRef}
        // vt-agent-col：与文档那一格成对，对调时浏览器拿它做补间（见 index.css）
        className={
          'vt-agent-col no-print relative flex min-h-0 w-full flex-col border-line ' +
          (agentLeft
            ? // 它占着**主位**（文档在右）
              (agentAway
                ? /*
                   * 让位：整块向左滑出窗口。
                   *
                   * 用的不是 transform 而是**负外边距**——负外边距会把自己的宽度从
                   * flex 行里收掉，于是文档栏那一格真的把地方占过去；transform 只挪画面，
                   * 布局里那块地方还留着（右边会空出一条）。
                   *
                   * 宽度必须写成确定值（calc(100% - --side-w) 正好等于它此刻的宽度），
                   * 并配上 flex-grow:0 / flex-shrink:0：这样「宽度不变、只有外边距在动」，
                   * 里面的对话一个字都不会重排。这两个数在进出的那一刻都与现状严丝合缝，
                   * 所以按下去不会跳一下。
                   *
                   * 补间走完（agentAway 落下）才换回 flex-1——半路换会让它当场跳一下。
                   */
                  'shrink-0 lg:grow-0 ' +
                  // 下划线是 Tailwind 任意值里的空格：calc 的减号两边**必须**有空格，
                  // 写成 calc(100%-var(--side-w)) 会被浏览器整条丢掉
                  (sideCollapsed
                    ? 'lg:w-full '
                    : 'lg:w-[calc(100%_-_var(--side-w))] ') +
                  'lg:transition-[margin-left] lg:duration-300 lg:ease-out ' +
                  // 窄屏下两格是上下叠着的，滑动这一套在那儿没有意义：直接不显示
                  'max-lg:hidden'
                : 'min-w-0 flex-1 ' + (frozenMain !== null ? 'lg:overflow-hidden ' : ''))
            : // 它占着**右格**（文档在左）：与文档栏占右格时同一套收起的做法；
              // 拖动中同样不要过渡，否则它慢半拍地追指针。纯净阅读也走这一套——
              // 它本来就是「右边那一格」，把宽度补间到 0 就是让位
              'shrink-0 border-t lg:border-t-0 ' +
              (resizingAgent ? 'lg:transition-none ' : 'lg:transition-[width] lg:duration-300 lg:ease-out ') +
              (sideClip || pureMoving ? 'lg:overflow-hidden ' : '') +
              (sideCollapsed || pure ? 'lg:w-0' : 'lg:w-[var(--side-w)]'))
        }
        /*
         * 负外边距就是「让位」那一下：把 -100% 与 --side-w 的差算出来，
         * 它正好等于这一格此刻的宽度（100% 是这一行的宽）。退出时它回到 0，
         * 于是整块又从左边滑回来。
         */
        style={
          agentLeft && agentAway
            ? { marginLeft: pure ? (sideCollapsed ? '-100%' : 'calc(var(--side-w) - 100%)') : 0 }
            : undefined
        }
      >
        {/* 内层平时跟着 var 走；补间/拖动期间的宽度见上面文档格那段的说明 */}
        <div
          ref={agentInnerRef}
          className={
            'flex min-h-0 flex-1 flex-col ' +
            (agentLeft
              ? 'lg:transition-[visibility] lg:duration-300 ' + (pure ? 'lg:invisible ' : '')
              : 'lg:w-[var(--side-w)] lg:transition-[visibility] lg:duration-300 ' +
                (sideCollapsed || pure ? 'lg:invisible ' : ''))
          }
          // 补间那 300ms 里主位定宽（见 setSide）：对话流因此不跟着每帧重排
          style={agentLeft && frozenMain !== null ? { width: frozenMain } : undefined}
        >
          {agentSlot}
        </div>
      </section>
    </div>
  )
}
