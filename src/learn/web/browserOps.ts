import type {
  BrowserClickResult,
  BrowserEvalResult,
  BrowserFillResult,
  BrowserIndexResult,
  BrowserInspectOpts,
  BrowserInspectResult,
  BrowserOps,
  BrowserPressResult,
  BrowserQueryOpts,
  BrowserQueryResult,
  BrowserScreenshotOpts,
  BrowserScrollResult,
  BrowserTabInfo,
  BrowserTarget,
  BrowserTextResult,
  BrowserTypeOpts,
  BrowserTypeResult,
  BrowserWaitForOpts,
  BrowserWaitForResult,
  BrowserToImageOpts,
  BrowserToImageResult,
  BrowserToMarkdownOpts,
  BrowserToMarkdownResult,
} from '../../agent/sandbox/types'
import type { LearnStore, TabRef, WebTabMeta } from '../types'
import { findTab, focusedGroup, groupIdOfTab } from '../groups'
import { normalizeWebInput } from '../webUrl'
import { buildRuntimeExecScript } from './browserRuntimeScript'
import { webviewOf } from './webviewRegistry'
import { saveScreenshot } from '../screenshots'

/**
 * browser.* 的宿主实现（沙箱里 api.browser.* 的真身，见 agent/sandbox/types 的 BrowserOps）。
 * 涵盖网页页签生命周期（open / tabs / activate / close）与基础读写（index / text / inspect / click / fill / press / scroll）。
 */
export interface BrowserDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  /** 开一个网页页签（url 在里面归一），回页签 id */
  openWebTab: (url: string) => string
  activateTab: (tabId: string) => void
  closeTab: (groupId: string, tabId: string, mode: 'self', opts?: { confirm?: boolean }) => void
  /** web 页签的活信息（真标题/加载态）；每次渲染都是最新的一份 */
  webMeta: Record<string, WebTabMeta>
  /** 在指定网页访客环境（guest）中执行 JavaScript 并获取返回值 */
  execJs?: (tabId: string, script: string) => Promise<unknown>
}

type WebTabRef = Extract<TabRef, { kind: 'web' }>

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

async function stitchSlicesToDataUrl(
  slices: Array<{ dataUrl: string; width: number; height: number }>,
  totalWidth: number,
  totalHeight: number,
  format: 'png' | 'jpeg' = 'png',
  quality = 0.92,
): Promise<string> {
  if (slices.length === 0) return ''
  if (slices.length === 1) return slices[0].dataUrl

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, totalWidth)
    canvas.height = Math.max(1, totalHeight)
    const ctx = canvas.getContext('2d')
    if (ctx) {
      let currentY = 0
      for (const slice of slices) {
        if (!slice.dataUrl) continue
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            try {
              ctx.drawImage(img, 0, currentY, slice.width, slice.height)
            } catch (e) {}
            currentY += slice.height
            resolve()
          }
          img.onerror = () => {
            currentY += slice.height
            resolve()
          }
          img.src = slice.dataUrl
        })
      }
      try {
        return canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', quality)
      } catch (e) {}
    }
  }
  return slices[0].dataUrl
}

