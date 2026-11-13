/**
 * 页签域类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 自由页签（TabRef）、agent 栏页签（AgentTabRef）、文档视图（DocView）、
 * web 页签的活信息（WebTabMeta）、打开的页签（LearnTab）、本地文件（LocalFile）
 * 与收藏（FavoriteRef / FavoriteItem）。本文件不依赖其他 types/ 子模块。
 */

/* ---------- 自由页签（像 vscode 那样） ---------- */

/**
 * 一个页签指向什么。
 *
 * 三种来源平级地摆在同一条页签栏上：节点的教学文档、节点的某一份笔记、以及磁盘上
 * 任意一个外部文件（拖进来或从本地文件列表点开的）。「页签」是**视图**的概念，
 * 与知识树没有从属关系——关掉一个教学文档的页签，节点本身照旧在树里。
 */
export type TabRef =
  /** 某个节点的教学文档 */
  | { kind: 'teach'; nodeId: string; view?: 'source' | 'preview' }
  /** 某个节点的某一份笔记（note 是笔记名，见 NoteFile） */
  | { kind: 'note'; nodeId: string; note: string; view?: 'source' | 'preview' }
  /** 某个节点的某一份超级文档（name 是它的名字，见 SuperDocFile） */
  | { kind: 'super'; nodeId: string; name: string; view?: 'source' | 'preview' }
  /**
   * 某一次考试的只读副本：卷子原件 + 那次作答 + 判分 + 错题讲解。
   * 认的是**考试**（attemptId），不是试卷——同一份卷子考两次，副本各是各的。
   */
  | { kind: 'exam'; nodeId: string; examId: string; attemptId: string }
  /**
   * 某个目标的大纲页（交互页面，见 OutlineDoc）。它不是源码/预览那种文档视图——
   * 渲染层见到它就走大纲自己的组件，不进 DocPane。
   */
  | { kind: 'outline'; nodeId: string; goalId?: string }
  /** 磁盘上的外部文件（绝对路径） */
  | { kind: 'local'; path: string; title?: string; view?: 'source' | 'preview' }
  /**
   * 工作区（项目）里的**内部文件**：nodeId 是它的工作区所属的节点（目标根节点就是
   * `docs/{目标}/workspace/`），seg 是**相对那个工作区目录**的路径（如 `项目A/README.md`）。
   *
   * 为什么存相对段而不是完整磁盘路径：节点目录会随标题改名跟着搬（见 learn/workspace）——
   * 存相对段，名字怎么改都还指得准。它与 local 的本质区别是**归属**：内部文件属于那个节点
   * 的目标（见 groups/goals 的 refOwner），打开时先过它的组（openGroupedDoc），
   * 跟着切目标收起 / 归队；外部文件不属于任何目标，也不进「本地文件」那套账。
   */
  | { kind: 'ws'; nodeId: string; seg: string; view?: 'source' | 'preview' }
  /**
   * 内置浏览器的网页页签（<webview>，见 electron/app/webSession 与 components/learn/web）。
   * url 是**当前**地址——页面每次主框架导航都回写进来，重启回到离开时的那一页；
   * key 是开签那一刻生成的唯一身份（learn/tabs 的 newWebKey），导航不换：
   * 同一个网址可以开两枚页签，空地址（起始页，url === ''）也可以同时开好几枚。
   */
  | { kind: 'web'; url: string; key: string; fileNodeId?: string; goalId?: string }
  /**
   * 视频页签（见 components/video/VideoStudyTab）。两种形态：
   * - 带 videoId：**绑定**到一个视频资源（描述在 learn/types 的 VideoResource），
   *   页里没有输入组件，打开即自动解析；
   * - 不带 videoId：**创建**态（全局一份），只有输入框 + 插件匹配 + 创建按钮。
   * 页签持久化；解析结果不落盘（流地址带签名会过期，重开再解析）。
   *
   * goalId（可选）：这份视频被某个**视频节点**绑到那个目标名下时，页签跟着归进
   * 那个目标的页签组（见 groups/goals 的 refOwner）——打开它 = 打开那个组，
   * 组被收起（锚大纲关闭进停靠场）时它一起收。身份仍是 videoId（tabKey 不看 goalId），
   * 绑定关系变了重开一次页签就对齐。
   */
  | { kind: 'video'; videoId?: string; videoNodeId?: string; goalId?: string }
  /**
   * 插件开发文档页签：介绍插件契约与配置面板（见 components/plugins/PluginDoc）。
   * 跟着页签持久化（normalize 认它），内容全是静态文档，没有要落盘的状态。
   */
  | { kind: 'pluginDoc' }
  /** 赞助者名单页签：展示赞助者致谢列表与赞助方式（见 components/sponsor/SponsorsDoc） */
  | { kind: 'sponsors' }
  /** Vim 学习与命令大全页签：集成游戏化闯关道场与速查命令大全文档（见 components/learn/vim/VimStudyPage） */
  | { kind: 'vim'; section?: 'tutor' | 'commands' }
  /**
   * 设置面板：文档区的一枚页签（不再是弹窗）。全局只有一份（tabKey 恒定），
   * 从哪个入口打开都是切到它；面板本身见 components/settings/SettingsPanel。
   * 它跟着 docArea 持久化——重启后还开在那儿，与「上次开着哪些页签」同一句话。
   */
  | { kind: 'settings' }
  /**
   * 用量统计页：同样全局一枚页签（入口在顶栏用户菜单）。它读的是「台账」
   * （ai/usageLog）而不是配置，所以不从设置里走；页面自己订阅台账重渲染。
   */
  | { kind: 'usage' }
  /**
   * 日程安排页：同样全局一枚页签（入口在顶栏日历按钮的悬停 tip，以及提醒弹层）。
   * 数据是用户级的 schedule（state.json，见 learn/schedule），不挂任何节点；
   * 它跟着 docArea 持久化——重启后还开在那儿，与「上次开着哪些页签」同一句话。
   */
  | { kind: 'schedule' }
  /**
   * 记忆管理页：导师写下的记忆（learn/memory 的 store.memory）的查看与编辑，
   * 入口在 agent 栏输入框的「+」菜单。**页签也按目标一枚**（tabKey = 'm:' + goalId）：
   * 打开时默认筛到该目标的工作记忆；长期记忆跨目标，这一页同样看得到。
   * 目标删掉时它的记忆页签一起关。kind 仍叫 'mind'——改名会让老用户开着的这枚页签
   * 在升级后凭空消失，而它承载的只是界面状态，不值得为名字付这个代价。
   */
  | { kind: 'mind'; goalId: string }
  /**
   * 超级导师设置页：对话压缩/工作流/开发者三块（原弹窗改的页签，见
   * components/agent/AgentSettingsPanel）。同样全局一枚，与全局设置是两份数据。
   */
  | { kind: 'agentSettings' }
  /** 空白页签（底页）：显示无页签引导卡片，用于快捷新建或作为保底页签 */
  | { kind: 'blank'; key: string }
  /**
   * **新建文件**页签：在空白页签上点「新建文件」得到的一枚临时编辑页。
   *
   * 它**还没有类型、也没有落点**——用户在空白页上点那一下说的只是「我要写点东西」，
   * 此刻答不上来「存成什么」。答案在保存那一步：选路径 + 文件名 + 后缀（默认 `.txt`），
   * 后缀一确定，它当场换成指向那个文件的 `local` 页签（见 useDocSaveFlow 的 draft 分支），
   * 于是「是什么类型」由后缀说话，不必在这里预设。
   *
   * 正文住在**暂存区**（learn/drafts，键就是页签 id），基准是空串：改一个字就出现
   * 「未保存」的圆点，保存则是一次明确的动作（Ctrl+S → 另存对话框）。它随 state.json
   * 一起落盘，所以关掉应用再打开，没保存的那半篇还在。
   */
  | { kind: 'draft'; key: string }

