/**
 * AI Agent 核心类型。
 *
 * 该模块保持框架无关（不依赖 React / 学习领域），便于复用到其它场景：
 * - AgentPart / ConversationMessage：会话的持久化与渲染结构
 * - AgentEvent：运行时向前端推送的增量事件（思考 / 工具 / 正文）
 * - AgentTool：可注册的工具；新增能力只需实现一个工具并注册进 ToolRegistry
 */
import type { ChatUsage } from '../ai/types'
import type { DeliveryRecord } from './delivery'

/** 会话里一条消息的组成片段：思考过程、正文回复、一次工具调用、一条运行时提示 */
export type AgentPart =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'notice'; level: 'warn' | 'info'; text: string }
  /**
   * 跳边界：一轮 Agent 可以来回好几跳（思考 → 工具 → 再思考），实发时**每跳是一条独立的
   * assistant 消息**；历史还原（toChatHistory）必须按同样的边界切开才能与上一轮实发的
   * 结构逐字节对齐（前缀缓存能否命中的唯一判据）。runtime 在一跳的工具全部执行完、
   * 下一跳开始前发一次 hop 事件，applyEvent 把它记成这个片段。只服务于历史还原，
   * 界面不渲染它；没有标记的旧数据按「整轮一条」还原（见 learn/agent/history 的说明）。
   */
  | { type: 'hop' }
  | {
      /**
       * 动态注入的提示词模块（见 learn/ai/promptModules）：发生在 agent loop 的边界
       * （当前这条请求已完整），它是**回复内部的一个片段**——界面渲染成与思考/工具
       * 同层的折叠块（不分割轮次），toChatHistory 在它所在的位置补发一条 user 消息
       * （text 就是当时注入的全文，逐字节重放，见 agent/history）。
       * 去重判据扫 parts 里的 key（retired 的消息不算——压缩后要能重新注入）。
       */
      type: 'prompt-module'
      key: string
      text: string
    }
  | {
      type: 'tool'
      id: string
      name: string
      /** 模型给出的原始参数 JSON */
      args: string
      /** 工具执行结果（供展示） */
      result: string
      ok: boolean
      status: 'running' | 'done' | 'error'
      /**
       * **调用级**失败：代码跑通了，只是其中某几次 api 调用没有生效（位置校验不过、
       * 标题撞名、题目格式不对……）。它与「这段代码根本跑不起来」是两回事——
       * 后者是 red 的失败，前者只是「有一件事没做成」，界面上用黄色点一下，
       * 状态仍算完成（见 ToolCard 与 agent/sandbox/execute 的 ok / soft 说明）。
       */
      soft?: boolean
      /**
       * 这次调用**附带回的图片**（如 execute 里 res.read 看了一张图）。
       * 字节在磁盘上，这里只有引用（见 MessageImage）。
       */
      images?: MessageImage[]
    }

/**
 * 一条回复的 token 账。
 *
 * 一轮 Agent 可能来回好几跳（模型 → 工具 → 模型），每跳都是一次独立请求：
 * - contextTokens：**最后一跳**的输入量，也就是「此刻上下文占了多少」——
 *   圆环的百分比用的是它，因为下一跳要送进去的就是这么多；
 * - totalTokens：这一轮所有跳的输入合计，衡量这一轮到底花了多少；
 * - 命中/未命中的原始量也留着，界面上要算总命中率与平均命中率。
 */
export interface MessageUsage {
  contextTokens: number
  contextWindow: number
  totalTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheMissTokens: number
  /** 至少一跳是本地估算的（服务端没回 usage） */
  estimated: boolean
  /**
   * 最近一跳实测的输出速度（tok/s，见 ChatUsage.tps）。**只有一跳的值**：
   * 多跳轮次里各跳快慢不同，留最后一跳——界面的状态条要的是「现在吐字多快」。
   */
  tps?: number
}

/**
 * 输入框里**还没发出去**的一张图。
 *
 * 与 MessageImage 的分界就是「落盘了没有」：
 * - MessageImage 是已经进了资源库的引用（bytes 在 {目标}/static/ 下）；
 * - PendingImage 只是内存里的那份字节 + 一个本地预览地址，消息发出去的那一刻才转存。
 *
 * 为什么要分开：资源库该只收**进了上下文的东西**。贴了又删、或者根本没发出去
 * （没配 Key、中途改主意）的图如果早早落盘，就会在目标里留下永远没人引用的孤儿文件。
 */
