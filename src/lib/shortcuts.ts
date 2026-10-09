/**
 * 快捷键模块：注册、改键、重置、冲突检测。
 *
 * 组合键本身的解析与显示在 lib/keyCombo（纯函数、不依赖 React）；
 * 这一层管的是「谁登记了哪个组合、按下时该叫醒谁」。三条设计取舍：
 *
 * 1. **只有一个全局监听**。模块自己挂一对 document 上的 keydown / keyup，
 *    各功能通过 subscribeShortcut 登记回调——而不是每个功能各自 addEventListener。
 *    这样「谁占了这个组合」只有一个地方说得清，冲突检测才有意义；
 *    监听是懒挂的：一个订阅都没有的时候不装监听器。
 *
 * 2. **组合键用字符串存**（`Ctrl+Shift+K`），不是对象。setting.yaml 是给人看的，
 *    字符串最直白；解析/格式化都收在 lib/keyCombo 里，外部只见字符串。
 *
 * 3. **按住型与点按型共用一套**。回调分成 down / up 两个，点按型只用 down 就行
 *    （up 传不传随意）。自动重复（长按一个键时的连续 keydown）一律忽略，
 *    否则「按住」类功能会不停重启。
 *
 * 还有一条规矩写在 shouldFire：**焦点在输入框里时，不带修饰键的组合不触发**。
 * 否则把某个功能绑到「K」上之后，聊天框里就打不出这个字母了。
 */

import { t } from '../i18n'
import { readUserSettings, writeUserSettings } from './userSettings'
import {
  canonicalCombo,
  comboFromEvent,
  comboLabel,
  formatCombo,
  normalizeKeyName,
  parseCombo,
  type KeyCombo,
} from './keyCombo'

/*
 * 组合键那几个纯函数从这里转出去：调用方（设置面板、按键浮层）只认 lib/shortcuts 这一个门，
 * 不必知道它们其实住在 keyCombo 里。
 */
export {
  canonicalCombo,
  comboFromEvent,
  comboLabel,
  formatCombo,
  keyLabel,
  normalizeKeyName,
  parseCombo,
} from './keyCombo'
export type { KeyCombo } from './keyCombo'

export interface ShortcutDef {
  id: string
  /** 设置面板里显示的名字 */
  label: string
  /** 一句话说明它是干什么的 */
  hint: string
  /** 默认组合（规范写法，见 formatCombo） */
  def: string
}

/**
 * 全部可注册的快捷键。**加功能就在这里加一条**，设置面板与运行时都读它。
 * id 是存储用的键，一旦发布就别改（改了等于把用户的改键丢掉）。
 */
export const SHORTCUT_DEFS: ShortcutDef[] = [

  {
    id: 'learn.save',
    label: '保存文档',
    hint: '把当前这份文档保存下来：源码视图里的改动先进暂存区，这一下才写进文档（本地文件写回原文件）',
    def: 'Ctrl+S',
  },
  {
    id: 'doc.find',
    label: '文档内查找',
    hint: '在文档区打开查找条，命中处会被标出来（预览与源码都支持）',
    def: 'Ctrl+F',
  },
  {
    id: 'doc.replace',
    label: '文档内替换',
    hint: '打开查找条并展开替换行；替换只在源码视图里可用（预览是只读的）',
    def: 'Ctrl+H',
  },
  {
    id: 'doc.export',
    label: '导出文档',
    hint: '把当前这份文档导出成 Markdown 源文件、HTML 网页或 PDF',
    def: 'Ctrl+E',
  },
  {
    id: 'learn.closeTab',
    label: '关闭当前标签页',
    hint: '关掉焦点那一格里正看着的页签；有没保存的改动时照旧先问一声（同页签上那颗 ×）',
    def: 'Ctrl+W',
  },
  {
    id: 'agent.focus',
    label: '收起 / 展开右侧栏',
    hint: '右侧那一栏在收起与展开之间切换；它装着导师时，展开后光标直接落到导师的输入框里',
    def: 'Ctrl+Q',
  },
  {
    id: 'doc.zen',
    label: '纯净阅读模式',
    hint: '收起两侧栏、页签栏与顶栏，只留正文；再按一次退出，Esc 也能退出（文档区右上角那颗按钮是同一件事）',
    def: 'F11',
  },
  {
    id: 'web.newTab',
    label: '新建网页页签',
    hint: '在焦点格里开一个网页页签（内置浏览器）；焦点已经在网页页签上时，把光标挪到它的地址栏',
    def: 'Ctrl+L',
  },
]

/**
 * 占用的组合：系统或应用本来就要用的，不许绑。
 * 不拦的话用户会把复制绑掉，然后以为是程序坏了。
 */