/**
 * agent 栏的页签指向什么（见 learn/agentTabs 与 components/agent/AgentTabStrip）。
 *
 * 固定聊天：栏上最左侧那枚**常驻页签**——纯聊天（无系统提示词、无工具、没有人格），
 * 不可关闭与拖拽，不落 store（界面在页签列表前合成置左）；会话住在
 * users/{uid}/free-chat.json（learn/freeChat），conversationId 记当前展示的那一段。
 * 目标级导师：一个目标一枚页签——上下文按目标隔离（graph/conversations），页签里
 * 可以在目标的几段对话之间切换（conversationId 记的是**当前展示**的那一段，
 * 为 null 表示还没有会话，激活时现场建）。
 * 子代理会话：页签随时可关（任务在后台继续跑，见 subagent/manager），所以
 * conversationId + sessionId 都要存——会话的渲染数据住在那一段导师对话上。
 */
export type AgentTabRef =
  | { kind: 'free'; conversationId: string | null }
  | { kind: 'goal'; goalId: string; conversationId: string | null }
  | { kind: 'sub'; conversationId: string; sessionId: string }

/** 文档区的视图：源码（可编辑）、预览（渲染后）与媒体预览（图片 / 音频 / 视频的本地文件） */
export type DocView = 'source' | 'preview' | 'media'

