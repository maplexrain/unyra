/**
 * 这个文件负责什么：沙箱类型契约的**browser（内置浏览器）**组——页签快照、页面读取、
 * DOM 交互与截图等各方法的入参/返回，以及宿主实现 BrowserOps（见 learn/web/browserOps）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/** browser.tabs 的元素：一枚存活网页页签的快照 */
export interface BrowserTabInfo {
  tabId: string
  url: string
  title: string
  active: boolean
  /** 页签所在分组格的 id */
  group: string
  /** 来源标识：通过文件节点打开的标记为 'fileNode'，用户主动新开的标记为 'user' */
  source?: 'fileNode' | 'user'
  fileNodeId?: string
  fileNodeTitle?: string
  goalId?: string
}

export type BrowserTarget = number | string

export interface BrowserIndexOpts {
  focus?: BrowserTarget
  target?: BrowserTarget
  maxDepth?: number
  collapse?: boolean
  full?: boolean
  expand?: number[]
}

export interface BrowserIndexResult {
  text: string
  count: number
  title: string
  url: string
  lines?: string[]
  error?: string
}

export interface BrowserTextOpts {
  maxChars?: number
  offset?: number
}

export interface BrowserTextResult {
  ok: boolean
  id: BrowserTarget
  text: string
  totalChars: number
  offset?: number
  hasMore?: boolean
  nextOffset?: number
  error?: string
}

export interface BrowserInspectOpts {
  nth?: number
}

export interface BrowserInspectResult {
  ok: boolean
  id: BrowserTarget
  matchCount?: number
  tag: string
  resolvedTag?: string
  idAttr?: string
  className?: string
  text?: string
  value?: string
  placeholder?: string
  href?: string
  checked?: boolean
  disabled?: boolean
  visible?: boolean
  warning?: string
  isEditable?: boolean
  rect?: { x: number; y: number; width: number; height: number }
  error?: string
}

export interface BrowserClickOpts {
  waitAfterMs?: number
}

export interface BrowserClickResult {
  ok: boolean
  tag?: string
  resolvedTag?: string
  visible?: boolean
  warning?: string
  openedTabId?: string
  navigated?: boolean
  error?: string
}

export interface BrowserFillOpts {
  clear?: boolean
  pressEnter?: boolean
}

export interface BrowserFillResult {
  ok: boolean
  tag?: string
  resolvedTag?: string
  resolvedType?: string
  wrote?: number
  readback?: string
  hint?: string
  error?: string
}

export interface BrowserTypeOpts {
  delayMs?: number
}

export interface BrowserTypeResult {
  ok: boolean
  tag?: string
  resolvedTag?: string
  typedChars?: number
  error?: string
}

export interface BrowserPressResult {
  ok: boolean
  key?: string
  dispatched?: boolean
  warning?: string
  error?: string
}

export interface BrowserScrollOpts {
  to?: 'top' | 'bottom'
  by?: number
  target?: BrowserTarget
}

export interface BrowserScrollResult {
  ok: boolean
  scrollY?: number
  scrollHeight?: number
  atBottom?: boolean
  containerScrollY?: number
  containerScrollHeight?: number
  containerAtBottom?: boolean
  documentScrollY?: number
  documentScrollHeight?: number
  documentAtBottom?: boolean
  error?: string
}

export interface BrowserQueryItem {
  id: number
  tag: string
  cls?: string
  idAttr?: string
  text: string
  href?: string
  value?: string
  placeholder?: string
  visible: boolean
  isEditable: boolean
  rect: { x: number; y: number; width: number; height: number }
}

export interface BrowserQueryOpts {
  limit?: number
}

export interface BrowserQueryResult {
  ok: boolean
  selector: string
  count: number
  matches: BrowserQueryItem[]
  error?: string
}

export interface BrowserWaitForOpts {
  timeoutMs?: number
  timeout?: number
  visible?: boolean
}

export interface BrowserWaitForResult {
  ok: boolean
  elapsedMs: number
  id?: number
  tag?: string
  visible?: boolean
  error?: string
}

export interface BrowserToImageOpts {
  /** 是否自动隔离/隐藏遮挡在目标元素上方的悬浮遮罩、吸顶栏与弹窗（默认 true） */
  isolate?: boolean
  /** 是否截取长内容的完整高度（如超长文章自动分段滚动并无缝拼接为长图，默认 true） */
  full?: boolean
  /** 截图周边留白边距（像素，默认 0） */
  padding?: number
  /** 长图拼接最大总高度限制（默认 16000px，防止无限滚动页面爆内存） */
  maxHeight?: number
  /** 图片保存名称（默认 'DOM元素截图' 或元素描述） */
  name?: string
  /** 导出格式（默认 'png'） */
  format?: 'png' | 'jpeg'
  /** JPEG 质量（1-100，仅 format 为 jpeg 时生效） */
  quality?: number
}

export interface BrowserToImageResult {
  ok: boolean
  url?: string
  uuid?: string
  path?: string
  width?: number
  height?: number
  tag?: string
  selector?: string
  slices?: number
  error?: string
  hint?: string
}

export interface BrowserScreenshotOpts {
  /** 可选：指定截取目标 DOM 元素（ID 或选择器）；若提供则自动按 DOM 元素转长图处理 */
  target?: BrowserTarget
  /** 是否隔离遮挡物（仅指定 target 时生效，默认 true） */
  isolate?: boolean
  /** 是否截取元素完整高度（默认 true） */
  full?: boolean
  /** 截图周边留白边距（像素，默认 0） */
  padding?: number
  /** 长图拼接最大总高度限制（默认 16000px） */
  maxHeight?: number
  /** 自定义名称 */
  name?: string
  path?: string
}

