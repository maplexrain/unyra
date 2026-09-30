/** 这个文件负责：注解浮层——「了解 / 笔记」气泡的内容拼装、定位、显隐、「修改 / 删除」回调，以及正文根上的事件接线。 */

import type { Annotation, AnnotationKind } from '../../learn/types'
import { t } from '../../i18n'
import { renderInline, renderNote } from '../markdown'
import { applyAnnotation } from './dom'
import { HOLE_SELECTOR } from './selectors'

/** 注解浮层的操作回调（笔记才有）；由上层注入，解绑时清除 */
export interface AnnotationActions {
  onEdit?: (term: string) => void
  onDelete?: (term: string) => void
}

/**
 * 「修改 / 删除」两个**文字按钮**：动作叫什么就写什么。
 *
 * 浮层是命令式拼出来的 HTML（不走 React），但这里不需要图标——两个词比两个
 * 图形好认，也与「注解本身是文字」的样子同一套语言（见 annotation.css）。
 * 文案在调用时经 t() 求值（原先是模块顶层的常量，会把语言冻结在 import 那一刻）。
 */
function actionsHtml(): string {
  return (
    '<span class="moji-anno-acts">' +
    `<button type="button" data-act="edit" title="${t('修改这条笔记')}" aria-label="${t('修改这条笔记')}">${t('修改')}</button>` +
    `<button type="button" data-act="delete" title="${t('删除这条笔记')}" aria-label="${t('删除这条笔记')}">${t('删除')}</button>` +
    '</span>'
  )
}

/** 能「收在末尾」的文字容器：按钮挂进最后一个这样的元素，才跟得上最后一行字 */
const TEXT_HOSTS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption'
/** 继续往里找的容器（列表项、引用里的段落等） */
const CONTAINER_HOSTS = 'ul, ol, div, section, article, details'

/**
 * 找到「内容末尾」那个能放行内元素的宿主。
 *
 * 不能直接 append 到浮层正文容器上：那个容器是块级的，按钮会另起一行，
 * 看起来还是一条工具条。要「拼接在内容末尾」，就得挂进最后那个块级文字元素里
 * （通常就是最后一段话）。列表则先落到最后一项，再落到项里的段落。
 * 结尾是代码块 / 公式 / 图片这类东西时不硬塞，退回正文容器——宁可另起一行，
 * 也不能把按钮塞进公式或代码里。
 */
function actionsHost(body: Element): Element {
  let host: Element = body
  for (let i = 0; i < 4; i++) {
    const last = host.lastElementChild
    if (!last || last.matches(HOLE_SELECTOR)) break
    if (last.matches(TEXT_HOSTS)) return last
    if (!last.matches(CONTAINER_HOSTS)) break
    host = last
  }
  return host
}

/**
 * 把「修改 / 删除」拼到笔记内容末尾。
 *
 * 两个动作是这条笔记的附属物，跟在最后一行文字后面最自然；
 * 另起一条工具条会多占一行，浮层本来就小。
 */
function attachActions(el: HTMLElement): void {
  const body = el.querySelector('.moji-anno-body')
  if (!body) return
  const tpl = el.ownerDocument.createElement('template')
  tpl.innerHTML = actionsHtml()
  const acts = tpl.content.firstElementChild
  if (acts) actionsHost(body).appendChild(acts)
}

/** 浮层与箭头是全局单例：同一时刻至多显示一个 */
let popup: HTMLDivElement | null = null
let arrow: HTMLDivElement | null = null
let hideTimer: number | null = null
/** 退场动画播完后再真正 display:none（见 hidePopup） */
let removeTimer: number | null = null
/** 一份回调注册表，随最后挂载的 hydrate 更新（同时只显示一处笔记） */
let actions: AnnotationActions = {}

function ensurePopup(doc: Document): { el: HTMLDivElement; tip: HTMLDivElement } {
  if (!popup || !popup.isConnected) {
    const ElementCtor = doc.defaultView?.HTMLElement ?? HTMLElement
    popup = doc.createElement('div')
    popup.className = 'moji-anno-pop'
    popup.style.display = 'none'
    arrow = doc.createElement('div')
    arrow.className = 'moji-anno-arrow'
    arrow.style.display = 'none'
    doc.body.append(popup, arrow)

    // 指针进入浮层时取消自动隐藏，离开则收起——笔记浮层里有按钮，必须可停留在上面
    popup.addEventListener('mouseenter', cancelHide)
    popup.addEventListener('mouseleave', scheduleHide)
    // 事件委托：修改/删除按钮由浮层统一处理，不给每个按钮单独绑定
    popup.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest?.('[data-act]')
      if (!(btn instanceof ElementCtor)) return
      const term = popup?.dataset.term
      if (!term) return
      const act = btn.getAttribute('data-act')
      if (act === 'edit') actions.onEdit?.(term)
      else if (act === 'delete') actions.onDelete?.(term)
      hidePopup()
    })
  }
  return { el: popup, tip: arrow as HTMLDivElement }
}

