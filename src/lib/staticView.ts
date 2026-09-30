/**
 * 文档里的资源引用（`![图注](moji:static/<uuid>)` / `[文字](moji:static/<uuid>)`）在界面上的形态。
 *
 * 为什么不在 renderNote 里做：那是纯函数、产物按源文缓存（见 lib/markdown）。
 * 而「这个 uuid 是什么类型、多大、字节在哪」是清单与磁盘的事——把 store 塞进纯函数，
 * 缓存立刻就是脏的。因此与函数图像（lib/plot）、「了解」注解（lib/annotation）同一套做法：
 * marked 只产出 `<img src="moji:static/…">` / `<a href="moji:static/…">`，
 * DOM 提交之后再把它变成真东西（见 MarkdownView 的 effect ①）。
 *
 * 本模块不认识 store，也不认识学习数据：清单查询、字节读取、在文件管理器里定位
 * 全部由工作区注册进来（见 setStaticView）。因此它可以被单独推理，也不依赖 React。
 *
 * 三种形态，由「元素种类 + 资源类型 + 能不能读到」共同决定：
 * - `![](...)` + 图片资源 → 内联图片（先同步取缓存，没有就给占位并异步读）
 * - `![](...)` + 非图片 / 未知 uuid / 文件缺失 → 文件卡片（原 <img> 被换掉）
 * - `[](...)` → 一律文件卡片：补样式并在链接文字后面附上后缀与大小，
 *   **不吞掉链接自己的文字**（那是作者写的说明）
 */

import { t } from '../i18n'
import {
  STATIC_SCHEME,
  fileNameOf,
  formatBytes,
  isImageExt,
  uuidFromHref,
  type StaticResource,
} from '../learn/static'

/**
 * 工作区注入的能力。没注册时（例如文档渲染在工作区之外）引用只剩占位，
 * 这里不做任何查询，也不会去猜。
 */
export interface StaticView {
  /** 清单里的那条资源；没有返回 null */
  resource: (uuid: string) => StaticResource | null
  /** 同步取缓存里的 data URL（没读过就是 null） */
  cachedUrl: (uuid: string) => string | null
  /** 异步读字节（只有图片需要） */
  loadUrl: (uuid: string) => Promise<string | null>
  /** 在系统文件管理器里定位这个文件 */
  reveal: (uuid: string) => void
  /** 订阅「有图读回来了」，据此重画 */
  subscribe: (cb: () => void) => () => void
}

let current: StaticView | null = null

/**
 * 注册表变化时的通知：每一份 hydrate 出来的文档都据此重来一遍。
 *
 * 为什么需要它：子组件的 layout effect 先于父组件执行，MarkdownView 第一次挂载时
 * 工作区还没来得及注册 resolver（注册发生在父组件的 effect 里）。只在挂载那一刻查一次的话，
 * 文档里的引用会永远停在「资源不存在」；注册表一变就整体重来，这个时序问题就不存在了。
 */
const listeners = new Set<() => void>()

/** 由工作区注册一次（闭包里有 store 与 goalId）；传 null 注销 */
export function setStaticView(view: StaticView | null): void {
  if (current === view) return
  current = view
  for (const cb of [...listeners]) cb()
}

/* ---------- 类名（样式见 index.css 的 .moji-static-* 一组） ---------- */

/** 卡片（<a> 与由 <img> 换来的那种都用它） */
const CARD = 'moji-static-card'
/** 资源不存在 / 文件缺失：虚线边框，颜色转警示 */
const CARD_MISSING = 'moji-static-card-missing'
/** 由 <img> 换来的卡片（与 <a> 卡片区分，便于单独调） */
const CARD_FILE = 'moji-static-file'
/** 内联图片本体 */
const IMG = 'moji-static-img'
/** 占位期的外层壳（图片就包在里面） */
const IMG_WRAP = 'moji-static-imgwrap'
/** 还在读字节；读完摘掉 */
const IMG_LOADING = 'moji-static-loading'
/** 占位文案「正在读取…」 */
const HINT = 'moji-static-hint'
/** 后缀徽标 */
const ICON = 'moji-static-icon'
/** 展示名 */
const NAME = 'moji-static-name'
/** 体积 */
const SIZE = 'moji-static-size'
/** 「资源不存在 / 文件缺失」这类状态说明 */
const NOTE = 'moji-static-note'
/** <a> 卡片后面追加的元信息（重画时整块换掉） */
const META = 'moji-static-meta'

