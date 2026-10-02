/**
 * 内置浏览器的会话与守门（网页页签，渲染层见 src/components/learn/web）。
 *
 * 网页页签用的是 <webview>：guest 是独立进程、默认全沙箱（无 node、无预载脚本），
 * 这里管它周围的三件事——
 * 1. 会话：persist:web 分区当「内置浏览器的 profile」，登录态跨页签、跨重启保留；
 *    UA 伪装成正常 Chrome（Electron 默认 UA 里的 Electron/… 会被 Google 登录这类站点直接拒掉）。
 * 2. 权限：定位、通知、摄像头一概拒绝；只放行剪贴板写入（网页的「复制」按钮）与网页全屏。
 * 3. 出口：guest 的 window.open / target=_blank / 中键新开，一律拦下来开成应用里的
 *    新 web 页签（渲染层 openWebTab 接住）；mailto 交给系统。应用级快捷键（Ctrl+Q/W/L）
 *    焦点在网页里时 DOM 层收不到，从 before-input-event 拦下来转发给主窗口。
 *
 * 下载不挂 will-download：Electron 默认弹系统「另存为」，够用。
 */
import { app, ipcMain, session, shell, webContents, type Debugger, type WebContents } from 'electron'
import { canOpenExternal } from '../link-core'
import { mainWindow } from './mainWindow'
import { axNodesToElements, type AxRawNode } from '../../shared/axTree'
import type { WebSnapshotResult } from '../../shared/ipc'

/**
 * 内置浏览器的分区。渲染层 <webview partition> 与这里是**同一个字符串**（两处必须一致，
 * 各写一份、注释互指）：强制走独立分区，guest 永远摸不到应用自己的 Cookie。
 */
export const WEB_PARTITION = 'persist:web'

/** 焦点在网页里也要能用的应用快捷键：q = 聚焦导师，w = 关页签，l = 新建网页页签 */
const FORWARD_KEYS = new Set(['q', 'w', 'l'])

/* ---------- 页面快照（browser.snapshot）：Accessibility 树 → 带 ref 的元素清单 ---------- */

/**
 * ref 台账：wcId →（ref → DOM 定位信息 + 展示用的 role/name）。
 * 每次快照整表覆盖；页签销毁随手摘掉。ref 是**每页签一份的易碎编号**——
 * 页面一变就可能失效，解析失败一律引导模型重新 snapshot，而不是猜。
 */
const snapshotRefs = new Map<number, Map<number, { backendNodeId: number; role: string; name: string }>>()

function guestOf(wcId: number): WebContents | null {
  const wc = webContents.fromId(wcId)
  return wc && !wc.isDestroyed() ? wc : null
}

/** 按需挂调试通道（Accessibility / DOM 两个域共用）；被占用多半是这页签开着 DevTools。
 *  attach 成功返回即已挂载（同步状态翻转），后续 sendCommand 的失败各自兜底。 */
function ensureDebugger(wc: WebContents): Debugger {
  const dbg = wc.debugger
  if (dbg.isAttached()) return dbg
  try {
    dbg.attach('1.3')
  } catch {
    throw new Error('调试通道被占用（这个页签可能开着开发者工具），拿不到页面快照')
  }
  return dbg
}

