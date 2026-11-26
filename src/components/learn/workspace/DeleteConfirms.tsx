import ConfirmDialog from '../../ConfirmDialog'
import { examDeleteWarn } from './labels'
import { examAttempted, type Exam } from '../../../learn/exam'
import type { PendingNodeDelete } from './useCanvasChannel'
import { t } from '../../../i18n'

/** 四枚删除确认框需要的状态与动作（状态与提交动作住 useDeleteFlows） */
export interface DeleteConfirmsProps {
  pendingDelete: PendingNodeDelete | null
  commitRemoveNode: () => void
  onCancelRemoveNode: () => void
  pendingExamDelete: Exam | null
  examDeleteStage: 'warn' | 'final'
  commitRemoveExam: () => void
  onCancelExam: () => void
  pendingNoteDelete: { nodeId: string; name: string } | null
  commitRemoveNote: (nodeId: string, name: string) => void
  onCancelNote: () => void
  pendingSuperDelete: { nodeId: string; name: string } | null
  commitRemoveSuperDoc: (nodeId: string, name: string) => void
  onCancelSuper: () => void
}

/** 删除类确认框的集中渲染：删目标/节点、删试卷（两档）、删笔记、删超级文档 */
export function DeleteConfirms({
  pendingDelete,
  commitRemoveNode,
  onCancelRemoveNode,
  pendingExamDelete,
  examDeleteStage,
  commitRemoveExam,
  onCancelExam,
  pendingNoteDelete,
  commitRemoveNote,
  onCancelNote,
  pendingSuperDelete,
  commitRemoveSuperDoc,
  onCancelSuper,
}: DeleteConfirmsProps) {
  return (
    <>
      {pendingExamDelete && (
        <ConfirmDialog
          title={examDeleteStage === 'warn' ? t('这份试卷考过，删除会一并带走这些') : t('最后确认：删除这份试卷？')}
          message={
            examDeleteStage === 'warn'
              ? examDeleteWarn(pendingExamDelete)
              : examAttempted(pendingExamDelete)
                ? t('《{0}》与它的 {1} 次考试记录会被永久移除；删错了按 Ctrl+Z 可撤回。', pendingExamDelete.title, pendingExamDelete.attempts.length)
                : t('《{0}》还没考过，删掉只是把这份题目丢掉，可以随时让导师重出一份。', pendingExamDelete.title)
          }
          confirmLabel={examDeleteStage === 'warn' ? t('我了解，继续') : t('删除试卷')}
          onConfirm={commitRemoveExam}
          onCancel={onCancelExam}
        />
      )}

      {pendingNoteDelete && (
        <ConfirmDialog
          title={t('删除这份笔记？')}
          message={t(
            '「{0}」是一个独立文件（{节点}.notes/{1}.md），删除后文件本体也会一并移除；删错了按 Ctrl+Z 可撤回。',
            pendingNoteDelete.name,
            pendingNoteDelete.name,
          )}
          confirmLabel={t('删除笔记')}
          onConfirm={() => {
            const p = pendingNoteDelete
            onCancelNote()
            commitRemoveNote(p.nodeId, p.name)
          }}
          onCancel={onCancelNote}
        />
      )}

      {pendingSuperDelete && (
        <ConfirmDialog
          title={t('删除这份超级文档？')}
          message={t(
            '「{0}」是一份可交互的 HTML 文档，删除后无法恢复（Ctrl+Z 可撤回）。配着它使用的持久化函数（method）仍会保留，需要时可在对话里让超级导师重新生成。',
            pendingSuperDelete.name,
          )}
          confirmLabel={t('删除超级文档')}
          onConfirm={() => {
            const p = pendingSuperDelete
            onCancelSuper()
            commitRemoveSuperDoc(p.nodeId, p.name)
          }}
          onCancel={onCancelSuper}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === 'goal' ? t('删除整个学习目标？') : t('删除这个文档节点？')}
          message={
            pendingDelete.kind === 'goal'
              ? t('「{0}」是学习目标，删除后它及其下 {1} 个文档节点、所有对话与试卷都会一并移除。删错可按 Ctrl+Z 撤回。', pendingDelete.title, Math.max(0, pendingDelete.count))
              : t('只删除「{0}」本身：与它相连的线一并解开，它的下级文档会留在画布上（成为没有上游的游离卡），挂在该文档上的笔记与超级文档解除绑定、仍留在画布上。删错可按 Ctrl+Z 撤回。', pendingDelete.title)
          }
          confirmLabel={pendingDelete.kind === 'goal' ? t('删除目标') : t('删除')}
          onConfirm={commitRemoveNode}
          onCancel={onCancelRemoveNode}
        />
      )}
    </>
  )
}
