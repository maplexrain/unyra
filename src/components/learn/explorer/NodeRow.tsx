/**
 * 这个文件负责：知识树里的一行——节点本身、它的下级节点递归，以及挂在它下面的
 * 学习文档与大纲（各自一行置顶）、文档目录（笔记 / 试卷 / 超级文档三合一，可开合）、
 * 工作区目录，与「哪一份试卷展开着历次考试」这个状态。
 */
import { useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { KnowledgeNode, LearnStore, TabRef } from '../../../learn/types'
import { superDocsOf } from '../../../learn/types'
import { examsOfNode, nodeById, prereqIds } from '../../../learn/graph'
import { STATUS_META } from '../mastery'
import StatusBranch from '../StatusBranch'
import { Collapse } from './sections'
import { DocRow, ExamList, NoteRenameRow } from './DocRow'
import { DocFolderIcon } from '../docTypes'
import { WorkspaceRow } from './WorkspaceRow'
import type { ExamActions, MenuTarget, NodeDocActions, WsActions } from './types'
import { chipJson, type ChipPayload } from '../../../lib/chipSyntax'
import { nodeDocPath } from '../../../learn/files'
import { t } from '../../../i18n'

/**
 * 知识树里的一行：**学习文档 + 大纲 + 下级节点 + 这个节点自己的其他文档**。
 *
 * 为什么把文档也挂进来：一个节点底下的东西远不止下级知识点——学习文档、大纲、
 * 若干份笔记、若干份试卷（每份还带着历次考试）、若干份超级文档。从前它们散在文档区
 * 右上角那几块 tip 里，「这个节点到底有什么」在侧栏里看不见，而侧栏本来就是回答
 * 那个问题的地方（vscode 的资源管理器同理）。
 *
 * 学习文档与大纲各自**一行**排在所有孩子的最前面（置顶，大纲在上）：两份都与节点强制绑定——
 * 节点在它们就在（创建节点那一刻两份文件同时成形），学习文档删了就是删节点本身。
 * 它们不是随便挂着的附件，而是节点的本体。
 *
 * 展开状态沿用节点那一套（上面的 manual / autoExpanded）：**一条箭头管整行的孩子**，
 * 不管是下级节点还是文档——分成两个开关，用户得点两次才能把一行看全。
 * 试卷的历次考试是第三层，只有试卷自己有第二根箭头（一次只开一份：侧栏本来就窄）。
 */
export function NodeRow({
  node,
  store,
  isOpen,
  onToggle,
  activeNodeId,
  activeTab,
  busyNodeId,
  onSelectNode,
  onOpenMenu,
  docs,
  exams,
  renamingNote,
  onEndRename,
  onOpenWs,
  ws,
}: {
  node: KnowledgeNode
  store: LearnStore
  isOpen: (id: string) => boolean
  onToggle: (id: string) => void
  activeNodeId: string | null
  /** 焦点格正在显示的那份文档：树里的文档行据此亮起来（与节点行同一套选中样式） */
  activeTab: TabRef | null
  busyNodeId: string | null
  onSelectNode: (id: string) => void
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void
  docs: NodeDocActions
  exams: ExamActions
  /** 正在就地改名的那份笔记名（改名请求来自右键菜单，所以状态由侧栏统一持有） */
  renamingNote: string | null
  /** 改名结束（提交或取消都走它）：清掉侧栏那一层的状态 */
  onEndRename: () => void
  /** 工作区文件在页签里打开（解析不解析看后缀，见 LearnWorkspace 的 openWsFile） */
  onOpenWs: (rel: string) => void
  /** 工作区的新建与改名（真实文件 / 目录，IO 在宿主那一头，见 WsActions） */
  ws: WsActions
}) {
  const open = isOpen(node.id)
  const children = prereqIds(store, node.id)
    .map((id) => nodeById(store, id))
    .filter((n): n is KnowledgeNode => !!n)
  const active = node.id === activeNodeId
  const meta = STATUS_META[node.status]
  const generating = busyNodeId === node.id
  const notes = node.notes ?? []
  const nodeExams = examsOfNode(store, node.id)
  const superdocs = superDocsOf(node)
  /** 三样文档合起来的份数：文档目录行尾的数量标记与空提示都看它 */
  const docTotal = notes.length + nodeExams.length + superdocs.length
  /** 展开着历次考试的那一份试卷 id；null = 都收着 */
  const [openExam, setOpenExam] = useState<string | null>(null)
  /**
   * 文档目录（笔记 / 试卷 / 超级文档三合一）的开合，**默认收着**（用户定的）：
   * 目录行的职责是先让人看见「有什么、有几份」，内容要点开才铺开——不然文档多的
   * 节点刚展开就又是一大片。与历次考试的开合一样是本地状态，收了哪层记到重挂为止。
   */
  const [docsOpen, setDocsOpen] = useState(false)
  /** 焦点格是「这个节点的哪份文档」——学习文档 / 大纲 / 笔记 / 超级文档各行自己比一遍 */
  const teachActive = activeTab?.kind === 'teach' && activeTab.nodeId === node.id
  const outlineActive = activeTab?.kind === 'outline' && activeTab.nodeId === node.id
  const nodeTitle = node.title || t('未命名')
  /** 目录行尾的数量：一眼知道这一层有几份，不必展开去数 */
  const countBadge = (n: number) => (
    <span className="shrink-0 rounded bg-line/70 px-1.5 py-px text-[10px] leading-4 text-ink-faint">{n}</span>
  )
  /** 展开一个空目录时的那一行话：新建的入口在右键菜单上，得告诉人去哪儿点 */
  const emptyHint = (text: string) => (
    <p className="py-1 pl-1.5 pr-2 text-[11px] leading-relaxed text-ink-faint">{text}</p>
  )

  /**
   * 这个节点底下的东西能拖出去的那几份引用（见 lib/chipSyntax 的 ChipPayload）：
   * 拖到页签栏开成页签、拖到对话输入框变成一枚引用。nodeId 宿主都知道，一并带上，
   * 打开时免于按路径反查（见 learn/chipRef）。
   */
  const teachChip = (): ChipPayload => ({
    type: 'doc',
    nodeId: node.id,
    path: nodeDocPath(store, node.id, { kind: 'teaching' }) ?? undefined,
    title: nodeTitle,
  })
  const outlineChip = (): ChipPayload => ({
    type: 'outline',
    nodeId: node.id,
    path: nodeDocPath(store, node.id, { kind: 'outline' }) ?? undefined,
    title: nodeTitle,
  })
  const noteChip = (name: string): ChipPayload => ({
    type: 'note',
    nodeId: node.id,
    note: name,
    path: nodeDocPath(store, node.id, { kind: 'note', note: name }) ?? undefined,
    title: name,
  })
  const superChip = (name: string): ChipPayload => ({
    type: 'super',
    nodeId: node.id,
    name,
    path: nodeDocPath(store, node.id, { kind: 'teaching' }) ?? undefined,
    title: name,
  })

  return (
    <div>
      <div className="mb-0.5">
        <div
          role="button"
          tabIndex={0}
          /*
           * 点整行 = 展开 / 收起子级（用户定的）：这一栏是**知识结构**，
           * 顺着一行点下去本来想看的多半是「它底下有什么」。要打开学习文档，
           * 点展开后置顶的那一行。
           */
          onClick={() => onToggle(node.id)}
          // 节点行拖出去 = 它的教学文档（教学文档行的引用是同一份）
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-moji-chip', chipJson(teachChip()))
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onToggle(node.id)
          }}
          onContextMenu={(e) => {
            /*
             * 只弹菜单，**不顺手打开这个节点**（用户定的）：右键是在问「这一行能做什么」，
             * 不是「把它打开」——右击 A 却把文档切到 A 上，正在读的那一份就被顶掉了。
             * 不 preventDefault 的话 Electron 里还会冒出系统菜单（虽然默认是空的，仍不该留口子）。
             */
            e.preventDefault()
            onOpenMenu(e.clientX, e.clientY, { kind: 'node', node })
          }}
          className={'flex cursor-pointer items-start gap-1 py-1 pl-1.5 pr-2 transition ' +
            (active ? 'bg-line/60' : 'hover:bg-line/40')}
        >
          <button
            type="button"
            title={open ? t('收起') : t('展开（学习文档、文档目录与下级节点）')}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.id)
            }}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
          >
            {/* 单箭头旋转而不是两颗图标切换：展开收起时它跟着转过去，与高度的动画同拍 */}
            <ChevronRight
              size={13}
              className={
                'transition-transform duration-200 ease-out motion-reduce:transition-none ' +
                (open ? 'rotate-90' : '')
              }
            />
          </button>

          {/*
            学习状态：**标题前的一棵小分支**（配色见 mastery 的 STATUS_META）。
            它从前是一颗圆点、更早是文档区顶上那条「学会之后可以回溯」的提示条——
            状态是要一眼扫过整棵树看出来的东西，分支的形状还带上了「这是树上的节点」。
          */}
          <span className="mt-[3px] flex shrink-0 items-center" title={t(meta.label)}>
            <StatusBranch size={12} className={meta.mark} />
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                className={'min-w-0 flex-1 truncate text-[13px] ' +
                  (active ? 'font-semibold text-ink-strong' : 'font-medium text-ink')}
              >
                {nodeTitle}
              </span>
              {generating && <Loader2 size={11} className="shrink-0 animate-spin text-ink-faint" />}
            </span>
          </span>
        </div>
        {/*
          节点行上不再放任何图标按钮（打开文档 / 删除都删了）：打开走展开后置顶的学习文档行，
          删除与「新建笔记 / 试卷 / 超级文档」在右键菜单里——行级按钮常驻会让整棵树
          看起来全是按钮，而这两件事本来就不是鼠标扫过时顺手做的。
        */}
      </div>

      {/*
        孩子分三段：**大纲与学习文档（各自一行置顶，跟节点绑定）→ 文档目录（笔记 / 试卷 / 超级文档
        三合一）→ 工作区与下级节点**。目录摆在子节点之上是资源管理器的本职排序——「这个节点有哪些
        文件」先于「往下学什么」；原来三样各占一个常驻目录，大多节点用不满，合进一个「文档」
        省下两行（用户定的）。目录**常驻**：空了也显示——新建的入口在目录行的右键菜单上，
        目录不画出来就没有地方右键，第一次初始化就无从下手。各段同一层缩进、同一条左边线。
      */}
      <Collapse open={open}>
        <div className="ml-3 border-l border-line pl-1.5">
          {/*
            大纲行与学习文档行**各自一行、大纲在上**（用户定的）。老数据没有大纲也照常显示——
            点开是「还没有大纲」的占位页，上面有「请导师生成大纲」。
          */}
          <DocRow
            kind="outline"
            label={t('大纲')}
            hint={t('打开「{0}」的大纲页（这一层的路线图：子目标与各自的学习情况）', nodeTitle)}
            active={outlineActive}
            dragChip={outlineChip}
            onClick={() => docs.onOpenOutline(node.id)}
            onMenu={(x, y) => onOpenMenu(x, y, { kind: 'outline', node })}
          />
          <DocRow
            kind="teach"
            label={nodeTitle}
            hint={t('打开学习文档「{0}」（与节点绑定：删除它就是删除节点）', nodeTitle)}
            active={teachActive}
            dragChip={teachChip}
            onClick={() => onSelectNode(node.id)}
            onMenu={(x, y) => onOpenMenu(x, y, { kind: 'teach', node })}
          />
        </div>

        <div className="ml-3 border-l border-line pl-1.5">
          {/*
            文档目录：笔记 / 试卷 / 超级文档三合一（用户定的）。展开后按 笔记 → 试卷（带历次
            考试）→ 超级文档 排开，一份份行的图标与颜色各是各的类型，混排也认得出。
          */}
          <DocRow
            // 目录行用文件夹图标（开合跟着展开状态走），与下面一份份的文档行（类型图标）区分开
            icon={<DocFolderIcon open={docsOpen} />}
            label={t('文档')}
            hint={
              docTotal > 0
                ? t('这个节点全部文档的目录（笔记 / 试卷 / 超级文档，共 {0} 份）；点行收起 / 展开，右键新建', docTotal)
                : t('这个节点还没有文档；右键这一行新建')
            }
            badge={docTotal > 0 ? countBadge(docTotal) : undefined}
            expandable
            open={docsOpen}
            onClick={() => setDocsOpen((v) => !v)}
            onMenu={(x, y) => onOpenMenu(x, y, { kind: 'folder', node, folder: 'docs' })}
          />
          <Collapse open={docsOpen}>
            <div className="ml-3 border-l border-line pl-1.5">
              {docTotal === 0 && emptyHint(t('还没有文档——右键「文档」这一行新建'))}
              {notes.map((n) =>
                renamingNote === n.name ? (
                  <NoteRenameRow
                    key={'note:' + n.name}
                    initial={n.name}
                    onCancel={onEndRename}
                    onCommit={(next) => {
                      onEndRename()
                      const name = next.trim()
                      if (name && name !== n.name) docs.onRenameNote(node.id, n.name, name)
                    }}
                  />
                ) : (
                  <DocRow
                    key={'note:' + n.name}
                    kind="note"
                    label={n.name}
                    hint={t('打开笔记「{0}」（右键：改名 / 在资源管理器中打开 / 删除）', n.name)}
                    active={activeTab?.kind === 'note' && activeTab.nodeId === node.id && activeTab.note === n.name}
                    dragChip={() => noteChip(n.name)}
                    onClick={() => docs.onOpenNote(node.id, n.name)}
                    onMenu={(x, y) => onOpenMenu(x, y, { kind: 'note', node, name: n.name })}
                  />
                ),
              )}
              <ExamList
                nodeExams={nodeExams}
                node={node}
                docs={docs}
                exams={exams}
                activeTab={activeTab}
                openExam={openExam}
                setOpenExam={setOpenExam}
                onOpenMenu={onOpenMenu}
              />
              {superdocs.map((d) => (
                <DocRow
                  key={'super:' + d.name}
                  kind="super"
                  label={d.name}
                  hint={t('打开超级文档「{0}」（右键：在资源管理器中打开 / 删除）', d.name)}
                  active={activeTab?.kind === 'super' && activeTab.nodeId === node.id && activeTab.name === d.name}
                  dragChip={() => superChip(d.name)}
                  onClick={() => docs.onOpenSuperDoc(node.id, d.name)}
                  onMenu={(x, y) => onOpenMenu(x, y, { kind: 'super', node, name: d.name })}
                />
              ))}
            </div>
          </Collapse>
        </div>

        {/*
          工作区目录：这个节点目录下的**真实子文件夹**（users/<uid>/docs/<目标>/<节点>/workspace/，
          布局见 learn/workspace）。与上面的文档目录不同，它不是应用记账出来的——里面列出的
          文件与子目录就是磁盘上实际有的那些（用户放进去的、导师用 workspace.write 写的都在）。
          一直显示：真实目录永远存在，藏起来反而让人以为没有。
        */}
        <WorkspaceRow node={node} store={store} ws={ws} onOpenMenu={onOpenMenu} onOpen={onOpenWs} />

        {children.map((child) => (
          <div key={child.id} className="ml-3 border-l border-line pl-1.5">
            <NodeRow
              node={child}
              store={store}
              isOpen={isOpen}
              onToggle={onToggle}
              activeNodeId={activeNodeId}
              activeTab={activeTab}
              busyNodeId={busyNodeId}
              onSelectNode={onSelectNode}
              onOpenMenu={onOpenMenu}
              docs={docs}
              exams={exams}
              renamingNote={renamingNote}
              onEndRename={onEndRename}
              onOpenWs={onOpenWs}
              ws={ws}
            />
          </div>
        ))}
      </Collapse>
    </div>
  )
}