function registerSnapshotIpc(): void {
  /** 单条 CDP 命令的兜底超时：页面卡死不该把 IPC 调用无限吊着 */
  function cdp<T>(dbg: Debugger, method: string, params?: object, ms = 12_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(method + ' 超时（页面可能没有响应）')), ms)
      dbg
        .sendCommand(method, params)
        .then(
          (v) => {
            clearTimeout(t)
            resolve(v as T)
          },
          (e: unknown) => {
            clearTimeout(t)
            reject(e instanceof Error ? e : new Error(String(e)))
          },
        )
    })
  }

  ipcMain.handle('web:snapshot', async (_e, wcId: number): Promise<WebSnapshotResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    try {
      const dbg = await ensureDebugger(wc)
      // 开了 Accessibility 域树才算出来；重复 enable 的报错吞掉即可
      await cdp(dbg, 'Accessibility.enable').catch(() => {})
      const { nodes } = await cdp<{ nodes?: AxRawNode[] }>(dbg, 'Accessibility.getFullAXTree', {})
      const { elements, truncated } = axNodesToElements(nodes)
      const refs = new Map<number, { backendNodeId: number; role: string; name: string }>()
      for (const el of elements) {
        if (el.backendNodeId !== undefined) {
          refs.set(el.ref, { backendNodeId: el.backendNodeId, role: el.role, name: el.name })
        }
      }
      snapshotRefs.set(wcId, refs)
      return {
        elements: elements.map(({ ref, role, name, value }) => ({
          ref,
          role,
          name,
          ...(value !== undefined ? { value } : {}),
        })),
        ...(truncated ? { truncated: true } : {}),
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : '页面快照失败' }
    }
  })

  ipcMain.handle(
    'web:locate',
    async (
      _e,
      wcId: number,
      target: { ref?: number; selector?: string },
    ): Promise<{ x: number; y: number } | { error: string }> => {
      const wc = guestOf(wcId)
      if (!wc) return { error: '这一页签的网页已经不在了' }
      let label = ''
      try {
        const dbg = await ensureDebugger(wc)
        await cdp(dbg, 'DOM.enable').catch(() => {})
        // backendNodeId：ref 走台账；selector 现场从 DOM 树查（depth 0 只要根，查询在 CDP 侧的树里做）
        let backendNodeId: number | undefined
        if (typeof target?.ref === 'number') {
          const hit = snapshotRefs.get(wcId)?.get(target.ref)
          if (!hit) return { error: 'ref 不存在或已过期（页面变了）——重新 api.browser.snapshot' }
          backendNodeId = hit.backendNodeId
          label = hit.name ? '（' + hit.role + '「' + hit.name + '」）' : ''
        } else if (typeof target?.selector === 'string' && target.selector.trim()) {
          const sel = target.selector.trim()
          const { root } = await cdp<{ root?: { nodeId?: number } }>(dbg, 'DOM.getDocument', { depth: 0 })
          if (!root?.nodeId) return { error: '拿不到页面的 DOM 树根（页面可能还没挂好）' }
          const { nodeId } = await cdp<{ nodeId?: number }>(dbg, 'DOM.querySelector', {
            nodeId: root.nodeId,
            selector: sel,
          })
          if (!nodeId) {
            return { error: '页面上找不到这个选择器：' + sel + '（跨源 iframe 里的元素定位不到——先 snapshot 换 { ref }）' }
          }
          backendNodeId = nodeId
        } else {
          return { error: '定位目标要给 { ref } 或 { selector }' }
        }
        // 元素多半在视口外：先滚进视野（节点已消失/不可滚的回错吞掉，下一步取四边形兜底）
        await cdp(dbg, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {})
        const { quads } = await cdp<{ quads?: number[][] }>(dbg, 'DOM.getContentQuads', { backendNodeId })
        const quad = quads?.[0]
        if (!quad || quad.length < 8) {
          return { error: '目标现在没有可点的位置（元素可能已经消失了）——重新 api.browser.snapshot 或换坐标' }
        }
        const xs = [quad[0], quad[2], quad[4], quad[6]]
        const ys = [quad[1], quad[3], quad[5], quad[7]]
        return {
          x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
          y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
        }
      } catch {
        return {
          error: '定位失败' + label + '：页面可能已经变了——重新 api.browser.snapshot 或换坐标',
        }
      }
    },
  )
}

export function setupWebBrowser(): void {
  const ses = session.fromPartition(WEB_PARTITION)
  registerSnapshotIpc()

  // 只摘掉 Electron/… 尾巴，版本号用真实 Chromium 的，其余照抄正常 Chrome 的桌面 UA
  ses.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
      process.versions.chrome +
      ' Safari/537.36',
  )

  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  app.on('web-contents-created', (_e, contents) => {
    // 宿主（主窗口 / 考试窗口）：webview 挂上来之前收掉一切特权——纵深防御，
    // 就算渲染层被人改了属性，guest 也拿不到 node 与我们的预载脚本
    if (contents.getType() === 'window') {
      contents.on('will-attach-webview', (_e2, webPreferences, params) => {
        delete webPreferences.preload
        webPreferences.nodeIntegration = false
        if (params.partition !== WEB_PARTITION) params.partition = WEB_PARTITION
      })
      return
    }
    if (contents.getType() !== 'webview') return

    // 页签销毁：ref 台账随手摘掉（台账按 wcId 记，留着也是幽灵键）
    contents.once('destroyed', () => snapshotRefs.delete(contents.id))

    // 网页想开新窗口：一律不开原生窗——http(s) 落成应用里的新 web 页签，mailto 给系统，
    // 其余（data:、blob:…）直接拒
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('mailto:')) void shell.openExternal(url)
      else if (canOpenExternal(url)) mainWindow()?.webContents.send('web:openTab', url)
      return { action: 'deny' }
    })

    contents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      if (!(input.control || input.meta) || input.alt || input.shift) return
      const key = input.key.toLowerCase()
      if (!FORWARD_KEYS.has(key)) return
      e.preventDefault()
      mainWindow()?.webContents.send('web:shortcut', key)
    })
  })
}
