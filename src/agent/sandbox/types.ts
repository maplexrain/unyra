/**
 * 这个文件负责什么：沙箱对外的全部**类型契约**——宿主能力（SandboxOptions）、
 * 各分组 ops 接口、请求/回复与 execute 工具的形状。这里没有实现（只有一张阶段表 EXAM_ACTIONS），
 * 实现见同目录的 api / body / askForm / worker / execute。
 */
import type { AgentTool, AgentToolResult, MessageImage } from '../types'
import type { TmpEntry } from '../../learn/types'
import type { ProfileField } from '../../user/fields'
/* SandboxDocKind 定义在 ./refs（DocRef 要用它），这里既要它进本文件的作用域、又要对外转出：
   import type 管前者，export type ... from 管后者——少写前者，下面那些引用会全变成「找不到名字」。 */
import type { ResolvedDocRef, ResolvedNodeRef, SandboxDocKind } from './refs'
export type { SandboxDocKind } from './refs'

export interface SandboxCall {
  name: string
  ok: boolean
  /**
   * 失败时那句话（「哪一步没做、该怎么改」）。
   *
   * 为什么要把这句话也记下来：只告诉模型「有 N 次调用失败」，它得自己回到 result 里
   * 去找是哪一项、错在哪——一次真实运行里它因此写了个 try/catch 去判断成败
   * （写操作的失败根本不抛异常），又追加一次读接口去确认有没有建成，白烧了两轮。
   * 把名字与那句话一起顶到结果最前面，它一眼就能改。
   */
  message?: string
}

/** 出题请求：字段一律 unknown，校验交给 learn/exam 的 normalize* */
export interface CreateExamPayload {
  title?: unknown
  kind?: unknown
  level?: unknown
  /**
   * 时限（分钟）。随堂小测不用给（不限时）；其余必给，且不得低于题目数 × 2——
   * 下限由 learn/exam 的 resolveExamMinutes 强制，不是提示词里的君子协定。
   */
  minutes?: unknown
  questions: unknown
}

/** 考试工具依赖：由学习工作区注入，沙箱本身不直接碰 store 结构 */
export interface ExamToolDeps {
  stage: () => 'idle' | 'grading'
  createExam: (payload: CreateExamPayload) => { ok: boolean; message: string }
  /** 读卷；给 attemptId 就读那一次考试（判分与讲解时要看某一次的历史记录） */
  readExam: (attemptId?: string) => string
  gradeExam: (payload: unknown) => { ok: boolean; message: string }
  /** 写错题讲解：判分之后的第二步，落在同一次考试上（显示在试卷副本页签里） */
  explainExam: (payload: unknown) => { ok: boolean; message: string }
  /** 删一份试卷；只认「一次都没考过」的，考过的要用户在界面上删，见 learn/exam 的 examDeleteBlock */
  deleteExam: (examId?: string) => { ok: boolean; message: string }
}

export type ExamAction = 'create' | 'grade' | 'explain' | 'delete'

/**
 * 阶段只约束**写**（出题 / 判分 / 作废）：有卷待阅时不能再出卷，反之亦然，
 * 模型因此不会在作答途中又出一份新卷，也不会重复阅卷。
 *
 * **读（exam.read）不在这张表里**，任何时候都开放。它原先只在「待阅卷」时可用，
 * 于是刚出完题想核对一下题目、或看看有没有卷子，得到的都是一句「当前没有待阅卷的试卷」
 * ——而这句「没有」还被算成一次调用失败。一次真实运行里模型因此连烧两轮才确认卷子建没建成
 * （见 failureHeader 与 learn/useAgent 里 read 那一段的注释）。
 */
export const EXAM_ACTIONS: Record<'idle' | 'grading', ExamAction[]> = {
  idle: ['create', 'delete'],
  // 判分与讲解是一套工作流的两步，必须同一阶段都放行；第二步在第一次调用之后仍是 grading
  grading: ['grade', 'explain'],
}



/**
 * 沙箱要用的全部宿主能力。
 *
 * 关键变化：**一切按 path 寻址**。会话上下文改成目标级之后，一次编排里 Agent 会同时
 * 碰好几个节点（给上一个节点写文档、给这一个改描述、再建一个新节点），全部隐式作用于
 * 「当前节点」的旧接口根本表达不了「改那一个」。path 的语法与解析见 learn/paths。
 */
