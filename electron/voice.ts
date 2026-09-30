/**
 * 语音模型（whisper.cpp 的 ggml base q5_1）的下载、缓存与读取。
 *
 * 为什么在主进程：
 *
 * 1. **CSP 不让渲染层直连外网**。生产构建的 CSP 是 connect-src 'self' llm-proxy:，
 *    huggingface.co 不在名单里——渲染层 fetch 一定被拦；
 * 2. 这是 57 MB 的二进制，直接落盘比「先塞进渲染进程内存再经存储桥写回」省一半内存；
 * 3. 下载进度要推给界面，主进程推事件最直接。
 *
 * 模型放在 appdata 的 voice-models/ 下，**不属于任何用户**：它是机器上的公共资源，
 * 换个用户、换个数据目录都还在，不该跟着用户目录搬家（也不该每个用户存一份 57 MB）。
 * 渲染进程拿到的是字节（voice:readModel），怎么喂给 WASM 由它自己决定。
 */

import { app, dialog, ipcMain, shell, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from './i18n'

import type {
  VoiceDownloadResult, VoiceModelStatus,
} from '../shared/ipc'

// VoiceModelStatus / VoiceDownloadResult 原先在这里也写了一份（与 electron/preload.ts、
// src/lib/native.ts 同体）：现在统一用 shared/ipc.ts，并按原样转出去。
export type {
  VoiceDownloadResult, VoiceModelStatus,
}

/** 模型目录名（appdata 下） */
const MODEL_DIR = 'voice-models'
/** 只认这一个文件名：whisper.cpp 的 base 多语言模型，q5_1 量化，约 57 MB */
const MODEL_FILE = 'ggml-base-q5_1.bin'
/**
 * 模型从哪来：官方源 + 一个国内镜像。
 *
 * 为什么要有镜像：huggingface.co 在中国大陆连不上（本机实测 fetch failed，10 秒超时），
 * 而这份模型的用户多半就在那儿；hf-mirror.com 是同一份文件（实测 200 / 59707625 字节）。
 * 两个源不是「挨个试」而是**同时探一下、谁先应答就用谁**：官方源在大陆要卡满十秒超时，
 * 挨个试等于每次下载都先白等十秒；并发探测的代价只是一个 HEAD 请求。
 */
const MODEL_SOURCES: Array<{ name: string; url: string }> = [
  {
    name: 'HuggingFace 官方',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/' + MODEL_FILE,
  },
  {
    name: 'hf-mirror 镜像',
    url: 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/' + MODEL_FILE,
  },
]
/** 状态里给界面显示的那一个（官方地址；界面上另有「用本机文件」这条路） */
const MODEL_URL = MODEL_SOURCES[0].url
/**
 * 认模型「下完了」的最小体积：20 MB。
 * 断流留下的半个文件绝不能当成可用模型——那会在加载时才炸，报的还是一句看不懂的 ggml 错误。
 * 门槛按最小的那一档定：tiny 的 q5_1 是 31 MB、base 是 57 MB，定 40 MB 会把 tiny 挡在门外（试过）。
 */
const MIN_BYTES = 20 * 1024 * 1024

const modelPath = (): string => path.join(app.getPath('userData'), MODEL_DIR, MODEL_FILE)

async function statusOf(): Promise<VoiceModelStatus> {
  const target = modelPath()
  try {
    const stat = await fsp.stat(target)
    const ok = stat.size >= MIN_BYTES
    return { path: target, exists: ok, bytes: stat.size, url: MODEL_URL, sources: MODEL_SOURCES.map((s) => t(s.name)) }
  } catch {
    return { path: target, exists: false, bytes: 0, url: MODEL_URL, sources: MODEL_SOURCES.map((s) => t(s.name)) }
  }
}

/** 正在下的那一次；非空表示已经在下，重复点不再起第二个连接 */
let inflight: AbortController | null = null/** 从一个源把模型拉下来；失败抛异常（含一句能读的中文） */
async function fetchOne(
  sender: WebContents,
  url: string,
  part: string,
  ac: AbortController,
): Promise<number> {
  const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
  const total = Number(res.headers.get('content-length') ?? 0)
  let received = 0
  let lastSent = 0
  // 先写 .part，下完再改名：中途断网/关窗都不会留下一个「看着像模型」的半个文件
  const handle = await fsp.open(part, 'w')
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      received += chunk.length
      // 每 512 KB 报一次就够了：进度条不需要更细，事件太多反而卡渲染进程
      if (received - lastSent >= 512 * 1024) {
        lastSent = received
        if (!sender.isDestroyed()) {
          sender.send('voice:modelProgress', {
            received,
            total,
            percent: total ? Math.round((received / total) * 100) : 0,
          })
        }
      }
    }
  } finally {
    await handle.close()
  }
  if (received < MIN_BYTES) {
    throw new Error(t('只下回来 {0} MB，不像是完整模型（源可能返回了错误页）', Math.round(received / 1024 / 1024)))
  }
  return received
}

/**
 * 下载模型：按 MODEL_SOURCES 的顺序挨个试。
 *
 * 一个源失败就删掉半个文件、试下一个——用户点的是「下载模型」，不是「测试哪个源能通」。
 * 取消（用户点了取消）是另一种情况：当场返回，不再试下一个。
 */
