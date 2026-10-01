/**
 * 文档里「就地图片」的解析与水合：与文档同目录（或其子目录）的图片文件，
 * 用相对路径引用（`![图](hero.png)`、`![](shots/a.png)`），渲染时读字节贴成 data URL。
 *
 * 为什么走 data URL 而不是放行 file://：生产页面以 file:// 加载，CSP 的 img-src 'self'
 * 对 file: 来源什么也不匹配——相对路径要么解析到 dist/（应用自己的安装目录，不是文档的）、
 * 要么被 CSP 拦下，「文档里的资源加载不出来」正是这么来的（2026-10-01）。读字节走
 * 既有的存储桥（storage.readImage），与资源库图片（moji:static → data URL）同一条路，
 * CSP 一字不用改。
 *
 * 与 lib/staticView 同一套做法：marked 只产出 <img src>，DOM 提交之后再水合；
 * 水合按「源 src」在元素上记进度，重跑是幂等的空转。本模块不认识 store——
 * 文档在哪、根在哪，由调用方以闭包注入（见两个 resolver 工厂）。
 */
import { loadImageByRel } from '../learn/static'
import { readImage, storageInfo } from './storage'
import { readLocalImage } from './localFiles'
import { t } from '../i18n'

export type LocalImageResolver = (src: string) => Promise<string | null>

/* ---------- 纯判断（用例见 tests/docImages.test.ts） ---------- */

/** 这张 <img> 的 src 是不是「文档旁边的相对路径」：无协议、不以 / 开头、不是锚点 */
export function isRelativeImageSrc(src: string): boolean {
  const s = src.trim()
  if (!s || s.startsWith('#')) return false
  // 带任意协议的（data: blob: http: https: moji: file: …）都不算「就地文件」
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return false
  if (s.startsWith('//') || s.startsWith('/')) return false
  return true
}

/**
 * 需要「读字节再贴回 src」待遇的图片引用 = 相对路径 + file:/// 两种。
 * 解析期（lib/markdown 的 image 渲染器）据此对这类引用**不发 src**——
 * 浏览器不该自己去请求它（生产里那是 ERR_FILE_NOT_FOUND 的直接来源），
 * 只标 data-moji-local-src，等水合按文档目录读字节。
 */
export function isLocalPendingImageSrc(src: string): boolean {
  return isRelativeImageSrc(src) || /^file:\/\//i.test(src.trim())
}

