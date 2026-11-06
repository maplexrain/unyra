/**
 * 这个文件负责什么：**api.see 的宿主实现**——把「模型递过来的东西」（网络图片地址、base64、
 * 或一份 PDF 的指定页）转成图片存进目标资源库，并作为工具附带图片挂到**下一跳**，
 * 让模型亲眼看见它。
 *
 * 为什么要过资源库而不是把 base64 塞进回执：execute 的返回值走文本通道
 * （safeJson → 裁到 3.2 万字符），一张图的 base64 进去只会剩一段被截断的乱码，
 * 还永久占着上下文。图片走**图像通道**——与 res.read 读资源图、ui.capture 截图、
 * 用户贴图完全同一条路：字节落盘成 `{目标}/static/{uuid}.{ext}`，引用（MessageImage）
 * 挂在返回值的 images 上，由 execute 收集、由运行时作为图片片段送进下一跳
 * （见 agent/types 的 AgentToolResult.images）。
 *
 * 落库前过一遍归一化（learn/images 的 normalizeImage）：长边超 1568 或体积偏大就
 * 缩放重编码——与用户贴图同一待遇。模型要的是「看清内容」，一张 8000px 的原图
 * 只会按分辨率多收钱，不会多看清一个像素。PDF 页在渲染时已对齐 1568 长边
 * （见 learn/pdfRender），归一化通常原样保留。
 *
 * **只收「看得见」的东西**：图片与 PDF 页面。文本文件的内容本来就是文字，
 * res.read / workspace.read 直接读比挂附件便宜；音频等其余二进制没有统一可挂的
 * 内容片段（中立内容层只有 text / image 两种，见 ai/content），不做。
 */

import type { MessageImage } from '../agent/types'
import type { LearnStore } from './types'
import type { SeeRequest } from '../agent/tools'
import { MAX_TOOL_IMAGES } from '../agent/types'
import {
  addResource,
  findByHash,
  findResource,
  goalStaticDir,
  hashBytes,
  makeResource,
  patchResource,
  resourceRel,
} from './static'
import { blobToDataUrl, MAX_SOURCE_BYTES, MIME_EXT, normalizeImage, rememberImage } from './images'
import { renderPdfPages } from './pdfRender'
import { readUserBinary, writeUserImage } from '../lib/storage'
import { native } from '../lib/native'
import { t } from '../i18n'

export type SeeResult =
  | {
      ok: true
      /** 第一张图的资源 uuid（res.list 里能看到；文档里引用写 ![说明](moji:static/<uuid>)） */
      uuid: string
      /** 多张（PDF 多页）时的全部 uuid */
      uuids?: string[]
      /** PDF 实际渲染的页码（1 起） */
      pages?: number[]
      rel: string
      name: string
      mime: string
      bytes: number
      note: string
      /** 由 execute 收集、运行时挂到下一跳；不进回执文本（见文件头） */
      images: MessageImage[]
    }
  | { ok: false; error: string; images?: undefined }

/** 12MB 原图折成 base64 约为它的 4/3：超出这个长度必不是一张能看的图，先挡掉再解码 */
const MAX_BASE64_CHARS = MAX_SOURCE_BYTES + (MAX_SOURCE_BYTES >> 1)

/** 一次 see 最多渲染几页 PDF：与 execute 每次编排的挂图上限同口径 */
const MAX_PDF_PAGES = MAX_TOOL_IMAGES

