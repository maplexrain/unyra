/**
 * 这个文件负责导出文档这条线上的零件：PDF 请求的形状、保存对话框的扩展名过滤、纸张与页脚，
 * 以及生产模式下给本地页面注入 CSP 的那一步（file:// 页面的 llm-proxy 放行）。
 */
import { session } from 'electron'
import { t } from '../i18n'
import { LOCAL_FILE_CSP } from '../csp'
import { isDev } from './startup'

/* ---------- 导出文档（file:saveText 与 file:exportPdf 的几块零件） ---------- */

/** PDF 导出请求（形状与 electron/preload.ts、src/lib/native.ts 里那两份各自声明的一致） */
export interface ExportPdfPayload {
  suggestedName?: string
  /** 自带样式的整份 HTML（见 src/lib/exportDoc 的 standaloneHtml） */
  html: string
  pageSize?: string
  landscape?: boolean
  /** 页脚打「第 n / 共 m 页」 */
  pageNumbers?: boolean
}

/**
 * 保存对话框的扩展名过滤。渲染层给什么用什么，但**认不出的项一律丢掉**：
 * 它只是对话框上的一层筛子（用户仍可切到「全部文件」），没必要把没校验过的字符串
 * 直接塞进系统对话框的参数里。
 */
export function saveFilters(raw: unknown): Electron.FileFilter[] | null {
  if (!Array.isArray(raw)) return null
  const out: Electron.FileFilter[] = []
  for (const item of raw) {
    const f = item as { name?: unknown; extensions?: unknown } | null
    const name = typeof f?.name === 'string' && f.name.trim() ? f.name.trim() : t('文件')
    const extensions = Array.isArray(f?.extensions)
      ? f.extensions.map((x) => String(x).replace(/[^a-z0-9]/gi, '')).filter(Boolean)
      : []
    if (extensions.length) out.push({ name, extensions })
  }
  if (!out.length) return null
  out.push({ name: t('全部文件'), extensions: ['*'] })
  return out
}

/** 纸张：认不出的按 A4——宁可给一个正常的默认值，也不要让排版去猜 */
export const pdfPageSize = (raw: unknown): 'A4' | 'A3' | 'Letter' =>
  raw === 'A3' || raw === 'Letter' ? raw : 'A4'

/**
 * PDF 页脚。**只能写内联样式**：页眉页脚由打印管线单独渲染，够不着导出件的样式表
 * （那里面的类一个都取不到）。title / pageNumber / totalPages 是打印管线提供的占位，
 * 会被替换成这份文档的标题与真实页码。
 *
 * 是函数而不是常量：页脚里的「第 n / 共 m 页」走 t()，常量会在 import 时把当时的
 * 语言冻结进去——每次导出现取一份，跟着界面语言走。
 */
export function pdfFooter(): string {
  return (
    '<div style="width:100%;padding:0 14mm;font:9px system-ui,\'Microsoft YaHei\',sans-serif;' +
    'color:#9a9186;display:flex;justify-content:space-between;">' +
    '<span class="title"></span>' +
    '<span>' +
    t('第 <span class="pageNumber"></span> / 共 <span class="totalPages"></span> 页') +
    '</span>' +
    '</div>'
  )
}

/**
 * 生产模式下页面从 file:// 加载，而 llm-proxy 是自定义协议：
 * 需要让 CSP 的 connect-src 放行它，否则请求会被 CSP 挡掉。
 * 开发模式（http://127.0.0.1:port）不加，避免干扰 Vite 的 HMR。
 *
 * 策略本体在 electron/csp.ts：那里写清了为什么必须放行 'unsafe-eval' 与 blob: Worker
 * （沙箱就是靠这两样跑模型写的代码），以及测试怎么把它钉住。
 */
export function installLocalFileCsp(): void {
  if (isDev) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    // 只给本地页面注入，不碰任何远端响应
    if (details.url.startsWith('file://')) {
      headers['Content-Security-Policy'] = [LOCAL_FILE_CSP]
    }
    callback({ responseHeaders: headers })
  })
}
