/**
 * 这个文件负责：explorer 各模块共用的形状与判定——节点下文档的动作、考试那一侧的动作、
 * 学习状态那块 tip 要的东西、右键菜单作用在哪一行（MenuTarget / MenuState）、菜单自己的 props，
 * 以及「一份试卷还等着收尾吗」这条判定。行、菜单、外壳三个文件都要用它们；
 * 放在任何一边都会变成「组件文件导出非组件」，触到 oxlint 的 react/only-export-components，故单独一个文件。
 */
import type { Exam, ExamAttempt } from '../../../learn/exam'
import type { KnowledgeNode, LocalFile, SelfReport } from '../../../learn/types'
import type { NodeStructure } from '../../../learn/graph'
import type { TabRef } from '../../../learn/types'

/**
 * 节点下那些文档的动作。收成一个对象往下传，而不是一堆 props：
 * 从侧栏到每一行要穿三层（Section → NodeRow → 子 NodeRow），散着传迟早会漏一个。
 */
export interface NodeDocActions {
  /** 打开某个节点的学习文档（学习文档行的点击；与「切到这个节点」是同一件事） */
  onOpenTeach: (nodeId: string) => void
  /** 打开某个目标的大纲页（交互页，见 OutlineView；与教学文档是两份东西） */
  onOpenOutline: (nodeId: string) => void
  /** 让导师规划 / 重排某个目标的大纲（内置工作流「生成大纲」） */
  onReplanOutline: (nodeId: string) => void
  /** 新建一份笔记并当场打开（名字由 learn/notes 分配，默认「笔记」，撞名加序号） */
  onNewNote: (nodeId: string) => void
  /** 新增一份试卷：跑内置工作流「出卷」，导师会先问类型与难度 */
  onNewExam: (nodeId: string) => void
  /** 新建一份超级文档：跑内置工作流「超级实验室」 */
  onNewSuperDoc: (nodeId: string) => void
  onOpenNote: (nodeId: string, name: string) => void
  onRenameNote: (nodeId: string, from: string, to: string) => void
  onDeleteNote: (nodeId: string, name: string) => void
  onOpenSuperDoc: (nodeId: string, name: string) => void
  onDeleteSuperDoc: (nodeId: string, name: string) => void
  /** 打开某一次考试的只读副本（试卷 + 作答 + 判分 + 错题讲解） */
  onOpenAttempt: (nodeId: string, examId: string, attemptId: string) => void
  /**
   * 在系统文件管理器里定位：笔记给**那一份 .md**（它是独立文件）、大纲给**那份
   * .outline.json**（同样是真实文件），试卷与超级文档给**这个节点的文档文件**——
   * 那两样存在节点数据里，没有自己的文件。
   */
  onReveal: (nodeId: string, what: { kind: 'note' | 'node' | 'outline'; note?: string }) => void
  /**
   * 导出某一份文档（原先挂在文档区悬浮组那颗按钮上，那颗已删）。
   *
   * 收的是**页签身份**（TabRef）而不是 nodeId：导出的对象是「焦点格显示的那一份」
   * （弹窗与导出件都按它算，见 LearnWorkspace 的 exportMeta），因此上层会先把这一份
   * 开出来并激活，再打开导出弹窗。
   */
  onExport: (ref: TabRef) => void
}

/**
 * 考试那一侧的动作。
 *
 * 原先它们住在文档区右上角那块「试卷」tip 里，那颗按钮删掉之后搬到这里：
 * **开考是只有用户能做的动作**（导师没有开考试窗口的 api），不能跟着按钮一起消失。
 */
export interface ExamActions {
  /** 开考：开一个独立的考试窗口（正在考另一份时由上层提示） */
  onStart: (nodeId: string, examId: string) => void
  /** 手动重跑「判分 + 讲解」：导师中途断了、或当时没配 Key，都靠它补 */
  onGrade: (nodeId: string) => void
  /** 删除一份试卷（两档确认由上层弹） */
  onDelete: (exam: Exam) => void
  /** 正在考的那一份试卷 id：那一行只显示「回到考试」 */
  liveExamId: string | null
  /** 导师正在判分 / 讲解：那颗按钮显示进度并禁用 */
  grading: boolean
}

/** 学习状态那块 tip 要的东西（见 NodeStatePanel）：按 nodeId 现取，面板本身不持有 store */
export interface NodeStateActions {
  structure: (nodeId: string) => NodeStructure
  onSetSelf: (nodeId: string, self: SelfReport) => void
  onClearMistake: (nodeId: string, pattern: string) => void
  onRecall: (nodeId: string) => void
  onProbe: (nodeId: string) => void
  /** Agent 正在跑：那时候再发隐藏指令只会排队，按钮先禁掉 */
  busy: boolean
}