/** 从解码后的字节认图片格式；认不出回 null（调用方报错） */
function sniffImageMime(head: Uint8Array): string | null {
  const u8 = head instanceof Uint8Array ? head : new Uint8Array(head)
  if (u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'image/png'
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg'
  if (u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'image/gif'
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
    u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (u8.length >= 2 && u8[0] === 0x42 && u8[1] === 0x4d) return 'image/bmp'
  return null
}

/** PDF 的魔数：%PDF- */
function isPdfBytes(head: Uint8Array): boolean {
  return head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const raw = atob(b64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** 网络地址里抠一个像样的展示名：取路径最后一段，去掉查询串与扩展名前的杂质 */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '').trim()
    if (seg) return seg.replace(/\.(pdf|png|jpe?g|webp|gif|bmp)$/i, '').slice(0, 60)
  } catch {
    // 不是合法 URL：主进程那边会报「地址读不出来」，这里只影响展示名
  }
  return ''
}

/** see 的落库管线：归一化 → 指纹去重 → 写盘 → 登记 → 进缓存。图片与 PDF 页共用这一段 */
async function saveSeenImage(
  deps: { getLatest: () => LearnStore; set: (store: LearnStore) => void; goalId: () => string },
  input: { bytes: Uint8Array; mime: string; name: string; caption?: string; order?: number },
): Promise<{ ok: true; image: MessageImage; reused: boolean } | { ok: false; error: string }> {
  let blob: Blob
  let dataUrl: string
  let mime = input.mime
  let width: number | undefined
  let height: number | undefined
  try {
    const normalized = await normalizeImage(new Blob([input.bytes as BlobPart], { type: mime }))
    if ('error' in normalized) return { ok: false, error: normalized.error }
    blob = normalized.blob
    dataUrl = await blobToDataUrl(normalized.blob)
    mime = normalized.mime
    width = normalized.width
    height = normalized.height
  } catch (err) {
    return { ok: false, error: t('图片处理失败：{0}', err instanceof Error ? err.message : String(err)) }
  }
  const finalBytes = new Uint8Array(await blob.arrayBuffer())

  const store0 = deps.getLatest()
  const goalId = deps.goalId()
  const dir = goalStaticDir(store0, goalId)
  if (!dir) return { ok: false, error: t('找不到这个目标的目录，图片存不了') }

  const hash = await hashBytes(finalBytes)
  const dup = findByHash(store0, goalId, hash)
  if (dup) {
    const rel = resourceRel(store0, goalId, dup)
    if (!rel) return { ok: false, error: t('图片与已有资源「{0}」内容相同，但它的文件读不到，请重试或换一张', dup.name) }
    // 同一份字节已在手上：顺手进缓存，下一跳取图就不用再读盘
    if ((input.caption !== undefined || input.order !== undefined) && (!dup.caption || dup.order === undefined)) {
      deps.set(patchResource(store0, goalId, dup.uuid, {
        ...(input.caption !== undefined && !dup.caption ? { caption: input.caption.trim() } : {}),
        ...(input.order !== undefined && dup.order === undefined ? { order: input.order } : {}),
      }))
    }
    const comma = dataUrl.indexOf(',')
    rememberImage(rel, { mime, data: dataUrl.slice(comma + 1), url: dataUrl })
    return {
      ok: true,
      reused: true,
      image: { id: dup.uuid, rel, name: dup.name, mime, bytes: dup.bytes, width, height },
    }
  }

  const uuid = crypto.randomUUID()
  const ext = MIME_EXT[mime] ?? 'png'
  const rel = dir + '/' + uuid + '.' + ext
  if (!(await writeUserImage(rel, dataUrl))) {
    return { ok: false, error: t('图片存盘失败（清单没有改动）') }
  }
  const resource = makeResource({ uuid, name: input.name, ext, bytes: blob.size, hash, type: 'binary', caption: input.caption, order: input.order })
  deps.set(addResource(store0, goalId, resource))
  // 刚存下来的这张已经在手上：进缓存，本跳请求与缩略图都不必再读盘
  const comma = dataUrl.indexOf(',')
  rememberImage(rel, { mime, data: dataUrl.slice(comma + 1), url: dataUrl })

  return {
    ok: true,
    reused: false,
    image: { id: uuid, rel, name: input.name, mime, bytes: blob.size, width, height },
  }
}

/**
 * see 的宿主实现。createSeeOps 只做装配（与 createResourceOps 同一条纪律：
 * store 与 goalId 现取闭包，本模块不在 Node 探针里裸跑——它要 DOM 与原生桥）。
 */
export function createSeeOps(deps: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  goalId: () => string
}): (input: SeeRequest) => Promise<SeeResult> {
  return async (input: SeeRequest): Promise<SeeResult> => {
    const name = (input.name ?? '').trim()
    const pdfRef = (input.pdf ?? '').trim()
    if (pdfRef) return seePdf(deps, pdfRef, input.page, name, input.caption, input.order)
    return seeImage(deps, input, name)
  }
}

/* ---------- 图片分支（URL / data URL / 裸 base64） ---------- */

