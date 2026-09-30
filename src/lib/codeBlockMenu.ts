/**
 * 代码块右侧的悬浮菜单：复制 / 编译 / 运行，外加代码块下面那条**运行输出**。
 *
 * 三颗按钮各归各家（这是需求里定死的分工）：
 * - **复制**：一直可用，复制的是代码原文（高亮不改 textContent）。
 * - **编译**：不是在这里发模型请求，而是**请超级导师跑一条工作流**（见 learn/workflows 的
 *   「伪编译」）——指令以一条 user 消息进对话，导师自己读这篇文档补上下文、自己转译、
 *   自己在对话里说明结果，产物用 api.code.save 交回宿主。菜单只做两件事：把代码交出去、
 *   在导师交货之前转圈（等产物表变化，见 lib/codeArtifacts 的订阅）。
 * - **运行**：默认灰着，**有产物才亮**；跑在一个一次性 Worker 沙箱里（见 lib/codeRun），
 *   输出就贴在代码块下面——这一栏**只放运行输出**，编译的说明与产物都在对话那一侧，
 *   那是它们该在的地方。
 *
 * 为什么是命令式 DOM 而不是 React 组件：它挂进的正是 renderNote 产出的那片 DOM
 * （与图像、注解、静态文件同一层，见 lib/renderPlugins 的 hydrate）。那片 DOM 由
 * MarkdownView 独占管理，React 不碰它；往里塞一个 React 根只会让两边争夺同一片节点。
 * 唯一需要 React 的是联网确认框，那一个由 lib/modalConfirm 临时挂。
 *
 * 产物按「语言 + 代码内容」寻址（见 lib/codeArtifacts）：所以代码一改，产物就自动
 * 对不上了，按钮自己变回「编译」——不需要谁去手动清状态。
 */
import { t } from '../i18n'
import {
  artifactFor,
  artifactKey,
  beginCompile,
  dropCompile,
  isCompiling,
  loadArtifacts,
  silentFor,
  subscribeArtifacts,
} from './codeArtifacts'
import type { CodeArtifact } from './native'
import { languageOfClass } from './codeHighlight'
import { codeHost, subscribeCodeHost } from './docHost'
import { runCompiledJs, type RunLine } from './codeRun'
import { askConfirm } from './modalConfirm'

/** 输出栏里最多画多少行（产物可能打印几千行，全画出来只会把滚动条撑爆） */
const MAX_SHOWN_LINES = 400

/**
 * 「等导师交货」的上限。超了就停止转圈、把这笔登记丢掉。
 * 为什么要有：交货是对话那一侧的事，模型完全可能只写了说明却忘了调 api.code.save；
 * 没有这道闸，那颗按钮就会一直转下去，用户以为还在编、其实早就没人在干活了。
 */
const COMPILE_WAIT_MS = 3 * 60 * 1000

interface BlockState {
  /** 伪编译产物（内存里那一份，与磁盘一致） */
  artifact?: CodeArtifact
  /** 此刻在忙什么：运行；idle 就是闲着（编译忙不忙看产物表的待编译登记） */
  mode: 'idle' | 'run'
  /** 运行失败的一句话 */
  error: string
  /** 运行输出 */
  lines: RunLine[]
}