export interface SandboxOptions {
  /** 会话此刻在看哪个节点；path 省略（或写「当前」）时的落点 */
  nodeId: () => string | null
  /** path → 节点；解析失败时 message 直接作为结果回给模型 */
  resolveNode: (path: string) => ResolvedNodeRef
  /** path → 节点 + 文档 */
  resolveDoc: (path: string) => ResolvedDocRef
  /** 文档读写（按已解析出的 id、文档类型与笔记名操作；note 只对 'note' 有意义） */
  docOps: {
    read: (nodeId: string, kind: SandboxDocKind, note?: string) => string
    write: (nodeId: string, kind: SandboxDocKind, note: string | undefined, content: string) => AgentToolResult
    replace: (
      nodeId: string,
      kind: SandboxDocKind,
      note: string | undefined,
      range: { start?: number; end?: number; content: string; expected?: string },
    ) => AgentToolResult
    append: (nodeId: string, kind: SandboxDocKind, note: string | undefined, content: string) => AgentToolResult
    /**
     * 写一条注解（正文旁边的虚线词条）。注解挂在**节点**上，kind / note 只用于报错措辞，
     * 因此这里只收 nodeId 与词条本身。见 agentOps 的实现说明。
     */
    annotate: (nodeId: string, input: { term: string; occurrence?: number; body: string }) => AgentToolResult
  }
  /** 节点管理：列、看、建、改名、改属性、删、移 */
  nodeOps: {
    list: () => unknown
    read: (nodeId: string) => unknown
    create: (parentId: string, input: { title: string; description?: string }) => AgentToolResult
    update: (
      nodeId: string,
      patch: { title?: string; description?: string; status?: 'learning' | 'mastered' },
    ) => AgentToolResult
    remove: (nodeId: string) => AgentToolResult
    /** 迁移节点到另一个节点之下（改父线；根/跨目标/成环会被拒，见 graph/nodes 的 moveNode） */
    move: (nodeId: string, newParentId: string) => AgentToolResult
  }
  /** 临时变量：拿最新的一份，写入时回调给 store 落盘。作用域是当前节点；不注入就没有 tmp 这一组 */
  tmp?: () => {
    nodeId?: string
    entries: Record<string, TmpEntry>
    onChange: (next: Record<string, TmpEntry>) => void
  }
  /**
   * 资源库（本目标 `static/` 下的文件，见 learn/static）；不注入就没有 res 这一组。
   *
   * 与 doc / node 两组的关键差别：它要碰磁盘（读文本、读图、删文件），所以方法是异步的；
   * 而且「读图片」有个硬约定——**绝不把 base64 放进返回值**。返回值走的是文本通道
   * （先 safeJson、再被裁到 3 万字符，见 AgentToolResult.images 的说明），
   * 一张图的 base64 进去只会剩一段乱码。图片挂在返回值的 images 上，
   * 由工具收集、由运行时作为图片片段送上下一跳。
   */
  resources?: ResourceOps
  /**
   * 学习状态（自评 / 掌握度 / 错误记忆 / 检验记录，见 learn/learning）；
   * 未注入时沙箱里没有 state 这一组。
   */
  state?: LearningOps
  /** 出题 / 读卷 / 判分 / 写错题讲解 / 删卷；未注入时沙箱里没有 exam 这一组 */
  exam?: {
    create: (payload: Record<string, unknown>) => AgentToolResult
    /** 读卷：给了 attemptId 就读那一次考试（判分与讲解都要看某一次的历史记录） */
    read: (attemptId?: string) => AgentToolResult
    grade: (payload: Record<string, unknown>) => AgentToolResult
    explain: (payload: Record<string, unknown>) => AgentToolResult
    remove: (payload: Record<string, unknown>) => AgentToolResult
  }
  /**
   * 长期记忆（mind.*，见 learn/mind）；未注入时沙箱里没有 mind 这一组。
   * 记忆**不会**被拼进系统提示词——agent 需要时必须主动 read，这是这条边界的一半；
   * 另一半（写入克制）写在提示词里。
   */
  mind?: MindOps
  /**
   * 目标级持久化函数（method.*，见 learn/methods）；未注入就没有 method 这一组。
   *
   * find 返回的是**源码**而不是执行结果：执行发生在 buildApi 的 method.call 里——
   * 那里才能拿到「当前这次编排的 api」注入给函数（函数体里 await api.doc.read(...)
   * 用的就是它）。测试探针与超级文档的桥各自拿到的 api 不同，但执行语义一致。
   */
  methods?: MethodOps
  /** 超级文档（sdoc.*，可交互 HTML，绑定节点，见 learn/superdocs）；未注入就没有 sdoc 这一组 */
  superdocs?: SuperDocOps
  /**
   * 目标大纲（outline.*，见 learn/outline）：每个节点一份的结构化计划。
   * read 回 OutlineDoc 或 null（还没写过）；write 整份覆盖。未注入就没有 outline 这一组。
   */
  outline?: OutlineOps
  /** 工作流登记表（wf.*，见 learn/workflows）；未注入就没有 wf 这一组 */
  workflows?: WorkflowOps
  /** 代码块伪编译的交付口（见 lib/codeArtifacts）；未注入就没有 code 这一组 */
  code?: CodeOps
  /**
   * 学习者画像（userInfo.*，见 user/fields 与 learn/agentOps）；未注入就没有这一组。
   *
   * 与 mind 同一条边界：**画像不会被拼进系统提示词**——导师需要时自己 get。
   * 头像不走这条路（它是几百 KB 的 data URL，进上下文就是灾难）。
   */
  reading?: ReadingOps
  /** 注意力评级（attention.get，见 learn/attention）；未注入就没有它 */
  attention?: AttentionOps
  /** 打卡（checkin.*，见 learn/checkin）；未注入就没有这一组 */
  checkin?: CheckinOps
  /** 间隔复习（review.*，见 learn/review）；未注入就没有这一组 */
  review?: ReviewOps
  /** 工作区目录（workspace.*，见 learn/workspace）；未注入就没有这一组 */
  workspace?: WorkspaceOps
  /** 番茄钟（pomodoro.*，见 learn/pomodoro）；未注入就没有这一组 */
  pomodoro?: PomodoroOps
  /** 读网页（web.*，见 learn/webDocs）；未注入就没有这一组 */
  web?: WebOps
  /** 上下文压缩（compact，见 learn/compact）；未注入就没有它 */
  compact?: CompactOps
  userInfo?: UserInfoOps
  /** 阻塞等待（wait，毫秒）；未注入就没有 wait */
  wait?: (ms: number) => Promise<void>
  /** 结构化表单询问（ask）：显示表单并阻塞到用户提交/取消；未注入就没有 ask */
  ask?: (form: AskFormPayload) => Promise<unknown>
  /** 任务预告（iwanna）：把接下来的计划以可视化清单显示给用户（只预告，不可勾选） */
  iwanna?: (items: string[]) => void
  /** 提示音（tiktok）：响一声系统提示音，提醒用户来看 */
  tiktok?: () => Promise<void> | void
  /**
   * 界面操作（ui.*）：交换主栏、吐司、定位文档、滚动、截图、DOM 交互。
   * 这些 api 都要「界面在场」——文档区没有打开的文档时，部分调用会明确失败。
   */
  ui?: UiOps
  /**
   * 内置浏览器（browser.*，见 learn/web/browserOps）：界面上开着的网页页签的
   * 打开、管理、页面读取与操作、截图。依赖界面注入（webview 元素在渲染层），
   * 未注入就没有这一组。
   */
  browser?: BrowserOps
  /** 一次编排的中止信号：用户点「停止」时，正在等用户的 ask 等调用要能立刻退出 */
  signal?: AbortSignal
  timeoutMs?: number
  /** 测试可注入一个假的沙箱执行器，从而不依赖浏览器 Worker */
  runSandbox?: (req: SandboxRequest) => Promise<SandboxReply>
  /**
   * api 组白名单（子代理专用）：给出时，名单外的组在 callApi 通道口被当场拒绝——
   * 「execute 的 api 按需开放」的硬闸（不是提示词君子协定）。不设就是全量（导师）。
   */
  apiAllow?: string[]
  /**
   * execute 参数说明里的 api 清单（子代理专用）：给了就替换默认的那份全量说明，
   * 让子代理只看到它真有的 api（清单从 apiCatalog 按组生成，见 subagent/groups）。
   */
  apiBrief?: string
  /**
   * subagent 组（create / run / resume / intervene / interrupt / view / delete / wait）：
   * **导师专用**的子代理管理通道（实现见 subagent/manager）。SUBAGENT_ALLOWED_GROUPS
   * 不含这一组——子代理的 apiAllow 白名单永远放不进它，不递归在通道口就被挡死。
   */
  subagent?: SubAgentSandboxApi
}