function cancelHide(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** 撤销「退场动画播完就隐藏」的安排；浮层重新出现时必须调用，否则会刚显示就被藏掉 */
function cancelRemove(): void {
  if (removeTimer !== null) {
    window.clearTimeout(removeTimer)
    removeTimer = null
  }
}

/** 稍后再收：留出从术语移到浮层的时间 */
function scheduleHide(): void {
  cancelHide()
  hideTimer = window.setTimeout(() => hidePopup(), 140)
}

/**
 * 定位：默认放在术语上方、箭头朝下（指向术语）；上方空间不足则翻到下方、
 * 箭头朝上。水平方向夹取防止出屏，箭头单独跟随术语中心——
 * 这样即使气泡被夹取，箭头仍指向词，不会像固定在气泡中心那样对不上。
 */
function showPopup(target: HTMLElement): void {
  const body = target.dataset.anno
  if (!body) return
  const doc = target.ownerDocument
  const win = doc.defaultView
  if (!win) return
  const kind: AnnotationKind = target.dataset.annoKind === 'note' ? 'note' : 'understand'
  cancelHide()
  cancelRemove()
  const { el, tip } = ensurePopup(doc)

  // 笔记是用户写的内容，走块级 Markdown（可含列表/公式/多段）；了解只是一两句短释义
  const rendered = kind === 'note' ? renderNote(body) : renderInline(body)
  el.dataset.kind = kind
  el.dataset.term = target.dataset.annoTerm ?? ''
  el.classList.toggle('moji-anno-pop-interactive', kind === 'note')
  if (kind === 'note') {
    el.innerHTML = `<div class="moji-anno-body">${rendered}</div>`
    // 「修改 / 删除」行内拼在正文末尾（见 attachActions），不另起一条工具条
    attachActions(el)
  } else {
    el.innerHTML = rendered
  }
  el.style.display = 'block'
  tip.style.display = 'block'
  // 进场：气泡缩放淡入，箭头只淡入——箭头靠 transform 指方向，
  // 动画的 transform 会把它压掉（见 index.css 的 .moji-anno-arrow）
  el.classList.remove('moji-out')
  el.classList.add('moji-in-soft')
  tip.classList.remove('moji-fade-out')
  tip.classList.add('moji-fade-in')

  const r = target.getBoundingClientRect()
  const pr = el.getBoundingClientRect()
  const GAP = 10
  const center = r.left + r.width / 2
  let left = center - pr.width / 2
  left = Math.max(8, Math.min(left, win.innerWidth - pr.width - 8))

  const above = r.top - pr.height - GAP >= 8
  const top = above ? r.top - pr.height - GAP : r.bottom + GAP

  el.style.left = `${left}px`
  el.style.top = `${top}px`
  const arrowX = Math.max(10, Math.min(center - left, pr.width - 10))
  tip.style.left = `${left + arrowX}px`
  tip.style.top = above ? `${top + pr.height - 1}px` : `${top - 5}px`
  tip.dataset.dir = above ? 'down' : 'up'
}

/**
 * 收起浮层：先播一段退场动画，动画结束再真正 display:none。
 *
 * 不能直接隐藏——浮层「啪」地消失正是这一轮要修的手感问题。
 * 期间用 .moji-out 里的 pointer-events:none 断掉点击，
 * 免得一个正在消失的「了解」挡住下一处选择。
 */
function hidePopup(): void {
  cancelHide()
  cancelRemove()
  if (!popup || popup.style.display === 'none') return
  popup.classList.remove('moji-in-soft')
  popup.classList.add('moji-out')
  arrow?.classList.remove('moji-fade-in')
  arrow?.classList.add('moji-fade-out')
  removeTimer = window.setTimeout(() => {
    removeTimer = null
    if (popup) popup.style.display = 'none'
    if (arrow) arrow.style.display = 'none'
  }, 120)
}

/** 指针是否正落在浮层（或其中的按钮）上 */
function insidePopup(node: EventTarget | null): boolean {
  return !!popup && node instanceof Node && popup.contains(node)
}

/**
 * 换掉浮层里的「修改 / 删除」回调。
 *
 * 回调是每次渲染新造的闭包，不能塞进补丁的比较里去（那会让每次渲染都白算一遍），
 * 由 MarkdownView 每次渲染后刷一份新的，浮层拿到的因此永远是最新的。
 */
export function setAnnotationActions(next?: AnnotationActions): void {
  actions = next ?? {}
}

/**
 * 全量套用：正文刚被重建时走这条（清空之后逐条包）。之后注解再变就走 syncAnnotations。
 *
 * 事件监听挂在这里，而且只挂一次：span 是随补丁增删的，监听只能挂在正文根上、
 * 按事件目标判断（closest('.moji-anno')）。因此哪怕当前一条注解都没有也照挂——
 * 补丁之后加进来的 span 同样要能弹出浮层。
 */
export function hydrateAnnotations(
  root: HTMLElement,
  annotations: Annotation[],
  annotationActions?: AnnotationActions,
): () => void {
  actions = annotationActions ?? {}
  /** 一个词条只标一处（正常不会重复：store 按词条去重；这里只是兜底） */
  const used = new Set<string>()
  for (const a of annotations) {
    if (used.has(a.term)) continue
    if (applyAnnotation(root, a)) used.add(a.term)
  }

  const win = root.ownerDocument.defaultView
  if (!win) return () => {}

  const onOver = (e: Event) => {
    const t = (e.target as Element | null)?.closest?.('.moji-anno')
    if (t instanceof win.HTMLElement && root.contains(t)) showPopup(t)
  }
  const onOut = (e: Event) => {
    const from = (e.target as Element | null)?.closest?.('.moji-anno')
    if (!from) return
    // 移到浮层里（笔记有按钮）不算离开，交回浮层自己的 mouseleave 判断
    if (insidePopup((e as MouseEvent).relatedTarget)) return
    scheduleHide()
  }
  root.addEventListener('mouseover', onOver)
  root.addEventListener('mouseout', onOut)
  win.addEventListener('scroll', hidePopup, true)
  return () => {
    root.removeEventListener('mouseover', onOver)
    root.removeEventListener('mouseout', onOut)
    win.removeEventListener('scroll', hidePopup, true)
    hidePopup()
    actions = {}
  }
}