export function makeBrowserOps(deps: BrowserDeps, _goalId?: string): BrowserOps {
  const titleOf = (tabId: string, ref: WebTabRef): string =>
    deps.webMeta[tabId]?.title ?? (ref.url ? hostOf(ref.url) : '（起始页）')

  /** 解析目标页签：给 tabId 就查；不给就取焦点格正在看着的那个网页页签 */
  const resolveTab = (tabId?: string): { tabId: string; ref: WebTabRef } => {
    const s = deps.getLatest()
    if (tabId) {
      const tab = findTab(s.docArea, tabId)
      if (!tab || tab.ref.kind !== 'web') {
        throw new Error('没有这个网页页签：' + tabId + '。先 api.browser.tabs() 看一眼存活的页签。')
      }
      return { tabId, ref: tab.ref }
    }
    const group = focusedGroup(s.docArea)
    const tab = group?.tabs.find((t) => t.id === group.active)
    if (!tab || tab.ref.kind !== 'web') {
      throw new Error('当前焦点格中没有正在浏览的网页页签。先 api.browser.tabs() 查看存活页签，或显式传入 tabId。')
    }
    return { tabId: tab.id, ref: tab.ref }
  }

  /** 在页面访客进程中执行代码并拿到返回值 */
  const executeInPage = async <T>(tabId: string | undefined, fnCall: string): Promise<T> => {
    const { tabId: resolvedId } = resolveTab(tabId)
    const script = buildRuntimeExecScript(fnCall)

    try {
      if (deps.execJs) {
        return (await deps.execJs(resolvedId, script)) as T
      }

      const wv = webviewOf(resolvedId)
      if (wv && typeof wv.executeJavaScript === 'function') {
        return (await wv.executeJavaScript(script)) as T
      }

      throw new Error('未能连接到网页执行环境（网页页签未挂载或已销毁）：' + resolvedId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err))
      throw new Error(msg)
    }
  }

  return {
    async open(url) {
      const target = normalizeWebInput(url)
      if (!target) throw new Error('要给出网址：api.browser.open("https://…")')
      const tabId = deps.openWebTab(target)
      return {
        tabId,
        url: target,
      }
    },
    tabs() {
      const s = deps.getLatest()
      const out: BrowserTabInfo[] = []
      for (const g of s.docArea.groups) {
        for (const t of g.tabs) {
          if (t.ref.kind !== 'web') continue
          out.push({
            tabId: t.id,
            url: t.ref.url,
            title: titleOf(t.id, t.ref),
            active: g.active === t.id,
            group: g.id,
          })
        }
      }
      return { tabs: out }
    },
    activate(tabId) {
      if (!groupIdOfTab(deps.getLatest().docArea, tabId)) {
        throw new Error('没有这个网页页签：' + tabId + '。先 api.browser.tabs() 看一眼存活的页签。')
      }
      deps.activateTab(tabId)
      return { ok: true }
    },
    close(tabId) {
      const ids = Array.isArray(tabId) ? tabId : [tabId]
      for (const id of ids) {
        const group = groupIdOfTab(deps.getLatest().docArea, id)
        if (!group) {
          throw new Error('没有这个网页页签：' + id + '。先 api.browser.tabs() 看一眼存活的页签。')
        }
        deps.closeTab(group, id, 'self', { confirm: false })
      }
      return { ok: true }
    },
    async index(tabId, opts) {
      return executeInPage<BrowserIndexResult>(tabId, `window.__agentIndex(${JSON.stringify(opts ?? {})})`)
    },
    async text(tabId, target: BrowserTarget, opts) {
      return executeInPage<BrowserTextResult>(tabId, `window.__agentText(${JSON.stringify(target)}, ${JSON.stringify(opts ?? {})})`)
    },
    async inspect(tabId, target: BrowserTarget, opts?: BrowserInspectOpts) {
      return executeInPage<BrowserInspectResult>(tabId, `window.__agentInspect(${JSON.stringify(target)}, ${JSON.stringify(opts ?? {})})`)
    },
    async click(tabId, target: BrowserTarget, opts) {
      const sBefore = deps.getLatest()
      const tabsBefore = sBefore.docArea.groups.flatMap((g) => g.tabs).map((t) => t.id)
      const r = await executeInPage<BrowserClickResult>(
        tabId,
        `window.__agentClick(${JSON.stringify(target)}, ${JSON.stringify(opts ?? {})})`,
      )
      if (opts?.waitAfterMs && opts.waitAfterMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.waitAfterMs))
      }
      const sAfter = deps.getLatest()
      const tabsAfter = sAfter.docArea.groups.flatMap((g) => g.tabs).map((t) => t.id)
      const newTabId = tabsAfter.find((id) => !tabsBefore.includes(id))
      if (newTabId) {
        r.openedTabId = newTabId
        r.navigated = true
      }
      return r
    },
    async fill(tabId, target: BrowserTarget, text: string, opts) {
      return executeInPage<BrowserFillResult>(
        tabId,
        `window.__agentFill(${JSON.stringify(target)}, ${JSON.stringify(text)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async type(tabId, target: BrowserTarget, text: string, opts?: BrowserTypeOpts) {
      return executeInPage<BrowserTypeResult>(
        tabId,
        `window.__agentType(${JSON.stringify(target)}, ${JSON.stringify(text)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async press(tabId, key: string, target?: BrowserTarget) {
      return executeInPage<BrowserPressResult>(
        tabId,
        `window.__agentPress(${JSON.stringify(key)}, ${JSON.stringify(target ?? null)})`,
      )
    },
    async scroll(tabId, opts) {
      return executeInPage<BrowserScrollResult>(tabId, `window.__agentScroll(${JSON.stringify(opts ?? {})})`)
    },
    async query(tabId, selector: string, opts?: BrowserQueryOpts) {
      return executeInPage<BrowserQueryResult>(
        tabId,
        `window.__agentQuery(${JSON.stringify(selector)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async waitFor(tabId, targetOrText: string, opts?: BrowserWaitForOpts) {
      return executeInPage<BrowserWaitForResult>(
        tabId,
        `window.__agentWaitFor(${JSON.stringify(targetOrText)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async screenshot(tabId, opts?: BrowserScreenshotOpts) {
      if (opts?.target !== undefined && opts?.target !== null && opts?.target !== '') {
        return this.toImage(tabId, opts.target, opts)
      }
      const { tabId: resolvedId } = resolveTab(tabId)
      const wv = webviewOf(resolvedId)
      if (!wv && !deps.execJs) {
        return { ok: false, error: '未找到网页视图实例（页签可能未激活或未渲染）' }
      }
      try {
        let nativeImg: any = null
        if (typeof (wv as any).capturePage === 'function') {
          nativeImg = await (wv as any).capturePage()
        }
        if (nativeImg && typeof nativeImg.toDataURL === 'function') {
          const dataUrl = nativeImg.toDataURL()
          const s = deps.getLatest()
          const goalId = _goalId || s.goals?.[0]?.id
          if (goalId) {
            const saved = await saveScreenshot(deps.getLatest, deps.set, goalId, dataUrl, opts?.name || '网页截图')
            if (saved.ok) {
              return {
                ok: true,
                uuid: saved.image.id,
                path: saved.image.rel,
                url: 'moji:static/' + saved.image.id,
                width: nativeImg.getSize?.()?.width,
                height: nativeImg.getSize?.()?.height,
              }
            }
          }
          return { ok: true, url: dataUrl.slice(0, 50) + '...', width: nativeImg.getSize?.()?.width, height: nativeImg.getSize?.()?.height }
        }
        return { ok: true, url: 'webview:captured' }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg }
      }
    },
    async toImage(tabId, target: BrowserTarget, opts?: BrowserToImageOpts): Promise<BrowserToImageResult> {
      const { tabId: resolvedId } = resolveTab(tabId)
      const wv = webviewOf(resolvedId)
      if (!wv && !deps.execJs) {
        return { ok: false, error: '未找到网页视图实例（页签可能未激活或未渲染）' }
      }

      // 1. 准备截图会话：穿透 Shadow DOM、消除遮挡（anti-occlusion）、计算坐标尺寸
      const prep = await executeInPage<{
        ok: boolean
        token?: string
        directDataUrl?: string
        docLeft?: number
        docTop?: number
        totalWidth?: number
        totalHeight?: number
        padding?: number
        full?: boolean
        viewportW?: number
        viewportH?: number
        tag?: string
        error?: string
      }>(tabId, `window.__agentPrepareElementCapture(${JSON.stringify(target)}, ${JSON.stringify(opts ?? {})})`)

      if (!prep || !prep.ok) {
        return { ok: false, error: prep?.error || '准备元素截图失败' }
      }

      const s = deps.getLatest()
      const goalId = _goalId || s.goals?.[0]?.id
      const imgName = opts?.name || (prep.tag ? `DOM元素截图 [${prep.tag}]` : 'DOM元素长图')

      // 2. 如果是 canvas 等原生直接产出无损图
      if (prep.directDataUrl) {
        if (goalId) {
          const saved = await saveScreenshot(deps.getLatest, deps.set, goalId, prep.directDataUrl, imgName)
          if (saved.ok) {
            return {
              ok: true,
              uuid: saved.image.id,
              path: saved.image.rel,
              url: 'moji:static/' + saved.image.id,
              width: prep.totalWidth,
              height: prep.totalHeight,
              tag: prep.tag,
              slices: 1,
            }
          }
        }
        return {
          ok: true,
          url: prep.directDataUrl.slice(0, 50) + '...',
          width: prep.totalWidth,
          height: prep.totalHeight,
          tag: prep.tag,
          slices: 1,
        }
      }

      const token = prep.token!
      try {
        const totalHeight = prep.totalHeight || 300
        const viewportH = prep.viewportH || 800
        const isSingle = totalHeight <= viewportH || opts?.full === false

        // 3. 单屏高度或不展开长图：单次捕获
        if (isSingle) {
          const sliceInfo = await executeInPage<{
            ok: boolean
            rect: { x: number; y: number; width: number; height: number }
            error?: string
          }>(tabId, `window.__agentGetCaptureSlice(${JSON.stringify(token)}, 0)`)

          let nativeImg: any = null
          if (typeof (wv as any).capturePage === 'function') {
            nativeImg = await (wv as any).capturePage(sliceInfo?.rect)
          }

          if (nativeImg && typeof nativeImg.toDataURL === 'function') {
            const dataUrl = nativeImg.toDataURL()
            if (goalId) {
              const saved = await saveScreenshot(deps.getLatest, deps.set, goalId, dataUrl, imgName)
              if (saved.ok) {
                return {
                  ok: true,
                  uuid: saved.image.id,
                  path: saved.image.rel,
                  url: 'moji:static/' + saved.image.id,
                  width: nativeImg.getSize?.()?.width ?? prep.totalWidth,
                  height: nativeImg.getSize?.()?.height ?? totalHeight,
                  tag: prep.tag,
                  slices: 1,
                }
              }
            }
            return {
              ok: true,
              url: dataUrl.slice(0, 50) + '...',
              width: nativeImg.getSize?.()?.width ?? prep.totalWidth,
              height: nativeImg.getSize?.()?.height ?? totalHeight,
              tag: prep.tag,
              slices: 1,
            }
          }
          return { ok: true, url: 'webview:captured', width: prep.totalWidth, height: totalHeight, tag: prep.tag, slices: 1 }
        }

        // 4. 多屏超长文章：分段滚动捕获并无缝拼接为长图
        const slices: Array<{ dataUrl: string; width: number; height: number }> = []
        let currentOffsetY = 0
        const maxLoops = 60
        let loop = 0

        while (currentOffsetY < totalHeight && loop < maxLoops) {
          loop++
          const sliceInfo = await executeInPage<{
            ok: boolean
            rect: { x: number; y: number; width: number; height: number }
            done?: boolean
            error?: string
          }>(tabId, `window.__agentGetCaptureSlice(${JSON.stringify(token)}, ${currentOffsetY})`)

          if (!sliceInfo || !sliceInfo.ok) break

          // 适度防抖等待页面渲染/懒加载
          await new Promise((r) => setTimeout(r, 45))

          let nativeImg: any = null
          if (typeof (wv as any).capturePage === 'function') {
            nativeImg = await (wv as any).capturePage(sliceInfo.rect)
          }

          if (nativeImg && typeof nativeImg.toDataURL === 'function') {
            slices.push({
              dataUrl: nativeImg.toDataURL(),
              width: sliceInfo.rect.width,
              height: sliceInfo.rect.height,
            })
          }

          if (sliceInfo.done || sliceInfo.rect.height <= 0) break
          currentOffsetY += sliceInfo.rect.height
        }

        if (slices.length === 0) {
          return { ok: false, error: '截取元素切片失败（未获得有效图像数据）' }
        }

        const stitchedDataUrl = await stitchSlicesToDataUrl(
          slices,
          prep.totalWidth || 800,
          currentOffsetY,
          opts?.format,
          opts?.quality,
        )

        if (goalId && stitchedDataUrl) {
          const saved = await saveScreenshot(deps.getLatest, deps.set, goalId, stitchedDataUrl, imgName)
          if (saved.ok) {
            return {
              ok: true,
              uuid: saved.image.id,
              path: saved.image.rel,
              url: 'moji:static/' + saved.image.id,
              width: prep.totalWidth,
              height: currentOffsetY,
              tag: prep.tag,
              slices: slices.length,
            }
          }
        }

        return {
          ok: true,
          url: stitchedDataUrl.slice(0, 50) + '...',
          width: prep.totalWidth,
          height: currentOffsetY,
          tag: prep.tag,
          slices: slices.length,
        }
      } finally {
        // 确保无论成功失败，页面受阻样式和滚动位置 100% 还原
        try {
          await executeInPage(tabId, `window.__agentCleanupElementCapture(${JSON.stringify(token)})`)
        } catch (e) {}
      }
    },
    async elementScreenshot(tabId, target, opts) {
      return this.toImage(tabId, target, opts)
    },
    async elementImage(tabId, target, opts) {
      return this.toImage(tabId, target, opts)
    },
    async toMarkdown(tabId, target, opts?: BrowserToMarkdownOpts) {
      return executeInPage<BrowserToMarkdownResult>(
        tabId,
        `window.__agentToMarkdown(${JSON.stringify(target ?? null)}, ${JSON.stringify(opts ?? {})})`,
      )
    },
    async eval(tabId, code: string) {
      return executeInPage<BrowserEvalResult>(
        tabId,
        `window.__agentEval(${JSON.stringify(code)})`,
      )
    },
  }
}