export interface BrowserScreenshotResult {
  ok: boolean
  path?: string
  url?: string
  uuid?: string
  width?: number
  height?: number
  error?: string
}

export interface BrowserToMarkdownOpts {
  /** 可选：直接将转换后的 Markdown 写入指定工作区文件（如 'workspace/article.md'），回执仅回字符数与行数，避免大量文本冲击上下文 */
  saveTo?: string
  maxChars?: number
}

export interface BrowserToMarkdownResult {
  ok: boolean
  markdown?: string
  chars?: number
  lines?: number
  saved?: boolean
  path?: string
  rel?: string
  diagnostics?: {
    images: number
    headings: number
    paragraphs: number
    codeBlocks: number
  }
  note?: string
  error?: string
}

export interface BrowserEvalOpts {
  /** 可选：将代码执行结果直接写入指定文件（如 'workspace/result.json'），回执仅回字符数与行数，避免大量文本冲击上下文 */
  saveTo?: string
}

export interface BrowserEvalResult {
  ok: boolean
  result?: unknown
  saved?: boolean
  path?: string
  rel?: string
  chars?: number
  lines?: number
  note?: string
  error?: string
}

/**
 * 内置浏览器（browser.*）的宿主实现（见 learn/web/browserOps）。
 * 涵盖网页页签生命周期（open / tabs / activate / close）与基础读写（index / text / inspect / click / fill / type / press / scroll / query / waitFor / screenshot / eval）。
 */
export interface BrowserOps {
  /** 开一个网页页签（纯关键词当搜索词处理）；回 tabId，返回时首屏基本加载完 */
  open(url: string): Promise<{ tabId: string; url: string; note?: string }>
  /** 全部存活的网页页签（信封 { tabs }——同组接口一致，别回裸数组） */
  tabs(): { tabs: BrowserTabInfo[] }
  /** 把某个页签切到前台 */
  activate(tabId: string): { ok: true }
  /** 关掉某个页签（不弹确认）；给数组就批量关（试错页签收尾用——用户自己开的别关） */
  close(tabId: string | string[]): { ok: true }
  /** 获取当前页面的压缩语义索引大纲（含 [id] 编号与 Shadow DOM 穿透） */
  index(tabId?: string, opts?: BrowserIndexOpts): Promise<BrowserIndexResult>
  /** 深入读取折叠正文或指定节点的文本（支持长文分段） */
  text(tabId: string | undefined, target: BrowserTarget, opts?: BrowserTextOpts): Promise<BrowserTextResult>
  /** 探测指定节点的详细属性（tag, value, placeholder, href, checked, rect 等，支持 nth 选择器） */
  inspect(tabId: string | undefined, target: BrowserTarget, opts?: BrowserInspectOpts): Promise<BrowserInspectResult>
  /** 自动滚到视口并智能点击指定节点 */
  click(tabId: string | undefined, target: BrowserTarget, opts?: BrowserClickOpts): Promise<BrowserClickResult>
  /** 智能输入文字（支持受控组件、原生组件与富文本框，自带写入自检 readback 防假阳性） */
  fill(tabId: string | undefined, target: BrowserTarget, text: string, opts?: BrowserFillOpts): Promise<BrowserFillResult>
  /** 逐字符按键仿真与 IME 模拟输入（为 B 站、知乎等 Shadow DOM 复杂富文本框量身定制的健壮输入通道） */
  type(tabId: string | undefined, target: BrowserTarget, text: string, opts?: BrowserTypeOpts): Promise<BrowserTypeResult>
  /** 模拟键盘按键（Enter, Escape, Tab, ArrowDown 等） */
  press(tabId: string | undefined, key: string, target?: BrowserTarget): Promise<BrowserPressResult>
  /** 滚动页面或指定局部容器 */
  scroll(tabId?: string, opts?: BrowserScrollOpts): Promise<BrowserScrollResult>
  /** 跨 Shadow DOM 全域检索选择器并返回匹配候选清单（每项带 [id]、text、href、rect、visible 等） */
  query(tabId: string | undefined, selector: string, opts?: BrowserQueryOpts): Promise<BrowserQueryResult>
  /** 智能等待选择器节点或指定文本出现（解决异步加载盲等硬等问题） */
  waitFor(tabId: string | undefined, targetOrText: string, opts?: BrowserWaitForOpts): Promise<BrowserWaitForResult>
  /** 截取当前网页视图并存入静态资源库，返回图片 moji:static 访问地址 */
  screenshot(tabId?: string, opts?: BrowserScreenshotOpts): Promise<BrowserScreenshotResult>
  /** 将指定 DOM 元素（ID 或选择器，穿透 Shadow DOM）转为图片存入资源库；自动消除遮挡层，支持超长文章长图无缝拼接 */
  toImage(tabId: string | undefined, target: BrowserTarget, opts?: BrowserToImageOpts): Promise<BrowserToImageResult>
  /** 别名：elementImage / elementScreenshot 同步支持 */
  elementImage?: (tabId: string | undefined, target: BrowserTarget, opts?: BrowserToImageOpts) => Promise<BrowserToImageResult>
  elementScreenshot?: (tabId: string | undefined, target: BrowserTarget, opts?: BrowserToImageOpts) => Promise<BrowserToImageResult>
  /** 在访客页面上下文中安全执行受控代码并返回 JSON（只读/枚举/透视终极保底武器） */
  /** 将指定 DOM 元素（ID 或选择器，穿透 Shadow DOM）转换为 Markdown 格式文本，尽可能保留图片、公式、表格、排版；支持 saveTo 落盘 */
  toMarkdown(tabId?: string, target?: BrowserTarget, opts?: BrowserToMarkdownOpts): Promise<BrowserToMarkdownResult>
  eval(tabId: string | undefined, code: string, opts?: BrowserEvalOpts): Promise<BrowserEvalResult>
}

