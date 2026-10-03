/**
 * 这个文件负责：资源管理器侧栏的**外壳**——aside 那一块、右边那条拖宽把手、三个分区
 * （知识节点 / 本地文件 / 最近打开）的接线，以及节点行与右键菜单的挂载。
 * 树在 explorer/NodeRow，菜单在 explorer/RowMenu，展开状态与宽度分别由
 * explorer/useTreeExpand、explorer/useSidebarWidth 管。
 */
import { useMemo, useState } from 'react'
import type { FavoriteRef, KnowledgeNode, LearnStore, TabRef } from '../../learn/types'
import { nodeById } from '../../learn/graph'
import { EXPLORER_WIDTH_MAX, EXPLORER_WIDTH_MIN } from '../../lib/appearance'
import Logo from '../Logo'
import { NewGoalIcon, OpenLocalIcon } from '../icons'
import { NodeRow } from './explorer/NodeRow'
import { RowMenu } from './explorer/RowMenu'
import { FavoriteSection, LocalRow, RecentSection, Section } from './explorer/sections'
import SystemAudioWave from './SystemAudioWave'
import { useSidebarWidth } from './explorer/useSidebarWidth'
import { useTreeExpand } from './explorer/useTreeExpand'
import type { ExamActions, MenuState, MenuTarget, NodeDocActions, NodeStateActions, WsActions } from './explorer/types'
import { t } from '../../i18n'

// 原有的三个具名导出照旧从本文件出去（它们搬到了 explorer/types.ts，这里 re-export：调用方零改动）
export type { ExamActions, NodeDocActions, NodeStateActions, WsActions } from './explorer/types'

/**
 * 资源管理器侧栏：知识节点 + 本地文件两个可折叠的区。
 *
 * 为什么从「知识节点栏」改成资源管理器：页面上的东西变多了——除了知识点，还有拖进来
 * 浏览的本地文件，以及后面可能加的更多来源。全平铺地堆在一条列表里，用户没法回答
 * 「我现在看的是哪一类东西」。分区之后每类各自折叠、各自计数，与 vscode 的资源管理器同构。
 *
 * 两个默认：**都默认展开**（用户打开侧栏就是想知道里面有什么），
 * **本地文件区没有内容时整块不显示**——一个永远空着的分区只会占地方。
 *
 * 一棵节点行里挂着**三样孩子**：与节点强制绑定的学习文档（置顶）、下级节点（知识结构）
 * 与这个节点自己的其他文档（笔记 / 试卷 / 超级文档）。从前文档只散在文档区右上角那几块
 * tip 里，「这个节点有什么」在侧栏看不见，而侧栏本来就是回答那个问题的地方。
 * 文档行因此长得与节点行不一样：小一档、点一下开页签；右键则给出这一类东西能做的事
 * （打开 / 改名 / 在资源管理器中定位 / 删除 / 开考）。焦点格开着哪份文档，哪一行就亮。
 */

interface Props {
  store: LearnStore
  /**
   * 当前**选中**的节点：由激活的页签推出，而不是「上次点过的节点」。
   * 关掉某个节点的教学文档页签，它就不该再是选中样式（见 LearnWorkspace）。
   */
  activeNodeId: string | null
  /** 焦点格正在显示的那份文档：树里的**文档行**也据此亮起来（不只节点行） */
  activeTab: TabRef | null
  busyNodeId: string | null
  open: boolean
  /** 纯净阅读：整栏收起让位（见 LearnWorkspace 的 F11）；窄屏下本来就是个抽屉，不必管 */
  pure: boolean
  onClose: () => void
  onSelectNode: (nodeId: string) => void
  onNewGoal: () => void
  onDeleteNode: (nodeId: string) => void
  /** 在系统文件管理器里定位该节点的正文文件（节点右键菜单） */
  onRevealNode: (nodeId: string) => void
  /** 定位工作区目录里的真实文件 / 子目录（docs/…/workspace/…，见 learn/workspace） */
  onRevealWs: (rel: string) => void
  /** 工作区文件在页签里打开（解析不解析看后缀，见 LearnWorkspace 的 openWsFile） */
  onOpenWs: (rel: string) => void
  /** 工作区的新建与改名（真实文件 / 目录，IO 在宿主那一头，见 WsActions） */
  ws: WsActions
  /** 打开一个本地文件（列表项点击、或从对话框挑回来） */
  onOpenLocal: (path: string) => void
  /** 从列表里移除（不动磁盘上的文件） */
  onRemoveLocal: (path: string) => void
  /** 在系统文件管理器里定位这个本地文件 */
  onRevealLocal: (path: string) => void
  /** 弹原生对话框挑本地文件 */
  onPickLocal: () => void
  /** 收藏区：打开一行（现场换算成页签，见 LearnWorkspace 的 openFavorite） */
  onOpenFavorite: (ref: FavoriteRef) => void
  /** 收藏区：把一行摘出收藏夹（不动文档本身） */
  onRemoveFavorite: (ref: FavoriteRef) => void
  /** 收藏行的标题（节点名 / 考试名要查数据，见 learn/favorites 的 favoriteTitle） */
  favoriteTitleOf: (ref: FavoriteRef) => string
  /** 节点下面那些文档的动作：新建、打开、改名、删除、定位 */
  docs: NodeDocActions
  /** 考试那一侧的动作（原先都在文档区悬浮组的「试卷」tip 里） */
  exams: ExamActions
  /** 学习状态那块 tip 要的东西（节点右键菜单里的二级 tip） */
  state: NodeStateActions
}