/**
 * 右键菜单作用在哪一行上。菜单只有**一个**（贴指针、夹到视口里），
 * 但行有九种——每一行给出那一类东西能做的事。
 *
 * 'teach' 是**学习文档行**、'outline' 是**大纲行**（大纲在学习文档之上，各自一行）：
 * 两个都跟节点强制绑定（见 NodeRow），菜单上没有「删除文档」——学习文档删了就是删节点本身，
 * 大纲则是节点的另一份本体文件。
 * 'folder' 是**文档目录行**（笔记 / 试卷 / 超级文档三合一的收纳层），菜单上给三种「新建」。
 */
export type MenuTarget =
  | { kind: 'node'; node: KnowledgeNode }
  | { kind: 'teach'; node: KnowledgeNode }
  | { kind: 'outline'; node: KnowledgeNode }
  | { kind: 'folder'; node: KnowledgeNode; folder: 'docs' }
  | { kind: 'note'; node: KnowledgeNode; name: string }
  | { kind: 'super'; node: KnowledgeNode; name: string }
  | { kind: 'exam'; node: KnowledgeNode; exam: Exam }
  | { kind: 'attempt'; node: KnowledgeNode; exam: Exam; attempt: ExamAttempt }
  | { kind: 'local'; file: LocalFile }
  /**
   * 工作区目录里的真实文件 / 子目录：rel 相对当前用户（docs/…/workspace/…，见 learn/workspace）。
   * dir 区分目录与文件（菜单上只有目录给「新建」）；root 只画在「工作区」根行——
   * 那一行不给改名（名字跟着节点标题走，磁盘上改了也会被下一次搬家改回来）。
   */
  | { kind: 'ws'; node: KnowledgeNode; rel: string; dir: boolean; root?: boolean }

/** 右键菜单的状态：位置是视口坐标，target 是它作用的那一行 */
export interface MenuState {
  x: number
  y: number
  target: MenuTarget
}

/** 一份试卷还等着收尾吗（待判分，或判完还缺讲解）——与 learn/exam 的 examNeedingWork 同一口径 */
/*
 * 它和上面那些类型一样被两个组件文件共用（RowMenu 决定显不显示「让导师判分」，
 * DocRow 的试卷行画那颗「待判分」角标），所以与类型住在一起。
 */
export function examNeedsWork(exam: Exam): boolean {
  return exam.attempts.some((a) => a.status === 'submitted' || (a.status === 'graded' && !a.explanation))
}

/**
 * 工作区那一簇动作（真实文件 / 目录的新建与改名，磁盘 IO 在宿主那一头，见 LearnWorkspace 的 wsActions）。
 * 树里只管画与转交：改的、建的都**真实地**落在节点目录的 workspace/ 上。
 */
export interface WsActions {
  /** 正在就地改名的那条路径（null = 没有在改名） */
  renaming: string | null
  /** 结束就地改名（取消或提交后都调它） */
  endRename: () => void
  /** 进入就地改名（菜单上的「重命名」） */
  startRename: (rel: string) => void
  /** 在某个目录下新建子目录 / 文件（真实落盘；建完自动进入就地改名） */
  create: (dirRel: string, kind: 'dir' | 'file') => void
  /** 真实改名（move，绝不覆盖已有目标；名字不合法 / 撞名由宿主用 toast 说清） */
  rename: (fromRel: string, toRel: string) => void
  /** 拖拽移动 / 复制到某个目录（Ctrl = 复制；撞名自动避开，目录进自己由宿主拒绝） */
  transfer: (fromRel: string, toDirRel: string, copy: boolean) => void
}

/** 行的右键菜单要的东西（见 RowMenu）：菜单当前的位置与目标行 + 它作用的那一类行能做的事 */
export interface RowMenuProps {
  menu: MenuState
  onClose: () => void
  onRevealNode: (nodeId: string) => void
  /** 定位工作区目录里的真实文件 / 子目录（docs/…/workspace/…，见 learn/workspace） */
  onRevealWs: (rel: string) => void
  /** 工作区的新建与改名（真实文件 / 目录） */
  ws: WsActions
  onDeleteNode: (nodeId: string) => void
  onRemoveLocal: (path: string) => void
  onRevealLocal: (path: string) => void
  onStartRename: (nodeId: string, name: string) => void
  docs: NodeDocActions
  exams: ExamActions
  state: NodeStateActions
}