async function download(sender: WebContents): Promise<VoiceDownloadResult> {
  if (inflight) return { ok: false, error: t('已经在下一次了') }
  const target = modelPath()
  const part = target + '.part'
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const ac = new AbortController()
  inflight = ac
  const failures: string[] = []
  try {
    // 先探路：两个源同时发一个 HEAD，谁先应答就用谁
    const ordered = await orderSources(ac.signal)
    for (const source of ordered) {
      try {
        if (!sender.isDestroyed()) {
          sender.send('voice:modelProgress', { received: 0, total: 0, percent: 0, note: t('正在从{0}下载…', t(source.name)) })
        }
        const bytes = await fetchOne(sender, source.url, part, ac)
        await fsp.rename(part, target)
        if (!sender.isDestroyed()) {
          sender.send('voice:modelProgress', { received: bytes, total: bytes, percent: 100, note: '' })
        }
        return { ok: true, bytes, source: t(source.name) }
      } catch (err) {
        await fsp.rm(part, { force: true })
        if (ac.signal.aborted) return { ok: false, error: t('已取消') }
        const msg = err instanceof Error ? err.message : String(err)
        failures.push(t('{0}：{1}', t(source.name), msg))
      }
    }
    return {
      ok: false,
      error: t(
        '每个下载源都不通——{0}。也可以在设置里用「用本机文件」挑一份已经下好的 ggml-base-q5_1.bin',
        failures.join(t('；')),
      ),
    }
  } finally {
    await fsp.rm(part, { force: true })
    inflight = null
  }
}

/**
 * 探测下载源，按「能用的排在前面」返回。
 *
 * 每个源发一个 HEAD，谁先 200 谁排第一；探测失败的排后面（万一它只是探测被挡、真下载能过，
 * 留着当备选比直接扔掉好）。全都探不通时按原顺序返回，让真正的下载去报具体的错。
 */
async function orderSources(signal: AbortSignal): Promise<Array<{ name: string; url: string }>> {
  const probes = await Promise.all(
    MODEL_SOURCES.map(async (source) => {
      const timer = new AbortController()
      const onAbort = (): void => timer.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      const timeout = setTimeout(() => timer.abort(), 5000)
      try {
        const res = await fetch(source.url, { method: 'HEAD', signal: timer.signal, redirect: 'follow' })
        return { source, ok: res.ok }
      } catch {
        return { source, ok: false }
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
      }
    }),
  )
  const good = probes.filter((p) => p.ok).map((p) => p.source)
  const bad = probes.filter((p) => !p.ok).map((p) => p.source)
  return [...good, ...bad]
}

/**
 * 从本机挑一个模型文件（离线环境、或者用户早就下过）。
 * 复制而不是引用：路径记在别处迟早会失效（用户挪个目录就废），复制一份一劳永逸。
 */
async function chooseModel(): Promise<{ ok: boolean; canceled?: boolean; error?: string; bytes?: number }> {
  const picked = await dialog.showOpenDialog({
    title: t('选择 whisper 模型（*.bin）'),
    properties: ['openFile'],
    filters: [
      { name: t('whisper 模型'), extensions: ['bin'] },
      { name: t('全部文件'), extensions: ['*'] },
    ],
  })
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
  const from = picked.filePaths[0]
  const target = modelPath()
  try {
    const stat = await fsp.stat(from)
    if (stat.size < MIN_BYTES) {
      return { ok: false, error: t('这个文件只有 {0} MB，base 模型应该有 50 MB 以上', Math.round(stat.size / 1024 / 1024)) }
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.copyFile(from, target)
    return { ok: true, bytes: stat.size }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('复制失败') }
  }
}

/** 读模型字节交给渲染进程。57 MB 过一趟 IPC 约几十毫秒，一次会话只读一次（渲染层自己缓存） */
async function readModel(): Promise<{ ok: boolean; bytes?: Uint8Array; error?: string }> {
  try {
    const buf = await fsp.readFile(modelPath())
    if (buf.byteLength < MIN_BYTES) return { ok: false, error: t('模型文件不完整，重新下载一次') }
    return { ok: true, bytes: new Uint8Array(buf) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('读取失败') }
  }
}

/** 删掉模型，把 57 MB 要回来 */
async function removeModel(): Promise<{ ok: boolean; error?: string }> {
  try {
    await fsp.rm(modelPath(), { force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('删除失败') }
  }
}

export function registerVoiceIpc(): void {
  ipcMain.handle('voice:modelStatus', () => statusOf())
  ipcMain.handle('voice:downloadModel', (e) => download(e.sender))
  ipcMain.handle('voice:cancelDownload', () => {
    inflight?.abort()
    return true
  })
  ipcMain.handle('voice:chooseModel', () => chooseModel())
  ipcMain.handle('voice:readModel', () => readModel())
  ipcMain.handle('voice:removeModel', () => removeModel())
  /** 在文件管理器里定位模型文件：用户想自己看看/替换时用得上 */
  ipcMain.handle('voice:revealModel', () => {
    shell.showItemInFolder(modelPath())
    return true
  })
}