/**
 * 点击定位的标记属性。
 *
 * 用**委托**而不是逐个元素挂监听：卡片是补丁出来的（占位壳、卡片都会换元素），
 * 逐个挂就要在每次换元素时搬一次监听，漏一次就是「点了没反应」。
 * 挂在正文根上一次，按 closest 判断，换多少元素都不用管。
 * 值为 uuid（畸形引用给空串：仍然要 preventDefault，但不能去定位一个不存在的文件）。
 */
const REF_ATTR = 'data-static-ref'

interface Rec {
  /** 原始元素（img 或 a）；<img> 的 error 监听挂在它身上，撤销时要摘 */
  origin: HTMLElement
  /** 当前代表这条资源的元素：换成卡片、包上占位壳之后指向新元素 */
  node: HTMLElement
  kind: 'img' | 'a'
  /** 清单里的 uuid；引用畸形时退化成「看起来像 id 的那几个字符」，只用于展示 */
  uuid: string
  /** 引用本身畸形：直接当「资源不存在」，也不去定位文件 */
  broken: boolean
  /** 已经写进 DOM 的那一版（签名），用来跳过无谓的重写 */
  applied: string
  /** 真正设进 <img> 的那个 data URL：error 要据此判断失败的是不是「我们这张图」 */
  appliedUrl: string
  /** 读过一次、文件不在：定格成卡片，不再重试（否则每次通知都要读一遍盘） */
  failed: boolean
  /** 正在读字节，避免同一张图被并发读多次 */
  loading: boolean
  /** 占位壳是否已经包出来 */
  wrapped: boolean
  /** <a> 后面追加的元信息；重画时先摘掉旧的 */
  meta: HTMLElement | null
  /** <img> 的 error 监听（只挂一次） */
  onError: (() => void) | null
}