/** subagent.wait 的一条交付：交付正文（中断 / 出错为 null）与为什么 */
export interface SubWaitDelivery {
  agent: string
  name: string
  delivery: string | null
  status: 'complete' | 'incomplete' | 'interrupted' | 'error'
  issue?: string
}

/** subagent.wait 回执里「仍在跑」的一行 */
export interface SubWaitRunning {
  agent: string
  name: string
}

/** subagent.wait 的回执：error 存在即参数不对；timedOut / aborted 见字段说明 */
export interface SubWaitResult {
  error?: string
  deliveries: SubWaitDelivery[]
  running: SubWaitRunning[]
  /** 到了最大时长还没人交付（导师该去 view 了） */
  timedOut?: boolean
  /** 等待期间用户停止了一轮，所有在跑的被级联中断 */
  aborted?: boolean
  note?: string
}

/** create / run 等的回执：error 存在即失败，其余字段按方法各有 */
export interface SubAgentApiResult {
  ok?: boolean
  error?: string
  note?: string
  agent?: string
  key?: string
  name?: string
  status?: string
  runs?: number
  recent?: Array<{ role: string; text: string; tools?: string[] }>
  [key: string]: unknown
}

/** subagent 组的宿主实现（导师专用；形状只在这里声明，行为在 subagent/manager） */
export interface SubAgentSandboxApi {
  /** 登记定义（不启动）：{ key, name?, system, tools? } */
  create(def: Record<string, unknown>): SubAgentApiResult
  /** 派任务并启动（后台跑，立即返回）：{ agent, task } */
  run(args: Record<string, unknown>): SubAgentApiResult
  /** 把被中断的 agent 从断点接着跑 */
  resume(agent: string): SubAgentApiResult
  /** 给运行中的 agent 插一条指令（消息完整后才插入） */
  intervene(agent: string, instruction: string): SubAgentApiResult
  /** 中断运行中的 agent（上下文保留，可 resume） */
  interrupt(agent: string): SubAgentApiResult
  /** 看状态与最近过程（监督回路的「查看」） */
  view(agent: string): SubAgentApiResult
  /** 删定义与会话（含挂起的交付；在跑的先中断） */
  remove(agent: string): SubAgentApiResult
  /** 等交付：首个完成即返回（带仍在跑清单），到 seconds 没人交付返回 timedOut */
  wait(args: Record<string, unknown>): Promise<SubWaitResult>
}