export default function ExplorerSidebar({
  store,
  activeNodeId,
  activeTab,
  busyNodeId,
  open,
  pure,
  onClose,
  onSelectNode,
  onNewGoal,
  onDeleteNode,
  onRevealNode,
  onRevealWs,
  onOpenWs,
  ws,
  onOpenLocal,
  onRemoveLocal,
  onRevealLocal,
  onPickLocal,
  onOpenFavorite,
  onRemoveFavorite,
  favoriteTitleOf,
  docs,
  exams,
  state,
}: Props) {
  const { isOpen, toggle } = useTreeExpand(store, activeNodeId)
  const [menu, setMenu] = useState<MenuState | null>(null)
  /**
   * 正在就地改名的那份笔记。**状态放在侧栏这一层**：改名是从右键菜单里点的，
   * 而菜单只有一份、挂在侧栏上——状态搁在某一行里，菜单就够不着它了。
   */
  const [renaming, setRenaming] = useState<{ nodeId: string; name: string } | null>(null)
  const { width, resizing, asideRef, onWidthDown, onWidthMove, onWidthUp } = useSidebarWidth()

  /** 两个分区各自的折叠状态；没记过的一律按展开（见文件头的说明） */
  const [collapsed, setCollapsed] = useState<Map<string, boolean>>(new Map())
  const sectionOpen = (key: string) => !collapsed.get(key)
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Map(prev)
      next.set(key, !prev.get(key))
      return next
    })

  const roots = useMemo(
    () => store.goals.map((g) => nodeById(store, g.rootNodeId)).filter((n): n is KnowledgeNode => !!n),
    [store],
  )
  const locals = store.localFiles ?? []
  const openMenu = (x: number, y: number, target: MenuTarget) => setMenu({ x, y, target })

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-mask/25 md:hidden" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        ref={asideRef}
        /*
         * 宽度写在这一层（内联），不用 w-72：它可拖、也记在设置里（见上面的宽度状态）。
         *
         * 纯净阅读（pure）时整栏往左让出去，让位靠的是**负外边距**而不是位移：
         * translate 只挪画面，这一栏在布局里占的那几百像素还在（正文左边会空一条）；
         * 把外边距收成 -width 才是真的让位，而宽度本身一点不动——里面的树、滚动位置
         * 全都原样待着，滑出去的只是整块。等宽过渡与右侧那一栏同一档（300ms）。
         */
        style={{ width, marginLeft: pure ? -width : 0 }}
        // md:relative（而不是 md:static）：右边那条宽度把手是绝对定位的，得有个定位祖先；
        // relative 与 static 在流里的占位完全一样，桌面上看不出区别。
        // 过渡属性按断点分开：窄屏下这一栏是抽屉（滑 transform，200ms），
        // 桌面上它靠外边距让位（300ms，与右侧栏对齐）——两者不会同时发生。
        className={'no-print fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r border-line bg-paper-deep transition-transform duration-200 md:transition-[margin-left,visibility] md:duration-300 md:ease-out md:relative md:translate-x-0 ' +
          (pure || open ? 'translate-x-0' : '-translate-x-full') +
          // 让位之后别再留在 Tab 序列里：滑出窗口只是看不见，里面那棵树、那些按钮
          // 照样能被 Tab 找到（与两列收起时那条 lg:invisible 同一个道理）
          (pure ? ' invisible' : '')}
      >
        <header className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <Logo size={34} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[15px] font-semibold text-ink-strong">{t('归一')}</div>
            <div className="text-[9px] uppercase tracking-[0.24em] text-ink-faint">Retro Learning</div>
          </div>
          {/*
            顶部不再放任何动作按钮：它们原先与各自分区里的入口重复
            （打开本地文件就在「本地文件」区的右上角），新建学习目标则挪到了
            「知识节点」区的右上角——动作长在它作用的那一类东西旁边，才找得到。
          */}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          <Section
            title={t('学习目标')}
            count={store.nodes.length}
            open={sectionOpen('nodes')}
            onToggle={() => toggleSection('nodes')}
            action={
              <button
                type="button"
                title={t('新建学习目标')}
                onClick={onNewGoal}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
              >
                <NewGoalIcon size={15} />
              </button>
            }
          >
            <div className="px-2">
              {roots.map((root) => (
                <NodeRow
                  key={root.id}
                  node={root}
                  store={store}
                  isOpen={isOpen}
                  onToggle={toggle}
                  activeNodeId={activeNodeId}
                  activeTab={activeTab}
                  busyNodeId={busyNodeId}
                  onSelectNode={onSelectNode}
                  onOpenMenu={openMenu}
                  docs={docs}
                  exams={exams}
                  renamingNote={renaming && renaming.nodeId === root.id ? renaming.name : null}
                  onEndRename={() => setRenaming(null)}
                  onOpenWs={onOpenWs}
                  ws={ws}
                />
              ))}
              {roots.length === 0 && (
                <div className="px-3 py-8 text-center text-[13px] leading-relaxed text-ink-faint">
                  {t('还没有学习记录')}
                  <br />
                  {t('从一个目标开始吧')}
                </div>
              )}
            </div>
          </Section>

          {/* 收藏：树与本地文件之间。收藏的东西多种多样（文档 / 网页 / 文件），
              放在「我有什么」的两区之间才找得到；空列表整块不显示 */}
          <FavoriteSection
            items={store.favorites ?? []}
            open={sectionOpen('favorites')}
            onToggle={() => toggleSection('favorites')}
            titleOf={favoriteTitleOf}
            onOpen={onOpenFavorite}
            onRemove={onRemoveFavorite}
          />

          {locals.length > 0 && (
            <Section
              title={t('本地文件')}
              count={locals.length}
              open={sectionOpen('local')}
              onToggle={() => toggleSection('local')}
              action={
              <button
                type="button"
                title={t('打开本地文件')}
                onClick={onPickLocal}
                className="flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
              >
                <OpenLocalIcon size={15} />
              </button>
              }
            >
              <div className="px-2">
                {locals.map((f) => (
                  <LocalRow
                    key={f.path}
                    file={f}
                    onOpen={() => onOpenLocal(f.path)}
                    onRemove={() => onRemoveLocal(f.path)}
                    onMenu={(x, y) => openMenu(x, y, { kind: 'local', file: f })}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* 最近打开排在最后：「我有什么」在前、「我刚才在看什么」在后 */}
          <RecentSection
            store={store}
            open={sectionOpen('recent')}
            onToggle={() => toggleSection('recent')}
            onSelectNode={onSelectNode}
            onOpenLocal={onOpenLocal}
          />
        </div>

        {/* 系统音频柱形频谱：挂在侧栏底端当一台小电台（采集见 src/lib/audio/loopback）。
            满宽、不加上边框——树区滚到底已有留白，再画一条线就把这块小电台框死了；
            柱子从底边往上长，接不上系统音频时只剩一排底座，原因在悬停提示里 */}
        <div className="px-2 py-2.5">
          <SystemAudioWave />
        </div>

        {/* 拖拽的提示常驻在最下面一行：本地文件区没内容时整块不显示，没有这句话就没人知道能拖 */}
        <div className="border-t border-line px-4 py-2 text-[10.5px] leading-relaxed text-ink-faint">
          {t('把 txt / markdown 文件拖进窗口，就能在这里浏览')}
        </div>

        {/*
          右边线上的宽度把手：命中区 8px（一像素的线抓不住），骑在那条 border-r 上。
          md 以上才有意义——窄屏下这一栏是盖在内容上的抽屉，宽度由屏幕说了算。
        */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('拖动调整资源管理器宽度（{0}~{1} px）', EXPLORER_WIDTH_MIN, EXPLORER_WIDTH_MAX)}
          title={t('拖动调整宽度（{0}~{1} px）', EXPLORER_WIDTH_MIN, EXPLORER_WIDTH_MAX)}
          onPointerDown={onWidthDown}
          onPointerMove={onWidthMove}
          onPointerUp={onWidthUp}
          onPointerCancel={onWidthUp}
          className={
            'no-print absolute inset-y-0 right-0 z-10 hidden w-2 translate-x-1/2 cursor-col-resize touch-none md:block ' +
            (resizing ? 'bg-seal/40' : '')
          }
        />
      </aside>

      {menu && (
        <RowMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onRevealNode={onRevealNode}
          onRevealWs={onRevealWs}
          ws={ws}
          onDeleteNode={onDeleteNode}
          onRemoveLocal={onRemoveLocal}
          onRevealLocal={onRevealLocal}
          onStartRename={(nodeId, name) => setRenaming({ nodeId, name })}
          docs={docs}
          exams={exams}
          state={state}
        />
      )}
    </>
  )
}
