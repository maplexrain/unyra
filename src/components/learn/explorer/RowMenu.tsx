/**
 * 这个文件负责：行的右键菜单本体——**一个菜单，六种行**，每一行给出那一类东西能做的事，
 * 其中节点的菜单里挂着「学习状态」那块二级 tip（含它往左还是往右伸的边界翻转）。
 */
import { useRef, useState } from 'react'
import { Download, FilePlus, FolderPlus, FolderOpen, GraduationCap, ListTree, NotebookPen, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react'
import { STATUS_META } from '../mastery'
import { DocTypeIcon } from '../docTypes'
import { NodeStatePanel } from '../NodeStatePanel'
import { examNeedsWork, type RowMenuProps } from './types'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import { t } from '../../../i18n'

/** 菜单项的统一样式 */
const MENU_ITEM = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition'

/**
 * 「在资源管理器中打开」这一项。
 *
 * **六种行的菜单里都有它**（节点 / 笔记 / 试卷 / 考试副本 / 超级文档 / 本地文件），
 * 文案、图标、样式一字不差，只有按下去做什么不同——指的是哪个文件由上层按 target 翻译
 * （见 NodeDocActions.onReveal 与本文件开头那段）。所以这里只留长相，动作由调用处传。
 */
function RevealItem({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={MENU_ITEM + ' text-ink hover:bg-line/60'}
    >
      <FolderOpen size={13} className="shrink-0 text-ink-soft" />
      在资源管理器中打开
    </button>
  )
}

/**
 * 行的右键菜单：**一个菜单，九种行**。
 *
 * 用 fixed 定位贴着指针，并夹取到视口内——贴在那一行上行不通：侧栏是滚动容器，
 * 绝对定位的菜单会被 overflow 裁掉。
 *
 * 每一项都是「对着这一类东西能做的事」：节点给新建与学习状态，笔记给改名，
 * 试卷给开考 / 判分，本地文件给移除。**在资源管理器中打开**对每一种都有意义，
 * 但指的可能是不同的文件（笔记是它自己的 .md，试卷与超级文档是这个节点的文档文件），
 * 所以它由上层按 target 翻译（见 NodeDocActions.onReveal）。
 */
export function RowMenu({
  menu,
  onClose,
  onRevealNode,
  onRevealWs,
  ws,
  onDeleteNode,
  onRemoveLocal,
  onRevealLocal,
  onStartRename,
  docs,
  exams,
  state,
}: RowMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  /**
   * 「学习状态」的二级 tip 往哪边伸。
   *
   * 与「历次考试」那块 tip 一样是不在菜单里的浮层（菜单只有 190px 宽），
   * 但方向相反：菜单贴着屏幕左边，往左没有地方——**往右才是空的**。
   * 右边实在不够（窄窗口、菜单又被夹到右边去了）时翻到左边。
   */
  const [stateSide, setStateSide] = useState<'right' | 'left' | null>(null)

  /*
   * 点别处 / 滚动 / Esc / 改窗口大小都收起，并把菜单夹进视口：这两条与页签右键菜单
   * 是同一条规矩，实现收在 lib/useDismiss 一处（「在别处右键」为什么能先关旧的再开新的、
   * 8px 余量怎么算，都写在那里）。
   */
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)

  /** 收下触发之后先关菜单，再做那件事：动作可能弹确认框，菜单留在上面会挡着 */
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }

  const target = menu.target
  const node = target.kind === 'local' ? null : target.node
  /** 目录行的称呼（菜单标题用）：「微积分 · 文档」一眼知道是哪个节点的那一层 */
  const FOLDER_LABEL: Record<'docs', string> = { docs: t('文档') }
  const title =
    target.kind === 'local'
      ? target.file.name
      : target.kind === 'folder'
        ? (target.node.title || t('未命名')) + ' · ' + FOLDER_LABEL[target.folder]
        : target.kind === 'node' || target.kind === 'teach' || target.kind === 'outline'
          ? target.node.title || t('未命名')
          : target.kind === 'note'
            ? target.name
            : target.kind === 'super'
              ? target.name
              : target.kind === 'exam'
                ? target.exam.title
                : t('考试记录')

  return (
    <div
      ref={ref}
      role="menu"
      // 菜单自己吃掉 mousedown / contextmenu：否则 document 上的「点别处收起」
      // 会先一步关掉它，按钮根本等不到 click
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] min-w-[190px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint" title={title}>
        {title}
        {node && target.kind !== 'node' && target.kind !== 'teach' && target.kind !== 'outline' && target.kind !== 'folder' ? (
          <span> · {node.title}</span>
        ) : null}
      </div>

      {/*
        学习文档行：它跟节点强制绑定，所以这一栏里没有「删除文档」——只有「删除节点」，
        删这份文档就是删节点本身。打开与导出则与节点菜单里的同名项是同一件事。
      */}
      {target.kind === 'teach' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onOpenTeach(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="teach" size={13} />
            {t('打开学习文档')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onOpenOutline(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="outline" size={13} />
            {t('打开大纲')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onExport({ kind: 'teach', nodeId: target.node.id }))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <Download size={13} className="shrink-0 text-ink-soft" />
            {t('导出教学文档')}
          </button>
          <RevealItem onSelect={run(() => onRevealNode(target.node.id))} />
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => onDeleteNode(target.node.id))}
            className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10'}
          >
            <Trash2 size={13} className="shrink-0" />
            {t('删除节点（含它的全部文件）')}
          </button>
        </>
      )}

      {target.kind === 'node' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onOpenTeach(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="teach" size={13} />
            {t('打开学习文档')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onOpenOutline(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="outline" size={13} />
            {t('打开大纲')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onExport({ kind: 'teach', nodeId: target.node.id }))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <Download size={13} className="shrink-0 text-ink-soft" />
            {t('导出教学文档')}
          </button>
          <RevealItem onSelect={run(() => onRevealNode(target.node.id))} />

          {/*
            在这条上新建文档：右键一个节点，紧接着想做的那件事多半就是「给它加点东西」。
            三样与侧栏里显示的三种文档一一对应（笔记 / 试卷 / 超级文档），
            与文档区那几块 tip 里的入口是同一批动作（都跑同一套流程）。
          */}
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onNewNote(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="note" size={13} />
            {t('新建笔记')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onNewExam(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="exam" size={13} />
            {t('新增试卷')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onNewSuperDoc(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="super" size={13} />
            {t('新建超级文档')}
          </button>

          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          {/*
            学习状态：悬停（或点一下）展开右边那块面板——它原先挂在文档区右上角那颗
            「学习状态」按钮上，那颗按钮已经删掉了，这一项是它现在唯一的入口。
            tip 与这一项包在同一个 wrapper 里：指针从按钮挪到 tip 上时不会中途被收掉。
          */}
          <div className="relative" onMouseLeave={() => setStateSide(null)}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={!!stateSide}
              onMouseEnter={() => {
                const box = ref.current?.getBoundingClientRect()
                const room = box ? window.innerWidth - box.right > 548 : false
                setStateSide(room ? 'right' : 'left')
              }}
              onFocus={() => setStateSide('right')}
              onClick={() => setStateSide((cur) => (cur ? null : 'right'))}
              className={MENU_ITEM + ' text-ink hover:bg-line/60'}
            >
              <span className={'h-[7px] w-[7px] shrink-0 rounded-full ' + STATUS_META[target.node.status].dot} />
              {t('学习状态')}
              <span className="ml-auto pl-2 text-[10.5px] text-ink-faint">
                {t(STATUS_META[target.node.status].label)}
              </span>
            </button>
            {stateSide && (
              <div
                className="absolute top-0 z-10"
                style={stateSide === 'right' ? { left: '100%', marginLeft: 4 } : { right: '100%', marginRight: 4 }}
              >
                <NodeStatePanel
                  node={target.node}
                  structure={state.structure(target.node.id)}
                  onSetSelf={(self) => state.onSetSelf(target.node.id, self)}
                  onClearMistake={(pattern) => state.onClearMistake(target.node.id, pattern)}
                  onRecall={() => state.onRecall(target.node.id)}
                  onProbe={() => state.onProbe(target.node.id)}
                  busy={state.busy}
                />
              </div>
            )}
          </div>

          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => onDeleteNode(target.node.id))}
            className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10'}
          >
            <Trash2 size={13} className="shrink-0" />
            {t('删除')}
          </button>
        </>
      )}

      {/*
        大纲行：与学习文档行一样跟节点强制绑定。没有「删除」——大纲是节点的另一份
        本体文件，要清掉的是里面的计划，让导师重排即可。
      */}
      {target.kind === 'outline' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onOpenOutline(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="outline" size={13} />
            {t('打开大纲')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onReplanOutline(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <ListTree size={13} className="shrink-0 text-ink-soft" />
            {t('让导师重排大纲')}
          </button>
          <RevealItem onSelect={run(() => docs.onReveal(target.node.id, { kind: 'outline' }))} />
        </>
      )}

      {/*
        文档目录行（笔记 / 试卷 / 超级文档三合一的收纳层）：收纳层本身只有「新建」可做
        （展开收起靠点行）——三种新建都摆在这里，右键目录想加东西就不用再回到节点那一层去找。
      */}
      {target.kind === 'folder' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onNewNote(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="note" size={13} />
            {t('新建笔记')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onNewExam(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="exam" size={13} />
            {t('新增试卷')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onNewSuperDoc(target.node.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <DocTypeIcon kind="super" size={13} />
            {t('新建超级文档')}
          </button>
        </>
      )}

      {target.kind === 'note' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => onStartRename(target.node.id, target.name))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <NotebookPen size={13} className="shrink-0 text-ink-soft" />
            {t('改名')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onExport({ kind: 'note', nodeId: target.node.id, note: target.name }))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <Download size={13} className="shrink-0 text-ink-soft" />
            {t('导出')}
          </button>
          <RevealItem onSelect={run(() => docs.onReveal(target.node.id, { kind: 'note', note: target.name }))} />
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onDeleteNote(target.node.id, target.name))}
            className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10'}
          >
            <Trash2 size={13} className="shrink-0" />
            {t('删除')}
          </button>
        </>
      )}

      {target.kind === 'super' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onExport({ kind: 'super', nodeId: target.node.id, name: target.name }))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <Download size={13} className="shrink-0 text-ink-soft" />
            {t('导出')}
          </button>
          <RevealItem onSelect={run(() => docs.onReveal(target.node.id, { kind: 'node' }))} />
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onDeleteSuperDoc(target.node.id, target.name))}
            className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10'}
          >
            <Trash2 size={13} className="shrink-0" />
            {t('删除')}
          </button>
        </>
      )}

      {target.kind === 'exam' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => exams.onStart(target.node.id, target.exam.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            {exams.liveExamId === target.exam.id ? (
              <>
                <RotateCcw size={13} className="shrink-0 text-ink-soft" />
                {t('回到考试')}
              </>
            ) : (
              <>
                <Play size={13} className="shrink-0 text-ink-soft" />
                {t('考试')}
              </>
            )}
          </button>
          {examNeedsWork(target.exam) && (
            <button
              type="button"
              role="menuitem"
              disabled={exams.grading}
              onClick={run(() => exams.onGrade(target.node.id))}
              className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10 disabled:pointer-events-none disabled:opacity-50'}
            >
              <GraduationCap size={13} className="shrink-0" />
              {exams.grading ? t('导师在判分…') : t('让导师判分')}
            </button>
          )}
          <RevealItem onSelect={run(() => docs.onReveal(target.node.id, { kind: 'node' }))} />
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => exams.onDelete(target.exam))}
            className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10'}
          >
            <Trash2 size={13} className="shrink-0" />
            {t('删除试卷')}
          </button>
        </>
      )}

      {target.kind === 'attempt' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onOpenAttempt(target.node.id, target.exam.id, target.attempt.id))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <GraduationCap size={13} className="shrink-0 text-ink-soft" />
            {t('打开这次考试的副本')}
          </button>
          <RevealItem onSelect={run(() => docs.onReveal(target.node.id, { kind: 'node' }))} />
        </>
      )}

      {target.kind === 'local' && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={run(() => docs.onExport({ kind: 'local', path: target.file.path }))}
            className={MENU_ITEM + ' text-ink hover:bg-line/60'}
          >
            <Download size={13} className="shrink-0 text-ink-soft" />
            {t('导出')}
          </button>
          <RevealItem onSelect={run(() => onRevealLocal(target.file.path))} />
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={run(() => onRemoveLocal(target.file.path))}
            className={MENU_ITEM + ' text-seal-deep hover:bg-seal/10'}
          >
            <Trash2 size={13} className="shrink-0" />
            {t('从列表里移除（不删文件）')}
          </button>
        </>
      )}

      {/* 工作区里的是磁盘上真实的文件 / 子目录：目录给新建（建完当场进输入框起名），
          目录与文件都能就地改名——改的就是磁盘上的名字，不是应用里的一份账 */}
      {target.kind === 'ws' && (
        <>
          {target.dir && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={run(() => ws.create(target.rel, 'dir'))}
                className={MENU_ITEM + ' text-ink hover:bg-line/60'}
              >
                <FolderPlus size={13} className="shrink-0 text-ink-soft" />
                {t('新建目录')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={run(() => ws.create(target.rel, 'file'))}
                className={MENU_ITEM + ' text-ink hover:bg-line/60'}
              >
                <FilePlus size={13} className="shrink-0 text-ink-soft" />
                {t('新建文件')}
              </button>
            </>
          )}
          {!target.root && (
            <button
              type="button"
              role="menuitem"
              onClick={run(() => ws.startRename(target.rel))}
              className={MENU_ITEM + ' text-ink hover:bg-line/60'}
            >
              <Pencil size={13} className="shrink-0 text-ink-soft" />
              {t('重命名')}
            </button>
          )}
          <RevealItem onSelect={run(() => onRevealWs(target.rel))} />
        </>
      )}
    </div>
  )
}
