/**
 * 这个文件负责：节点底下那些**文档行**——大纲与学习文档（各自一行）、
 * 笔记 / 试卷 / 试卷副本 / 超级文档共用的一行（DocRow）、笔记的就地改名行（NoteRenameRow），
 * 以及「一份试卷 + 它历次考试」那一段（ExamList）。
 */
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Exam } from '../../../learn/exam'
import { GraduationCap } from 'lucide-react'
import { attemptBrief, examTotalPoints } from '../../../learn/exam'
import type { KnowledgeNode, TabRef } from '../../../learn/types'
import { DocTypeIcon } from '../docTypes'
import { examNeedsWork, type ExamActions, type MenuTarget, type NodeDocActions } from './types'
import { Collapse } from './sections'
import { chipJson, type ChipPayload } from '../../../lib/chipSyntax'
import { t } from '../../../i18n'

/**
 * 侧栏里的一行**文档**：笔记 / 试卷 / 超级文档 / 某一次考试共用。
 *
 * 与节点行刻意长得不一样：节点是**知识结构**（粗体、点了会切当前节点、标题前一颗状态点），
 * 文档是挂在它下面的东西（小一档、点一下开一个页签）。一眼分得清两类，
 * 才不会把「打开一份笔记」误当成「切到这个知识点」。
 */
export function DocRow({
  kind,
  icon,
  label,
  hint,
  badge,
  action,
  active = false,
  onClick,
  onMenu,
  expandable = false,
  open = false,
  nested = false,
  dragChip,
  onDragExtra,
}: {
  /** 文档类型：决定图标与颜色（见 docTypes） */
  kind?: 'teach' | 'outline' | 'note' | 'super' | 'exam' | 'local'
  /** 自己给图标时用它（考试历史那一行是一颗状态点，不是类型图标） */
  icon?: ReactNode
  label: string
  hint: string
  /** 行尾的一小块状态字（「待判分」「正在考」…） */
  badge?: ReactNode
  /**
   * 行尾的一颗动作按钮（试卷行的「考试」）。
   *
   * 传进来的按钮**必须自己 stopPropagation**：整行是一次点击（开文档 / 展开），
   * 点动作键不该把它也带上。
   */
  action?: ReactNode
  /**
   * 这一行就是焦点格里显示的那份文档。与节点行的选中同一套样式（一抹底色 + 加重文字）：
   * 「我现在开的是哪一份」在树里和页签上要说同一句话。
   */
  active?: boolean
  onClick: () => void
  onMenu?: (x: number, y: number) => void
  /** 还有下一层（试卷的历次考试）：右端给一根小箭头 */
  expandable?: boolean
  open?: boolean
  /** 第三层（某一次考试）：再往里缩一档 */
  nested?: boolean
  /**
   * 这一行能拖出的那份引用（见 lib/chipSyntax 的 ChipPayload）：拖到页签栏开成页签、
   * 拖到对话输入框变成一枚引用。不给就是这一行不参与拖拽（比如就地改名行）。
   */
  dragChip?: () => ChipPayload | null
  /** 拖动开始时的附加数据（工作区行用它再塞一份「移动 / 复制」的 MIME，见 learn/workspace） */
  onDragExtra?: (e: React.DragEvent<HTMLDivElement>) => void
}) {
  return (
    /*
     * 根元素是 div[role=button] 而不是 button：行尾那颗动作按钮（试卷行的「考试」）
     * 自己也是 button，塞进 button 里是非法嵌套（浏览器会把它提到外面，React 也会警告）。
     * 键盘可达性靠 tabIndex + Enter，与节点行同一套做法。
     */
    <div
      role="button"
      tabIndex={0}
      title={hint}
      draggable={!!dragChip}
      onDragStart={(e) => {
        const p = dragChip?.()
        if (!p) return
        e.dataTransfer.setData('application/x-moji-chip', chipJson(p))
        e.dataTransfer.effectAllowed = 'copyMove'
        onDragExtra?.(e)
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault()
              onMenu(e.clientX, e.clientY)
            }
          : undefined
      }
      className={
        'group flex w-full items-center gap-1.5 py-1 pr-1.5 text-left text-[12px] transition ' +
        (active
          ? 'bg-line/60 text-ink-strong '
          : 'text-ink-soft hover:bg-line/40 hover:text-ink ') +
        (nested ? 'pl-5' : 'pl-1.5')
      }
    >
      {icon ?? (kind ? <DocTypeIcon kind={kind} size={12} /> : null)}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge}
      {action}
      {expandable && (
        <span className="shrink-0 text-ink-faint">
          {/* 单箭头旋转（与 Collapse 的高度动画同拍），不再两颗图标硬切换 */}
          <ChevronRight
            size={12}
            className={
              'transition-transform duration-200 ease-out motion-reduce:transition-none ' +
              (open ? 'rotate-90' : '')
            }
          />
        </span>
      )}
    </div>
  )
}

/**
 * 就地改名的那一行（笔记）。
 *
 * 名字就是磁盘上的文件名，所以改名要当场看见、当场改——弹一个对话框问，
 * 反而看不到原先叫什么。回车提交、Esc 取消、失焦也算提交（鼠标点到别处去了，
 * 那一刻心里的动作就是「改完了」）。
 */
export function NoteRenameRow({
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
  // 挂上就聚焦并全选：改名多半是整名重写，不是往里插一个字
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <div className="flex items-center gap-1.5 py-1 pl-1.5 pr-1.5">
      <DocTypeIcon kind="note" size={12} />
      <input
        ref={ref}
        value={value}
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
        className="min-w-0 flex-1 rounded border border-seal/40 bg-card px-1.5 py-0.5 text-[12px] text-ink outline-none"
      />
    </div>
  )
}

