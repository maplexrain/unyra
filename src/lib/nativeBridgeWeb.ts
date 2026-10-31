/**
 * WebUI 运行环境下的原生桥适配器 (WebNativeBridge)。
 *
 * 当 Unyra 运行在常规现代浏览器（Safari, Chrome, Edge, Firefox, iPad 等）而非 Electron 桌面壳中时，
 * 此适配器接管 window.mojiNative 的全部能力，通过标准 HTTP fetch 与 WebSocket 将调用
 * 路由到本地 Node.js 微服务 (http://localhost:3800)。
 */

import type {
  NativeBridge,
} from './native'
import type {
  CloseBehavior,
  ExportPdfPayload,
  ExportPdfResult,
  FlushItem,
  NoticeSettings,
  SaveFilter,
  StorageFail,
  StorageInfo,
  StorageOk,
  StorageRootResult,
  UpdateChannel,
  UpdateState,
  VoiceDownloadResult,
  VoiceModelStatus,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
  ScreenCaptureResult,
  ImageSavePayload,
} from '../../shared/ipc'

// 本地微服务的基础地址（同一主机端口，或跨端口开发调试时指定）
const getApiBase = (): string => {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3800'
  return ''
}

const apiFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const url = `${getApiBase()}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok && res.status >= 500) {
    const errJson = await res.json().catch(() => ({}))
    throw new Error(errJson.error || `服务端请求失败: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// 单例 WebSocket 实例
let wsClient: WebSocket | null = null
const wsChangeListeners = new Set<() => void>()

function ensureWebSocket(): void {
  if (typeof window === 'undefined' || wsClient) return
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.port === '5173' ? 'localhost:3800' : window.location.host
  try {
    wsClient = new WebSocket(`${protocol}//${host}/ws`)
    wsClient.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'ws:changed') {
          for (const cb of wsChangeListeners) {
            try { cb() } catch {}
          }
        }
      } catch {}
    }
    wsClient.onclose = () => {
      wsClient = null
      setTimeout(ensureWebSocket, 3000)
    }
  } catch {}
}

