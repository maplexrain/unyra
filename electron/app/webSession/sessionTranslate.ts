/**
 * 极速翻译（免费公用）：网络分发器与翻译核心。
 * 分发器优先解析系统/会话代理，未解析时回退系统环境变量代理；核心先直连
 * Google Translate 公共 RPC，超时或不可达时无缝降级 MyMemory 免费服务。
 * 纯文字翻译，零 Token 消耗、无需用户配置 Key。
 */
import { session } from 'electron'
import { ProxyAgent } from 'undici'
import { detectSourceLanguage, isMyMemoryError, normalizeLangForMyMemory } from '../../../shared/translation'
import type { WebFastTranslateResult } from '../../../shared/ipc'
import { WEB_PARTITION } from './sessionPartition'

let cachedProxyUrl = ''
let cachedProxyAgent: ProxyAgent | undefined

/**
 * 获取翻译网络请求的分发器：优先解析系统/会话代理，未解析时回退至系统环境变量代理。
 * Node.js 原生 fetch 默认不穿透 HTTP_PROXY/HTTPS_PROXY，在此补全以支持海外直连公共翻译 RPC。
 */
export async function getTranslationDispatcher(targetUrl: string): Promise<ProxyAgent | undefined> {
  let proxy = ''
  try {
    if (session && typeof session.fromPartition === 'function') {
      const ses = session.fromPartition(WEB_PARTITION)
      if (ses && typeof ses.resolveProxy === 'function') {
        const resolved = await ses.resolveProxy(targetUrl)
        const match = resolved.match(/PROXY\s+([^;\s]+)/i)
        if (match && match[1]) {
          proxy = match[1].startsWith('http') ? match[1] : `http://${match[1]}`
        }
      }
    }
  } catch {
    // 忽略 resolveProxy 异常
  }

  if (!proxy) {
    const envProxy =
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
    if (envProxy) {
      proxy = envProxy.trim()
    }
  }

  if (!proxy) return undefined

  if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
    proxy = `http://${proxy}`
  }

  if (proxy === cachedProxyUrl && cachedProxyAgent) {
    return cachedProxyAgent
  }

  try {
    cachedProxyAgent = new ProxyAgent(proxy)
    cachedProxyUrl = proxy
    return cachedProxyAgent
  } catch {
    return undefined
  }
}

/**
 * 极速双语/文本翻译核心：优先直连 Google Translate 公共接口，超时或不可达时无缝降级至 MyMemory 免费服务。
 * 纯文字翻译，零 Token 消耗、无需用户配置 Key。支持网络代理调度与防止同文回写/超额警告污染。
 */
export async function fastTranslateCore(text: string, targetLang = 'zh-CN'): Promise<WebFastTranslateResult> {
  const clean = text.trim()
  if (!clean) return { ok: true, text: '' }

  // 1. 尝试 Google Translate 公开 RPC (先 translate.googleapis.com，次选 translate.google.com)
  const googleHosts = ['translate.googleapis.com', 'translate.google.com']
  for (const host of googleHosts) {
    const googleUrl =
      `https://${host}/translate_a/single?client=gtx&sl=auto&tl=` +
      encodeURIComponent(targetLang) +
      '&dt=t&q=' +
      encodeURIComponent(clean)
    try {
      const dispatcher = await getTranslationDispatcher(googleUrl)
      const res = await fetch(googleUrl, {
        signal: AbortSignal.timeout(2500),
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit)
      if (res.ok) {
        const data = (await res.json()) as unknown
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const translated = data[0]
            .map((item) => (Array.isArray(item) ? item[0] : ''))
            .filter(Boolean)
            .join('')
            .trim()
          if (translated && translated !== clean) {
            return { ok: true, text: translated, source: 'google' }
          }
        }
      }
    } catch {
      // 超时或不可达，尝试下一主机或平滑降级
    }
  }

  // 2. 降级走 MyMemory 免费公共翻译接口（国内免代理直连）
  // 注意：MyMemory 不支持 'auto' 源语言代码，必须显式传递识别到的语种代码，且需过滤错误提示
  try {
    const detectedSrc = detectSourceLanguage(clean, targetLang)
    const normSrc = normalizeLangForMyMemory(detectedSrc)
    const normTgt = normalizeLangForMyMemory(targetLang)

    if (normSrc.toLowerCase() === normTgt.toLowerCase()) {
      return { ok: true, text: clean, source: 'mymemory' }
    }

    const langpair = `${normSrc}|${normTgt}`
    const myMemoryUrl =
      'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(clean) +
      '&langpair=' +
      encodeURIComponent(langpair)
    const dispatcher = await getTranslationDispatcher(myMemoryUrl)
    const res = await fetch(myMemoryUrl, {
      signal: AbortSignal.timeout(5000),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit)
    if (res.ok) {
      const data = (await res.json()) as {
        responseData?: { translatedText?: string }
        responseStatus?: number | string
      }
      const translated = data?.responseData?.translatedText?.trim()
      if (
        translated &&
        !isMyMemoryError(translated, data?.responseStatus) &&
        translated !== clean
      ) {
        return { ok: true, text: translated, source: 'mymemory' }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }

  return { ok: false, error: '极速翻译接口暂时不可用，请稍后重试或切换为 AI 翻译' }
}
