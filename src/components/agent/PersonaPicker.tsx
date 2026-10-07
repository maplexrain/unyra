import { type ReactNode } from 'react'
import { Check, Drama } from 'lucide-react'
import { PERSONAS, personaOf, type PersonaId } from '../../agent/persona'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'

/**
 * 导师人格选择器：标题「超级导师」后面括号里的那个名字。
 *
 * 为什么放在标题里而不是菜单里：人格是**整段对话的语气**，用户随时可能想换一个试试，
 * 而「更多 → …」要三步。挂在标题上是一步，而且它读起来就是「现在跟谁在说话」——
 * 括号里那两个字本身就是状态显示。
 *
 * 与顶栏那几个入口、文档区那颗悬浮组同一套手感：**指针经过就向下展开、移开就收**
 * （动画与那两处共用 moji-wipe-corner-in/out）。点一下选中，选完就收。
 */

/** 指针停够这么久才展开：划过标题时不该闪出一张面板 */
const HOVER_OPEN_MS = 90
/** 移开之后延后这么久再收：按钮与 tip 之间那道 pt-1 的缝要能穿过去 */
const HOVER_CLOSE_MS = 110
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐（动画播完才卸载） */
const TIP_EXIT_MS = 160

export default function PersonaPicker({
  persona,
  onPick,
  placement = 'down',
}: {
  persona: PersonaId
  onPick: (id: PersonaId) => void
  /**
   * 面板展开的方向。'down'（默认）是原来住在标题里的样子；搬进输入框下面的
   * 状态行之后要 'up'——再往下展开就出了窗口。
   */
  placement?: 'down' | 'up'
}) {
  // 这一处与顶栏那几个入口同一套时序，只是多了一档「停够才展」（HOVER_OPEN_MS）
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    openMs: HOVER_OPEN_MS,
    closeMs: HOVER_CLOSE_MS,
    exitMs: TIP_EXIT_MS,
    buttonOpens: true,
  })
  const current = personaOf(persona)

  return (
    <div className="relative shrink-0" {...wrapProps}>
      {/*
        括号是按钮的一部分：它是「超级导师」的补语，读起来是一句话
        （超级导师（标准）），点起来的命中区也就把括号一起算进去。
      */}
      <button
        type="button"
        aria-label={t('导师人格：{0}，点击切换', t(current.label))}
        aria-expanded={open}
        title={t(current.label) + ' · ' + t(current.role)}
        {...buttonProps}
        onClick={() => setOpen(!open)}
        className={
          // 住在输入框底行（placement='up'）时与同行按钮同一副骨架（h-8 居中，
          // 见 SubAgentMenu / ModelPicker 的触发钮）——纯文字没有行高骨架，会浮着不对齐
          (placement === 'up'
            ? 'flex h-8 items-center rounded-lg px-1.5 text-[12.5px] font-medium transition '
            : 'rounded px-0.5 text-[13px] font-medium transition ') +
          (open ? 'bg-seal/10 text-seal-deep' : 'text-ink-faint hover:text-seal-deep')
        }
      >
        {/* 面具（Drama）：人格的隐喻——「现在跟谁在说话」。颜色跟按钮文字走，
            悬停/展开时与文字一起染成印章色，不用单独的状态色抢戏。
            mr-1.5：与文字留一口缝——flex 底行与旧的行内形态都用这一颗外边距，
            不必给按钮加 gap（两种形态的排布方式不一样） */}
        <Drama size={13} className="mr-1.5 shrink-0" aria-hidden="true" />
        {/* 住在状态行里（placement='up'）就不再带括号：它前面没有「超级导师」给它当补语了 */}
        {placement === 'up' ? t(current.short) : t('（{0}）', t(current.short))}
      </button>

      {mounted && (
        /*
          pt-1 是「桥」：按钮与面板之间那道缝必须落在本组件里，
          否则指针穿过去的一瞬间就会被判成离开（与 DocFloat 的 tip 同一套）。
          placement='up' 时面板从下往上展开（bottom-full + mb-1），桥改到面板自己那侧。
        */
        <div className={'absolute left-0 z-40 ' + (placement === 'up' ? 'bottom-full mb-1' : 'top-full pt-1')}>
          <div className={panelProps.className}>
            <div className="w-[300px] rounded-lg border border-line-strong bg-card p-1.5 shadow-[0_12px_36px_rgba(31,27,23,0.22)]">
              <div className="flex items-baseline gap-1.5 px-1 pb-1.5">
                <span className="text-[11.5px] font-medium text-ink-strong">{t('导师人格')}</span>
                <span className="text-[10.5px] text-ink-faint">{t('换一种讲法，知识不变')}</span>
              </div>

              {PERSONAS.map((p) => {
                const on = p.id === current.id
                return (
                  <Row
                    key={p.id}
                    onClick={() => {
                      setOpen(false)
                      if (!on) onPick(p.id)
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline gap-1.5">
                        <span className={'text-[12px] ' + (on ? 'font-medium text-seal-deep' : 'text-ink')}>
                          {t(p.label)}
                        </span>
                        <span className="text-[10.5px] text-ink-faint">{t(p.role)}</span>
                      </span>
                      <span className="text-[10.5px] leading-relaxed text-ink-faint">{t(p.tagline)}</span>
                    </span>
                    {on && <Check size={12} className="shrink-0 text-seal-deep" />}
                  </Row>
                )
              })}

              {/*
                说清「切换是怎么生效的」：它不改系统提示词，而是在下一轮往上下文里补一条指令。
                用户看到「不重发历史」才会放心地随手切——这也正是这么设计的原因（缓存）。
              */}
              <p className="px-1 pt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                {t('切换从下一轮开始生效。人格是以一条隐藏指令进入上下文的，不改系统提示词， 之前的对话一条都不会重发。')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 一行人格：整行可点，悬停亮底——与菜单项、笔记面板里那几行同一套观感 */
function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left transition hover:bg-line/50"
    >
      {children}
    </button>
  )
}