const RESERVED: Array<{ combo: string; why: string }> = [
  { combo: 'Ctrl+C', why: '复制' },
  { combo: 'Ctrl+V', why: '粘贴' },
  { combo: 'Ctrl+X', why: '剪切' },
  { combo: 'Ctrl+A', why: '全选' },
  { combo: 'Ctrl+Z', why: '撤销' },
  { combo: 'Ctrl+Y', why: '重做' },
  { combo: 'Ctrl+F', why: '查找' },
  { combo: 'Ctrl+H', why: '替换' },
  { combo: 'Ctrl+E', why: '导出文档' },
  { combo: 'Ctrl+P', why: '打印' },
  { combo: 'Ctrl+R', why: '重新加载窗口' },
  { combo: 'Ctrl+Shift+R', why: '重新加载窗口' },
  { combo: 'Ctrl+Shift+I', why: '开发者工具' },
  { combo: 'F12', why: '开发者工具' },
  { combo: 'Alt+F4', why: '关闭窗口' },
  { combo: 'Escape', why: '关闭当前弹窗' },
]

/* ---------- 状态（内存 + setting.yaml） ---------- */

/** id → 组合串；缺省用 def。载入时归一一次，坏值直接丢掉 */
let bindings: Record<string, string> = {}

function normalizeBindings(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  const known = new Set(SHORTCUT_DEFS.map((d) => d.id))
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(id) || typeof value !== 'string') continue
    const combo = canonicalCombo(value)
    if (combo) out[id] = combo
  }
  return out
}

/** 启动 / 切换用户时调用（见 lib/boot）；未登录时回到全默认 */
export function refreshShortcuts(): void {
  bindings = normalizeBindings(readUserSettings('shortcuts'))
}

/** 当前的组合串：没改过就是默认值 */
export function bindingOf(id: string): string {
  const def = SHORTCUT_DEFS.find((d) => d.id === id)
  if (!def) return ''
  return bindings[id] ?? def.def
}

function commit(): void {
  writeUserSettings('shortcuts', bindings)
}

/** 占了同一个组合的另一条（返回 id 与名字） */
function conflictWith(id: string, combo: string): { id: string; label: string } | null {
  for (const def of SHORTCUT_DEFS) {
    if (def.id === id) continue
    if (bindingOf(def.id) === combo) return { id: def.id, label: def.label }
  }
  return null
}

function reservedWith(combo: string): string | null {
  const hit = RESERVED.find((r) => r.combo === combo)
  return hit ? hit.why : null
}

export interface ShortcutRow extends ShortcutDef {
  combo: string
  /** 改过没有（设置面板据此显示「重置」） */
  custom: boolean
  /** 与谁撞了（正常情况下是空——设值时就会拦住；这里兜手工改坏的设置文件） */
  conflict: string | null
}

export function shortcutRows(): ShortcutRow[] {
  return SHORTCUT_DEFS.map((def) => {
    const combo = bindingOf(def.id)
    const other = conflictWith(def.id, combo)
    return { ...def, combo, custom: combo !== def.def, conflict: other ? other.label : null }
  })
}

export type SetShortcutResult = { ok: true } | { ok: false; error: string }

/** 改键。冲突与占用一律当场拒绝——让用户换一个，而不是先存下再说 */
export function setShortcut(id: string, raw: string): SetShortcutResult {
  const def = SHORTCUT_DEFS.find((d) => d.id === id)
  if (!def) return { ok: false, error: t('没有这个快捷键') }
  const combo = canonicalCombo(raw)
  if (!combo) return { ok: false, error: t('至少要有一个主键，例如 Ctrl+K') }
  const parsed = parseCombo(combo) as KeyCombo
  const hasMod = parsed.ctrl || parsed.alt || parsed.meta
  const fkey = /^F\d{1,2}$/.test(parsed.key)
  if (!hasMod && !fkey) {
    return { ok: false, error: t('请带上 Ctrl / Alt / Win，或改用 F1~F12——单独一个字母会和打字冲突') }
  }
  /*
   * 被占用的组合不许绑——**除非那就是它自己的默认值**：
   * 「文档内查找」默认就是 Ctrl+F，而 Ctrl+F 又在占用表里（占用表拦的是「别人来抢」）。
   * 不多这一句的话，用户改走再想改回来会被自己拦下，提示还写着「Ctrl+F 是查找用的」。
   * 报错在这里拼好（显示侧拿到的就是成品），占用原因与冲突名也各自过一遍 t()。
   */
  const why = reservedWith(combo)
  if (why && def.def !== combo)
    return { ok: false, error: t('{0} 是「{1}」用的，换一个', comboLabel(combo), t(why)) }
  const other = conflictWith(id, combo)
  if (other) return { ok: false, error: t('和「{0}」撞了，换一个', t(other.label)) }
  bindings = { ...bindings, [id]: combo }
  commit()
  return { ok: true }
}

/** 重置一条 */
export function resetShortcut(id: string): void {
  const def = SHORTCUT_DEFS.find((d) => d.id === id)
  if (!def || !(id in bindings)) return
  const next = { ...bindings }
  delete next[id]
  bindings = next
  commit()
}