/**
 * 一份试卷的行，以及它下面展开着的历次考试（第三层）。
 *
 * 展开状态（openExam）留在 NodeRow 那一层——**一次只开一份**，箭头点谁谁开，
 * 这里只负责把那一份试卷与它的历次考试画出来。
 */
export function ExamList({
  nodeExams,
  node,
  docs,
  exams,
  activeTab,
  openExam,
  setOpenExam,
  onOpenMenu,
}: {
  nodeExams: Exam[]
  node: KnowledgeNode
  docs: NodeDocActions
  exams: ExamActions
  /** 焦点格的页签：某一次考试的副本开着时，树里那一行也要亮（与节点行同一句话） */
  activeTab: TabRef | null
  openExam: string | null
  setOpenExam: Dispatch<SetStateAction<string | null>>
  onOpenMenu: (x: number, y: number, target: MenuTarget) => void
}) {
  return (
    <>
      {nodeExams.map((exam) => {
        const openThis = openExam === exam.id
        const attempts = [...exam.attempts].reverse()
        const live = exams.liveExamId === exam.id
        return (
          <div key={exam.id}>
            <DocRow
              kind="exam"
              label={exam.title}
              hint={
                exam.attempts.length
                  ? t('展开《{0}》的历次考试（{1} 次）；右键开考 / 判分 / 删除', exam.title, exam.attempts.length)
                  : t('《{0}》还没考过——右键「考试」开始第一次', exam.title)
              }
              badge={
                live ? (
                  <span className="shrink-0 rounded bg-seal/15 px-1 py-px text-[10px] text-seal-deep">
                    {t('正在考')}
                  </span>
                ) : examNeedsWork(exam) ? (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[10px] text-amber-700">
                    {t('待判分')}
                  </span>
                ) : null
              }
              /*
               * 行尾那颗「考试」：从前只能右键开考，而右键菜单是「这一行能做什么」的抽屉，
               * 开考是这一行**最常做**的事，值得直接摆在面上（用户要求）。
               * 正在考的那一份与判分中的不给点——点了也是白点。
               */
              action={
                <button
                  type="button"
                  title={live ? t('这一份正在考') : t('开始考试')}
                  disabled={live || exams.grading}
                  onClick={(e) => {
                    e.stopPropagation()
                    exams.onStart(node.id, exam.id)
                  }}
                  /* 与节点行那颗一样：鼠标经过这一行才现身（用 opacity 占着位，显隐不跳字） */
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-seal/10 hover:text-seal focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
                >
                  <GraduationCap size={12} />
                </button>
              }
              expandable
              open={openThis}
              // 拖出去 = 试卷原件的引用：拖进输入框是「跟导师谈这份卷子」（点击弹考试窗口），
              // 拖到页签栏没人接（原件没有页签形态，见 chipRef）
              dragChip={() => ({ type: 'exam', nodeId: node.id, examId: exam.id, title: exam.title })}
              // 点一下只展开历次考试：侧栏里没有「打开一份试卷」这回事，
              // 真正能打开的是某一次考试的副本（下一层那几条）
              onClick={() => setOpenExam((cur) => (cur === exam.id ? null : exam.id))}
              onMenu={(x, y) => onOpenMenu(x, y, { kind: 'exam', node, exam })}
            />
            {/* 历次考试走 Collapse：展开收起有高度动画（与目录、节点同一拍） */}
            <Collapse open={openThis}>
              <div className="ml-3 border-l border-line pl-1.5">
                {attempts.length === 0 && (
                  <p className="py-1 pl-1.5 pr-2 text-[11px] leading-relaxed text-ink-faint">
                    {t('还没考过。右键这一行选「考试」开始第一次。')}
                  </p>
                )}
                {attempts.map((attempt) => {
                  const brief = attemptBrief(exam, attempt)
                  const when = new Date(attempt.startedAt)
                  const stamp =
                    when.getMonth() + 1 + '/' + when.getDate() +
                    ' ' + String(when.getHours()).padStart(2, '0') +
                    ':' + String(when.getMinutes()).padStart(2, '0')
                  const score =
                    brief.score === null
                      ? t('未判分')
                      : t('{0}/{1} 分', brief.score, examTotalPoints(exam))
                  return (
                    <DocRow
                      key={attempt.id}
                      // 有讲解的给一颗印章色的点：用户要的「错题解析」就是它
                      icon={
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          <span
                            className={
                              'h-[6px] w-[6px] rounded-full ' +
                              (brief.hasExplanation ? 'bg-seal' : 'bg-line-strong')
                            }
                          />
                        </span>
                      }
                      label={stamp + ' · ' + score}
                      hint={
                        t('打开这一次的试卷副本：作答、判分与错题讲解') +
                        (brief.hasExplanation ? t('（导师已经写了讲解）') : t('（还没有讲解）'))
                      }
                      nested
                      active={
                        activeTab?.kind === 'exam' &&
                        activeTab.examId === exam.id &&
                        activeTab.attemptId === attempt.id
                      }
                      // 拖出去 = 这一次考试的副本：页签栏上开成 e: 页签，输入框里是一枚引用
                      dragChip={() => ({
                        type: 'attempt',
                        nodeId: node.id,
                        examId: exam.id,
                        attemptId: attempt.id,
                        title: exam.title + ' · ' + stamp,
                      })}
                      onClick={() => docs.onOpenAttempt(node.id, exam.id, attempt.id)}
                      onMenu={(x, y) =>
                        onOpenMenu(x, y, { kind: 'attempt', node, exam, attempt })
                      }
                    />
                  )
                })}
              </div>
            </Collapse>
          </div>
        )
      })}
    </>
  )
}