/* ---------- ask：结构化表单 ---------- */

/** 一道题的选项：模型可以直接给字符串（自动配 id），也可以给 { id, label } */
export interface AskOption {
  id: string
  label: string
}

/** 表单里的一道题（normalizeAskForm 归一化之后的形状） */
export interface AskQuestion {
  /** 题目 id；模型没给时按 q1、q2… 自动配 */
  id: string
  /** single 单选 / multiple 多选 / short 简答 */
  type: 'single' | 'multiple' | 'short'
  prompt: string
  /** single / multiple 必给（2~8 项）；short 恒为空数组 */
  options: AskOption[]
  /**
   * 条件显示：只有当前面某道题的答案命中 oneOf 之一时，这道题才出现——
   * 「前面选了什么，会影响后面问什么」就靠它。oneOf 与选项 id、选项文字
   * 以及「其他」补充输入的原文做精确匹配。
   */
  when?: { id: string; oneOf: string[] } | null
  /**
   * 这道题的答案要写进画像的哪个字段（见 user/fields 的 ProfileField，如 'education'）。
   *
   * 标了它，用户**提交的那一刻**回答就直接落进画像（user/fields 的 patchFromAnswers），
   * 导师不必再 update 一次——「画像缺什么就问什么」的省事写法，也是画像唯一的
   * 结构化补全通道。没标就是普通问题，只是聊聊天。
   */
  userInfo?: ProfileField
  /**
   * **没有必答题**（曾经的 required 字段已移除）：用户懒得答的题就该留空——
   * 留空在返回的 answers 里只有 id/type/prompt，不是错误，模型不要追问。
   */
}

/** 一次 ask 的载荷：questions 已由 normalizeAskForm 归一化并校验过 */
export interface AskFormPayload {
  title: string
  questions: AskQuestion[]
}

/** 用户对一道题的回答 */
export interface AskAnswer {
  id: string
  type: 'single' | 'multiple' | 'short'
  prompt: string
  /** single / multiple：选中项的文字 */
  picked?: string[]
  /** single / multiple：选中项的 id */
  pickedIds?: string[]
  /** 选了「其他」时用户输入的补充 */
  other?: string
  /** short：用户输入的正文 */
  text?: string
}

/** 表单提交后的回答集（ask 的返回值里 answers 的形状） */
export type AskAnswers = AskAnswer[]

/* ---------- mind：长期记忆 ---------- */

/**
 * 记忆那一组（沙箱里的 mind.*）的宿主实现（见 learn/mind）。
 *
 * 与 tmp 的分界：tmp 是一次编排里的大中间结果（按节点、会过期、不进上下文）；
 * mind 是**跨对话长期有效**的判断与偏好（按目标、不过期、也不自动进上下文——
 * 系统提示词不拼它，agent 需要时必须主动 read，这是需求明确的边界）。
 * 返回普通对象，失败用 { error }（与 res.* 同一约定）。
 */
/* ---------- reading / attention / checkin / pomodoro：学习过程的那一组 ---------- */

/**
 * reading.*：文档有效阅读的事实（见 learn/reading）。
 *
 * 三件事分开给：get 是「这个节点读到哪了」（节点级事实），
 * list 是「整个目标里哪个节点还没读」，day 是「今天/某一天读了什么」——
 * 出题、排计划、答「他学得怎么样」各取所需。**这里没有「打分」**：
 * 注意力是派生判断，单独走 attention.get（见 learn/attention 的文件头）。
 */
export interface ReadingOps {
  /** 某个节点（缺省=当前节点）的阅读事实：有效时长、各节覆盖、最近会话 */
  get: (path?: string) => unknown
  /** 当前目标里每个读过或有记录的节点一行（未读节、最后阅读时间、时长） */
  list: () => unknown
  /** 某个学习日（缺省=今天）读了什么：时长、节点、节 */
  day: (day?: string) => unknown
}