async function seeImage(
  deps: { getLatest: () => LearnStore; set: (store: LearnStore) => void; goalId: () => string },
  input: SeeRequest,
  name: string,
): Promise<SeeResult> {
  /* ---------- 1. 拿到原始字节 ---------- */
  let bytes: Uint8Array | null = null
  let mime = (input.mime ?? '').trim().toLowerCase()
  let label = name
  const raw = (input.raw ?? '').trim()
  const url = (input.url ?? '').trim()
  const b64 = (input.base64 ?? '').replace(/\s+/g, '')

  try {
    if (url || /^https?:\/\//i.test(raw)) {
      // 网络图片：主进程去取字节（渲染层的 fetch 被 CORS 与 CSP 拦着，见 electron/web）
      const target = url || raw
      const res = await native().web.fetchBinary(target)
      if (!res.ok) return { ok: false, error: res.error }
      bytes = base64ToBytes(res.dataUrl.slice(res.dataUrl.indexOf(',') + 1))
      if (!bytes) return { ok: false, error: t('图片字节解码失败') }
      if (!label) label = nameFromUrl(res.finalUrl)
    } else if (/^data:image\//i.test(raw)) {
      // data URL：前缀里自带 mime
      const comma = raw.indexOf(',')
      if (comma < 0) return { ok: false, error: t('这不是一张合法的 data URL') }
      if (!mime) mime = raw.slice(5, raw.indexOf(';') < 0 ? comma : raw.indexOf(';')).trim()
      bytes = base64ToBytes(raw.slice(comma + 1))
      if (!bytes) return { ok: false, error: t('图片数据不是合法的 base64') }
    } else if (raw || b64) {
      // 裸 base64：体积先挡一道（省得解码几千万字符才发现超限）
      const payload = b64 || raw.slice(raw.indexOf(',') + 1)
      if (payload.length > MAX_BASE64_CHARS) {
        return { ok: false, error: t('图片超过 12MB，先换一张小一点的或压缩后再试') }
      }
      bytes = base64ToBytes(payload)
      if (!bytes) return { ok: false, error: t('图片数据不是合法的 base64') }
      if (!mime || !mime.startsWith('image/')) mime = sniffImageMime(bytes) ?? ''
    } else {
      return {
        ok: false,
        error:
          'see 需要一张图或一份 PDF：api.see(\'https://…/图.png\')、api.see({ pdf: \'https://…/论文.pdf\', page: 3 })、' +
          "api.see({ base64: '…', mime: 'image/png', name: '叫什么' })。",
      }
    }
  } catch (err) {
    return { ok: false, error: t('取图失败：{0}', err instanceof Error ? err.message : String(err)) }
  }

  if (!bytes || !bytes.byteLength) return { ok: false, error: t('图片数据是空的') }
  if (!mime || !mime.startsWith('image/')) mime = sniffImageMime(bytes) ?? ''
  if (!mime) return { ok: false, error: t('这不是一张能识别的图片') }
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    return { ok: false, error: t('图片超过 12MB，先换一张小一点的或压缩后再试') }
  }
  if (!label) label = 'Base64 图片'

  /* ---------- 2. 落库并挂到下一跳 ---------- */
  const saved = await saveSeenImage(deps, { bytes, mime, name: label, caption: input.caption, order: input.order })
  if (!saved.ok) return { ok: false, error: saved.error }
  const img = saved.image
  return {
    ok: true,
    uuid: img.id,
    rel: img.rel,
    name: img.name,
    mime: img.mime,
    bytes: img.bytes,
    note:
      '图片已存进资源库（' + img.name + '，' + Math.round(img.bytes / 1024) + ' KB）' +
      (saved.reused ? '（与库里已有资源内容相同，复用了它）' : '') +
      '并附在你的下一步里，你会直接看到它。要在文档里引用它写 ![说明](moji:static/' + img.id + ')。',
    images: [img],
  }
}

/* ---------- PDF 分支（URL / moji:static/<uuid> / 用户相对路径） ---------- */

