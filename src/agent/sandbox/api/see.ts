/**
 * 这个文件负责什么：视觉输入 api 的装配（see.*，见 learn/see）——看图 / 看 PDF 页。
 * 字符串、对象与数组批量写法都收（normalizeSeeItem 负责整形），图片本身由宿主挂到
 * 下一跳视觉通道；批量写法里的附图上限（MAX_TOOL_IMAGES）与说明话术是敏感口径。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import { MAX_TOOL_IMAGES } from '../../types'
import type { SandboxCall, SandboxOptions } from '../types'

/** 视觉输入域：see */
export function installSee(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 看图 / 看 PDF 页（顶层 api）：字符串、对象与数组批量写法都收，图片本身由宿主挂到下一跳（见 learn/see）
  if (opts.see) {
    const see = opts.see
    const normalizeSeeItem = (item: unknown): any => {
      if (typeof item === 'string') {
        const raw = item.trim()
        return raw ? { raw } : null
      }
      const obj = asRecord(item)
      if (!Object.keys(obj).length) return null
      const rawPage = obj.page
      const page = Array.isArray(rawPage)
        ? rawPage.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : typeof rawPage === 'number' || typeof rawPage === 'string'
          ? Number(rawPage)
          : undefined
      return {
        ...(obj.raw !== undefined ? { raw: asText(obj.raw) } : {}),
        ...(obj.uuid !== undefined && obj.raw === undefined ? { raw: asText(obj.uuid) } : {}),
        ...(obj.url !== undefined || obj.link !== undefined || obj.href !== undefined
          ? { url: asText(obj.url ?? obj.link ?? obj.href) }
          : {}),
        ...(obj.base64 !== undefined || obj.dataUrl !== undefined || obj.b64 !== undefined
          ? { base64: asText(obj.base64 ?? obj.dataUrl ?? obj.b64) }
          : {}),
        ...(obj.mime !== undefined ? { mime: asText(obj.mime) } : {}),
        ...(obj.name !== undefined ? { name: asText(obj.name) } : {}),
        ...(obj.pdf !== undefined ? { pdf: asText(obj.pdf) } : {}),
        ...(page !== undefined && (!Array.isArray(page) || page.length) ? { page } : {}),
        ...(obj.caption !== undefined ? { caption: asText(obj.caption) } : {}),
        ...(typeof obj.order === 'number' && Number.isFinite(obj.order) ? { order: obj.order } : {}),
      }
    }

    wrapApi(api, 'see', async (args) => {
      const first = args[0]
      if (Array.isArray(first)) {
        if (!first.length) return { ok: false, error: '批量 see 参数不能为空数组' }
        const items = []
        const allImages: any[] = []
        for (const item of first) {
          const req = normalizeSeeItem(item)
          if (!req) {
            items.push({ ok: false, error: '参数不合法（缺少 url/pdf/base64）' })
            continue
          }
          const res = (await see(req)) as any
          items.push(res)
          if (res?.ok && Array.isArray(res.images)) {
            allImages.push(...res.images)
          }
        }
        const successCount = items.filter((r) => r.ok).length
        const attachedCount = Math.min(allImages.length, MAX_TOOL_IMAGES)
        const unattachedCount = Math.max(0, allImages.length - MAX_TOOL_IMAGES)
        return {
          ok: successCount > 0,
          total: first.length,
          successCount,
          attachedCount,
          unattachedCount,
          items: items.map((r) => {
            if (!r.ok) return { ok: false, error: r.error }
            return {
              ok: true,
              uuid: r.uuid,
              name: r.name,
              caption: r.caption,
              order: r.order,
              bytes: r.bytes,
              rel: r.rel,
            }
          }),
          images: allImages,
          note: `批量存入 ${successCount}/${first.length} 张图片到资源库。` +
            (unattachedCount > 0
              ? `单回合视觉通道附图上限为 ${MAX_TOOL_IMAGES} 张（已挂载前 ${attachedCount} 张）。其余 ${unattachedCount} 张已安全保存入库，可在后继步骤中分批查看或直接在文档中用 moji:static/<uuid> 引用。`
              : `全部 ${attachedCount} 张图片均已附在下一步视觉通道中。`),
        }
      }

      const req = normalizeSeeItem(first)
      if (!req) {
        return {
          error:
            'see 需要一张图或一份 PDF：api.see(\'https://…/图.png\')、api.see({ pdf: \'https://…/论文.pdf\', page: 3 })、' +
            "api.see({ base64: '…', mime: 'image/png', name: '叫什么', caption: '图1说明', order: 1 })，或传数组批量处理 api.see([...])。",
        }
      }
      return see(req)
    }, log)
  }
}