export interface PendingImage {
  /** 本地临时 id：只用于 React key 与移除，与将来资源库里的 uuid 无关 */
  id: string
  /** 展示名（原文件名，粘贴来的给「粘贴的图片 N」） */
  name: string
  bytes: number
  /** 原始文件；转存时从这里读字节（缩放、算指纹、写盘） */
  file: File
  /** 预览用 object URL。移除 / 发送 / 卸载时必须 revoke，否则每贴一张漏一份内存 */
  previewUrl: string
}

/**
 * 输入框里**还没发出去**的一份文件附件（见 learn/attachments）。
 *
 * 与 PendingImage 分开：图片是字节，文件大多会变成文字（也有读不出文本的二进制）。
 * 同理只在内存里——发出去的那一刻才决定它进不进上下文、要不要落到资源库。
 */
export interface PendingFile {
  /** 本地临时 id：只用于 React key 与移除 */
  id: string
  name: string
  bytes: number
  /** 来源路径（从本地文件对话框选来的才有；展示用，不进上下文） */
  path?: string
  /** 图片类附件：走图片通道，与 PendingImage 同样处理 */
  image?: File
  /** 文本正文（按上限截断过） */
  text?: string
  /** 截断过（界面与上下文都要说清楚，见 learn/attachments 的 ATTACH_MAX_CHARS） */
  truncated?: boolean
  /** 二进制：读不出文本内容 */
  binary?: boolean
}

/**
 * 隐藏消息的注入类别（见 ConversationMessage.inject 的说明）。
 * 纯类型放在这里，判据函数住在 agent/messageKind（要能被 UI 与测试共用）。
 */