/** attention.get：把阅读事实折成档位 + 事实句 + 建议（纯派生，不落盘） */
export interface AttentionOps {
  /** 当前节点（或给了 path 的节点）的注意力评级；缺省看整体 */
  get: (path?: string) => unknown
}

/**
 * checkin.*：打卡（见 learn/checkin）。
 *
 * **没有「直接打卡成功」这个口子**：status 告诉 agent 今天能不能打卡、考什么、门槛多少；
 * 考完由 agent 自己判分，再 settle 说结果。settle 里我们会复核门槛与次数——
 * agent 说「过了」但没到门槛时不算过。出题本身走 ask（见工作流「打卡」）。
 */
export interface CheckinOps {
  /** 今天能不能打卡：有效阅读、出题源（今天读到的节）、还剩几次机会、建议题数与门槛 */
  status: () => unknown
  /** 记一次结果（correct/total/threshold/passed/note）：通过则打卡完成 */
  settle: (input: Record<string, unknown>) => unknown
}

/**
 * review.*：间隔复习（见 learn/review）。
 *
 * **计划是系统建的**（节点首次变「已掌握」时）：agent 只读它、按阶段带用户复习、落账。
 * 完成不复核对错——record 里 complete 由你判「交互做完了吗」，答错只进错误记忆不惩罚。
 * 合并复习必须先经 ask 征得用户同意再调 merge（强相关才提议）。
 */
export interface ReviewOps {
  /** 当前节点（或 path）的复习计划：到期阶段、下次到期、合并组成员、可合并候选、历次记录 */
  read: (path?: string) => unknown
  /** 落一次复习的账：完成阶段 / 补充任务（extraId）、记错法（mistakes）、标修复（fixed）、修掌握度 */
  record: (input: Record<string, unknown>) => unknown
  /** 合并复习组（nodeIds 含当前节点）：各节点需处于同一阶段；合并后整组一起复习、各自落账 */
  merge: (input: Record<string, unknown>) => unknown
  /** 针对薄弱点追加一条补充复习（focus + days，缺省 3 天后到期） */
  extend: (input: Record<string, unknown>) => unknown
  /** 调整计划：action 'postpone'（顺延到期日）/ 'split'（退出合并组） */
  adjust: (input: Record<string, unknown>) => unknown
}

/**
 * workspace.*：节点的工作区目录（见 learn/workspace）。
 *
 * 「工作区」是磁盘上**真实存在**的系统目录（users/<uid>/docs/<目标>/<节点>/workspace/）：
 * 用户在系统资源管理器里看得见、自己也能放文件；路径写法与文档 api 同构——
 * 节点路径在前、文件在后（极限/数据/实验.csv），省略 path 就是当前节点。只收文本。
 */
export interface WorkspaceOps {
  /** 列目录（path 省略 = 当前节点的工作区）；目录还不存在时回空清单 */
  list: (path?: string) => unknown
  /** 读一个文本文件；太长的截断并带 totalChars */
  read: (path?: string) => unknown
  /** 写一个文本文件（整份覆盖；父目录自动建），输入 { path, content } */
  write: (input: Record<string, unknown>) => unknown
}

/**
 * pomodoro.*：番茄钟（见 learn/pomodoro）。
 *
 * **只有 status，而且是只读**：番茄钟是用户自己的计时器——一段多长、做几组、
 * 什么时候停，全在他按的那颗按钮上。agent 连「排计划」都没有了，能看的只有记录。
 */
export interface PomodoroOps {
  /** 现状与记录：正在跑的哪一段、今天几组多少分钟、最近几天、最近几条 */
  status: () => unknown
}

/**
 * web.*：把网页读成正文（见 learn/webDocs）；search 多引擎搜索（见 learn/webSearch）。
 *
 * 三个 api 的分工：webFetch 抓一页（正文短就直接给，长了落盘并只回大纲树），
 * read 按 uuid + 小节路径读落盘的那一份，search 是多引擎搜索（抓取复用同一条主进程通道）。
 *
 * 实现由界面层注入（抓取要网络、落盘要 storage，都不该进这个文件）；
 * Node 探针里给一份假的就能把 api 面钉住。
 */
export interface WebOps {
  /** 抓一页：url → { ok, uuid, title, chars, text? , outline? } */
  fetch: (url: string) => Promise<unknown>
  /** 读落盘网页的某一节；path 形如 '一级标题/二级标题'，省略则从头给一段（附大纲） */
  read: (uuid: string, path?: string) => Promise<unknown>
  /**
   * 多引擎搜索：query → { ok, engine, results: [{ rank, title, url, snippet }] }。
   * 引擎与语言在 opts 里（engine / lang / count）。不注入就没有 web.search
   * （子代理的内置「网络检索」靠它干活；抓取与解析见 learn/webSearch 与 lib/web/serp）。
   */
  search?: (query: string, opts?: Record<string, unknown>) => Promise<unknown>
}

