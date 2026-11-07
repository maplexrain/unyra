/**
 * 这个文件负责什么：内置浏览器的 api 装配（browser.*，见 learn/web/browserOps）——
 * 网页页签生命周期（open/tabs/activate/close）、页面读写（index/text/inspect/query）、
 * 交互（click/fill/type/press/scroll/waitFor）、截图与转图（screenshot/toImage/
 * elementImage/elementScreenshot）、落盘（toMarkdown/eval 的 saveTo）。
 * 第一参的 tabId 与目标的解析规则（parseTabAndRest / targetOf）是这里的关键口径。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions, BrowserTarget, BrowserEvalOpts, BrowserToMarkdownOpts } from '../types'

/** 内置浏览器域：browser.* */
export function installBrowser(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 内置浏览器（browser.*，见 learn/web/browserOps）：网页页签生命周期与基础读写
  if (opts.browser) {
    const browser = opts.browser
    const isTabIdStr = (v: unknown): v is string =>
      typeof v === 'string' && (v.startsWith('w:') || v.startsWith('tab-') || v.includes(':'))

    const parseTabAndRest = (args: unknown[]): { tabId: string | undefined; rest: unknown[] } => {
      if (args.length === 0) return { tabId: undefined, rest: [] }
      const first = args[0]
      // 显式给 null 或 undefined 作为占位符，消费掉第一参
      if (first === undefined || first === null) {
        return { tabId: undefined, rest: args.slice(1) }
      }
      // 显式给 tabId 字符串（如 'w:abc', 'tab-1'）
      if (isTabIdStr(first)) {
        return { tabId: first.trim(), rest: args.slice(1) }
      }
      // 第一参就是普通目标或其它参数
      return { tabId: undefined, rest: args }
    }

    const targetOf = (v: unknown): number | string => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string') {
        const trimmed = v.trim()
        const asNum = Number(trimmed)
        if (!isNaN(asNum) && trimmed !== '') return asNum
        return trimmed
      }
      const rec = asRecord(v)
      if (typeof rec.target === 'number' || typeof rec.target === 'string') return targetOf(rec.target)
      if (typeof rec.id === 'number' || typeof rec.id === 'string') return targetOf(rec.id)
      if (typeof rec.ref === 'number' || typeof rec.ref === 'string') return targetOf(rec.ref)
      throw new Error('目标需要给出节点编号数字（如 12）或 CSS 选择器字符串')
    }

    wrapApi(api, 'browser.open', (args) => browser.open(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.tabs', () => browser.tabs(), log)
    wrapApi(api, 'browser.activate', (args) => browser.activate(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.close', (args) => browser.close(Array.isArray(args[0]) ? (args[0].map((v) => asText(v).trim()) as string[]) : asText(args[0]).trim()), log)

    wrapApi(api, 'browser.index', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.index(tabId, rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.index(tabId, asRecord(rest[0]))
    }, log)

    wrapApi(api, 'browser.text', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'id' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.text(tabId, targetOf(rec.target ?? rec.id), rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.text(tabId, targetOf(rest[0]), asRecord(rest[1]))
    }, log)

    wrapApi(api, 'browser.inspect', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'id' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.inspect(tabId, targetOf(rec.target ?? rec.id), rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.inspect(tabId, targetOf(rest[0]), asRecord(rest[1]))
    }, log)

    wrapApi(api, 'browser.click', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'id' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.click(tabId, targetOf(rec.target ?? rec.id), rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.click(tabId, targetOf(rest[0]), asRecord(rest[1]))
    }, log)

    wrapApi(api, 'browser.fill', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'id' in first) && ('text' in first || 'value' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        const text = asText(rec.text ?? rec.value)
        return browser.fill(tabId, targetOf(rec.target ?? rec.id), text, rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.fill(tabId, targetOf(rest[0]), asText(rest[1]), asRecord(rest[2]))
    }, log)

    wrapApi(api, 'browser.type', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'id' in first) && ('text' in first || 'value' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        const text = asText(rec.text ?? rec.value)
        return browser.type(tabId, targetOf(rec.target ?? rec.id), text, rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.type(tabId, targetOf(rest[0]), asText(rest[1]), asRecord(rest[2]))
    }, log)

    wrapApi(api, 'browser.press', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && 'key' in first) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        const key = asText(rec.key).trim()
        const target = (rec.target !== undefined || rec.id !== undefined) ? targetOf(rec.target ?? rec.id) : undefined
        return browser.press(tabId, key, target)
      }
      const { tabId, rest } = parseTabAndRest(args)
      const key = asText(rest[0]).trim()
      const target = rest[1] !== undefined ? targetOf(rest[1]) : undefined
      return browser.press(tabId, key, target)
    }, log)

    wrapApi(api, 'browser.scroll', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.scroll(tabId, rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.scroll(tabId, asRecord(rest[0]))
    }, log)

    wrapApi(api, 'browser.query', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && 'selector' in first) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.query(tabId, asText(rec.selector).trim(), rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.query(tabId, asText(rest[0]).trim(), asRecord(rest[1]))
    }, log)

    wrapApi(api, 'browser.waitFor', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'text' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.waitFor(tabId, asText(rec.target ?? rec.text).trim(), rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.waitFor(tabId, asText(rest[0]).trim(), asRecord(rest[1]))
    }, log)

    wrapApi(api, 'browser.screenshot', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        return browser.screenshot(tabId, rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      return browser.screenshot(tabId, asRecord(rest[0]))
    }, log)

    wrapApi(api, 'browser.toImage', (args) => {
      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'selector' in first)) {
        const rec = first as Record<string, unknown>
        const tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        const target = (rec.target ?? rec.selector) as BrowserTarget
        return browser.toImage(tabId, target, rec)
      }
      const { tabId, rest } = parseTabAndRest(args)
      const target = (typeof rest[0] === 'number' ? rest[0] : asText(rest[0]).trim()) as BrowserTarget
      return browser.toImage(tabId, target, asRecord(rest[1]))
    }, log)

    wrapApi(api, 'browser.elementImage', (args) => {
      const b = (api as any).browser
      return b.toImage(...args)
    }, log)

    wrapApi(api, 'browser.elementScreenshot', (args) => {
      const b = (api as any).browser
      return b.toImage(...args)
    }, log)

    wrapApi(api, 'browser.toMarkdown', async (args) => {
      let tabId: string | undefined
      let target: BrowserTarget | undefined
      let optsObj: BrowserToMarkdownOpts = {}

      const first = args[0]
      if (first && typeof first === 'object' && ('target' in first || 'saveTo' in first)) {
        const rec = first as Record<string, unknown>
        tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        if (rec.target !== undefined) target = targetOf(rec.target)
        if (typeof rec.saveTo === 'string') optsObj.saveTo = rec.saveTo.trim()
        if (typeof rec.maxChars === 'number') optsObj.maxChars = rec.maxChars
      } else {
        const { tabId: parsedTabId, rest } = parseTabAndRest(args)
        tabId = parsedTabId
        if (rest[0] !== undefined) {
          if (typeof rest[0] === 'object' && rest[0] !== null && ('saveTo' in rest[0] || 'maxChars' in rest[0])) {
            const rec = rest[0] as Record<string, unknown>
            if (typeof rec.saveTo === 'string') optsObj.saveTo = rec.saveTo.trim()
            if (typeof rec.maxChars === 'number') optsObj.maxChars = rec.maxChars
          } else {
            target = targetOf(rest[0])
            const optArg = rest[1]
            if (optArg && typeof optArg === 'object') {
              const rec = optArg as Record<string, unknown>
              if (typeof rec.saveTo === 'string') optsObj.saveTo = rec.saveTo.trim()
              if (typeof rec.maxChars === 'number') optsObj.maxChars = rec.maxChars
            }
          }
        }
      }

      const res = await browser.toMarkdown(tabId, target, optsObj)
      if (!res.ok || !optsObj.saveTo) {
        return res
      }

      if (!opts.workspace) {
        return { ok: false, error: 'saveTo 需要工作区支持，但当前未配置 workspace' }
      }
      const rawText = res.markdown || ''
      const saveRes = (await opts.workspace.write({
        path: optsObj.saveTo,
        content: rawText,
      })) as { error?: string; path?: string; rel?: string }

      if (saveRes && saveRes.error) {
        return { ok: false, error: '落盘保存到工作区失败：' + saveRes.error }
      }

      const lines = rawText.split(/\r?\n/).length
      return {
        ok: true,
        saved: true,
        path: saveRes?.path ?? optsObj.saveTo,
        rel: saveRes?.rel,
        chars: rawText.length,
        lines,
        diagnostics: res.diagnostics,
        note: `DOM 元素已成功转换为 Markdown 并落盘至工作区「${saveRes?.path ?? optsObj.saveTo}」（共 ${rawText.length} 字符，${lines} 行），避免占用上下文。可使用 api.workspace.grep 检索或在文档中以 quote 原文引用。`,
      }
    }, log)

    wrapApi(api, 'browser.eval', async (args) => {
      let tabId: string | undefined
      let evalCode = ''
      let evalOpts: BrowserEvalOpts | undefined

      const first = args[0]
      if (first && typeof first === 'object' && 'code' in first) {
        const rec = first as Record<string, unknown>
        tabId = typeof rec.tabId === 'string' ? rec.tabId : undefined
        evalCode = asText(rec.code)
        if (typeof rec.saveTo === 'string' && rec.saveTo.trim()) {
          evalOpts = { saveTo: rec.saveTo.trim() }
        }
      } else {
        const { tabId: parsedTabId, rest } = parseTabAndRest(args)
        tabId = parsedTabId
        evalCode = asText(rest[0])
        const optArg = rest[1]
        if (optArg && typeof optArg === 'object' && 'saveTo' in optArg) {
          const rec = optArg as Record<string, unknown>
          if (typeof rec.saveTo === 'string' && rec.saveTo.trim()) {
            evalOpts = { saveTo: rec.saveTo.trim() }
          }
        }
      }

      const res = await browser.eval(tabId, evalCode, evalOpts)
      if (!res.ok || !evalOpts?.saveTo) {
        return res
      }

      if (!opts.workspace) {
        return { ok: false, error: 'saveTo 需要工作区支持，但当前未配置 workspace' }
      }
      const rawText = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)
      const saveRes = (await opts.workspace.write({
        path: evalOpts.saveTo,
        content: rawText,
      })) as { error?: string; path?: string; rel?: string }

      if (saveRes && saveRes.error) {
        return { ok: false, error: '落盘保存到工作区失败：' + saveRes.error }
      }

      const lines = rawText.split(/\r?\n/).length
      return {
        ok: true,
        saved: true,
        path: saveRes?.path ?? evalOpts.saveTo,
        rel: saveRes?.rel,
        chars: rawText.length,
        lines,
        note: `执行结果已成功写入工作区文件「${saveRes?.path ?? evalOpts.saveTo}」（共 ${rawText.length} 字符，${lines} 行），避免占用上下文。可用 api.workspace.grep 定向检索行号，或在文档中以引用使用。`,
      }
    }, log)
  }
}
