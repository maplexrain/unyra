/** 这个文件负责：注解列表变了以后怎么改 DOM——增量补丁，以及编辑期的样式实时预览。 */

import type { Annotation, AnnotationStyle } from '../../learn/types'
import { applyAnnotationStyle, serializeStyle } from '../annotationStyle'
import { applyAnnotation, buildStream, findHit, nthHit, restyleAnnotation, retagAnnotation, unwrapAnnotation, unwrapSpan, wrapPiece } from './dom'

/**
 * 增量补丁：正文一个字都没变，只是注解列表变了（新增/修改/删除/挪位置）。
 *
 * 这是「改一条注解就把整篇正文重写一遍」的替代路径。那条老路实测在一份 276KB 的
 * 教学文档上会把 8432 个元素全部换掉、强制布局 28~30ms、到下一帧 48~52ms（掉 2~3 帧），
 * 已经画好的函数图像也会被一起丢掉、等 idle 才补回来——看着就是闪一下。
 * 这里只动真正变了的那几处：改样式 0 个元素被替换，增删 1 个。
 *
 * 逐条按 [释义, 类型, 样式, 出现序号] 比对，能少动就少动：样式原地改，
 * 释义/类型换 dataset 即可，只有「位置变了」或「span 已经不在」才必须拆了重包。
 *
 * 与「清空后全量 hydrate 一遍」等价：先拆完所有该拆的（含被牵连的嵌套词条），
 * 再按注解数组顺序包回去。
 */
export function syncAnnotations(root: HTMLElement, prev: Annotation[], next: Annotation[]): void {
  const fp = (a: Annotation) => ({
    body: a.body,
    kind: a.kind === 'note' ? 'note' : 'understand',
    style: serializeStyle(a.style),
    occurrence: a.occurrence ?? 0,
  })
  const before = new Map(prev.map((a) => [a.term, fp(a)]))
  const after = new Map(next.map((a) => [a.term, a]))

  // 只查一遍 DOM，按词条分好组：比每条注解各 querySelectorAll 一次省得多
  const spanCount = new Map<string, number>()
  for (const el of root.querySelectorAll('.moji-anno')) {
    const t = el instanceof HTMLElement ? el.dataset.annoTerm : undefined
    if (t) spanCount.set(t, (spanCount.get(t) ?? 0) + 1)
  }

  /** 要拆了重包的词条（新增、挪位置、span 没了，以及被牵连的嵌套词条） */
  const dirty = new Set<string>()
  /** 原地就能改完的动作 */
  const inPlace: Array<() => void> = []

  for (const a of next) {
    const was = before.get(a.term)
    const has = (spanCount.get(a.term) ?? 0) > 0
    if (!was || !has) {
      dirty.add(a.term)
      continue
    }
    const to = fp(a)
    if (was.occurrence !== to.occurrence) {
      dirty.add(a.term)
      continue
    }
    if (was.body !== to.body || was.kind !== to.kind) inPlace.push(() => retagAnnotation(root, a))
    if (was.style !== to.style) inPlace.push(() => restyleAnnotation(root, a))
  }
  // 这一轮已经不在列表里的词条：连同它的 span 一起拆掉
  for (const term of before.keys()) if (!after.has(term)) dirty.add(term)

  // 顺序要紧：先原地改（此时结构还没动，定位稳定），再拆，最后按 next 的顺序包回来
  for (const run of inPlace) run()
  // dirty 会因「拆外层」而加入嵌套词条；Set 迭代会把新加入的也走一遍
  for (const term of dirty) unwrapAnnotation(root, term, dirty)
  for (const a of next) if (dirty.has(a.term)) applyAnnotation(root, a)
}

/* ---------- 编辑期的样式实时预览 ---------- */

/**
 * 正在编辑某条笔记时，把它当前的样式实时套到正文里对应的那段文字上。
 *
 * 要「切换样式时正文跟着变」而不是先保存再回去看效果。两种情形：
 * - 这个词已经有标注（改笔记）：改那几个 span 的内联样式，记下原样，结束时写回；
 * - 还没有标注（新建笔记）：临时按同一套规则包一处，结束时拆掉、还原成普通文字。
 *   临时 span 的 data-anno 是空串——浮层只认有释义的标注，所以悬停不会弹出东西。
 *
 * 会话按「根 + 词条」认：换词条、换节点就重开一次。正文被整体重写（保存之后）时，
 * 这些 span 已经不在文档里了，因此每步都判 isConnected，绝不去动新 DOM。
 */
interface StylePreviewSession {
  root: HTMLElement
  term: string
  /** 动过样式的既有 span：记下原内联样式，结束时写回 */
  saved: Array<{ el: HTMLElement; style: string | null }>
  /** 临时包出来的 span：结束时拆回文字 */
  created: HTMLElement[]
}

let stylePreview: StylePreviewSession | null = null

export function previewAnnotationStyle(
  root: HTMLElement,
  term: string,
  occurrence: number | undefined,
  style: AnnotationStyle | undefined,
): void {
  const t = term.trim()
  if (!t) return
  if (!stylePreview || stylePreview.root !== root || stylePreview.term !== t) {
    endAnnotationPreview()
    const session: StylePreviewSession = { root, term: t, saved: [], created: [] }
    stylePreview = session
    const spans = Array.from(root.querySelectorAll<HTMLElement>('.moji-anno')).filter(
      (el) => el.dataset.annoTerm === t,
    )
    if (spans.length) {
      session.saved = spans.map((el) => ({ el, style: el.getAttribute('style') }))
    } else {
      const stream = buildStream(root)
      const hit = (occurrence ? nthHit(stream, t, occurrence) : null) ?? findHit(stream, t)
      if (hit) {
        for (let i = hit.pieces.length - 1; i >= 0; i--) {
          const span = wrapPiece(root.ownerDocument, hit.pieces[i], { term: t, body: '' })
          if (span) session.created.push(span)
        }
        session.saved = session.created.map((el) => ({ el, style: el.getAttribute('style') }))
      }
    }
  }
  for (const { el, style: original } of stylePreview.saved) {
    if (!el.isConnected) continue
    // 先退回原样再套新样式：applyAnnotationStyle 只写不删，
    // 不先回退的话「取消加粗」这类操作在预览里不会生效
    if (original === null) el.removeAttribute('style')
    else el.setAttribute('style', original)
    applyAnnotationStyle(el, style)
  }
}

/** 结束预览：临时包出来的拆掉，改过样式的写回原样 */
export function endAnnotationPreview(): void {
  const session = stylePreview
  stylePreview = null
  if (!session) return
  for (const { el, style } of session.saved) {
    if (!el.isConnected) continue
    if (style === null) el.removeAttribute('style')
    else el.setAttribute('style', style)
  }
  for (const el of session.created) {
    if (el.isConnected) unwrapSpan(el)
  }
}