async function seePdf(
  deps: { getLatest: () => LearnStore; set: (store: LearnStore) => void; goalId: () => string },
  pdfRef: string,
  page: number | number[] | undefined,
  name: string,
  caption?: string,
  order?: number,
): Promise<SeeResult> {
  /* ---------- 1. 页码归一化 ---------- */
  const list = Array.isArray(page) ? page : page !== undefined ? [page] : [1]
  const pages = [...new Set(list.map((n) => Math.floor(Number(n)))) ]
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b)
  if (!pages.length) return { ok: false, error: 'page 要是 1 起的页码（单个或数组），例如 page: 3 或 page: [1, 2]。' }
  if (pages.length > MAX_PDF_PAGES) {
    return {
      ok: false,
      error: '一次最多看 ' + MAX_PDF_PAGES + ' 页（附图有上限）。把 page 拆成几次调用，先看你最需要的那几页。',
    }
  }

  /* ---------- 2. 拿到 PDF 字节 ---------- */
  let bytes: Uint8Array | null = null
  let label = name
  try {
    if (/^https?:\/\//i.test(pdfRef)) {
      const res = await native().web.fetchBinary(pdfRef)
      if (!res.ok) return { ok: false, error: res.error }
      bytes = base64ToBytes(res.dataUrl.slice(res.dataUrl.indexOf(',') + 1))
      if (!bytes) return { ok: false, error: t('图片字节解码失败') }
      if (!label) label = nameFromUrl(res.finalUrl)
    } else {
      // moji:static/<uuid>、裸 uuid、或「相对当前用户」的路径（node.paths() 里取的 workspaceDir 之类）
      const uuid = pdfRef.startsWith('moji:static/') ? pdfRef.slice('moji:static/'.length).trim() : pdfRef.trim()
      const res = findResource(deps.getLatest(), deps.goalId(), uuid)
      if (res) {
        const rel = resourceRel(deps.getLatest(), deps.goalId(), res)
        if (!rel) return { ok: false, error: '资源「' + res.name + '」的文件读不到（清单里有、磁盘上没有）。' }
        const dataUrl = await readUserBinary(rel)
        if (!dataUrl) return { ok: false, error: '资源「' + res.name + '」的文件读不到（清单里有、磁盘上没有）。' }
        bytes = base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1))
        if (!label) label = res.name
      } else {
        const dataUrl = await readUserBinary(uuid)
        if (!dataUrl) {
          return {
            ok: false,
            error:
              '找不到这份 PDF：' + pdfRef + '。pdf 可以给 http(s) 地址、资源库引用 moji:static/<uuid>' +
              '（先 res.list() 看）、或相对用户的文件路径（node.paths() 里有 workspaceDir）。',
          }
        }
        bytes = base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1))
      }
    }
  } catch (err) {
    return { ok: false, error: t('取图失败：{0}', err instanceof Error ? err.message : String(err)) }
  }
  if (!bytes || !bytes.byteLength) return { ok: false, error: 'PDF 数据是空的' }
  if (!isPdfBytes(bytes)) {
    return { ok: false, error: t('这不是一份 PDF（{0}）', '文件头不是 %PDF-') }
  }
  if (!label) label = 'PDF'

  /* ---------- 3. 渲染 + 落库 ---------- */
  const rendered = await renderPdfPages(bytes, pages)
  if (!rendered.ok) return { ok: false, error: rendered.error }

  const images: MessageImage[] = []
  const uuids: string[] = []
  for (const p of rendered.pages) {
    const saved = await saveSeenImage(deps, { bytes: p.bytes, mime: 'image/png', name: label + '-第' + p.page + '页', caption, order: order !== undefined ? order + p.page - 1 : undefined })
    if (!saved.ok) {
      return {
        ok: false,
        error: '第 ' + p.page + ' 页存库失败：' + saved.error +
          (uuids.length ? '（前面的页已存进资源库：' + uuids.join('、') + '）' : ''),
      }
    }
    images.push(saved.image)
    uuids.push(saved.image.id)
  }

  const first = images[0]
  const refHint = images.map((img) => img.name + ' → ![说明](moji:static/' + img.id + ')').join('；')
  return {
    ok: true,
    uuid: first.id,
    uuids,
    pages: rendered.pages.map((p) => p.page),
    rel: first.rel,
    name: first.name,
    mime: first.mime,
    bytes: first.bytes,
    note:
      '这份 PDF 共 ' + rendered.total + ' 页，已把第 ' + rendered.pages.map((p) => p.page).join('、') +
      ' 页渲染成图片附在你的下一步里（' + images.length + ' 张）。' +
      '它只渲染页面，**不提供文字层**——要逐字引用正文请让用户把原文贴出来或放进工作区再读。' +
      '要在文档里引用页面截图：' + refHint + '。',
    images,
  }
}