export interface MindOps {
  /** 清单：id、key、摘要、更新时间 */
  list: () => unknown
  /** 按 id 或 key 读一条的完整正文 */
  read: (idOrKey: string) => unknown
  /** 写入 / 覆盖（给了 key 且已存在同 key 条目时覆盖）；输入是 { key?, text } 或裸字符串 */
  write: (input: unknown) => unknown
  /** 删除一条；成功回 { ok: true, deleted }，没有就 { error } */
  delete: (idOrKey: string) => unknown
  /** 清空当前目标的全部记忆 */
  clear: () => unknown
}

/**
 * compact：把这段对话压成一份**交接摘要**（见 learn/compact）。
 *
 * 摘要**不立刻生效**：先写进会话，等本轮 loop 结束后由宿主把旧消息标成失活
 * （把上下文从正在跑的循环底下抽走是不行的——见 useAgent 的 finally）。回执里会说明这一点，
 * 模型才不会以为「已经清空了」而重复调用。
 */
export interface CompactOps {
  /** { summary, tasks? } → 摘要成形并写入会话（等本轮结束后应用） */
  write: (input: Record<string, unknown>) => unknown
}

/* ---------- method：目标级持久化函数 ---------- */

/**
 * method.* 的宿主实现（见 learn/methods）。
 *
 * 与 mind 的分界：mind 存的是「判断与偏好」（文本，给人与模型读）；
 * method 存的是**可执行的函数源码**——它存在的意义是被调用（agent 的编排里、
 * 以及超级文档的按钮经 api.method.call）。name 就是身份，create 同名覆盖。
 */
export interface MethodOps {
  /** 清单：名字、体量、更新时间（不带代码本身） */
  list: () => unknown
  /** 新建 / 覆盖；校验（含语法编译）失败回 { error } */
  create: (input: { name?: unknown; code?: unknown }) => unknown
  /** 按 name 删一条 */
  remove: (name: string) => unknown
  /** 按 name 取一份源码；没有回 null */
  find: (name: string) => { name: string; code: string } | null
}

/* ---------- sdoc：超级文档 ---------- */

/**
 * sdoc.* 的宿主实现（见 learn/superdocs）：绑定在节点上的可交互 HTML 文档。
 * 操作都作用在「path 解析出的那个节点」上，name 是文档在该节点内的身份。
 */
export interface SuperDocOps {
  /** 清单：这个节点有哪些超级文档（名字、体量、更新时间） */
  list: (nodeId: string) => unknown
  /** 读正文；没有那份就回 { error } */
  read: (nodeId: string, name: string) => unknown
  /** 写入（同名覆盖、没有就新建），回最终名字 */
  write: (nodeId: string, name: string | undefined, html: string) => unknown
  /** 删除一份 */
  remove: (nodeId: string, name: string) => unknown
}

/* ---------- outline：目标大纲 ---------- */

/**
 * outline.* 的宿主实现（见 learn/outline）：大纲是结构化的计划（导语 + 一层子目标），
 * 不是 Markdown——它在页签里打开是交互页面。write 是整份覆盖（与 sdoc.write 同一语义）。
 */
export interface OutlineOps {
  /** 读某个节点的大纲；还没有时回 null（这不是错误，模型据此知道要先写） */
  read: (nodeId: string) => unknown
  /** 整份写入；校验（条目形状、一层深度、数量上限）不过时回 ok:false 与原因 */
  write: (nodeId: string, input: { intro?: unknown; children?: unknown }) => AgentToolResult
}

/* ---------- wf：工作流登记表 ---------- */

/**
 * wf.* 的宿主实现（见 learn/workflows）：三级任务模板（内置 / 全局 / 目标级）的登记处。
 *
 * 与 method 的分界：method 存**可执行代码**（沙箱当场执行），wf 存**指令文本**——
 * 被触发时才以 user 消息整段进上下文，不进系统提示词。这里只有管理三件事：
 * 看、登记、删；「触发」永远由用户在界面上点，沙箱里没有 wf.run。
 */
export interface WorkflowOps {
  /** 全部工作流（内置 + 全局 + 当前目标），带 id、名字、分级与指令体量 */
  list: () => unknown
  /** 登记一条（global 或 goal 级，同名覆盖）；校验失败回 { error } */
  create: (input: unknown) => unknown
  /** 按 id 或名字删一条；内置的删不掉 */
  remove: (ref: string) => unknown
}

/* ---------- code：代码块伪编译 ---------- */

/**
 * code.* 的宿主实现：伪编译产物的**交货口**（见 lib/codeArtifacts 的 submitCompile）。
 *
 * 为什么要有这么一条 api，而不是让宿主去读对话里那段围栏：产物是一条要落盘、
 * 要被代码块认领的数据，靠「猜哪段围栏是结果」是猜不准的（一轮对话里可能有好几块）。
 * key 由触发方给（它知道是哪一块代码），代码原文由宿主自己记着，模型只交 js 与说明。
 */