export type InjectKind = 'instruction' | 'prompt'

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  parts: AgentPart[]
  /** 该条回复的 token 账；旧数据没有，界面上不显示 */
  usage?: MessageUsage
  /**
   * 这一轮交付了什么（文件变动 / 参考引证），由 api.delivery.submit 登记。
   * 有它时消息底部固定展示一个交付组件，一行一条；没有就整块不渲染（见 learn/delivery）。
   */
  delivery?: DeliveryRecord
  ts: number
  /** 内部指令（如自动开讲），参与模型上下文但不展示给用户 */
  hidden?: boolean
  /**
   * 这条隐藏指令是「哪件事」：出卷 / 阅卷 / 开讲…
   *
   * 有它的话，界面上会在对话流里画一条小小的分界条（见 AgentPanel），
   * 消息定位条也把它当成一个锚点——否则「导师带我做的那次练习」在长对话里根本找不回来：
   * 那条指令是隐藏的，用户消息一个点都没有。**没有 mark 的隐藏指令照旧不显示**。
   */
  mark?: string
  /**
   * 工作流启动时的**实参**（runWorkflow 的 params：如伪编译的 language/key/code）。
   * 界面的工作流分界条展开时据此画「参数行」，并把指令里对应的实参高亮出来。
   * 只随隐藏指令落库；聊天轮没有它。
   */
  wfParams?: Record<string, string | number>
  /**
   * 隐藏消息的**注入类别**——决定它在对话流里怎么出现（判据见 agent/messageKind）。
   *
   * - `'instruction'`：**工作流指令**。触发一条工作流时整段进入上下文的那条 user 消息
   *   （开讲 / 出卷 / 阅卷 / 压缩…）。它是一道**轮次边界**：界面上画一条分界条。
   * - `'prompt'`：**提示词注入**。人格 / 文档格式 / 技能库 / 提示词模块这些「补给上下文」
   *   的隐藏消息。它们不分割轮次，界面上并进那一轮的「思考、工具与提示词」过程组——
   *   与思考、工具调用是同一层的东西（都是「这一轮它凭什么这么答」）。
   *
   * 两者从前都塞进同一条分界条里，几条一起注入时那行字被挤得溢出（用户报的 bug）。
   * 这个字段就是那条分界线的判据：**只有 instruction 才画**。
   * 老数据没有这个字段，由 messageKind 按 persona / docFormat / promptModule / skillsDigest
   * 这些既有标记反推（见 injectKindOf）。
   */
  inject?: InjectKind
  /**
   * 这是「导师人格」那一条隐藏指令，值是人格 id（见 agent/persona）。
   *
   * 单独一个字段而不是从 mark 里认字符串：宿主每一轮都要判断「当前人格交代过了没有」
   * （见 needsPersonaAnnounce），认字符串的话改一次文案就失效了。
   */
  persona?: string
  /**
   * 这是「文档格式策略」那一条隐藏指令，值是格式 id（见 agent/docFormat）。
   *
   * 与 persona 同一条纪律：去重判据认字段不认文案（见 needsDocFormatAnnounce），
   * 一条对话里同一种格式只补一次，被压缩掉之后自动补回来。
   */
  docFormat?: string
  /**
   * 这是「动态注入的提示词模块」那条隐藏指令，值是模块 key（见 learn/ai/promptModules）。
   *
   * 与 persona 同一条道理：去重判据认字段不认文案。宿主注入前扫一遍活着的消息
   * （retired 的不算——被压缩折掉的模块要能重新注入），key 已在就不重复注入；
   * 界面上带 mark 渲染成可展开的分界条（见 MessageBubble 的 ModuleDivider）。
   */
  promptModule?: string
  /**
   * 这是「可用专业技能库索引」那条隐藏指令的指纹（见 agent/skill/registry）。
   * 动态按需注入，随技能增删实时重注入，避免修改系统提示词破坏前缀缓存。
   */
  skillsDigest?: string
  /**
   * 这是「可用外部 MCP 服务」那条隐藏指令的指纹（见 agent/mcp/announce）。
   * 与 skillsDigest 同一套机制：服务启停 / 工具清单变化时重注入（hosted 会话不落盘，
   * 重启后自然重注入——那一刻前缀缓存本来就是冷的）。
   */
  mcpDigest?: string
  /**
   * 这是「学习者画像」那一条隐藏信息（见 agent/userInfo）。
   * 首轮注入在人格与文档格式之后，提供客观学习者背景供因材施教。
   */
  userInfo?: boolean
  /**
   * 附加上下文（如「询问」的选段位置），随消息一起送给模型但不展示。
   * 与 hidden 的区别：hidden 连正文都不显示，context 只补充说明、正文照常显示。
   */
  context?: string
  /** 「询问」引用的选段：气泡里显示为可点击引文，点击回到笔记高亮对应文字 */
  quote?: MessageQuote
  /** 这条消息带的图（只存引用，字节在磁盘上）；没有图就没有这个字段 */
  images?: MessageImage[]
  /** 这条消息带的文件附件（文本内容直接存在这里，见 MessageFile）；没有就没有这个字段 */
  files?: MessageFile[]
  /**
   * 失活：已经被折进摘要，不再进上下文（见 learn/compact）。
   *
   * 与「删掉」不同：它还在会话里，界面上照旧能翻、能看（只是标成旧的）。
   * 判据只此一条——上下文只发没失活的消息。
   */
  retired?: boolean
}

/**
 * 一条消息带的一个文件附件。
 *
 * 与图片分开走：图片是**字节**（转存进资源库、作为 image 片段发给模型），
 * 文件是**文字**——用户拖进来的大多是一份源码、一段数据、一篇摘录，
 * 模型要的是内容本身，不是这份文件在磁盘上的位置（路径既没用又泄露隐私）。
 * 因此这里存的是**读出来的正文**（截断过就记一笔），而不是一条路径。
 *
 * 二进制文件（读不出文本的那种）只留名字与体积：模型至少知道「他附了一份 exe」，
 * 而不是完全没看见。
 */
export interface MessageFile {
  /** 文件名（含扩展名） */
  name: string
  bytes: number
  /**
   * 文本附件在资源库里的那条记录（uuid）与文件位置（rel，相对当前用户）。
   * 正文本身不在这里——它在资源库里（见 learn/attachments），要发的时候按 rel 读回来。
   * 二进制附件没有这两项：那份字节既没进资源库，也没有内容可读。
   */
  uuid?: string
  rel?: string
  /** 附上的正文字数；二进制没有 */
  chars?: number
  /** 超过上限被截断了（只发了开头一段） */
  truncated?: boolean
  /** 二进制：读不出文本内容 */
  binary?: boolean
  /** 来源文件在本地磁盘上的绝对路径（拖入或对话框选取的文件有此属性，点击可在标签页中打开） */
  path?: string
}

