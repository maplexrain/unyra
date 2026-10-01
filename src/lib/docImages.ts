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
 */
export function createLocalDocImageResolver(filePath: string): LocalImageResolver {
  const dir = filePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').slice(0, -1).join('/')
  return async (src) => {
    if (isRelativeImageSrc(src)) {
      const rel = joinUnderDir(dir, src)
      // 外部文档的资源就是它旁边那些文件：爬出文档目录的一律不读
      if (!rel || !pathInside(dir, rel)) return null
      return readImage(rel)
    }
    const abs = fileUrlToPath(src)?.replace(/\\/g, '/')
    if (!abs || !pathInside(dir, abs)) return null
    return readImage(abs)
  }
}

/* ---------- 水合 ---------- */

/** 处理进度的记号（写在元素属性上）：同一份 src 只解析一次，重跑水合是空转 */
const DONE_ATTR = 'data-moji-local'
/** 读不到（文件不在 / 越界被拒）时钉上的类：虚线底，别留一个莫名的碎图标（样式见 styles/annotation.css） */
export const LOCAL_IMG_MISSING = 'moji-local-img-missing'

/**
 * 把 root 下所有「就地引用」的 <img> 贴成 data URL。
 * 只碰相对路径与 file:/// 两种写法；https/data/blob/moji: 的 src 本来就能渲染或另有水合，不动。
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
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[src]'))) {
    const src = img.getAttribute('src') ?? ''
    if (!isRelativeImageSrc(src) && !/^file:\/\//i.test(src)) continue
    if (img.getAttribute(DONE_ATTR) === src) continue
    img.setAttribute(DONE_ATTR, src)
    void once(src).then((url) => {
      if (disposed || !root.contains(img)) return
      if (url) img.src = url
      else img.classList.add(LOCAL_IMG_MISSING)
    })
  }
  return () => {
    disposed = true
  }
}