export interface CodeOps {
  /** 交付一份伪编译产物；key 对不上、js 为空时回 { error } */
  save: (input: unknown) => unknown
  /**
   * 判定「这段代码没有输出」，**当场停止编译**并把那块标成无输出（见 lib/codeArtifacts）。
   * 这是一条正经的交付，不是失败：有些代码块本来就是一堆定义，转译出来也没有任何东西可看。
   */
  silent: (input: unknown) => unknown
}

/* ---------- userInfo：学习者画像 ---------- */

/**
 * userInfo.* 的宿主实现（见 user/fields 与 learn/agentOps）。
 *
 * 为什么要有这两个 api：画像原先是被**塞进系统提示词**的——它一变（用户改一次资料），
 * 整段前缀缓存就作废，而绝大多数轮次根本用不到画像里的任何一项。改成主动取之后，
 * 提示词只与目标相关，「这份讲解要不要贴合这个人」由导师自己决定。
 *
 * get 回的是给模型看的那份（**不含头像**，见 user/fields 的 profileForModel）；
 * update 是**增量**语义：只写传进来的字段，其余原样保留。
 */
export interface UserInfoOps {
  /** 读画像；没有当前用户时回 { error } */
  get: () => unknown
  /** 增量更新；认不出的字段与写不进去的值要逐条说明（见 user/fields 的 coerceProfileValue） */
  update: (patch: unknown) => unknown | Promise<unknown>
}

/* ---------- ui：界面操作 ---------- */

/** ui.point 的定位请求：path 已解析成节点 + 文档，needle 是要在渲染结果里找的文字 */
export interface UiPointRequest {
  nodeId: string
  kind: SandboxDocKind
  /** 笔记名；kind 为 'note' 但省略时由界面取该节点第一份笔记 */
  note?: string
  /** 要定位/选中的文字（源文里按 line 或 regex 算出来的那一段，已折叠空白） */
  needle?: string
  /** 找不到 needle 时的兜底：按比例滚到文档的这个位置（0~1） */
  fallbackRatio?: number
}

/** ui.scroll 的请求：滚到顶/底，或按像素滚动 */
export interface UiScrollRequest {
  to?: 'top' | 'bottom'
  by?: number
}

/** ui.screenshot 的返回：截图已存进资源库，图片挂在 images 上由运行时送进下一跳 */
export type UiCaptureResult =
  | { ok: true; note?: string; images: MessageImage[] }
  | { ok: false; error: string }

export interface UiOps {
  /** 'agent' = 对话栏放到主位；'doc' = 文档栏放回主位 */
  switchMain?: (main: 'agent' | 'doc') => void
  toast?: (message: string) => void
  /** 打开/切换到某节点的文档页签并定位；located 说明定位是否成功 */
  point?: (req: UiPointRequest) => Promise<{ located: boolean }> | { located: boolean }
  scroll?: (req: UiScrollRequest) => void
  capture?: () => Promise<UiCaptureResult>
  /** ui.dom 的根：文档区元素；没有打开的文档时返回 null（会话建立会失败） */
  domRoot?: () => Element | null
  /**
   * 打开/切到一个节点的某份超级文档页签（ui.superdoc）。
   * opened 说明那份超级文档还在不在——删掉的打不开，别静默开一个空页签。
   */
  openSuper?: (req: { nodeId: string; name: string }) => Promise<{ opened: boolean }> | { opened: boolean }
}

/** browser.tabs 的元素：一枚存活网页页签的快照 */
export interface BrowserTabInfo {
  tabId: string
  url: string
  title: string
  active: boolean
  /** 页签所在分组格的 id */
  group: string
}

/** point / dom 的目标：snapshot 清单里的 { ref } 或 CSS 选择器 */
export type BrowserTarget = string | { ref: number }

/**
 * 内置浏览器（browser.*）的宿主实现（见 learn/web/browserOps 与 learn/web/webviewRegistry）。
 *
 * **看 = snapshot（元素清单）/ read（整页 markdown）/ capture（截图，最后手段），
 * 动手 = dom（对 ref 的受控 DOM 操作），指给用户看 = point（滚动 + 高亮）**——
 * 没有任意执行页面 JS 的口子（read / eval 试过一轮，结果不可控，已撤）。
 * tabId 省略 = 「焦点格正看着的那个网页」；指名不存在时抛错，错误里引导先 browser.tabs()。
 * 返回对象会原样序列化给模型，文字要写成人话。
 */