/** 处理 root 下所有 moji:static 引用：图片 patch src、文件卡片、点击定位。返回撤销函数 */
export function hydrateStaticFiles(root: HTMLElement): () => void {
  const doc = root.ownerDocument
  const recs: Rec[] = []
  let disposed = false

  /** 当前代表这条资源的 <img>；换成卡片之后就找不到了 */
  const imageOf = (rec: Rec): HTMLImageElement | null =>
    rec.node.tagName === 'IMG' ? (rec.node as HTMLImageElement) : rec.node.querySelector('img')

  /** 把「点击定位」的标记挪到当前元素上（收集阶段就要用，所以放在最前） */
  const markRef = (rec: Rec, node: HTMLElement): void => {
    rec.node.removeAttribute(REF_ATTR)
    node.setAttribute(REF_ATTR, rec.broken ? '' : rec.uuid)
    rec.node = node
  }

  /* ---------- 收集：正文刚被整体写过一次，此刻的引用就是全部 ---------- */

  const selector =
    'img[src^="' + STATIC_SCHEME + '"], a[href^="' + STATIC_SCHEME + '"]'
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    const kind: 'img' | 'a' = el.tagName === 'IMG' ? 'img' : 'a'
    const raw = (kind === 'img' ? el.getAttribute('src') : el.getAttribute('href')) ?? ''
    const uuid = uuidFromHref(raw)
    const rec: Rec = {
      origin: el,
      node: el,
      kind,
      uuid: uuid ?? raw.slice(STATIC_SCHEME.length).split(/[?#]/)[0].trim().slice(0, 8),
      broken: uuid === null,
      applied: '',
      appliedUrl: '',
      failed: false,
      loading: false,
      wrapped: false,
      meta: null,
      onError: null,
    }
    recs.push(rec)
    markRef(rec, el)
    if (kind === 'img') {
      /*
       * 图片读回来却显示不出来（0 字节、或者后缀是图片其实是文本）：
       * 同样退化成卡片，而不是留一个碎图标。
       *
       * 只认「我们设进去的那张」失败：marked 产出的 moji: src 在浏览器看来本来就取不到，
       * 它那次 error 与资源是否存在无关——不判断的话，一张好图会在占位期被判死刑。
       */
      const onError = (): void => {
        if (disposed || !rec.appliedUrl) return
        if ((rec.origin as HTMLImageElement).getAttribute('src') !== rec.appliedUrl) return
        rec.failed = true
        render(rec)
      }
      rec.onError = onError
      el.addEventListener('error', onError)
    }
  }

  /* ---------- 重画 ---------- */

  /**
   * 同步取缓存 → 直接设 src；没有就占位 + 异步读。
   * 读回来时缓存会发通知（见 learn/images 的 subscribeImages），走 repaint 再进来一次。
   */
  const render = (rec: Rec): void => {
    if (disposed) return
    // 只认仍然挂在本文档里的元素：正文重建后旧节点已经脱离（用户看不到，
    // 再改它也没有意义），调用方 repaint 顺手把这条记录丢掉
    if (!root.contains(rec.node)) return
    const view = current
    if (!view) {
      // resolver 还没注册：先把图片挂成占位（多数的引用就是插图）。注册表一变会重来
      if (rec.kind === 'img') showLoading(rec)
      return
    }

    const res = rec.broken ? null : view.resource(rec.uuid)
    if (rec.kind === 'img' && res && isImageExt(res.ext) && !rec.failed) {
      const url = view.cachedUrl(rec.uuid)
      if (url) {
        showImage(rec, url)
        return
      }
      showLoading(rec)
      if (!rec.loading) {
        rec.loading = true
        void view.loadUrl(rec.uuid).then(
          (got) => {
            rec.loading = false
            // 成功时不必在这里设 src：字节进缓存会发通知，repaint 会把它贴上去
            if (!got) missFile(rec)
          },
          () => {
            rec.loading = false
            missFile(rec)
          },
        )
      }
      return
    }
    showCard(rec, res)
  }

  /* ---------- 三种形态 ---------- */

  /** 内联图片：缓存里有就直接贴上去 */
  const showImage = (rec: Rec, url: string): void => {
    if (rec.applied === 'img') return
    rec.applied = 'img'
    rec.appliedUrl = url
    const img = imageOf(rec)
    if (!img) return
    img.classList.add(IMG)
    img.src = url
    // 占位壳（若有）到此收工：去掉虚线底与「正在读取…」，只留图片
    const wrap = rec.node === img ? null : rec.node
    if (wrap) {
      wrap.classList.remove(IMG_LOADING)
      wrap.querySelector('.' + HINT)?.remove()
    }
  }

  /**
   * 占位：灰底 + 「正在读取…」。
   *
   * 之所以包一层壳而不是直接给 <img> 上样式：<img> 是替换元素，伪元素画不出来，
   * 而占位期又没有图画——文字只能落在它外面。
   */
  const showLoading = (rec: Rec): void => {
    if (rec.applied === 'loading') return
    rec.applied = 'loading'
    if (rec.wrapped) return
    const img = rec.node as HTMLImageElement
    const wrap = doc.createElement('span')
    wrap.className = IMG_WRAP + ' ' + IMG_LOADING
    img.classList.add(IMG)
    // 别让浏览器去解析 moji:——那会留下一个碎图标，而这里正要给它占位
    img.removeAttribute('src')
    img.replaceWith(wrap)
    wrap.appendChild(img)
    const hint = doc.createElement('span')
    hint.className = HINT
    hint.textContent = t('正在读取…')
    wrap.appendChild(hint)
    rec.wrapped = true
    markRef(rec, wrap)
  }

  /** 文件卡片：非图片资源、未知 uuid、文件缺失，以及所有 [文字](moji:static/…) 形态 */
  const showCard = (rec: Rec, res: StaticResource | null): void => {
    if (rec.kind === 'a') {
      styleLink(rec, res)
      return
    }
    const key = res
      ? 'card:' + res.uuid + ':' + res.ext + ':' + res.name + ':' + res.bytes + (rec.failed ? ':x' : '')
      : 'none:' + rec.uuid
    if (rec.applied === key) return
    rec.applied = key

    const alt = (rec.origin.getAttribute('alt') ?? '').trim()
    const box = doc.createElement('span')
    box.className = CARD + ' ' + CARD_FILE + (res && !rec.failed ? '' : ' ' + CARD_MISSING)
    if (res && !rec.failed) {
      box.appendChild(icon(doc, res.ext))
      box.appendChild(text(doc, NAME, res.name))
      box.appendChild(text(doc, SIZE, formatBytes(res.bytes)))
      box.title = [fileNameOf(res), alt, res.description].filter(Boolean).join(' · ')
    } else if (res) {
      // 清单里有、磁盘上没有：这是「文件缺失」，与「uuid 从没登记过」是两回事
      box.appendChild(icon(doc, res.ext))
      box.appendChild(text(doc, NAME, res.name))
      box.appendChild(text(doc, NOTE, t('文件缺失')))
      box.title = [fileNameOf(res), alt, t('文件不在资源目录里')].filter(Boolean).join(' · ')
    } else {
      box.appendChild(icon(doc, '?'))
      if (alt) box.appendChild(text(doc, NAME, alt))
      box.appendChild(text(doc, NOTE, rec.uuid ? t('资源不存在 · {0}', rec.uuid) : t('资源不存在')))
      box.title = rec.uuid
        ? t('资源不存在：{0}（清单里没有这条引用）', rec.uuid)
        : t('资源不存在（清单里没有这条引用）')
    }
    rec.node.replaceWith(box)
    markRef(rec, box)
  }

  /**
   * <a> 卡片：补样式 + 在链接文字后面附上元信息。
   *
   * 链接文字是作者（或模型）写的说明，一律保留——卡片只补「是什么文件、多大」，
   * 不改写人家的话。
   */
  const styleLink = (rec: Rec, res: StaticResource | null): void => {
    const key = res
      ? 'a:' + res.uuid + ':' + res.ext + ':' + res.name + ':' + res.bytes
      : 'a-none:' + rec.uuid
    if (rec.applied === key) return
    rec.applied = key

    const a = rec.node
    a.classList.add(CARD)
    a.classList.toggle(CARD_MISSING, !res)
    rec.meta?.remove()
    const meta = doc.createElement('span')
    meta.className = META
    if (res) {
      meta.appendChild(icon(doc, res.ext))
      meta.appendChild(text(doc, SIZE, formatBytes(res.bytes)))
      // 链接文字之外再给一份真实文件名（悬停可见）：两者不一致时一眼能看出引错了没有
      if (!a.getAttribute('title')?.trim()) {
        a.title = [fileNameOf(res), res.description].filter(Boolean).join(' · ')
      }
    } else {
      meta.appendChild(text(doc, NOTE, rec.uuid ? t('资源不存在 · {0}', rec.uuid) : t('资源不存在')))
    }
    a.appendChild(meta)
    rec.meta = meta
  }

  /** 字节读不到（文件被删/移走）：定格成卡片，不再重试 */
  const missFile = (rec: Rec): void => {
    if (disposed || rec.failed) return
    rec.failed = true
    rec.applied = ''
    render(rec)
  }

  /* ---------- 订阅：缓存里多了一张图、或 resolver 换了，都重来一遍 ---------- */

  const repaint = (): void => {
    if (disposed) return
    for (let i = recs.length - 1; i >= 0; i--) {
      const rec = recs[i]
      if (!root.contains(rec.node)) {
        recs.splice(i, 1)
        continue
      }
      render(rec)
    }
  }

  let offLoad: (() => void) | null = null
  /** 每次注册表变化都重新订阅：新的 view 有它自己的订阅源 */
  const bindView = (): void => {
    offLoad?.()
    offLoad = null
    if (current) offLoad = current.subscribe(repaint)
  }
  const onViewChange = (): void => {
    if (disposed) return
    bindView()
    repaint()
  }

  /* ---------- 点击：卡片与链接都在文件管理器里定位 ---------- */

  const onClick = (e: Event): void => {
    const target = e.target
    if (!(target instanceof Element)) return
    const el = target.closest('[' + REF_ATTR + ']')
    if (!el || !root.contains(el)) return
    // moji: 协议本身无意义（在 Electron 里会变成一次注定失败的导航），一律拦下
    e.preventDefault()
    const uuid = el.getAttribute(REF_ATTR)
    if (uuid) current?.reveal(uuid)
  }

  listeners.add(onViewChange)
  if (recs.length) root.addEventListener('click', onClick)
  bindView()
  repaint()

  return () => {
    disposed = true
    listeners.delete(onViewChange)
    offLoad?.()
    offLoad = null
    root.removeEventListener('click', onClick)
    for (const rec of recs) if (rec.onError) rec.origin.removeEventListener('error', rec.onError)
    recs.length = 0
  }
}

/* ---------- 小工具 ---------- */

const icon = (doc: Document, ext: string): HTMLElement => {
  const el = doc.createElement('span')
  el.className = ICON
  // 没有后缀的资源给一个通用标记，不要留空槽
  el.textContent = (ext || 'file').toUpperCase()
  return el
}

const text = (doc: Document, className: string, value: string): HTMLElement => {
  const el = doc.createElement('span')
  el.className = className
  el.textContent = value
  return el
}
