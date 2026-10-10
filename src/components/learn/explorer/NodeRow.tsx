/**
 * 这个文件负责：知识树里的一行——节点本身（文字为教学文档链接、右侧为大纲按钮）、
 * 它的下级节点递归，以及直接挂在节点目录下的文档（笔记 / 试卷 / 超级文档平铺，无文档时不渲染）、
 * 工作区目录，与「哪一份试卷展开着历次考试」这个状态。
 */
import { useState, useEffect } from 'react'
import { ChevronRight, ListTree, Loader2 } from 'lucide-react'
import type { KnowledgeNode, LearnStore, TabRef } from '../../../learn/types'
import { superDocsOf } from '../../../learn/types'
import { examsOfNode, nodeById, prereqIds } from '../../../learn/graph'
import { STATUS_META } from '../mastery'
import StatusBranch from '../StatusBranch'
import { Collapse, Indent } from './Folder'
import { subscribeReveal } from './reveal'
import { DocRow, ExamList, NoteRenameRow } from './DocRow'
import { WorkspaceRow } from './WorkspaceRow'
import type { ExamActions, MenuTarget, NodeDocActions, WsActions } from './types'
import { chipJson, type ChipPayload } from '../../../lib/chipSyntax'
import { nodeDocPath } from '../../../learn/files'
import { t } from '../../../i18n'

/**
 * 知识树里的一行：**节点标题链接 + 大纲按钮 + 下级节点 + 这个节点自己的其他文档与工作区**。
 *
 * 教学文档作为节点的本体，直接通过节点文字的链接样式呈现，点击文字即可打开；
 * 大纲作为节点路线图，以节点行右对齐的图标按钮呈现，点击打开大纲；
 * 点击节点行非文字区域则展开 / 折叠下级节点与文档内容。
 * 节点的笔记、试卷、超级文档直接平铺在节点展开项下，无文档时不渲染多余的空目录。
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
  /** 三样文档合起来的份数：若为 0 则不渲染文档区域，避免空文档目录 */
  const docTotal = notes.length + nodeExams.length + superdocs.length
  /** 展开着历次考试的那一份试卷 id；null = 都收着 */
  const [openExam, setOpenExam] = useState<string | null>(null)
  /** 焦点格是「这个节点的哪份文档」——教学文档 / 大纲 / 笔记 / 超级文档各行自己比一遍 */
  const teachActive = activeTab?.kind === 'teach' && activeTab.nodeId === node.id
  const outlineActive = activeTab?.kind === 'outline' && activeTab.nodeId === node.id
  const nodeTitle = node.title || t('未命名')

  // 定位广播轮到这个节点：开出正在看的那份试卷的历次考试。
  useEffect(
    () =>
      subscribeReveal((req) => {
        const exam = req.exams.find((e) => e.nodeId === node.id)
        if (exam) setOpenExam(exam.examId)
      }),
    [node.id],
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
          data-reveal={`row:doc:teach:${node.id}`}
          /*
           * 点节点行非文字区域 = 展开 / 收起子级（知识结构）。
           * 点文字链接 = 独立打开教学文档。
           */
          onClick={() => onToggle(node.id)}
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
             * 只弹菜单，不顺手打开这个节点（用户定的）：右键是在问「这一行能做什么」，
             * 不是「把它打开」。
             */
            e.preventDefault()
            onOpenMenu(e.clientX, e.clientY, { kind: 'node', node })
          }}
          className={'group flex cursor-pointer items-center gap-1 rounded-md py-1 pl-1.5 pr-1.5 transition ' +
            (active ? 'bg-line/60' : 'hover:bg-line/40')}
        >
          <button
            type="button"
            title={open ? t('收起') : t('展开（文档、工作区与下级节点）')}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.id)
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/70 hover:text-ink"
          >
            {/* 单箭头旋转：展开收起时它跟着转过去，与高度的动画同拍 */}
            <ChevronRight
              size={13}
              className={
                'transition-transform duration-200 ease-out motion-reduce:transition-none ' +
                (open ? 'rotate-90' : '')
              }
            />
          </button>

          {/*
            学习状态：标题前的一棵小分支（配色见 mastery 的 STATUS_META）。
          */}
          <span className="flex shrink-0 items-center" title={t(meta.label)}>
            <StatusBranch size={12} className={meta.mark} />
          </span>

          {/*
            节点文字作为链接样式：点击文字独立于整行的展开折叠，直接打开教学文档
          */}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span
                role="link"
                tabIndex={0}
                title={t('打开学习文档「{0}」', nodeTitle)}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectNode(node.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    onSelectNode(node.id)
                  }
                }}
                className={
                  'min-w-0 max-w-full truncate text-[13px] transition cursor-pointer select-none ' +
                  (teachActive
                    ? 'font-semibold text-seal underline underline-offset-2'
                    : active
                      ? 'font-semibold text-ink-strong hover:text-seal hover:underline'
                      : 'font-medium text-ink hover:text-seal hover:underline')
                }
              >
                {nodeTitle}
              </span>
              {generating && <Loader2 size={11} className="shrink-0 animate-spin text-ink-faint" />}
            </span>
          </span>

          {/*
            大纲按钮：右对齐的图标按钮，点击打开大纲，右键弹出大纲专属菜单
          */}
          <button
            type="button"
            data-reveal={`row:doc:outline:${node.id}`}
            title={t('打开「{0}」的大纲页', nodeTitle)}
            aria-label={t('大纲')}
            onClick={(e) => {
              e.stopPropagation()
              docs.onOpenOutline(node.id)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpenMenu(e.clientX, e.clientY, { kind: 'outline', node })
            }}
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              e.dataTransfer.setData('application/x-moji-chip', chipJson(outlineChip()))
              e.dataTransfer.effectAllowed = 'copy'
            }}
            className={
              'flex h-5 w-5 shrink-0 items-center justify-center rounded transition ' +
              (outlineActive
                ? 'bg-seal/15 text-seal'
                : 'text-ink-faint hover:bg-line/70 hover:text-seal')
            }
          >
            <ListTree size={12} />
          </button>
        </div>
      </div>

      {/*
        展开项：平铺的文档（若有）→ 工作区目录（保留）→ 下级节点
      */}
      <Collapse open={open}>
        {docTotal > 0 && (
          <Indent>
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
                  revealKey={`row:doc:note:${node.id}:${n.name}`}
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
                revealKey={`row:doc:super:${node.id}:${d.name}`}
                dragChip={() => superChip(d.name)}
                onClick={() => docs.onOpenSuperDoc(node.id, d.name)}
                onMenu={(x, y) => onOpenMenu(x, y, { kind: 'super', node, name: d.name })}
              />
            ))}
          </Indent>
        )}

        {/*
          工作区目录：这个节点目录下的真实子文件夹，保留展示
        */}
        <WorkspaceRow node={node} store={store} ws={ws} onOpenMenu={onOpenMenu} onOpen={onOpenWs} onTransfer={ws.transfer} />

        {children.map((child) => (
          <Indent key={child.id}>
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
          </Indent>
        ))}
      </Collapse>
    </div>
  )
}

