import type { MessageFile, MessageImage, PendingFile } from '../agent/types'
import type { AttachReadResult } from '../lib/native'
import { formatBytes } from './images'
import { extOf, typeOfExt } from './static'

/**
 * 文件附件：把一份文件交给超级导师。
 *
 * 三类东西走三条路，判据是**内容**而不是扩展名：
 * - 图片：走原来的图片通道（转存进资源库、作为 image 片段发给模型，需要模型收图）；
 * - 文本：正文直接拼进这一条消息（模型要的是内容，不是它在磁盘上的位置）；
 * - 二进制：读不出文本，只把名字与体积告诉模型——至少让它知道「他附了一份 exe」。
 *
 * 为什么不像图片那样把文本也存进资源库：那要先写盘、再读回来，中间多一次往返，
 * 而文本本来就不大（上限见 ATTACH_MAX_CHARS）。图片不一样：它是字节，
 * 塞进 chat.json 会让每次落盘都变慢（见 agent/types 的 MessageImage）。
 */

/**
 * 单个文本附件最多带多少字进上下文。
 *
 * 6 万字 ≈ 3 万 token：一份源码、一篇长文都装得下，又不会一份附件就把上下文吃掉一半。
 * 超出的部分截断，并在界面与上下文里都注明「只附上了开头一部分」——
 * 悄悄截断会让模型以为文件就这么长，之后所有结论都建立在半份材料上。
 */
export const ATTACH_MAX_CHARS = 60_000

/**
 * 一条消息最多带几个文件附件。
 *
 * 与图片同一个量级（6 张）：再多，用户自己在输入框上方那一行里也数不清发了什么，
 * 而模型一次能认真读的材料就那么多。
 */
export const MAX_FILES = 6

/** 这个文件名看着像文本吗（扩展名判据；内容判据在主进程读过之后，见 readAttach） */
export function isTextName(name: string): boolean {
  return typeOfExt(extOf(name)) === 'text'
}

/** 附件的标题行：上下文里那一小段说明，包含序号、文件名、大小与用于在应用中定位打开的元信息路径 */
export function attachHead(f: MessageFile, index = 1, total = 1): string {
  const prefix = total > 1 ? `附件 ${index}（共 ${total} 份）` : `附件 ${index}`
  const size = f.chars ? '共 ' + f.chars + ' 字' + (f.truncated ? '，只附上了开头一部分' : '') : formatBytes(f.bytes)
  const meta: string[] = [f.name]
  if (f.binary) meta.push(formatBytes(f.bytes) + '，二进制文件，没有文本内容')
  else meta.push(size)
  const loc = f.path || f.rel
  if (loc) meta.push('路径：' + loc)
  return `${prefix}：${meta.join(' · ')}`
}

/**
 * 围栏：定界符要比正文里最长的一段反引号还长，否则正文里的一段代码块
 * 会把这个围栏提前关掉，后面所有内容都跑到围栏外面去。
 */
function fenceFor(text: string): string {
  let run = 0
  let best = 0
  for (const ch of text) {
    if (ch === '`') {
      run++
      if (run > best) best = run
    } else run = 0
  }
  return '`'.repeat(Math.max(3, best + 1))
}

/**
 * 把附件拼成一段文字，接在用户消息的正文之后。
 *
 * 这段文字会**逐字进入上下文**，包含清晰的序号与路径元信息，方便模型结合文件位置分析并在应用中打开。
 */
export function fileBlock(files: MessageFile[], texts: Map<string, string>): string {
  const parts: string[] = []
  const total = files.length
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const header = '【' + attachHead(f, i + 1, total) + '】'
    const text = f.uuid ? texts.get(f.uuid) : undefined
    if (!text) {
      parts.push(header)
      continue
    }
    const fence = fenceFor(text)
    const lang = extOf(f.name)
    parts.push(header + '\n' + fence + lang + '\n' + text + '\n' + fence)
  }
  return parts.length ? parts.join('\n\n') : ''
}

/** 附件里有多少字要进上下文（估算用） */
export function attachChars(files: MessageFile[]): number {
  return files.reduce((sum, f) => sum + (f.chars ?? 0), 0)
}

/**
 * 附件元信息块（**只给 role 层**，不带图片字节 / 文件正文）。
 *
 * role 是沟通与调度层：它要知道「用户附了什么、有多重」，但不该把几 MB 的图
 * 或整份源码塞进自己的上下文——真正动手读内容的是 work。需要内容时，
 * role 用 `api.work.send({ messageId })` 把原消息（含附件引用）转给 work。
 *
 * 这一块会逐字进入 role 的请求，所以措辞要明确「未挂载」，避免它假装看过图。
 * `opts.messageId` 是通道抬头的信封 id（群聊 `g-...`）：这一行只在真的有附件时出现，
 * 让 role 能把「哪条消息」原样交给 work，而不是猜一个 uuid。
 */
