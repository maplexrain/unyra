/**
 * 这个文件负责两条二进制通道：聊天气泡用的图片（扩展名白名单）与资源库用的任意文件
 * （扩展名只是推 mime 的线索）。两者都用 base64 data URL 在 IPC 上过一道。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
// 文案函数在这份里叫 tr：下面 const t = target(rel) 会把它遮住
import { t as tr } from '../i18n'
import { target } from './files'
import { errText, isMissing, type Result } from './settings'

/* ---------- 图片（二进制） ---------- */

/**
 * 图片一律以**真实二进制**落盘，读写用 base64 data URL 在 IPC 上过一道。
 *
 * 为什么不把 base64 当文本存：图片是用户自己的素材，写进数据目录就该是能直接
 * 双击打开的 png，而不是一段 base64 文本；顺带每次读写也少 33% 的体积。
 * 为什么不直接传 Buffer：渲染进程与主进程之间只能过结构化克隆，
 * data URL 是最省事的形态（浏览器自己也是这么给 canvas 结果的）。
 */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024

/** 只认这几种图片扩展名：这条通道不允许写别的二进制 */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/

/** 写一张图；rel 必须以图片扩展名结尾，内容必须是 base64 data URL */
export async function writeImage(rel: unknown, dataUrl: unknown): Promise<Result> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  if (!IMAGE_MIME[path.extname(t.full).toLowerCase()]) return { ok: false, error: tr('只允许写入图片文件') }
  if (typeof dataUrl !== 'string') return { ok: false, error: tr('图片内容不合法') }
  const matched = DATA_URL_RE.exec(dataUrl.trim())
  if (!matched) return { ok: false, error: tr('图片内容不是 base64 data URL') }
  const buf = Buffer.from(matched[2], 'base64')
  if (!buf.length) return { ok: false, error: tr('图片内容为空') }
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, error: tr('图片超过 16MB') }
  try {
    await fsp.mkdir(path.dirname(t.full), { recursive: true })
    await fsp.writeFile(t.full, buf)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/** 读一张图，回一个 data URL；文件不存在时 dataUrl 为 null（不算错误） */
export async function readImage(
  rel: unknown,
): Promise<{ ok: true; dataUrl: string | null } | { ok: false; error: string }> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  const mime = IMAGE_MIME[path.extname(t.full).toLowerCase()]
  if (!mime) return { ok: false, error: tr('只允许读取图片文件') }
  try {
    const buf = await fsp.readFile(t.full)
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (err) {
    if (isMissing(err)) return { ok: true, dataUrl: null }
    return { ok: false, error: errText(err) }
  }
}

/* ---------- 通用二进制（资源库） ---------- */

/**
 * 资源库通道：任意类型的文件，读写同样用 base64 data URL 在 IPC 上过一道
 * （为什么用 data URL 而不是 Buffer，见上面图片通道的说明——两者同源）。
 *
 * 与图片通道分开，是因为两者的**语义**不同而不是内容不同：图片通道服务聊天气泡，
 * 扩展名白名单就是它的功能（挡掉「往头像路径写一个 exe」）；资源库是用户自己
 * 放素材的地方，pdf / zip / mp3 都该进得来，因此扩展名不设限，认不出来的一律
 * 按 octet-stream 走——存得下、取得回，打开的事交给系统。
 *
 * 上限比图片大一倍：图片是要送进模型上下文的，资源库里的文件只躺在磁盘上等人打开。
 */
const MAX_BINARY_BYTES = 32 * 1024 * 1024

/**
 * 扩展名 → mime。只列真用得上的那些：这张表的作用是让预览与下载拿到像样的类型，
 * 穷举所有已知类型没有意义；表里没有的一律 octet-stream，而浏览器与系统对
 * octet-stream 的处理是「下载」，这正好是未知类型的合理归宿。
 *
 * 故意不复用上面的 IMAGE_MIME：那张表是**白名单**（不在表里就拒绝写入），
 * 这张是**查表**（不在表里照样写，只是读回来是 octet-stream）。语义不同，
 * 合成一张会让「为什么 svg 能进资源库却写不进头像」变得看不出来。
 */
const BINARY_MIME: Record<string, string> = {
  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  // 文档
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  // 压缩包
  '.zip': 'application/zip',
  // 音视频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * 表外但**确定是纯文本**的扩展名，读回来回落成 text/plain。
 *
 * 与下面的 octet-stream 分开，是因为两者的下游行为完全不同：text/plain 会被
 * 当文本预览，octet-stream 的归宿是「下载」。.log / .ini / .ts 这类文件落进
 * 后者，用户点开只会得到一个下载框，而它明明是可以直接看的文本。
 * 表列到「够用」为止：真正的判据是内容而不是扩展名，这里只是给常见几种兜个底。
 */
const TEXT_EXT = new Set([
  '.log',
  '.ini',
  '.toml',
  '.conf',
  '.cfg',
  '.properties',
  '.env',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.css',
  '.scss',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.sh',
  '.bat',
  '.ps1',
  '.sql',
  '.srt',
  '.vtt',
])

/** 既不认识、也不像文本时的回落类型；单独提出来是为了让读路径一眼看出「这里没有白名单」 */
const FALLBACK_MIME = 'application/octet-stream'

/**
 * 写任意扩展名的二进制；rel 不限扩展名，内容必须是 base64 data URL。
 *
 * 不校验 data URL 里声明的 mime：同一份字节可以有多种说得通的说法，
 * 落盘只留字节，**扩展名才是唯一的事实来源**（读的时候按它推 mime）。
 * 两处都推、还要求它们一致，迟早会在某个用户手改过扩展名的文件上卡住。
 */
export async function writeBinary(rel: unknown, dataUrl: unknown): Promise<Result> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  if (typeof dataUrl !== 'string') return { ok: false, error: tr('内容不合法') }
  const matched = DATA_URL_RE.exec(dataUrl.trim())
  if (!matched) return { ok: false, error: tr('内容不是 base64 data URL') }
  const buf = Buffer.from(matched[2], 'base64')
  // 空内容多半是上游把二进制读成了空字符串，写下去只会在资源库里留一个 0 字节的谜
  if (!buf.length) return { ok: false, error: tr('内容为空') }
  if (buf.length > MAX_BINARY_BYTES) return { ok: false, error: tr('文件超过 32MB') }
  try {
    await fsp.mkdir(path.dirname(t.full), { recursive: true })
    await fsp.writeFile(t.full, buf)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/** 读任意扩展名的二进制，回 data URL；mime 由扩展名推，文件不存在时 dataUrl 为 null（不算错误） */
export async function readBinary(
  rel: unknown,
): Promise<{ ok: true; dataUrl: string | null } | { ok: false; error: string }> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  const ext = path.extname(t.full).toLowerCase()
  const mime = BINARY_MIME[ext] ?? (TEXT_EXT.has(ext) ? 'text/plain' : FALLBACK_MIME)
  try {
    const buf = await fsp.readFile(t.full)
    return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (err) {
    if (isMissing(err)) return { ok: true, dataUrl: null }
    return { ok: false, error: errText(err) }
  }
}
