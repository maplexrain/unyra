/*
 * 本文件负责：节点卡片下沿向下展开的**文档 tip 气泡**（笔记 / 试卷 / 超级文档三栏清单），
 * 以及它内部的三种行组件（通用行、笔记行、就地改名输入框）。
 *
 * 全部原样搬自 MindmapView.tsx，注释一并带走。
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, FileText, FlaskConical, Plus, X } from 'lucide-react'
import type { KnowledgeNode, LearnStore, TabRef } from '../../../learn/types'
import { notesOf, superDocsOf } from '../../../learn/types'
import { examsOfNode } from '../../../learn/graph'
import { DocTypeIcon } from '../docTypes'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { t } from '../../../i18n'
import { attemptScore } from '../../../learn/exam'
import type { ActivePreviewInfo, DocKey } from './mindmapTypes'
import { DOC_LABEL, TIP_BORDER, TIP_GAP, TIP_TAIL } from './mindmapTypes'

/**
 * 节点卡片下沿向下展开的文档 tip。
 *
 * 做成**卡片内部绝对定位**的子元素（挂在卡片的 DOM 里），而不是浮在画布上的独立层：
 * 卡片整体在 `scale(zoom)` 的变换里，tip 跟着一起缩放——缩小时字变小是「这张图在缩小」
 * 的正常表现，而独立层会保持字号不变、从图上「浮起来」，两套坐标系会互相打架。
 *
 * 尺寸也随卡片：tip 与卡片同宽（`left-0 right-0`），列表长了在里面滚。
 */