export interface BrowserOps {
  /** 开一个网页页签（纯关键词当搜索词处理）；回 tabId，返回时首屏基本加载完 */
  open(url: string): Promise<{ tabId: string; url: string; note?: string }>
  /** 全部存活的网页页签 */
  tabs(): BrowserTabInfo[]
  /** 把某个页签切到前台 */
  activate(tabId: string): { ok: true }
  /** 关掉某个页签（不弹确认） */
  close(tabId: string): { ok: true }
  /**
   * 页面快照：可交互元素列成**带 ref 的清单**（role + 名称 + 输入值，≤200 条）——
   * 「看」的文本通道，比截图省；DOM 变了 ref 会过期，重新 snapshot 即可。
   */
  snapshot(tabId?: string): Promise<{
    elements: Array<{ ref: number; role: string; name: string; value?: string }>
    truncated?: boolean
  }>
  /** 页面像锚点跳转一样滚到目标元素，并注入短暂的脉冲高亮把它标出来（指给用户看） */
  point(tabId: string | undefined, target: BrowserTarget): Promise<{ ok: true }>
  /**
   * 对 snapshot 清单里的 ref 做受控 DOM 操作：op = "click" / "fill"(文字，触发
   * input/change，React 受控输入也认) / "focus" / "submit"(所在表单) / "text"(元素文字，
   * ≤4000 字) / "attr"(属性名)。result 是操作自己的小结果（fill 回新值、attr 回属性值）。
   */
  dom(tabId: string | undefined, ref: number, op: string, arg?: string): Promise<{ ok: true; result?: unknown }>
  /** 整页转 markdown（与 web.webFetch 同一条管线：短的回全文，长的落盘回大纲 + uuid） */
  read(tabId?: string): Promise<unknown>
  /** 页面截图 → 资源库 + 挂到下一跳（与 ui.screenshot 同一条通道）——snapshot/read 拿不到时才用 */
  capture(tabId?: string): Promise<{ ok: true; note?: string; images: MessageImage[] } | { ok: false; error: string }>
}

/**
 * 资源库操作：沙箱里 res.* 的宿主实现（见 learn/agentOps 与 learn/static）。
 *
 * 除 list / info / refs 外都是异步的（要读写磁盘）。返回的普通对象会直接序列化给模型，
 * 因此**文字要写成人话**：模型只有这一句话能依据。
 */
export interface ResourceOps {
  /** 清单：本目标的全部资源（含引用数） */
  list: () => unknown
  /** 单条资源的详情 */
  info: (uuid: string) => unknown
  /** 读。文本回内容（可给区间）；图片不回数据，而是挂到下一跳；其它二进制只回元数据 */
  read: (uuid: string, range?: { start?: number; end?: number }) => Promise<unknown>
  /** 新建一份文本资源 */
  create: (input: { name: string; ext: string; content: string }) => Promise<unknown>
  /** 改名称 / 描述 / 文本内容 */
  update: (
    uuid: string,
    patch: { name?: string; description?: string; content?: string },
  ) => Promise<unknown>
  /** 删。还被引用时必须 force 才动手 */
  remove: (uuid: string, force: boolean) => Promise<unknown>
  /** 被引用扫描：给了 uuid 就查这一条被谁引用，不给就列出全部资源的引用状况 */
  refs: (uuid?: string) => unknown
}

/**
 * 学习状态那一组（沙箱里的 state.*）。
 *
 * 它写的不是「文档」，而是**系统对这个学习者的判断**：他自评会不会、掌握到几分、
 * 错过哪几类、最近测出来什么。因此参数一律经过值域校验（四档只有四个值、掌握度只有 0~100），
 * 认不出就把可选项列出来回给模型——一个写不进去的乱值比一次报错危险得多，
 * 它会让状态面板显示一个没人能解释的数字。
 *
 * 返回值一律是 AgentToolResult：失败要回 ok:false，而不是把一句说明塞进正文——
 * execute 会把出现过 ok:false 的 api 点出来（见 createExecuteTool 的 failures），
 * 模型据此才知道「这一次没改成」，而不是以为做完了。
 */
export interface LearningOps {
  read: (nodeId: string) => unknown
  update: (
    nodeId: string,
    patch: { self?: unknown; by?: unknown; mastery?: unknown; note?: unknown },
  ) => AgentToolResult
  mistake: (nodeId: string, input: { pattern?: unknown; cause?: unknown; count?: unknown }) => AgentToolResult
  forget: (nodeId: string, pattern: string) => AgentToolResult
  check: (nodeId: string, input: Record<string, unknown>) => AgentToolResult
}

export interface SandboxRequest {
  body: string
  timeoutMs: number
  callApi: (name: string, args: unknown[]) => Promise<unknown>
}

export type SandboxReply =
  | { ok: true; value: unknown; ms: number }
  | { ok: false; error: string }

export interface ExecuteTool extends AgentTool {
  /** 最近一次编排实际调用了哪些 api（供界面显示，不进上下文） */
  lastCalls: () => SandboxCall[]
}