interface Block {
  wrap: HTMLElement
  /** 原始代码文本（复制与编译都用它；高亮之后 textContent 仍是原文） */
  text: string
  languageId: string | null
  key: string
  state: BlockState
  label: { copy: HTMLElement; compile: HTMLElement; run: HTMLElement }
  btn: { copy: HTMLButtonElement; compile: HTMLButtonElement; run: HTMLButtonElement }
  out: HTMLElement
  abort: AbortController | null
  /** 「等交货」的定时器 */
  wait: number | null
  /** 「无输出」那枚标签（导师判定之后替代编译与运行出现） */
  badge: HTMLElement
  disposed: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function makeButton(cls: string, label: string): { btn: HTMLButtonElement; label: HTMLElement; spin: HTMLElement } {
  const btn = el('button', cls)
  btn.type = 'button'
  const text = el('span', 'moji-run-label', label)
  const spin = el('span', 'moji-run-spin')
  spin.setAttribute('aria-hidden', 'true')
  btn.append(spin, text)
  return { btn, label: text, spin }
}

/** 忙碌时那颗按钮上的转圈：只加一个类，动画交给 CSS */
function setBusy(btn: HTMLButtonElement, busy: boolean): void {
  btn.classList.toggle('is-busy', busy)
  if (busy) btn.setAttribute('aria-busy', 'true')
  else btn.removeAttribute('aria-busy')
}

function flash(label: HTMLElement, text: string): void {
  const old = label.textContent ?? ''
  label.textContent = text
  window.setTimeout(() => {
    // 这一小会儿里别的东西改过标题就别抢回来
    if (label.textContent === text) label.textContent = old
  }, 1200)
}

/** 把这一块的状态画到 DOM 上。所有会变的地方都收在这一个函数里 */
function render(b: Block): void {
  /*
   * 「无输出」是**导师判定**的结论（它看过代码之后调 api.code.silent，见 lib/codeArtifacts）。
   * 一旦判定：编译与运行两颗按钮直接收起，只留复制与那枚标签——而且从此不再出现
   * （标记落了盘，重启也还在；那块代码改了内容才会失效，因为标记是按内容寻址的）。
   */
  const mark = silentFor(b.key, b.text, b.languageId)
  b.btn.compile.hidden = !!mark
  b.btn.run.hidden = !!mark
  b.badge.hidden = !mark
  if (mark) {
    b.badge.title = mark.reason
      ? t('导师判定这段代码没有输出：{0}', mark.reason)
      : t('导师判定这段代码没有输出（跑起来不会有任何东西可看）')
    b.btn.copy.disabled = false
    b.out.hidden = true
    return
  }
  const s = b.state
  const compiling = isCompiling(b.key)
  const running = s.mode === 'run'
  // 有产物才有「重新编译」这一说；正在等交货的那一轮，按钮转圈且点不动
  b.label.compile.textContent = compiling ? t('编译中') : s.artifact ? t('重新编译') : t('编译')
  b.btn.compile.classList.toggle('is-recompile', !!s.artifact && !compiling)
  b.btn.compile.disabled = compiling || running || !codeHost()
  if (!codeHost()) b.btn.compile.title = t('这里没有超级导师的上下文（在文档区里才能编译）')
  else b.btn.compile.removeAttribute('title')
  b.btn.run.disabled = running || compiling || !s.artifact
  b.btn.copy.disabled = false
  setBusy(b.btn.compile, compiling)
  setBusy(b.btn.run, running)

  const hasOutput = !!(s.error || s.lines.length || running)
  b.out.hidden = !hasOutput
  if (!hasOutput) {
    b.out.replaceChildren()
    return
  }

  const head = el('div', 'moji-run-head')
  head.appendChild(el('span', 'moji-run-title', t('运行输出')))
  const close = el('button', 'moji-run-mini', t('收起'))
  close.type = 'button'
  close.addEventListener('click', () => {
    s.error = ''
    s.lines = []
    render(b)
  })
  head.appendChild(close)

  const body = el('div', 'moji-run-body')
  if (s.error) body.appendChild(el('div', 'moji-run-line lv-error', s.error))
  const shown = s.lines.slice(-MAX_SHOWN_LINES)
  if (s.lines.length > shown.length) {
    body.appendChild(el('div', 'moji-run-stage', t('（前面还有 {0} 行没显示）', s.lines.length - shown.length)))
  }
  for (const line of shown) {
    body.appendChild(el('div', 'moji-run-line lv-' + line.level, line.text))
  }
  if (running && !s.lines.length) body.appendChild(el('div', 'moji-run-stage', t('正在跑…')))

  b.out.replaceChildren(head, body)
}

/* ---------- 三件事 ---------- */

async function doCopy(b: Block): Promise<void> {
  try {
    await navigator.clipboard.writeText(b.text)
    flash(b.label.copy, t('已复制'))
  } catch {
    flash(b.label.copy, t('复制失败'))
  }
}

/**
 * 编译：把这段代码交给超级导师的工作流，然后等产物回来。
 *
 * 登记与交付都由 lib/codeArtifacts 管：这里只负责「登一笔、请人干活、等通知」。
 * 已有产物时再点一次就是重新编译（产物按内容寻址，键不变，新的会覆盖旧的）——
 * **不先删旧的**：万一这次编失败，用户手上那份还能跑。
 */
function doCompile(b: Block): void {
  if (isCompiling(b.key) || b.state.mode === 'run') return
  // 已经判定无输出的块不再编译（按钮藏起来了，这一句是防它从别处被触发）
  if (silentFor(b.key, b.text, b.languageId)) return
  const host = codeHost()
  if (!host) return
  const key = beginCompile(b.text, b.languageId)
  host.compile({ key, code: b.text, languageId: b.languageId })
  // 交货之前一直转圈；超时就把这笔登记丢掉（见 COMPILE_WAIT_MS 的说明）
  if (b.wait !== null) window.clearTimeout(b.wait)
  b.wait = window.setTimeout(() => {
    b.wait = null
    if (b.disposed) return
    dropCompile(key)
    render(b)
  }, COMPILE_WAIT_MS)
  render(b)
}

/** 这次运行里用户对联网的回答；问过一次就不再问（「每次运行确认一次」） */
function networkAsker(): (url: string) => Promise<boolean> {
  let answered: boolean | null = null
  return async (url: string) => {
    if (answered !== null) return answered
    const ok = await askConfirm({
      title: t('这段代码要联网'),
      message: t(
        '它想访问：\n{0}\n\n同意之后，本次运行里后续的联网请求都会一并放行。\n代码是 AI 转译出来的，请确认上面这个地址你认识。',
        url,
      ),
      confirmLabel: t('允许本次运行'),
    })
    answered = ok
    return ok
  }
}

async function doRun(b: Block): Promise<void> {
  const s = b.state
  if (s.mode !== 'idle' || !s.artifact) return
  s.mode = 'run'
  s.error = ''
  s.lines = []
  render(b)

  const controller = new AbortController()
  b.abort = controller
  const res = await runCompiledJs(s.artifact.js, {
    onLine: (line) => {
      if (b.disposed) return
      s.lines.push(line)
      render(b)
    },
    askNetwork: networkAsker(),
    signal: controller.signal,
  })
  b.abort = null
  if (b.disposed) return
  s.mode = 'idle'
  // 失败且输出里没有解释（超时、语法错误这类）：补一句，否则用户只看见「没反应」
  if (!res.ok && res.error && !s.lines.some((l) => l.level === 'error')) {
    s.lines.push({ level: 'error', text: res.error })
  }
  if (res.net === 'denied') {
    s.lines.push({ level: 'sys', text: t('（联网被拒绝，代码可能在等数据）') })
  }
  render(b)
}

/* ---------- 挂载 ---------- */

function mount(pre: HTMLElement, code: HTMLElement): Block {
  const text = code.textContent ?? ''
  const languageId = languageOfClass(code.className)
  const key = artifactKey(text, languageId)

  const wrap = el('div', 'moji-run-block')
  const menu = el('div', 'moji-run-menu')
  menu.setAttribute('role', 'toolbar')
  menu.setAttribute('aria-label', t('代码块操作'))
  const copy = makeButton('moji-run-btn', t('复制'))
  const compile = makeButton('moji-run-btn', t('编译'))
  const run = makeButton('moji-run-btn', t('运行'))
  copy.btn.dataset.act = 'copy'
  compile.btn.dataset.act = 'compile'
  run.btn.dataset.act = 'run'
  // 三颗按钮与那枚标签一直挂在菜单里，显示哪一个由 render 按「有没有被判定无输出」决定
  const badge = el('span', 'moji-run-none', t('无输出'))
  menu.append(copy.btn, compile.btn, run.btn, badge)
  const out = el('div', 'moji-run-out')
  out.hidden = true

  const block: Block = {
    wrap,
    text,
    languageId,
    key,
    state: { mode: 'idle', error: '', lines: [] },
    label: { copy: copy.label, compile: compile.label, run: run.label },
    btn: { copy: copy.btn, compile: compile.btn, run: run.btn },
    out,
    abort: null,
    wait: null,
    badge,
    disposed: false,
  }

  // 已经有产物（这次启动里编过、或者上次留下的）：直接亮起运行
  const known = artifactFor(key, text, languageId)
  if (known) block.state.artifact = known

  copy.btn.addEventListener('click', () => void doCopy(block))
  compile.btn.addEventListener('click', () => doCompile(block))
  run.btn.addEventListener('click', () => void doRun(block))

  pre.dataset.mojiRun = 'done'
  const parent = pre.parentElement
  if (parent) parent.insertBefore(wrap, pre)
  wrap.append(pre, menu, out)
  render(block)
  return block
}

/**
 * 挂载 root 里所有代码块的菜单；返回清理函数（与其它 hydrate 同一契约）。
 *
 * 产物表是异步拉的（要读磁盘），因此挂完还要补一次 render；此后每次产物变动都由
 * 订阅推着重画——「导师交货了」这件事只有那条通知知道。
 */
export function hydrateCodeRun(root: HTMLElement): () => void {
  const blocks: Block[] = []
  for (const pre of Array.from(root.querySelectorAll<HTMLElement>('pre'))) {
    if (pre.dataset.mojiRun) continue
    const code = pre.querySelector('code')
    if (!code) continue
    try {
      blocks.push(mount(pre, code as HTMLElement))
    } catch (err) {
      console.warn('[coderun] 代码块菜单挂不上', err)
    }
  }
  const refresh = (): void => {
    for (const b of blocks) {
      if (b.disposed) continue
      const hit = artifactFor(b.key, b.text, b.languageId)
      if (hit && hit !== b.state.artifact) {
        b.state.artifact = hit
        // 交货了：等交货的定时器可以撤了
        if (b.wait !== null) {
          window.clearTimeout(b.wait)
          b.wait = null
        }
      }
      render(b)
    }
  }
  if (blocks.length) {
    void loadArtifacts().then(refresh)
    const off = subscribeArtifacts(refresh)
    // 宿主（学习区）可能比菜单晚一步注册：它一上线就要把「编译」放开
    const offHost = subscribeCodeHost(refresh)
    return () => {
      off()
      offHost()
      for (const b of blocks) {
        b.disposed = true
        if (b.wait !== null) window.clearTimeout(b.wait)
        // 在跑的沙箱要停：它占着 CPU，而输出已经没人看了
        if (b.state.mode === 'run') b.abort?.abort()
      }
    }
  }
  return () => {
    for (const b of blocks) b.disposed = true
  }
}