export function NodeDocTip({
  node,
  kind,
  anchorX,
  store,
  docs,
  exams,
  activeTab,
  activePreview,
  onClose,
  onPreview,
  readOnly = false,
}: {
  node: KnowledgeNode
  kind: DocKey
  /** 气泡尖角对着的横坐标（卡片本地坐标，见 toggleTip） */
  anchorX: number
  store: LearnStore
  docs: NodeDocActions
  exams: ExamActions
  activeTab: TabRef | null
  activePreview?: ActivePreviewInfo | null
  onClose: () => void
  onPreview: (info: ActivePreviewInfo) => void
  readOnly?: boolean
}) {
  const notes = notesOf(node)
  const supers = superDocsOf(node)
  const nodeExams = examsOfNode(store, node.id)

  const [expandedExamIds, setExpandedExamIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (activePreview?.kind === 'exam' && activePreview.examId) {
      initial.add(activePreview.examId)
    }
    if (activeTab?.kind === 'exam' && activeTab.examId) {
      initial.add(activeTab.examId)
    }
    return initial
  })

  const toggleExam = (examId: string) => {
    setExpandedExamIds((prev) => {
      const next = new Set(prev)
      if (next.has(examId)) {
        next.delete(examId)
      } else {
        next.add(examId)
      }
      return next
    })
  }

  const rows =
    kind === 'note' ? notes.length : kind === 'exam' ? nodeExams.length : supers.length

  return (
    <div
      // 拖动与选中都不该被 tip 内部的操作带跑（外面那层卡片的 onClick 自己会选中节点）
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      /*
       * z-30 只在卡片内部比大小（卡片因为 z-40 成了自己的层叠上下文）；
       * **真正让它压过邻居的是卡片那一层的 z-40**（见卡片上那段说明）——
       * 只在这里写多大的 z 都没用，它飞不出卡片自己的层。
       *
       * 形状上它是一个**气泡**：圆角收小一圈（rounded-lg），下沿这一侧由那颗转 45° 的
       * 小方块接住，指向点开它的那颗按钮。mt-2 的空当正好被尖角填满，
       * 于是眼睛看到的是「卡片上的按钮鼓出来一个气泡」，而不是两片分开的浮层。
       */
      className="absolute top-full left-0 right-0 z-30 cursor-default rounded-lg border-2 border-line-strong bg-paper p-2 shadow-xl dark:bg-card"
      style={{ marginTop: TIP_GAP }}
    >
      {/*
        尖角。一个转了 45° 的方块只留朝外的两条边（border-l + border-t），转过来之后
        这两条边就成了菱形的左上 / 右上两条——与气泡的上边框同色同粗，接得上。
        填充色与气泡一致，它盖住气泡上边框的那一段（子元素画在父元素的边框之上），
        于是那一段「断开」成了尖角的开口，整体是一根连续的轮廓线。
      */}
      <span
        aria-hidden="true"
        className="absolute border-l-2 border-t-2 border-line-strong bg-paper dark:bg-card"
        style={{
          left: anchorX - TIP_TAIL / 2 - TIP_BORDER,
          // 让菱形的顶端正好顶到卡片下沿：先把空当与边框补回来，再减去菱形自己高出的那一点
          top: -(TIP_GAP + TIP_BORDER - TIP_TAIL * 0.207),
          width: TIP_TAIL,
          height: TIP_TAIL,
          transform: 'rotate(45deg)',
          borderRadius: 2,
        }}
      />
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
          <DocTypeIcon kind={kind} size={12} />
          <span>{t(DOC_LABEL[kind])}</span>
          <span className="font-mono text-ink-faint">{rows}</span>
        </span>
        <div className="flex items-center gap-1">
          {!readOnly && kind === 'note' && (
            <button
              type="button"
              onClick={() => docs.onNewNote(node.id)}
              title={t('新建一份笔记')}
              className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] text-seal transition hover:bg-seal/10"
            >
              <Plus size={10} />
              <span>{t('新建')}</span>
            </button>
          )}
          {!readOnly && kind === 'exam' && (
            <button
              type="button"
              onClick={() => docs.onNewExam(node.id)}
              title={t('让导师出一份卷子')}
              className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] text-seal transition hover:bg-seal/10"
            >
              <Plus size={10} />
              <span>{t('出卷')}</span>
            </button>
          )}
          {!readOnly && kind === 'super' && (
            <button
              type="button"
              onClick={() => docs.onNewSuperDoc(node.id)}
              title={t('开一个超级实验室，让导师写一份可交互文档')}
              className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] text-seal transition hover:bg-seal/10"
            >
              <Plus size={10} />
              <span>{t('新建')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title={t('收起')}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {/* 空态：告诉用户这一栏能干什么，而不是留一片空 */}
        {rows === 0 && (
          <p className="flex items-center gap-1.5 px-1.5 py-2 text-[11px] leading-relaxed text-ink-faint">
            <FileText size={12} className="shrink-0" />
            {kind === 'note'
              ? t('还没有笔记。点右上「新建」写一份。')
              : kind === 'exam'
                ? t('还没考过。点右上「出卷」让导师出一份。')
                : t('还没有超级文档。点右上「新建」开一个。')}
          </p>
        )}

        {kind === 'note' &&
          notes.map((note) => (
            <NoteTipRow
              key={note.name}
              node={node}
              name={note.name}
              readOnly={readOnly}
              active={
                activeTab?.kind === 'note' && activeTab.nodeId === node.id && activeTab.note === note.name
              }
              docs={docs}
              onPreview={() => {
                if (readOnly) {
                  docs.onOpenNote(node.id, note.name)
                } else {
                  onPreview({
                    parentNodeId: node.id,
                    kind: 'note',
                    title: note.name,
                    noteName: note.name,
                  })
                }
              }}
            />
          ))}

        {kind === 'super' &&
          supers.map((sd) => (
            <TipRow
              key={sd.name}
              icon={<DocTypeIcon kind="super" size={12} />}
              label={sd.name}
              hint={readOnly ? t('打开《{0}》', sd.name) : t('预览《{0}》', sd.name)}
              readOnly={readOnly}
              active={
                activeTab?.kind === 'super' && activeTab.nodeId === node.id && activeTab.name === sd.name
              }
              onOpen={() => {
                if (readOnly) {
                  docs.onOpenSuperDoc(node.id, sd.name)
                } else {
                  onPreview({
                    parentNodeId: node.id,
                    kind: 'super',
                    title: sd.name,
                    superName: sd.name,
                  })
                }
              }}
              onOpenTab={() => docs.onOpenSuperDoc(node.id, sd.name)}
              onDelete={() => docs.onDeleteSuperDoc(node.id, sd.name)}
              icon2={<FlaskConical size={11} />}
            />
          ))}

        {kind === 'exam' &&
          nodeExams.map((exam) => {
            const isExpanded = expandedExamIds.has(exam.id)
            const hasAttempts = exam.attempts.length > 0
            return (
              <div key={exam.id} className="flex flex-col gap-0.5 border-b border-line/40 pb-1 last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  title={
                    hasAttempts
                      ? isExpanded
                        ? t('收起考试记录')
                        : t('展开考试记录')
                      : t('暂无考试记录')
                  }
                  onClick={() => {
                    if (hasAttempts) {
                      toggleExam(exam.id)
                    }
                  }}
                  className={`group/row flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-left text-[11.5px] transition text-ink-soft hover:bg-line/40 hover:text-ink ${
                    hasAttempts ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <DocTypeIcon kind="exam" size={12} />
                  <span className="min-w-0 flex-1 truncate font-medium">{exam.title}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">
                    {hasAttempts ? t('{0} 次考试', exam.attempts.length) : t('未考')}
                  </span>
                  {hasAttempts && (
                    <ChevronDown
                      size={12}
                      className={`shrink-0 text-ink-faint transition-transform duration-200 ${
                        isExpanded ? '' : '-rotate-90'
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    title={t('在页签栏开考')}
                    onClick={(e) => {
                      e.stopPropagation()
                      exams.onStart(node.id, exam.id)
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-seal/10 hover:text-seal transition cursor-pointer"
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>
                {isExpanded && hasAttempts && (
                  <div className="pl-4 flex flex-col gap-0.5 mt-0.5">
                    {exam.attempts.map((att, idx) => {
                      const when = new Date(att.startedAt)
                      const stamp =
                        when.getMonth() + 1 + '/' + when.getDate() +
                        ' ' + String(when.getHours()).padStart(2, '0') +
                        ':' + String(when.getMinutes()).padStart(2, '0')
                      const scoreVal = attemptScore(att)
                      const scoreStr = scoreVal != null ? `(${scoreVal}分)` : ''
                      const isAttActive =
                        (activePreview?.kind === 'exam' &&
                          activePreview.examId === exam.id &&
                          activePreview.attemptId === att.id) ||
                        (activeTab?.kind === 'exam' &&
                          activeTab.examId === exam.id &&
                          activeTab.attemptId === att.id)
                      return (
                        <div
                          key={att.id}
                          role="button"
                          tabIndex={0}
                          title={t('预览第 {0} 次作答副本', idx + 1)}
                          onClick={() => {
                            if (readOnly) {
                              docs.onOpenAttempt(node.id, exam.id, att.id)
                            } else {
                              onPreview({
                                parentNodeId: node.id,
                                kind: 'exam',
                                title: `${exam.title} (${stamp})`,
                                examId: exam.id,
                                attemptId: att.id,
                              })
                            }
                          }}
                          className={`group/row flex w-full items-center gap-1 rounded py-0.5 pl-1.5 pr-1 text-[10.5px] transition cursor-pointer ${
                            isAttActive
                              ? 'bg-seal/10 font-medium text-seal'
                              : 'text-ink-faint hover:bg-line/30 hover:text-ink'
                          }`}
                        >
                          <span className="truncate flex-1">
                            #{idx + 1} · {stamp} {scoreStr}
                          </span>
                          <button
                            type="button"
                            title={t('在页签栏打开本次考试副本')}
                            onClick={(e) => {
                              e.stopPropagation()
                              docs.onOpenAttempt(node.id, exam.id, att.id)
                            }}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-seal/10 hover:text-seal transition"
                          >
                            <ExternalLink size={10} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

/**
 * 笔记那一行。做成独立组件是因为它有就地改名的状态（改名是笔记独有的：
 * 名字就是磁盘上的文件名，见 NoteRenameRow）。
 */
function NoteTipRow({
  node,
  name,
  active,
  docs,
  onPreview,
  readOnly,
}: {
  node: KnowledgeNode
  name: string
  active: boolean
  docs: NodeDocActions
  onPreview: () => void
  readOnly?: boolean
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    <TipRow
      icon={<DocTypeIcon kind="note" size={12} />}
      label={name}
      hint={readOnly ? t('打开《{0}》', name) : t('预览《{0}》；双击改名', name)}
      active={active}
      readOnly={readOnly}
      onOpen={onPreview}
      onOpenTab={() => docs.onOpenNote(node.id, name)}
      onDoubleClick={readOnly ? undefined : () => setRenaming(true)}
      onDelete={() => docs.onDeleteNote(node.id, name)}
      renaming={
        renaming ? (
          <NoteRenameInline
            initial={name}
            onCommit={(next) => {
              setRenaming(false)
              if (next.trim() && next !== name) docs.onRenameNote(node.id, name, next.trim())
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : undefined
      }
    />
  )
}

/** tip 里就地改名的输入框（与侧栏的 NoteRenameRow 同一套交互） */
function NoteRenameInline({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit(value)}
      className="min-w-0 flex-1 rounded border border-seal/40 bg-card px-1.5 py-0.5 text-[11.5px] text-ink outline-none"
    />
  )
}

/** tip 里的一行（笔记 / 超级文档共用）：点开、右侧悬停出现删除 */
function TipRow({
  icon,
  label,
  hint,
  active,
  onOpen,
  onOpenTab,
  onDelete,
  onDoubleClick,
  renaming,
  icon2,
  readOnly,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  active: boolean
  onOpen: () => void
  onOpenTab?: () => void
  onDelete?: () => void
  onDoubleClick?: () => void
  /** 就地改名时整行换成输入框 */
  renaming?: React.ReactNode
  /** 该类型的一个小提示图标（超级文档用烧瓶，一眼区分） */
  icon2?: React.ReactNode
  readOnly?: boolean
}) {
  if (renaming && !readOnly) {
    return <div className="flex items-center gap-1.5 px-1.5 py-1">{renaming}</div>
  }
  return (
    <div
      role="button"
      tabIndex={0}
      title={hint}
      onClick={readOnly ? onOpenTab || onOpen : onOpen}
      onDoubleClick={readOnly ? undefined : onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (readOnly ? onOpenTab || onOpen : onOpen)()
      }}
      className={
        'group/row flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-left text-[11.5px] transition cursor-pointer ' +
        (active ? 'bg-line/60 text-ink-strong' : 'text-ink-soft hover:bg-line/40 hover:text-ink')
      }
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {icon2 && <span className="shrink-0 text-ink-faint">{icon2}</span>}
      {onOpenTab && (
        <button
          type="button"
          title={t('在页签栏打开《{0}》', label)}
          onClick={(e) => {
            e.stopPropagation()
            onOpenTab()
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-seal/10 hover:text-seal transition"
        >
          <ExternalLink size={11} />
        </button>
      )}
      {!readOnly && onDelete && (
        <button
          type="button"
          title={t('删除《{0}》', label)}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-seal/10 hover:text-seal group-hover/row:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