/**
 * 一次上下文压缩的结果（见 learn/compact）。
 *
 * 语义是「这段对话到此为止」：**所有原消息失活**（ConversationMessage.retired），
 * 只剩这份交接摘要 + 之后的新消息进上下文。原消息仍然留在会话里——它们只是不再进上下文，
 * 界面上照旧能翻、能看（所以标的是「失活」，而不是把消息删掉）。
 *
 * 摘要由 agent 自己在工作流里写（api.compact），不是宿主另起一次模型请求。
 */
export interface ContextSummary {
  /** 摘要写成的时刻 */
  at: number
  /** 交接摘要正文（模型写的，此后每一轮都原样带上） */
  text: string
  /**
   * **还没做完的事**，逐条列。
   *
   * 单独一个字段（而不是写进正文）：任务细节是压缩里最容易丢、也最要命的部分，
   * 所以它拼进上下文时排在正文前面，写的时候也要求「具体到能照着继续干」。
   */
  tasks: string[]
  /** 被折叠掉的消息条数（应用时算出来，给界面说「省了多少」） */
  messages: number
  /** 被折叠掉的字符数 */
  chars: number
  /** 摘要已写入、还没应用（消息还没失活）——本轮 loop 结束后由宿主应用 */
  pending?: boolean
}

/**
 * 一条消息带的一张图。
 *
 * **只存引用，字节在磁盘上**（\`{目标}/images/{id}.{ext}\`，见 learn/images）：
 * chat.json 每次改动都整份重写，把几百 KB 的 base64 塞进消息里，写一次就从几毫秒
 * 变成几十毫秒，出了问题也更难查；反过来，图片单独成文件，用户在资源管理器里
 * 就能直接打开看——这与「数据目录本身要能看懂」的一贯取舍一致。
 *
 * 送模型时按 id 把字节读回来拼成 content 片段（见 ai/content），历史里因此
 * 一个字节都不多存。
 */
export interface MessageImage {
  /** 文件名（不含扩展名），也是它在 images 目录里的唯一标识 */
  id: string
  /** 相对数据根目录的路径，如 docs/微积分/images/3f2a1b.png */
  rel: string
  /** 原文件名（展示用）；剪贴板里来的图给一句「粘贴的图片」 */
  name: string
  mime: string
  bytes: number
  /**
   * 像素尺寸。**可选**：用户贴进来的图在保存时就知道尺寸，而由资源库挂上来的图
   * （Agent 用 res.read 看的那一张）只从清单里拿到字节数，不必为它多解码一次。
   */
  width?: number
  height?: number
}

/** 用户就笔记里某一段发问时记下的引文 */
export interface MessageQuote {
  /** 选中的渲染态文字（用于展示，也用于在笔记 DOM 中定位） */
  text: string
  /** 该段在 Markdown 源文中的字符区间；定位失败时省略 */
  start?: number
  end?: number
}

/**
 * 一段对话。归属单位是**学习目标**而不是节点：
 * 目标下所有节点共用同一份上下文，切换节点不换对话——
 * Agent 因此知道「刚才在这个目标的另一个节点上讲过什么」，
 * 系统提示词也才能稳定在目标一级（前缀缓存不会因为切节点而整段作废）。
 */
