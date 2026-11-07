/**
 * 媒体与游离实体域类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 视频资源（VideoResource / VideoChapter / VideoRecap）、视频节点（VideoNodeEntity）、
 * 项目节点（ProjectNodeEntity / ProjectPathKind）、文件节点（FileNodeKind /
 * FileNodeEntity）。本文件不依赖其他 types/ 子模块。
 */

/**
 * 一个视频资源：**创建时确定**的「插件 + 输入 + 插件专属数据」。
 *
 * 与「视频页签」的关系：页签只记 id，资源记内容。所以页签关掉再开、换机器带
 * state.json 走，都能复原；资源被删则页签显示「已删除」的占位。
 *
 * fields 是插件在 createFields 里声明的**每个视频各自的**数据（例如画质），
 * 解析时与插件全局配置合并进 host.settings（同键以这里为准）——插件不需要
 * 区分两份配置从哪来。
 */
export interface VideoResource {
  id: string
  /** 处理它的插件的声明 id（插件被删时视频仍列着，解析会报插件不存在） */
  pluginId: string
  /** 插件显示名的快照（列表里不依赖插件是否还装着） */
  pluginName?: string
  /** 创建时的输入（原样交给插件 match / resolve） */
  input: string
  /** createFields 的值（创建时填好，之后不再改） */
  fields?: Record<string, string | number | boolean>
  /** 列表显示名：创建时取输入截断，解析成功后由插件给的标题覆盖 */
  title: string
  /**
   * 选集状态（**通用状态归宿主**）：用户在合集 / 分 P 列表里最终停在的那一项。
   * source 是那一项能被插件再认领的输入串（如带 ?p=N 的链接）；没选过就是创建时
   * 的 input。重开页签按它解析——「上次看的那一集」也在进度里，见下。
   */
  selection?: { source: string; title?: string }
  /**
   * 播放进度（**通用状态归宿主**）：上次播放到哪儿，打开绑定页签时自动跳回。
   * source 记住这是**哪一项**的进度（换选集后旧进度不再乱套到新一集上当续播）。
   * 播放器自身的偏好（音量 / 倍速 / 静音）属于本机，不在这里（见 VideoPlayer 的
   * localStorage）；插件专属的状态放 fields。
   */
  progress?: { source?: string; positionMs: number; updatedAt: number }
  /**
   * **被哪些视频节点引用着**（见 store.videoNodes 的 VideoNodeEntity）：绑定是双向的——
   * 节点记 videoId，资源这边记引用它的节点 id。这一份是**镜像**（读盘归一时从
   * videoNodes 重建），引用判定的唯一事实源仍是 store.videoNodes；写操作
   * （bind / 解绑 / 删节点）两边同一次提交一起动。
   */
  boundTo?: string[]
  /**
   * 视频总结（一个动作生成的内容总结 + 语义分段，见 learn/video/summarize）：
   * **按选集 source** 存（合集 / 分 P 每一项的字幕各不相同），一项一份。
   * 进度条上的分段点与底部区（字幕/总结/视频分段）都读它；生成过就不再生成。
   * 两段都可缺省（手改的数据允许残缺，界面按缺失兜底）。
   */
  recaps?: Record<string, VideoRecap>
  createdAt: number
  updatedAt?: number
}

/** 视频的一段语义分段：从哪个时间戳开始、讲了什么（进度条上的分段点） */
export interface VideoChapter {
  /** 这一段的开始时间（整数毫秒，对准转录段的时间轴） */
  startMs: number
  /** 这一段的内容概述（一句话，给悬停信息用） */
  summary: string
}

/**
 * 一份「视频总结」：**一个动作**生成的内容总结 + 语义分段（按选集 source 存）。
 * 总结是这个视频讲了什么的一段话；分段把内容按话题切开，变成进度条上的分段点。
 */
export interface VideoRecap {
  /** 视频内容描述（一段连贯的话） */
  summary?: string
  /** 语义分段（进度条分段点 + 底部「视频分段」页签的行） */
  chapters?: VideoChapter[]
}

/**
 * 视频节点（节点宇宙的游离类型）：把**一个学习目标**与**一个视频资源**绑在一起。
 * 只作为游离实体存在（不进大纲树——它是「这门课配这个视频」的引用，不是知识结构），
 * 一个目标可以有多枚，同一个视频也可以被多个目标各自绑一枚。
 */
export interface VideoNodeEntity {
  /** 节点宇宙身份（无前缀，与笔记 / 试卷同一款拼法） */
  id: string
  goalId: string
  /** 绑定的视频资源 id；null = 空节点（刚从 palette 落下，还没选视频） */
  videoId: string | null
  /** 视频唯一标识（URL 或 B 站 BV 号） */
  input?: string
  /** 视频节点标题（创建时为未命名视频，解析后自动回填或用户手动重命名） */
  title?: string
  /** 用户是否手动重命名过标题（手动命名后不再随解析覆盖） */
  titleCustomized?: boolean
  /** 是否已确定为视频资源并固化标识输入框 */
  confirmed?: boolean
  createdAt: number
  updatedAt: number
}

/**
 * 项目节点（节点宇宙的游离类型）：声明一条**真实文件系统路径**的引用。
 *
 * 路径两种拼法（pathKind）：relative 相对**目标根目录**（磁盘上 docs/{目标段}/），
 * absolute 是电脑上任意绝对路径。节点在拓扑图上声明之后，这条路径及其下的整棵子树
 * 就对 agent 敞开（读写走 api.project.*，权限边界=「已声明的 project 根」，见
 * learn/ops/project 与 electron/base/projectFiles 的双重校验）。
 *
 * 可挂在某份文档之下（树边 from 文档 to 本节点），也可以不挂任何东西（游离）——
 * 授权只看实体在不在，跟挂不挂、挂在哪无关。
 */
export interface ProjectNodeEntity {
  /** 节点宇宙身份（无前缀，与笔记 / 试卷同一款拼法） */
  id: string
  goalId: string
  /** 显示名（卡片标题；与路径无关，纯标签） */
  title: string
  /** 声明的路径本体；空串 = 还没设置（刚落地的空节点） */
  path: string
  /** relative = 相对目标根目录；absolute = 电脑上的绝对路径 */
  pathKind: ProjectPathKind
  createdAt: number
  updatedAt: number
}

/** project 节点的路径拼法 */
export type ProjectPathKind = 'relative' | 'absolute'

/**
 * 文件节点（节点宇宙的游离类型）：绑定一个本地文件或网页文件。
 *
 * - local: 本地文件，只能引用存储在 docs/{目标}/files/ 中的文件（如 files/{文件名}）。
 * - web: 网页文件，没有限制，可以是一个网址。
 * 一个文件节点只能绑定一个文件或网页。
 */
export type FileNodeKind = 'local' | 'web'

export interface FileNodeEntity {
  /** 节点宇宙身份（无前缀，如 file-xxx） */
  id: string
  goalId: string
  /** 节点标题（卡片标题显示名） */
  title: string
  /** 本地文件还是网页文件 */
  fileKind: FileNodeKind
  /**
   * 引用的文件或网址：
   * - local: 必须只引用存储在 docs/{目标}/files/ 下的文件（格式形如 `files/{文件名}`）
   * - web: 网页 URL（如 https://... 或 http://...）
   */
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

  /**
   * 用户是否手动重命名/自定义了标题。
   * 为 false 或 undefined 时，引用文件或打开网页后会自动回填文件名或网页实际 title。
   */
  titleCustomized?: boolean

  createdAt: number
  updatedAt: number
}