export function createWebNativeBridge(): NativeBridge {
  ensureWebSocket()

  const bridge: NativeBridge = {
    isElectron: true as const,
    platform: 'darwin', // 在 Web 模式下默认行为采用标准类 Unix/Mac 习惯 (无窗口右上角自绘按钮)

    setProxyHosts: (hosts: string[]): Promise<string[]> =>
      apiFetch<{ ok: boolean; hosts: string[] }>('/api/proxy/setHosts', {
        method: 'POST',
        body: JSON.stringify({ hosts }),
      }).then((r) => r.hosts ?? []),

    getProxyHosts: (): Promise<string[]> =>
      apiFetch<{ ok: boolean; hosts: string[] }>('/api/proxy/getHosts').then((r) => r.hosts ?? []),

    saveText: async (payload: { suggestedName?: string; content: string; title?: string; filters?: SaveFilter[] }) => {
      try {
        const blob = new Blob([payload.content], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = payload.suggestedName || 'download.txt'
        a.click()
        URL.revokeObjectURL(url)
        return { ok: true, path: a.download }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    },

    exportPdf: async (payload: ExportPdfPayload): Promise<ExportPdfResult> => {
      window.print()
      return { ok: true, path: payload.suggestedName || 'export.pdf', bytes: 0 }
    },

    pathForFile: (file: File) => file.name,

    local: {
      read: (p: string) => apiFetch('/api/base/files/read', { method: 'POST', body: JSON.stringify({ path: p }) }),
      readMedia: (p: string) => apiFetch('/api/storage/readImage', { method: 'POST', body: JSON.stringify({ rel: p }) }),
      write: (p: string, content: string) => apiFetch('/api/base/files/write', { method: 'POST', body: JSON.stringify({ path: p, content }) }),
      reveal: () => Promise.resolve({ ok: true }),
      pick: () => Promise.resolve({ ok: false, canceled: true }),
      pickAttach: () => Promise.resolve({ ok: false, canceled: true }),
      readAttach: (p: string) => apiFetch('/api/base/files/read', { method: 'POST', body: JSON.stringify({ path: p }) }),
      watch: () => Promise.resolve({ ok: true }),
      onChanged: () => () => {},
    },

    ws: {
      watch: (dirs: string[]) => apiFetch('/api/storage/ws/watch', { method: 'POST', body: JSON.stringify(dirs) }),
      onChanged: (cb: () => void) => {
        wsChangeListeners.add(cb)
        return () => wsChangeListeners.delete(cb)
      },
    },

    storage: {
      info: () => apiFetch<StorageInfo>('/api/storage/info'),
      setRoot: (dir?: string) => apiFetch<StorageRootResult>('/api/storage/setRoot', { method: 'POST', body: JSON.stringify({ dir }) }),
      pickRoot: () => apiFetch<{ ok: boolean; canceled?: boolean; root?: string; error?: string }>('/api/storage/pickRoot', { method: 'POST' }),
      list: (rel: string) => apiFetch('/api/storage/list', { method: 'POST', body: JSON.stringify({ rel }) }),
      read: (rel: string) => apiFetch('/api/storage/read', { method: 'POST', body: JSON.stringify({ rel }) }),
      write: (rel: string, content: string) => apiFetch<StorageOk | StorageFail>('/api/storage/write', { method: 'POST', body: JSON.stringify({ rel, content }) }),
      writeImage: (rel: string, dataUrl: string) => apiFetch<StorageOk | StorageFail>('/api/storage/writeImage', { method: 'POST', body: JSON.stringify({ rel, dataUrl }) }),
      readImage: (rel: string) => apiFetch('/api/storage/readImage', { method: 'POST', body: JSON.stringify({ rel }) }),
      writeBinary: (rel: string, dataUrl: string) => apiFetch<StorageOk | StorageFail>('/api/storage/writeBinary', { method: 'POST', body: JSON.stringify({ rel, dataUrl }) }),
      readBinary: (rel: string) => apiFetch('/api/storage/readBinary', { method: 'POST', body: JSON.stringify({ rel }) }),
      move: (from: string, to: string) => apiFetch<StorageOk | StorageFail>('/api/storage/move', { method: 'POST', body: JSON.stringify({ from, to }) }),
      copy: (from: string, to: string) => apiFetch<StorageOk | StorageFail>('/api/storage/copy', { method: 'POST', body: JSON.stringify({ from, to }) }),
      remove: (rel: string) => apiFetch<StorageOk | StorageFail>('/api/storage/remove', { method: 'POST', body: JSON.stringify({ rel }) }),
      mkdir: (rel: string) => apiFetch<StorageOk | StorageFail>('/api/storage/mkdir', { method: 'POST', body: JSON.stringify({ rel }) }),
      reveal: () => Promise.resolve({ ok: true }),
      readYaml: (rel: string) => apiFetch('/api/storage/readYaml', { method: 'POST', body: JSON.stringify({ rel }) }),
      writeYaml: (rel: string, data: unknown) => apiFetch<StorageOk | StorageFail>('/api/storage/writeYaml', { method: 'POST', body: JSON.stringify({ rel, data }) }),
      readSession: () => apiFetch('/api/storage/readSession'),
      writeSession: (data: unknown) => apiFetch<StorageOk | StorageFail>('/api/storage/writeSession', { method: 'POST', body: JSON.stringify({ data }) }),
      flush: (items: FlushItem[]) => {
        void apiFetch('/api/storage/flush', { method: 'POST', body: JSON.stringify(items) })
        return { ok: true, failed: [] }
      },
    },

    mcp: {
      discover: (server) => apiFetch('/api/mcp/discover', { method: 'POST', body: JSON.stringify({ server }) }),
      call: (server, tool, args) => apiFetch('/api/mcp/call', { method: 'POST', body: JSON.stringify({ server, tool, args }) }),
      stop: (serverId?: string) => apiFetch('/api/mcp/stop', { method: 'POST', body: JSON.stringify({ serverId }) }),
    },

    plugins: {
      list: () => Promise.resolve({ ok: true, dir: '', entries: [] }),
      read: () => Promise.resolve({ ok: false, error: 'WebUI 模式暂不支持本地外部插件' }),
      setEnabled: () => Promise.resolve({ ok: true }),
      reveal: () => Promise.resolve({ ok: true }),
      toggles: () => Promise.resolve({ ok: true, toggles: {} }),
      setToggle: () => Promise.resolve({ ok: true }),
      // 插件配置只存在于桌面端（safeStorage 在主进程）
      settingsGet: () => Promise.resolve({ ok: false, error: '插件配置仅桌面端可用' }),
      settingsSet: () => Promise.resolve({ ok: false, error: '插件配置仅桌面端可用' }),
    },

    runner: {
      artifacts: () => Promise.resolve({ ok: true, items: {}, silent: {} }),
      putArtifact: () => Promise.resolve({ ok: true }),
      putSilent: () => Promise.resolve({ ok: true }),
      clearArtifacts: () => Promise.resolve({ ok: true }),
      fetch: (url, init) => apiFetch('/api/web/fetch', { method: 'POST', body: JSON.stringify({ url, ...init }) }),
    },

    voice: {
      modelStatus: () => apiFetch<VoiceModelStatus>('/api/voice/status'),
      downloadModel: () => apiFetch<VoiceDownloadResult>('/api/voice/download', { method: 'POST' }),
      cancelDownload: () => Promise.resolve(true),
      chooseModel: () => Promise.resolve({ ok: false, canceled: true }),
      removeModel: () => apiFetch('/api/voice/remove', { method: 'POST' }),
      transcribe: (req: VoiceTranscribeRequest) =>
        apiFetch<VoiceTranscribeResult>('/api/voice/transcribe', {
          method: 'POST',
          body: JSON.stringify({
            ...req,
            samples: req.samples ? Array.from(req.samples) : [],
          }),
        }),
      gpuInfo: () => apiFetch('/api/voice/gpuInfo'),
      revealModel: () => Promise.resolve(true),
      onModelProgress: () => () => {},
    },

    update: {
      state: () => Promise.resolve({ phase: 'idle' } as UpdateState),
      check: () => Promise.resolve({ phase: 'idle' } as UpdateState),
      download: () => Promise.resolve({ phase: 'idle' } as UpdateState),
      getAuto: () => Promise.resolve(false),
      setAuto: () => Promise.resolve(false),
      getChannel: () => Promise.resolve('stable' as UpdateChannel),
      setChannel: (c) => Promise.resolve(c),
      install: () => Promise.resolve({ ok: false }),
      openRelease: () => { window.open('https://github.com/maplexrain/unyra/releases', '_blank'); return Promise.resolve(true) },
      onState: () => () => {},
    },

    window: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => { window.close() },
      isMaximized: () => Promise.resolve(false),
      devtools: () => {},
      onMaximizeChange: () => () => {},
      beep: () => {},
      capture: () => Promise.resolve({ ok: false, error: 'Web 模式下不支持全屏截图' }),
      logoSource: () => Promise.resolve(''),
      setAppIcon: () => Promise.resolve(true),
      notify: async (payload) => {
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'granted') {
            new Notification(payload.title, { body: payload.body })
            return { ok: true }
          }
          if (Notification.permission !== 'denied') {
            const p = await Notification.requestPermission()
            if (p === 'granted') {
              new Notification(payload.title, { body: payload.body })
              return { ok: true }
            }
          }
        }
        return { ok: true }
      },
      flashTop: () => {},
      getFocusedApp: async () => {
        try {
          const res = await apiFetch<{ ok: boolean; app: string }>('/api/guard/focusedApp')
          return res.app || 'Unyra'
        } catch {
          return 'Unyra (Web 模式)'
        }
      },
    },

    examHost: {
      open: () => Promise.resolve({ ok: true, reused: true }),
      push: () => {},
      close: () => {},
      onEvent: () => () => {},
      onClosed: () => () => {},
    },

    examGuest: {
      emit: () => {},
      onState: () => () => {},
      onConfirmClose: () => () => {},
      setFullscreen: () => {},
      allowClose: () => {},
    },

    // 上下文轨迹窗口是 Electron 独立窗口，Web 模式没有主进程可开窗：全给空实现
    traceHost: {
      open: () => Promise.resolve({ ok: false, error: '上下文轨迹窗口仅桌面端可用' }),
      push: () => {},
      onClosed: () => () => {},
    },

    traceGuest: {
      onState: () => () => {},
    },

    notice: {
      get: () => apiFetch<NoticeSettings>('/api/notice/get'),
      set: (patch: Partial<NoticeSettings>) =>
        apiFetch<NoticeSettings>('/api/notice/set', { method: 'POST', body: JSON.stringify(patch) }),
    },

    shell: {
      getCloseBehavior: () => Promise.resolve('close' as CloseBehavior),
      setCloseBehavior: () => Promise.resolve('close' as CloseBehavior),
      decideClose: () => Promise.resolve({ ok: true, behavior: 'close' as CloseBehavior }),
      openExternal: (url: string) => { window.open(url, '_blank'); return Promise.resolve(true) },
      hideToTray: () => {},
      onCloseRequested: () => () => {},
    },

    web: {
      fetch: (url: string) => apiFetch('/api/web/fetch', { method: 'POST', body: JSON.stringify({ url }) }),
      // Web 模式没有主进程的二进制图片通道；see(url) 在这一模式下会拿到这句明确回执
      fetchBinary: async () => ({ ok: false as const, error: 'Web 模式暂不支持抓取网络二进制（图片/PDF），可改用 base64 传入' }),
    },

    // 视频学习（实验）在 Web 模式不可用：媒体中转协议只存在于桌面端主进程里
    video: {
      fetch: async () => ({ ok: false as const, error: '视频学习仅桌面端可用' }),
      openStream: async () => ({ ok: false as const, error: '视频学习仅桌面端可用' }),
    },

    browser: {
      onOpenTab: () => () => {},
      onShortcut: () => () => {},
      onGuestInput: () => () => {},
      onTranslate: () => () => {},
      fastTranslate: (t) => Promise.resolve({ ok: true, text: t }),
      snapshot: () => Promise.resolve({ elements: [] }),
      point: () => Promise.resolve({ ok: true }),
      domOp: () => Promise.resolve({ ok: true }),
      readHtml: () => Promise.resolve({ error: 'Web 模式下直接通过阅读视图呈现' }),
      logs: () => Promise.resolve({ lines: [], shown: 0, totalConsole: 0, totalNetwork: 0, latestSeq: 0, truncated: false }),
      logDetail: () => Promise.resolve({ error: 'Web 模式下不支持' }),
      pageFetch: () => Promise.resolve({ error: 'Web 模式下不支持' }),
      record: () => Promise.resolve({ error: 'Web 模式下不支持' }),
      text: () => Promise.resolve({ text: '', chars: 0 }),
      scroll: () => Promise.resolve({ ok: true, scrollY: 0, scrollHeight: 0, viewport: 0, atBottom: true, atTop: true }),
      waitFor: () => Promise.resolve({ ok: true, matched: 'load', waitedMs: 0, url: '' }),
    },

    files: {
      read: (p, opts) => apiFetch('/api/base/files/read', { method: 'POST', body: JSON.stringify({ path: p, opts }) }),
      write: (p, content, opts) => apiFetch('/api/base/files/write', { method: 'POST', body: JSON.stringify({ path: p, content, opts }) }),
      edit: (p, opts) => apiFetch('/api/base/files/edit', { method: 'POST', body: JSON.stringify({ path: p, opts }) }),
      list: (p) => apiFetch('/api/base/files/list', { method: 'POST', body: JSON.stringify({ path: p }) }),
      stat: (p) => apiFetch('/api/base/files/stat', { method: 'POST', body: JSON.stringify({ path: p }) }),
      mkdir: (p) => apiFetch('/api/base/files/mkdir', { method: 'POST', body: JSON.stringify({ path: p }) }),
      copy: (from, to, opts) => apiFetch('/api/base/files/copy', { method: 'POST', body: JSON.stringify({ from, to, opts }) }),
      move: (from, to) => apiFetch('/api/base/files/move', { method: 'POST', body: JSON.stringify({ from, to }) }),
      delete: (p) => apiFetch('/api/base/files/delete', { method: 'POST', body: JSON.stringify({ path: p }) }),
      onChanged: () => () => {},
    },

    process: {
      create: (opts) => apiFetch('/api/base/process/create', { method: 'POST', body: JSON.stringify({ opts }) }),
      start: (id) => apiFetch('/api/base/process/start', { method: 'POST', body: JSON.stringify({ id }) }),
      status: (id) => apiFetch('/api/base/process/status', { method: 'POST', body: JSON.stringify({ id }) }),
      output: (id, opts) => apiFetch('/api/base/process/output', { method: 'POST', body: JSON.stringify({ id, opts }) }),
      stop: (id, opts) => apiFetch('/api/base/process/stop', { method: 'POST', body: JSON.stringify({ id, opts }) }),
      list: () => apiFetch('/api/base/process/list'),
      get: (id) => apiFetch('/api/base/process/get', { method: 'POST', body: JSON.stringify({ id }) }),
      delete: (id) => apiFetch('/api/base/process/delete', { method: 'POST', body: JSON.stringify({ id }) }),
    },

    syncPermissions: (dirs) => apiFetch('/api/base/permissions/sync', { method: 'POST', body: JSON.stringify({ dirs }) }),

    base: {
      files: {
        read: (p, opts) => apiFetch('/api/base/files/read', { method: 'POST', body: JSON.stringify({ path: p, opts }) }),
        write: (p, content, opts) => apiFetch('/api/base/files/write', { method: 'POST', body: JSON.stringify({ path: p, content, opts }) }),
        edit: (p, opts) => apiFetch('/api/base/files/edit', { method: 'POST', body: JSON.stringify({ path: p, opts }) }),
        list: (p) => apiFetch('/api/base/files/list', { method: 'POST', body: JSON.stringify({ path: p }) }),
        stat: (p) => apiFetch('/api/base/files/stat', { method: 'POST', body: JSON.stringify({ path: p }) }),
        mkdir: (p) => apiFetch('/api/base/files/mkdir', { method: 'POST', body: JSON.stringify({ path: p }) }),
        copy: (from, to, opts) => apiFetch('/api/base/files/copy', { method: 'POST', body: JSON.stringify({ from, to, opts }) }),
        move: (from, to) => apiFetch('/api/base/files/move', { method: 'POST', body: JSON.stringify({ from, to }) }),
        delete: (p) => apiFetch('/api/base/files/delete', { method: 'POST', body: JSON.stringify({ path: p }) }),
        onChanged: () => () => {},
      },
      process: {
        create: (opts) => apiFetch('/api/base/process/create', { method: 'POST', body: JSON.stringify({ opts }) }),
        start: (id) => apiFetch('/api/base/process/start', { method: 'POST', body: JSON.stringify({ id }) }),
        status: (id) => apiFetch('/api/base/process/status', { method: 'POST', body: JSON.stringify({ id }) }),
        output: (id, opts) => apiFetch('/api/base/process/output', { method: 'POST', body: JSON.stringify({ id, opts }) }),
        stop: (id, opts) => apiFetch('/api/base/process/stop', { method: 'POST', body: JSON.stringify({ id, opts }) }),
        list: () => apiFetch('/api/base/process/list'),
        get: (id) => apiFetch('/api/base/process/get', { method: 'POST', body: JSON.stringify({ id }) }),
        delete: (id) => apiFetch('/api/base/process/delete', { method: 'POST', body: JSON.stringify({ id }) }),
      },
      syncPermissions: (dirs) => apiFetch('/api/base/permissions/sync', { method: 'POST', body: JSON.stringify({ dirs }) }),
    },

    tools: {
      captureScreen: async () => {
        try {
          const res = await apiFetch<ScreenCaptureResult>('/api/tools/capture-screen')
          if (res.ok && res.dataUrl) return res
        } catch {
          // 服务端截屏未成功时，自动尝试浏览器原生屏幕共享捕获
        }

        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            })
            const video = document.createElement('video')
            video.srcObject = stream
            await video.play()
            const canvas = document.createElement('canvas')
            canvas.width = video.videoWidth || window.innerWidth
            canvas.height = video.videoHeight || window.innerHeight
            const ctx = canvas.getContext('2d')
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
            stream.getTracks().forEach((track) => track.stop())
            return { ok: true, dataUrl: canvas.toDataURL('image/png') }
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : '获取屏幕画面被取消或失败' }
          }
        }
        return { ok: false, error: '当前环境不支持屏幕截图' }
      },
      copyImage: async (dataUrl: string) => {
        try {
          const res = await fetch(dataUrl)
          const blob = await res.blob()
          if (typeof navigator !== 'undefined' && navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
            return { ok: true }
          }
          return { ok: false, error: '浏览器环境不支持写入剪贴板图片' }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : '写入剪贴板失败' }
        }
      },
      saveImage: async (payload: ImageSavePayload) => {
        try {
          const a = document.createElement('a')
          a.href = payload.dataUrl
          a.download = payload.suggestedName || `Screenshot_${Date.now()}.png`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : '保存图片失败' }
        }
      },
      startRecord: async () => {
        return { ok: false, error: '录屏工具占位中' }
      },
      notifyPinReady: () => {},
      movePin: () => {},
      onScreenshotUpdate: () => () => {},
    },
  }

  return bridge
}