export interface Conversation {
  id: string
  goalId: string
  messages: ConversationMessage[]
  createdAt: number
  updatedAt: number
  /**
   * 这段对话叫什么。**由模型起名**（见 learn/title）：一段对话的标题是"它在聊什么"，
   * 只有读过第一句话才知道；让用户自己填，绝大多数人不会填。
   *
   * 可选：老会话没有这个字段，界面上退回「对话 N」。起名只做一次——
   * 有了标题就不再改（聊到一半改名，用户反而认不出刚才是哪一段）。
   */
  title?: string
  /**
   * 上下文压缩：有它就说明这段对话的前半段已经折叠成一份摘要。
   * 只留**最近一次**——新的压缩会把上一次的摘要读进来一起重写（见 learn/compact）。
   */
  summary?: ContextSummary
  /**
   * 在途轮次标记：这一段对话有一轮回复**正在跑**（runTurn 开始时写上、收口落库时清掉）。
   * 进程被杀时它还留着——载入时据此找到那条没收口的回复做中断恢复
   * （见 learn/agent/inflight 的 recoverInterruptedTurn）。有了它才能区分「跑一半被杀」
   * 与「早就正常结束」：用户点「停止」的轮次走正常收口不会被误标，老数据没有这个字段
   * 也不会被误伤。
   */
  inflight?: { messageId: string; startedAt: number }
  /**
   * 子代理（见 docs/subagent-architecture.md）：这段对话里登记过的自定义定义与活着的
   * 会话（各自的独立上下文）。**生命周期 = 这段对话**：随 chat.json 落盘、随对话删除
   * 一起消失。没有子代理的对话不写这个字段（空桶存 undefined）。
   */
  subagents?: SubAgentBucket
  /**
   * **固化的系统提示词**：这段对话的第一次请求抓一份、之后每一轮都用它（不再现拼）。
   *
   * 为什么固化进对话：系统提示词只描述目标一级、本来就不随轮次变——把它钉死在对话
   * 数据上，a) 前缀缓存的「system 段」在对话生命周期内逐字节稳定（设置中途改动不会
   * 把进行中的对话前缀打断）；b) 轨迹查看器（agent/contextTrace）能展示「当时发出去
   * 的到底是哪一份」。兼容老数据：没有这个字段就在下一轮请求前现场抓一份补上并落盘，
   * 之后与新数据完全一致。
   */
  systemPrompt?: string
}

/**
 * 子代理的类型契约（持久化在 Conversation.subagents 上，随 chat.json 落盘）。
 *
 * 子代理是导师派出去干活的「分身」：各有自己独立的上下文，在导师的对话里跑自己的
 * 「思考 → 工具 → 观察」循环，跑完只把**一份交付消息**交回导师（中间过程不进导师上下文）。
 * 没有内置的：导师用 api.subagent.create 先登记定义（系统提示词与可用的 api 组），
 * 再 api.subagent.run 派任务；登记只活在当前这段对话里，不能跨对话复用，
 * 本对话内可反复派活（会话按 key 复用）。
 * 架构与边界见 docs/subagent-architecture.md；实现见 agent/subagent/。
 */

/** 一个子代理的定义：key 是导师寻址它的唯一凭据 */
export interface SubAgentDef {
  /** 稳定标识：agent_run 的 agent 参数写的就是它 */
  key: string
  /** 显示名（面板的会话列表用） */
  name: string
  /** 子代理自己的系统提示词——它的上下文里唯一的一号消息 */
  system: string
  /**
   * execute 开放的 api 组（SandboxOptions.apiAllow，如 ['web','tmp']）。
   * 「子代理都有 execute 工具，api 按需开放」就是它：名单外的组在通道口被硬拒。
   */
  apiGroups: string[]
}

export type SubAgentStatus = 'idle' | 'running' | 'interrupted' | 'error'

/** 一次生命的实例：一个定义可以对应一个活着的会话（按 defKey 复用） */
export interface SubAgentSession {
  id: string
  defKey: string
  status: SubAgentStatus
  /** 已完成的任务次数 */
  runs: number
  createdAt: number
  lastActiveAt: number
  /**
   * 自己独立的上下文。就是普通的 ConversationMessage[]：导师的任务是一条 user 消息，
   * 每次任务是一条 assistant 回复（parts 里含工具卡片、思考与通知）。
   * 界面渲染与模型历史（toChatHistory）共用这一份——与导师同一套镜像纪律。
   */
  messages: ConversationMessage[]
  /** 最近一次交付的预览（会话列表用；完整交付只进导师上下文） */
  lastDelivery?: string
  /** 最近一次没能交付的原因（中断 / 出错）——列表里要说清为什么没有交付 */
  lastIssue?: string
}

/** 一段对话的子代理桶：自定义定义 + 会话。生命周期 = 这段导师对话（随 chat.json 落盘） */
export interface SubAgentBucket {
  /** 导师经 api.subagent.create 登记的定义（只在本对话内有效） */
  defs: SubAgentDef[]
  sessions: SubAgentSession[]
}

