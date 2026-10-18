/**
 * 这个文件负责什么：文档区右键菜单的**长相**——三项（复制 / 粘贴 / 定位源码）、
 * 快捷键提示、选中文字的那一行预览，以及它怎么贴着指针摆进视口。
 *
 * 动作本身不在这里：菜单只报「点了哪一项」，接线与落地收在 note/useDocContextMenu
 * （它要读选区、读剪贴板、还要让上层切视图，散在这里既不好读，也会让「渲染」与「做事」
 * 两份东西各走各的）。
 */
import { ClipboardPaste, Code2, Copy } from 'lucide-react'
import type { RefObject } from 'react'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import { t } from '../../../i18n'
import type { DocMenuState } from './useDocContextMenu'

/** 菜单项的统一样式（与资源管理器右键菜单同一套，见 explorer/RowMenu） */
const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition'

interface Props {
  /** 这一次右键对应的选区；为 null 时不渲染（退场动画那一帧它还在，所以照常渲染） */
  menu: DocMenuState | null
  menuRef: RefObject<HTMLDivElement | null>
  /** 是否正在播退场动画 */
  closing: boolean
  /** 这份正文能不能就地改（粘贴）：试卷副本这类只读正文没有 */
  canPaste: boolean
  /** 这份正文有没有源码视图可去（定位源码） */
  canReveal: boolean
  onCopy: () => void
  onPaste: () => void
  onReveal: () => void
  onClose: () => void
}

export function DocContextMenu({
  menu,
  menuRef,
  closing,
  canPaste,
  canReveal,
  onCopy,
  onPaste,
  onReveal,
  onClose,
}: Props) {
  // 点别处 / 滚动 / 缩放 / Esc 都收起，并把菜单夹进视口（规矩收在 lib/useDismiss 一处）
  useDismissOn({ onClose })
  useClampToViewport(menuRef, menu)

  if (!menu) return null

  /** 选区映射回源文失败时，粘贴与定位都没有落点：留着能点却什么也不做更让人困惑 */
  const located = !!menu.loc

  return (
    <div
      ref={menuRef}
      role="menu"
      // 菜单自己吃掉 mousedown：否则 document 上的「点别处收起」会先一步关掉它，
      // 按钮根本等不到 click（与 explorer/RowMenu 同一条）
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      /* 位置不写在 style 里：贴着指针摆、再夹进视口，都由 useClampToViewport 在绘制前定下来
         （与 explorer/RowMenu 同一条；写成内联样式的话，React 每次重渲染都会把夹取后的
         位置覆盖回未夹取的那个坐标） */
      className={`fixed z-[70] min-w-[176px] max-w-[260px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)] ${
        closing ? 'moji-out' : 'moji-in-soft'
      }`}
    >
      {/* 选中的那一小段：右键之后先说清「现在对着的是哪一句」 */}
      <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint" title={menu.text}>
        {menu.text}
      </div>

      <button
        type="button"
        role="menuitem"
        // preventDefault 保住选区：不然按下鼠标的瞬间选区就没了，
        // 用户看着文字被取消选中，会以为复制到的是别的什么
        onMouseDown={(e) => e.preventDefault()}
        onClick={onCopy}
        className={MENU_ITEM + ' text-ink hover:bg-line/60'}
      >
        <Copy size={13} className="shrink-0 text-ink-soft" />
        {t('复制')}
        <span className="ml-auto pl-3 text-[10.5px] tabular-nums text-ink-faint">Ctrl+C</span>
      </button>

      <button
        type="button"
        role="menuitem"
        disabled={!canPaste || !located}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPaste}
        title={located ? t('把剪贴板里的内容替换掉选中的这一段') : t('这一段没能映射回源文，粘贴没有落点')}
        className={MENU_ITEM + ' text-ink hover:bg-line/60 disabled:pointer-events-none disabled:opacity-40'}
      >
        <ClipboardPaste size={13} className="shrink-0 text-ink-soft" />
        {t('粘贴')}
      </button>

      <span aria-hidden="true" className="my-1 block h-px bg-line" />

      <button
        type="button"
        role="menuitem"
        disabled={!canReveal || !located}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onReveal}
        title={t('切到源码视图，并选中这段文字在源文里的位置')}
        className={MENU_ITEM + ' text-ink hover:bg-line/60 disabled:pointer-events-none disabled:opacity-40'}
      >
        <Code2 size={13} className="shrink-0 text-ink-soft" />
        {t('定位源码')}
      </button>
    </div>
  )
}
