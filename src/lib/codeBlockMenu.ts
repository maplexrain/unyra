/**
 * 代码块右侧的悬浮菜单：**复制**（伪编译与运行已随该功能退役，这里只剩复制）。
 *
 * 为什么是命令式 DOM 而不是 React 组件：它挂进的正是 renderNote 产出的那片 DOM
 * （与图像、注解、静态文件同一层，见 lib/renderPlugins 的 hydrate）。那片 DOM 由
 * MarkdownView 独占管理，React 不碰它；往里塞一个 React 根只会让两边争夺同一片节点。
 */
import { t } from '../i18n'
import { popScale, spawnInkRipple } from './motion'

/** 一块代码的挂载状态：原文与几枚标签的引用 */
interface Block {
  /** 原始代码文本（高亮之后 textContent 仍是原文） */
  text: string
  label: HTMLElement
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

function flash(label: HTMLElement, text: string): void {
  const old = label.textContent ?? ''
  label.textContent = text
  window.setTimeout(() => {
    // 这一小会儿里别的东西改过标题就别抢回来
    if (label.textContent === text) label.textContent = old
  }, 1200)
}

async function doCopy(b: Block): Promise<void> {
  try {
    await navigator.clipboard.writeText(b.text)
    flash(b.label, t('已复制'))
    popScale(b.label)
  } catch {
    flash(b.label, t('复制失败'))
  }
}

function mount(pre: HTMLElement, code: HTMLElement): Block {
  const wrap = el('div', 'moji-run-block')
  const menu = el('div', 'moji-run-menu')
  menu.setAttribute('role', 'toolbar')
  menu.setAttribute('aria-label', t('代码块操作'))
  const btn = el('button', 'moji-run-btn moji-press')
  btn.type = 'button'
  btn.dataset.act = 'copy'
  const label = el('span', 'moji-run-label', t('复制'))
  btn.append(label)
  menu.append(btn)

  const block: Block = { text: code.textContent ?? '', label, disposed: false }
  btn.addEventListener('click', (e) => { spawnInkRipple(e); void doCopy(block) })

  pre.dataset.mojiRun = 'done'
  const parent = pre.parentElement
  if (parent) parent.insertBefore(wrap, pre)
  wrap.append(pre, menu)
  return block
}

/**
 * 挂载 root 里所有代码块的复制菜单；返回清理函数（与其它 hydrate 同一契约）。
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
  return () => {
    for (const b of blocks) b.disposed = true
  }
}