/** 运行时事件流：前端据此增量渲染 */
export type AgentEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; id: string; name: string; args: string }
  | {
      type: 'tool-result'
      id: string
      name: string
      result: string
      ok: boolean
      /** 调用级失败（见 AgentPart 里同名字段的说明）：ok 为 false 但代码本身跑通了 */
      soft?: boolean
      images?: MessageImage[]
    }
  /**
   * 跳边界：一跳的工具全部执行完、下一跳开始前发一次（见 AgentPart 的 hop 说明）。
   * 有了它，扁平的事件流才分得清「同一跳的两次调用」与「相邻两跳」——
   * 这两种在 parts 里长得一模一样，只有 runtime 自己知道边界在哪。
   */
  | { type: 'hop' }
  /** 非错误的运行时提示：输出被截断、步数用尽、正在重试等 */
  | { type: 'notice'; level: 'warn' | 'info'; message: string }
  /**
   * 一次请求失败、即将退避重发（见 agent/retry 的判据与上限）。
   *
   * 它的作用只有一个：**让界面把这一趟已经吐出去的字撤掉**。重发是从头再生成一遍，
   * 留着那些半截正文，新的回答就会接在旧答案后面，看着像说了一半又从头说。
   * 紧跟在后面的 notice 才是给用户看的那句「正在重试（第 n 次）」——
   * 顺序不能反，反过来那条提示自己也会被撤掉。
   */
  | { type: 'retry'; attempt: number; max: number; message: string }
  /**
   * 输出中的实时速度（tok/s）：输出期间每秒重算一次「累计输出 ÷ 首个 chunk 以来的时长」。
   * 它是**估算值**（按字符折算，口径与 estimateUsage 一致）；请求结束时的 usage 事件
   * 会带着服务端的精确 tps 来替换它。
   */
  | { type: 'pace'; tps: number }
  /** 每次请求结束后上报的用量（含缓存命中），前端累加成一条消息的账 */
  | { type: 'usage'; usage: ChatUsage }
  | { type: 'done' }
  | { type: 'error'; message: string }

/**
 * 工具附带的图片挂上来的那条消息的说明文字。
 *
 * 运行时（agent/runtime）与历史还原（learn/useAgent 的 toChatHistory）必须**一字不差**：
 * 两者差一个字符，下一轮发出去的历史就与上一轮实发的那份对不上，服务端的前缀缓存
 * 从这一处起整段作废。
 */
export const TOOL_IMAGE_NOTE = '（这是上一步附上的图片）'

/** 一次工具执行最多挂几张图：再多模型也看不过来，token 更吃不消 */
export const MAX_TOOL_IMAGES = 4

export interface AgentToolResult {
  ok: boolean
  /**
   * 这次失败是**调用级**的：代码本身跑通了，只是其中某几次 api 调用没有生效。
   *
   * 为什么要分出来：`ok:false` 在这两件事上是同一个值，可它们在界面上该长得不一样——
   * 代码报错（语法、运行时抛错、超时）是「这一步没跑成」，红色、失败；
   * 而「有一次写入被拒」是「跑完了，但那件事没做成」，模型下一步就能改，
   * 界面上再标红只会让人以为整步都废了（见 ToolCard 的 soft 分支）。
   */
  soft?: boolean
  /** 回填给模型的内容（也会展示在工具卡片里）。**只能是文本** */
  content: string
  /**
   * 除了文字，这次调用还要让模型**看见**的图片。
   *
   * 为什么不塞进 content：工具结果是纯文本通道，先过 safeJson、再被裁到 3 万字符
   * （见 agent/tools 的说明）。一张 200KB 的图 base64 之后是 27 万字符，进了那条通道
   * 只会剩一段被截断的乱码，还永久占着上下文。
   * 图片因此走**图像通道**：运行时在下一条消息里把它们作为 image 片段挂上去
   * （见 agent/runtime 与 learn/useAgent 的 toChatHistory）。
   */
  images?: MessageImage[]
}

/** 工具执行上下文：与具体领域解耦，由调用方注入 */
export interface AgentContext {
  /** 当前正在看的节点（会话是目标级的，节点只是「此刻的落点」） */
  nodeId: string | null
  goalId: string
}

export interface AgentTool {
  name: string
  description: string
  /** JSON Schema（OpenAI function parameters 格式） */
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: AgentContext) => AgentToolResult | Promise<AgentToolResult>
}
