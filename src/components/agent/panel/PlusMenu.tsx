/**
 * 输入框左下角那颗「+」以及它弹出来的菜单（含「工作流」「对话历史」两层）。
 *
 * 这里只负责画：菜单的状态机、两张菜单表、点别处与 Esc 的收起都在 usePlusMenu.tsx。
 * 画的是「一层叠一层做滑动」那套——当前层在流内撑高度，离开的那层绝对定位盖在上面。
 *
 * props 是一个个摊开的，而不是收成一个 menu 对象：那份对象里有一个挂载回调要交给
 * 按钮的 ref 属性，而 react(refs) 规则一旦看见「对象的成员出现在 ref 位置上」，
 * 就会把整个对象当成 ref，之后每一次 menu.xxx 都报「渲染期访问 ref」。摊开就没这回事。
 */

import { ChevronRight, Plus } from 'lucide-react'
import type { MenuSub } from './types'
import { t } from '../../../i18n'

export function PlusMenu({
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
}: {
  /** 要不要渲染：收起后先播退场动画，播完才由 usePresence 置 false */
  menuMounted: boolean
  /** 正在播退场动画（那时断掉指针事件） */
  menuClosing: boolean
  /** 现在停在哪一级：null = 一级；二级只有「工作流」与「对话历史」两项 */
  menuSub: MenuSub
  /** 逻辑上的展开状态（那颗「+」的 aria-expanded 与高亮都看它） */
  menuOpen: boolean
  /** 正在滑出的那一层，以及滑动方向（与 ModelPicker 的换层是同一套做法） */
  menuLeaving: { sub: MenuSub; dir: 1 | -1 } | null
  menuDir: 1 | -1
  /** 面板高度：两层的内容不一样高，量出来做高度过渡，换层时面板才不会跳 */
  menuBodyH: number | null
  /** 四个挂载回调：把节点登记到 usePlusMenu 内部的 ref 上 */
  panelMount: (el: HTMLDivElement | null) => void
  panelBodyMount: (el: HTMLDivElement | null) => void
  buttonMount: (el: HTMLButtonElement | null) => void
  /** 一层的内容：过渡期间要同时渲染"新来的"与"正走的"两层 */
  renderMenuPanel: (sub: MenuSub) => React.ReactNode
  /** 面包屑上的「更多」：退回一级 */
  goRoot: () => void
  /** 那颗「+」：开了就收起，没开就回到一级再打开 */
  toggle: () => void
  /** 那颗「+」按钮上的高亮类 */
  plusButtonClass: string
}) {
  return (
    <>
      {menuMounted && (
        <div
          ref={panelMount}
          role="menu"
          className={
            'absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[360px] overflow-hidden rounded-2xl border border-line-strong bg-card/95 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.18)] ' +
            // 收起时断掉指针事件：免得点到一颗正在消失的菜单项
            (menuClosing ? 'moji-bloom-up-out pointer-events-none' : 'moji-bloom-up-in')
          }
        >
          {/*
            面包屑：一级永远是「更多」，进到二级就多一截。它也是退回上一层的那条路
            （与 ModelPicker 的层级菜单同一套观感：层级关系看得见，而不是"啪"地换一屏）。
          */}
          <div className="flex items-center gap-1.5 border-b border-line bg-paper-deep/75 px-3 py-2 text-[11.5px]">
            {menuSub === null ? (
              <span className="font-semibold text-ink-strong">{t('更多选项')}</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goRoot}
                  className="font-medium text-ink-soft transition hover:text-ink"
                >
                  {t('更多')}
                </button>
                <ChevronRight size={11} className="text-ink-faint" />
                <span className="truncate font-semibold text-ink-strong">
                  {menuSub === 'workflow' ? t('工作流模板') : t('对话历史')}
                </span>
              </>
            )}
            <span className="ml-auto flex items-center gap-1 text-[10px] text-ink-faint">
              <kbd className="rounded bg-line/60 px-1 py-0.5 font-mono text-[9.5px]">Esc</kbd>
              <span>{t('收起')}</span>
            </span>
          </div>
          {/*
            两层叠着做滑动：当前层在流内（撑出高度），离开的那层绝对定位盖在上面。
            外层 max-h-[300px] overflow-y-auto 保证任何长列表都优雅滚动，不撑破窗口。
          */}
          <div
            className="relative max-h-[300px] overflow-y-auto transition-[height] duration-200 ease-out"
            style={menuBodyH === null ? undefined : { height: Math.min(300, menuBodyH) }}
          >
            {menuLeaving && (
              <div
                className={
                  'absolute inset-x-0 top-0 ' +
                  (menuLeaving.dir === 1 ? 'moji-slide-out-forward' : 'moji-slide-out-back')
                }
                aria-hidden="true"
              >
                <div className="p-1.5">{renderMenuPanel(menuLeaving.sub)}</div>
              </div>
            )}
            <div
              ref={panelBodyMount}
              key={menuSub ?? 'root'}
              className={
                'relative ' +
                (menuLeaving ? (menuDir === 1 ? 'moji-slide-in-forward' : 'moji-slide-in-back') : '')
              }
            >
              <div className="p-1.5">{renderMenuPanel(menuSub)}</div>
            </div>
          </div>
        </div>
      )}

      {/*
        左下角那颗「+」：点开在输入框**上方**弹出一块与它等宽的菜单。
        菜单是绝对定位的（不占位），因此它弹出时输入框不会跳动。
        菜单项目见 usePlusMenu 里的 COMPOSER_MENU（工作流那几项在 WORKFLOW_MENU 里）。
      */}
      <button
        type="button"
        ref={buttonMount}
        title={t('更多')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggle}
        className={plusButtonClass}
      >
        <Plus size={16} />
      </button>
    </>
  )
}