/** 全部重置 */
export function resetAllShortcuts(): void {
  bindings = {}
  commit()
}

/* ---------- 运行时 ---------- */

export interface ShortcutHandlers {
  /** 按下。自动重复不会重复调用 */
  down?: (e: KeyboardEvent) => void
  /** 松开（按住型用；点按型可以不传） */
  up?: (e: KeyboardEvent) => void
}

const handlers = new Map<string, ShortcutHandlers>()
/** 正按着的：id → 当时的组合。keyup 时靠它决定该结束谁 */
const active = new Map<string, KeyCombo>()
let listening = false

/** 焦点在能打字的地方吗（输入框、文本域、可编辑区域） */
function typingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * 这次事件该不该触发。
 * 唯一的例外写在上面：正在打字时，不带 Ctrl/Alt/Win 的组合一律放过（让键照常进输入框）。
 *
 * **F1~F12 是第二条例外**：功能键不会往输入框里落字，而它们绑的多半是「整个界面的事」
 * （纯净阅读、开发者工具这类）。光标恰好在源码编辑器或对话输入框里时按不动 F11，
 * 用户只会以为这个快捷键坏了。这与 setShortcut 放行单独绑 F 键是同一条口径
 * （见那里「或改用 F1~F12」那句）。
 */
function shouldFire(combo: KeyCombo): boolean {
  if (!typingTarget()) return true
  if (combo.ctrl || combo.alt || combo.meta) return true
  return /^F\d{1,2}$/.test(combo.key)
}

/**
 * macOS 上把绑定里的 Ctrl 当 Cmd 使：Windows 上的习惯写法是 Ctrl+S，Mac 上按的是 Cmd+S，
 * 两边都该响。只换主修饰键，Shift/Alt 不动（Cmd+Shift+I 与 Ctrl+Shift+I 是两回事）。
 */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

function idsFor(combo: KeyCombo): string[] {
  const wanted = new Set([formatCombo(combo)])
  if (IS_MAC) wanted.add(formatCombo({ ...combo, ctrl: combo.meta, meta: combo.ctrl }))
  return SHORTCUT_DEFS.filter((d) => handlers.has(d.id) && wanted.has(bindingOf(d.id))).map((d) => d.id)
}

function releaseAll(e?: KeyboardEvent): void {
  for (const [id, combo] of [...active]) {
    active.delete(id)
    const h = handlers.get(id)
    if (h?.up) h.up(e ?? new KeyboardEvent('keyup', { key: combo.key }))
  }
}

/** 设置面板的「按一下新组合」正在录键：这期间一律不触发、也不拦事件 */
let recording = false

export function setShortcutRecording(on: boolean): void {
  recording = on
}

function onKeyDown(e: KeyboardEvent): void {
  if (recording) return
  const combo = comboFromEvent(e)
  if (!combo || !shouldFire(combo)) return
  const ids = idsFor(combo)
  if (!ids.length) return
  // 认领这次事件：不 preventDefault 的话，Ctrl+S 之类会被浏览器/外壳顺手做掉
  e.preventDefault()
  e.stopPropagation()
  for (const id of ids) {
    if (active.has(id)) continue
    active.set(id, combo)
    handlers.get(id)?.down?.(e)
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (!active.size) return
  const released = normalizeKeyName(e.key)
  const modsUp = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey
  for (const [id, combo] of [...active]) {
    // 松开主键，或者修饰键先松（四个都松了）——都算这次「按住」结束
    if (released === combo.key || (modsUp && released === null)) {
      active.delete(id)
      handlers.get(id)?.up?.(e)
    }
  }
}

function onBlur(): void {
  // 切走窗口时 keyup 收不到：不收尾的话「按住说话」会一直录下去
  releaseAll()
}

function ensureListening(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', onBlur)
}

function maybeStopListening(): void {
  if (!listening || handlers.size) return
  listening = false
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('keyup', onKeyUp, true)
  window.removeEventListener('blur', onBlur)
}

/** 登记一个快捷键；返回取消登记的函数。同一个 id 可以登记多份（都收得到） */
export function subscribeShortcut(id: string, h: ShortcutHandlers): () => void {
  handlers.set(id, h)
  ensureListening()
  return () => {
    handlers.delete(id)
    active.delete(id)
    maybeStopListening()
  }
}

/*
 * 这里没有 useShortcut：React 那个包装在 lib/useShortcut 里。
 * 分开是为了让本文件保持「不依赖 React」——Node 探针（scripts/agent-ops.test.ts）
 * 要 import 注册表与纯函数，把 React 拖进去它就跑不起来了。
 */

/** 测试用：清掉运行时状态（设置面板的「全部重置」走的是 resetAllShortcuts） */
export function __resetRuntime(): void {
  releaseAll()
  handlers.clear()
  maybeStopListening()
}