export function attachmentMetaBlock(
  images: MessageImage[],
  files: MessageFile[],
  opts?: { totalFiles?: number; messageId?: string },
): string {
  const totalFiles = opts?.totalFiles ?? files.length
  const parts: string[] = []
  images.forEach((img, i) => {
    const size = [img.mime, formatBytes(img.bytes), img.width && img.height ? `${img.width}×${img.height}` : '']
      .filter(Boolean)
      .join(' · ')
    parts.push(`【附件·图片 ${i + 1}：${img.name} · ${size}】`)
  })
  files.forEach((f, i) => {
    const size = f.binary
      ? `${formatBytes(f.bytes)}，二进制`
      : f.chars
        ? `共 ${f.chars} 字${f.truncated ? '（已截断）' : ''}`
        : formatBytes(f.bytes)
    const suffix = totalFiles > 1 ? `（文件 ${i + 1}/${totalFiles}）` : ''
    parts.push(`【附件·文件：${f.name} · ${size}${suffix}】`)
  })
  if (!parts.length) return ''
  // 模型能看见的是通道抬头的 id（群聊里就是 g-...），不是会话消息内部的 uuid。
  // 把这枚 id 直接写在附件块里，role 才知道 work.send 该引用什么。
  if (opts?.messageId) parts.unshift(`【原消息 id：${opts.messageId}（转给 work 时用这个）】`)
  parts.push(
    opts?.messageId
      ? '（以上只有附件元信息，图片字节与文件正文都没有挂进 role 的请求；需要读取内容时，用 `api.work.send({ messageId: "' +
          opts.messageId +
          '", text: "读取附件并…" })` 把原消息交给 work。）'
      : '（以上只有附件元信息，图片字节与文件正文都没有挂进 role 的请求；需要读取内容时，把带附件的原消息交给 work。）',
  )
  return parts.join('\n')
}

/* ---------- 收集待发送的附件 ---------- */

/** 把一段文本按上限截断，返回截断后的正文与「是否截断过」 */
function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= ATTACH_MAX_CHARS) return { text, truncated: false }
  return { text: text.slice(0, ATTACH_MAX_CHARS), truncated: true }
}

/**
 * 拖进来 / 粘贴进来的一份文件。
 *
 * 图片不在这里读——它走 PendingImage 那条路（见 agent/types）：字节由图片通道处理，
 * 这里只认「能变成文字的东西」。读文本用 File.text()：文件已经在内存/磁盘上，
 * 浏览器自己能读，不必绕主进程一趟。
 */
export async function pendingFromFile(file: File): Promise<PendingFile> {
  const id = crypto.randomUUID()
  const name = file.name || '未命名文件'
  const path = typeof (file as { path?: unknown }).path === 'string' && (file as { path?: string }).path ? (file as { path?: string }).path : undefined
  if (file.type.startsWith('image/')) {
    return { id, name, bytes: file.size, image: file, path }
  }
  if (!isTextName(name)) return { id, name, bytes: file.size, binary: true, path }
  try {
    const raw = await file.text()
    const { text, truncated } = clip(raw)
    return { id, name, bytes: file.size, text, truncated, path }
  } catch {
    return { id, name, bytes: file.size, binary: true, path }
  }
}

/**
 * 从本地文件对话框选来的一份（主进程已经把内容读好了，见 readAttach）。
 *
 * 图片在这里还原成 File：图片通道收的是 File（缩放、指纹、转存都在它上面，
 * 见 learn/static 的 saveStaticImage）。data URL 自己解，不走 fetch——
 * 生产环境的 CSP 允许 connect-src 的名单很短，data: 不一定在里面。
 */
export function pendingFromRead(read: AttachReadResult, path: string): PendingFile | null {
  if (!read.ok || !read.name) return null
  const id = crypto.randomUUID()
  const bytes = read.bytes ?? 0
  if (read.kind === 'image' && read.dataUrl) {
    const file = dataUrlToFile(read.dataUrl, read.name)
    if (!file) return null
    return { id, name: read.name, bytes, path, image: file }
  }
  if (read.kind === 'text') {
    const { text, truncated } = clip(read.text ?? '')
    return { id, name: read.name, bytes, path, text, truncated: truncated || read.truncated === true }
  }
  return { id, name: read.name, bytes, path, binary: true }
}

/** data URL → File（只用于图片附件；解码失败回 null） */
function dataUrlToFile(dataUrl: string, name: string): File | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const mime = dataUrl.slice(5, comma).split(';')[0] || 'image/png'
  try {
    const bin = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new File([bytes], name, { type: mime })
  } catch {
    return null
  }
}