/**
 * web 页签的**活信息**：只活在会话里、不落盘（learn/state 的 buildState 不挑它）。
 * 标题与图标要等页面事件来了才有，页签栏拿 tabTitle 兜底出的域名先顶着（见 learn/tabs）。
 */
export interface WebTabMeta {
  url: string
  /**
   * DOM 元素过滤选择器（如 'article, main, .post-content'）。
   * 设置后在纯净阅读模式下只保留该元素显示，消除周围噪声。
   */
  domFilter?: string
  /**
   * 白名单选择器列表（纯净模式下仅保留匹配这些选择器的元素显示）
   */
  whitelist?: string[]
  /**
   * 黑名单选择器列表（在页面中隐藏匹配这些选择器的元素，如广告、侧边栏、页眉等）
   */
  blacklist?: string[]
  /**
   * 是否启用纯净阅读模式（默认 true，保留切换回原页面阅读的开关）
   */
  pureMode?: boolean
  /**
   * 自动缓存的页面 Markdown/纯文本内容
   */
  cachedContent?: string
  /**
   * 缓存生成时间戳
   */
  cachedAt?: number

  title?: string
  favicon?: string
  loading: boolean
  canBack: boolean
  canFwd: boolean
  error: string | null
}

/**
 * 一个打开的页签。
 *
 * id 由 tabKey(ref) 算出（见 learn/tabs），因此「同一个目标」在列表里只可能出现一次——
 * 重复打开只是把它激活，不会多出一个页签。
 */
export interface LearnTab {
  /** 稳定 key（tabKey 的结果），页签列表与激活态都按它比对 */
  id: string
  ref: TabRef
  /**
   * 用户在这个页签上手动选过的视图。省略 = 按文件类型给默认值
   * （md / html 默认预览，其余默认源码，见 learn/tabs 的 viewOf）。
   * 记在页签上而不是全局一个开关：在 a.md 上切成源码，不该让 b.md 也跟着变。
   */
  view?: DocView
  createdAt: number
  /** 是否固定标签页：固定tab永远显示在最前面，不受tab栏滚动和非直接关闭影响 */
  pinned?: boolean
}

/**
 * 本地文件列表里的一条：拖进归一浏览过的外部文件。
 *
 * 只记路径与「最近打开时间」，**不复制文件内容**：拖进来的文件仍然住在原处，
 * 归一只是打开它看一眼、必要时改一改（源码视图）。把它拷进数据目录会造成
 * 两份内容各自演化，用户下次在原文件里改的东西就再也对不上了。
 */
export interface LocalFile {
  /** 绝对路径：这份文件的唯一身份 */
  path: string
  /** 文件名（含扩展名），列表里显示它 */
  name: string
  /** 最近一次打开的时间；列表按它倒序 */
  openedAt: number
}

/**
 * 收藏夹里的一条指向什么（见 learn/favorites）。
 *
 * 与 TabRef 同构，只有网页不同：收藏认**网址**而不是开签那一刻的 key——
 * 收藏的是「这个页面」，同一网址开几枚页签、关了再开，都是同一条收藏。
 */
export type FavoriteRef =
  /** 某个节点的教学文档 */
  | { kind: 'teach'; nodeId: string }
  /** 某个节点的某一份笔记（名字就是身份，见 NoteFile） */
  | { kind: 'note'; nodeId: string; note: string }
  /** 某个节点的某一份超级文档（名字就是身份，见 SuperDocFile） */
  | { kind: 'super'; nodeId: string; name: string }
  /** 某一次考试的只读副本（认考试，与页签同一口径） */
  | { kind: 'exam'; nodeId: string; examId: string; attemptId: string }
  /** 某个目标的大纲页 */
  | { kind: 'outline'; nodeId: string; goalId?: string }
  /** 磁盘上的外部文件（绝对路径） */
  | { kind: 'local'; path: string; title?: string }
  /**
   * 一个网页（内置浏览器；认网址）。收藏那一刻顺手记下页面的**标题与站点图标**——
   * 网页标题没有活的数据源可查（文档改名有节点可查，页面标题只在打开时才知道），
   * 收藏夹里要显示它们就只能存（见 learn/favorites）。缺了（页面还没加载完就收藏了）
   * 显示域名兜底；两者都不参与身份（favoriteKey 只比网址）。
   */
  | { kind: 'web'; url: string; title?: string; icon?: string }

/**
 * 一条收藏：指向什么 + 什么时候收藏的（列表按收藏先后排）。
 * group 是**分组文件夹**的名字（网页收藏的管理用，见 learn/favorites）：缺了 = 没有分组、
 * 躺在收藏区顶层。它不参与身份（favoriteKey 只比指向），改组名只是原地换字符串。
 */
export type FavoriteItem = FavoriteRef & { at: number; group?: string }
