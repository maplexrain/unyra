/**
 * 全局命令输入栏（GlobalVimCommandBar）的**唤起通道**，以及编辑器 Vim 命令行的**接管桥**。
 *
 * 为什么要有这一层：命令输入框现在**只有一份**（挂在 App 上的 GlobalVimCommandBar）——
 * 编辑页面里按 `:`、非编辑页面按 Shift+:，唤出的都是它。但命令栏是 React 组件，
 * `:` 的唤起方却有两处（窗口键盘监听、编辑器里的 vim 扩展），组件状态够不着——
 * 于是走 agentFocus / explorerFocus 同一根模块级的线。
 *
 * 编辑器那半边（installVimPromptBridge）：@replit/codemirror-vim 收到 `:` 后经
 * showPrompt 调 `cm.openDialog(template, callback, options)` 打开它自己的 `.cm-vim-panel`。
 * 这里在 view 上**覆写实例方法**接管这一步（'/' 搜索提示照旧回落原生面板）：
 * - Enter：把文本交回 vim 的 callback → processCommand → 我们注册的那批 Ex 命令执行
 *   （执行与收尾自清，命令栏不重复执行）；
 * - 取消（Esc / 空输入回格）：借 vim 自己传下来的 onKeyDown 走它的 Esc 分支
 *   （pushInput + clearInputState + 关面板 + 焦点回编辑器），不留卡死的命令行状态。
 */
import type { EditorView } from '@codemirror/view'

/** 唤起命令栏时带的参数 */
export interface CommandBarOpenOpts {
  /** 预填的命令文本（vim 提示符带值时用：可视模式的 '<,'>、重复前缀） */
  prefill?: string
  /**
   * 有它 = 编辑器 Vim 命令行正等着输入（命令栏处于「提示符模式」）：
   * Enter 时命令栏**不自己执行**，把最终文本交回给它（input: string = 执行，undefined = 取消）。
   */
  onFinish?: (input?: string) => void
}

let opener: ((opts?: CommandBarOpenOpts) => void) | null = null

/** 登记唤起实现（由 GlobalVimCommandBar 注入）；传 null 注销 */
export function setGlobalCommandBarOpener(fn: ((opts?: CommandBarOpenOpts) => void) | null): void {
  opener = fn
}

/** 唤起全局命令栏；没人接（理论上有 App 常驻就有人接）时静默跳过 */
export function openGlobalCommandBar(opts?: CommandBarOpenOpts): void {
  opener?.(opts)
}

/** 模板 textContent 以 ':' 开头 = vim 的冒号命令行提示符（'/' 搜索提示不以它开头） */
function isCmdlineTemplate(template: unknown): boolean {
  const text =
    typeof (template as { textContent?: string } | null | undefined)?.textContent === 'string'
      ? (template as { textContent: string }).textContent.trim()
      : ''
  return text.startsWith(':')
}

/** 足以被 vimKeyFromEvent 认成 Esc 的最小事件（e_stop 只摸 preventDefault / stopPropagation） */
function fakeEscapeEvent(): KeyboardEvent {
  const e = { key: 'Escape', preventDefault() {}, stopPropagation() {} }
  return e as unknown as KeyboardEvent
}

/**
 * 给编辑器的 view 装上命令行接管桥。装过就跳过（幂等）；
 * view 上没有 vim 适配实例（没挂 vim() 扩展）也安静退出。
 */
export function installVimPromptBridge(view: EditorView): void {
  const cm = (view as unknown as { cm?: Record<string, unknown> }).cm
  if (!cm || typeof cm.openDialog !== 'function') return
  const slot = cm as { openDialog?: unknown; __mojiPromptBridge?: boolean }
  if (slot.__mojiPromptBridge) return
  const nativeOpenDialog = (cm.openDialog as (
    template: unknown,
    callback?: (input?: string) => void,
    options?: VimDialogOptions,
  ) => unknown).bind(cm)
  slot.__mojiPromptBridge = true
  slot.openDialog = (template: unknown, callback?: (input?: string) => void, options?: VimDialogOptions): unknown => {
    // '/' 搜索提示与其它对话框照旧走原生面板，只接管冒号命令行
    if (!isCmdlineTemplate(template)) {
      return nativeOpenDialog(template, callback, options)
    }
    let done = false
    const finish = (input?: string): void => {
      if (done) return
      done = true
      if (typeof input === 'string' && callback) {
        // 交回 vim：processCommand 执行我们注册的 Ex 命令，收尾（clearInputState）在那条路里自带
        try {
          callback(input)
        } catch {
          // vim 内部对坏输入自己兜底，这里不吞上下文
        }
        try {
          view.focus()
        } catch {
          // 焦点回不去就算了
        }
        return
      }
      // 取消：借 vim 自己的 onKeyDown 走 Esc 分支（清命令行状态、关面板），再把焦点还编辑器
      try {
        options?.onKeyDown?.(fakeEscapeEvent(), '', () => {})
      } catch {
        // 同上，取消路径不抛
      }
      try {
        view.focus()
      } catch {
        // 同上
      }
    }
    openGlobalCommandBar({
      prefill: typeof options?.value === 'string' ? options.value : '',
      onFinish: finish,
    })
    // 原生面板的 close 返回值在 vim 里无人使用
    return () => {}
  }
}

/** vim 的 showPrompt 传给 openDialog 的 options（本桥用到的字段） */
interface VimDialogOptions {
  value?: string
  onKeyDown?: (e: KeyboardEvent, input: string, close: (newVal?: string) => void) => boolean | void
  onKeyUp?: (e: KeyboardEvent, input: string, close: (newVal?: string) => void) => boolean | void
  onClose?: (dialog: unknown) => void
  bottom?: boolean
  selectValueOnOpen?: boolean
}