/** file:/// URL → 本地路径（正斜杠、盘符开头）；不是本地文件路径回 null */
export function fileUrlToPath(src: string): string | null {
  if (!/^file:\/\//i.test(src)) return null
  try {
    let p = decodeURIComponent(new URL(src).pathname)
    // file:///C:/x 的 pathname 是 /C:/x：把多出来的那条斜杠去掉
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
    if (!/^[A-Za-z]:\//.test(p)) return null // 只认盘符路径；UNC 与 POSIX 根不认
    return p.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/**
 * 以目录为基准解析相对路径（posix 风格，与存储层的用户区 rel 同构）。
 * **基准的第一段就是允许的顶**：`..` 只能爬到与基准同级为止，再往上回 null——
 * 调用方想放多宽就传多宽的基准（节点文档传 docs/… 的文档目录，天然封在数据树里；
 * 越界与否的进一步判定由各 resolver 自己的 clamp 负责）。
 */
export function joinUnderDir(dir: string, src: string): string | null {
  const base = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  for (const seg of src.trim().replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      // 顶上只剩基准第一段时不再爬：那是这条通道的边界
      if (base.length <= 1) return null
      base.pop()
      continue
    }
    base.push(seg)
  }
  return base.length ? base.join('/') : null
}

/** 本地路径是否落在目录之内（含子目录）；分隔符两种都认，比较不分大小写（Windows） */
export function pathInside(dir: string, p: string): boolean {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return n.startsWith(d + '/') && n.length > d.length + 1
}

/* ---------- 两种文档的 resolver ---------- */

export interface NodeDocImageDeps {
  /** 这份文档所在目录（用户区相对路径，如 docs/微积分/极限.notes）；现取——常驻的多片正文各是各的文档 */
  dirRel: () => string | null
}

/**
 * 节点文档（教学文档 / 笔记）的就地图解析。相对路径按文档目录解析，
 * **必须落在 docs/ 数据树里**——这条通道的边界就是学习数据，不是整块磁盘；
 * file:/// 绝对路径只认应用数据根之下的（根从 storageInfo 现取一次并缓存）。
 */
export function createNodeDocImageResolver(deps: NodeDocImageDeps): LocalImageResolver {
  let root: string | null = null
  const rootOf = async (): Promise<string | null> => {
    if (root === null) {
      const info = await storageInfo().catch(() => null)
      root = info?.root ? info.root.replace(/[\\/]+$/, '') : ''
    }
    return root || null
  }
  return async (src) => {
    if (isRelativeImageSrc(src)) {
      const dir = deps.dirRel()
      if (!dir) return null
      const rel = joinUnderDir(dir, src)
      if (!rel || !rel.startsWith('docs/')) return null
      // 与聊天气泡共用同一份图片缓存（learn/images，键是 rel）：同一张图只读一次盘
      const loaded = await loadImageByRel(rel).catch(() => null)
      return loaded?.url ?? null
    }
    const abs = fileUrlToPath(src)
    if (!abs) return null
    const rootDir = await rootOf()
    if (!rootDir || !pathInside(rootDir, abs)) return null
    return readImage(abs)
  }
}

/**
 * 外部本地 md（LocalDoc）的就地图解析：相对路径按它**自己的目录**解析，
 * file:/// 也只认这个目录之内——外部文档的资源就是它旁边那些文件，不多给。
 * 读取走 local:readAttach（任意绝对路径的附件通道，图片扩展名回 data URL）——
 * storage 那组只认数据目录内的路径，外部文件用它会被「路径不合法」拒掉。
 */
export function createLocalDocImageResolver(filePath: string): LocalImageResolver {
  const dir = filePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').slice(0, -1).join('/')
  return async (src) => {
    if (isRelativeImageSrc(src)) {
      const rel = joinUnderDir(dir, src)
      // 外部文档的资源就是它旁边那些文件：爬出文档目录的一律不读
      if (!rel || !pathInside(dir, rel)) return null
      return readLocalImage(rel)
    }
    const abs = fileUrlToPath(src)?.replace(/\\/g, '/')
    if (!abs || !pathInside(dir, abs)) return null
    return readLocalImage(abs)
  }
}

/* ---------- 水合 ---------- */

/** 水合进度记在元素上：done / missing 不再动；pending（正文先重建了）从 data-moji-local-src 再来一遍 */
const STATE_ATTR = 'data-moji-local-state'
const ORIG_ATTR = 'data-moji-local-src'
/** 读不到（文件不在 / 越界被拒）时换成的说明文字：一枚安静的灰字，无边框无底色 */
export const LOCAL_IMG_MISSING = 'moji-local-img-missing'

/**
 * 把就地引用的图片读字节贴回 src。
 *
 * 两个来源：marked 解析期标好的 `img[data-moji-local-src]`（markdown 相对引用，
 * **从来没有 src**，浏览器不发请求），以及正文里手写的 `<img src="相对/file:">`
 * （在这里当场摘掉 src，晚一拍也比留着它刷 404 强）。三态幂等：正文在水合期间
 * 被重建（agent 改写、切页签回来），重跑水合会接着 pending 的那几张再来一遍。
 */
export function hydrateDocImages(root: HTMLElement, resolve: LocalImageResolver): () => void {
  let disposed = false
  /** 同一份 src 并发只解析一次（一篇文档里引用五次同一张图，读一次盘就够） */
  const inflight = new Map<string, Promise<string | null>>()
  const once = (src: string): Promise<string | null> => {
    let p = inflight.get(src)
    if (!p) {
      p = resolve(src).catch(() => null)
      inflight.set(src, p)
    }
    return p
  }
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
    const state = img.getAttribute(STATE_ATTR)
    if (state === 'done' || state === 'missing') continue
    const orig = (state === 'pending' ? img.getAttribute(ORIG_ATTR) : (img.getAttribute(ORIG_ATTR) ?? img.getAttribute('src')))?.trim()
    if (!orig || !isLocalPendingImageSrc(orig)) continue
    img.setAttribute(STATE_ATTR, 'pending')
    img.setAttribute(ORIG_ATTR, orig)
    if (img.hasAttribute('src')) img.removeAttribute('src')
    void once(orig).then((url) => {
      if (disposed || !root.contains(img)) return
      if (url) {
        img.setAttribute(STATE_ATTR, 'done')
        img.src = url
      } else {
        img.setAttribute(STATE_ATTR, 'missing')
        // 不给边框与底色：读不到就换成一枚安静的灰字（alt 是作者写的图注，优先用它）
        const note = img.ownerDocument!.createElement('span')
        note.className = LOCAL_IMG_MISSING
        note.textContent = (img.getAttribute('alt') ?? '').trim() || t('图片读取失败')
        img.replaceWith(note)
      }
    })
  }
  return () => {
    disposed = true
  }
}
