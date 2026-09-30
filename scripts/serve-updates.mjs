/**
 * 本地更新源：把 release/ 里的产物按 generic provider 的约定发出去，
 * 用来在**不发布**的前提下把整条更新链路真跑一遍
 * （见 docs/packaging-and-release.md「怎么验证更新链路」）。
 *
 * 为什么需要它：更新最容易错的地方不是代码，而是「元数据与安装包对不上」——
 * 版本号、文件名、sha512、以及 latest.yml 到底有没有跟着传上去。这些问题在
 * 真发布之前用一个本地 HTTP 目录就能全部暴露出来，代价是几十秒。
 *
 * 为什么还要支持多段 Range（multipart/byteranges）：增量下载就是靠它工作的。
 * electron-updater 对非 GitHub 的源默认走「一次请求要一堆区间」，服务端必须按
 * RFC 7233 回 multipart；只回 200 整份的话，客户端拿到的是一整块文件而不是
 * 那些区间，校验必然对不上，于是每次都退回全量下载——**不会出错，但会悄悄
 * 变成每次都下一百多 MB**。这也是「本地源要跟真实源一样」的原因：不一样就测不出来。
 *
 * 用法：
 *   npm run serve:updates                 发 release/，端口 8788
 *   npm run serve:updates -- <目录> <端口>
 *
 * 环境变量 MOJI_SERVE_KBPS 可以把发送速度压到指定的 KB/s（例如 8000 = 8 MB/s）。
 * 本地回环下一百多兆一两秒就下完了，进度条、取消、断点这些根本来不及出现——
 * 要验证它们，就得让本地源慢下来，而不是去怪「代码看不出来」。
 *
 * 客户端那边用 MOJI_UPDATE_FEED 指过来（见 electron/update.ts）：
 *   $env:MOJI_UPDATE_FEED='http://127.0.0.1:8788'   # 开发运行也会走这条链路
 *
 * generic provider 的约定很简单：url 根目录下要有 latest.yml，里面写的文件名
 * 就在同一层。electron-builder 生成的 release/ 正好是这个形状，不用另建目录。
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const dir = path.resolve(ROOT, process.argv[2] ?? 'release')
const port = Number(process.argv[3] ?? 8788)

const TYPES = {
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
}

/** Range 头 → 区间列表。认不出来就返回 null，按整份回（RFC 允许服务端忽略 Range） */
function parseRanges(header, size) {
  const m = /^bytes=(.+)$/.exec(header ?? '')
  if (!m) return null
  const out = []
  for (const raw of m[1].split(',')) {
    const one = /^(\d*)-(\d*)$/.exec(raw.trim())
    if (!one) return null
    const start = one[1] ? Number(one[1]) : 0
    const end = one[2] ? Number(one[2]) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= size) return null
    out.push({ start, end })
  }
  return out.length ? out : null
}

/**
 * 限速发送（MOJI_SERVE_KBPS 才生效）。默认不限速：大多数验证不需要等。
 * 按 100ms 一份发，速度就是 kbps KB/s。
 */
const throttleKbps = Number(process.env.MOJI_SERVE_KBPS)
const throttled = Number.isFinite(throttleKbps) && throttleKbps > 0

async function sendThrottled(file, res, start, end) {
  const chunk = Math.max(16 * 1024, Math.round((throttleKbps * 1024) / 10))
  const rs = createReadStream(file, { start, end, highWaterMark: chunk })
  for await (const buf of rs) {
    if (!res.write(buf)) await new Promise((r) => res.once('drain', r))
    await new Promise((r) => setTimeout(r, 100))
  }
  res.end()
}

/** 把一个区间写进 res（不结束响应） */
function writeRange(file, range, res) {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(file, { start: range.start, end: range.end })
    rs.on('error', reject)
    rs.on('end', resolve)
    rs.pipe(res, { end: false })
  })
}

/**
 * 多段 Range：RFC 7233 的 multipart/byteranges。
 * 边界与每段头都要自己拼，长度必须算准——客户端是按字节数切段的。
 */
async function sendMultipart(file, ranges, size, res) {
  const boundary = 'moji-updates-' + size.toString(16)
  const head = (r, first) =>
    Buffer.from(
      (first ? '' : '\r\n') +
        '--' + boundary + '\r\n' +
        'Content-Type: application/octet-stream\r\n' +
        'Content-Range: bytes ' + r.start + '-' + r.end + '/' + size + '\r\n' +
        '\r\n',
    )
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n')

  let total = tail.length
  const heads = ranges.map((r, i) => {
    const buf = head(r, i === 0)
    // 每段之后那个 \r\n 由下一段的头带（最后一段由 tail 带）
    total += buf.length + (r.end - r.start + 1)
    return buf
  })

  res.writeHead(206, {
    'Content-Type': 'multipart/byteranges; boundary=' + boundary,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
  })
  for (let i = 0; i < ranges.length; i++) {
    res.write(heads[i])
    await writeRange(file, ranges[i], res)
  }
  res.end(tail)
}

createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '')
  // 目录穿越挡掉：这个服务只发一个目录里的东西
  const file = path.resolve(dir, name)
  if (!name || !file.startsWith(path.resolve(dir) + path.sep)) {
    res.writeHead(404).end('not found')
    return
  }
  let size
  try {
    const st = statSync(file)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    console.log('[updates] 404 ' + name)
    res.writeHead(404).end('not found')
    return
  }

  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const ranges = parseRanges(req.headers.range, size)

  if (ranges && ranges.length > 1) {
    const bytes = ranges.reduce((n, r) => n + (r.end - r.start + 1), 0)
    console.log('[updates] 206 ' + name + ' · ' + ranges.length + ' 段 · 共 ' + bytes + ' 字节 / ' + size)
    sendMultipart(file, ranges, size, res).catch((err) => {
      console.error('[updates] 多段响应失败：', err)
      res.destroy()
    })
    return
  }

  if (ranges && ranges.length === 1) {
    const r = ranges[0]
    console.log('[updates] 206 ' + name + ' ' + r.start + '-' + r.end + '/' + size)
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': r.end - r.start + 1,
      'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + size,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(file, { start: r.start, end: r.end }).pipe(res)
    return
  }

  console.log('[updates] 200 ' + name + ' (' + size + ' 字节)' + (throttled ? ' · 限速 ' + throttleKbps + ' KB/s' : ''))
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' })
  if (throttled) {
    sendThrottled(file, res, 0, size - 1).catch((err) => {
      console.error('[updates] 发送失败：', err)
      res.destroy()
    })
    return
  }
  createReadStream(file).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log('[updates] 更新源就绪：http://127.0.0.1:' + port + '/  （目录 ' + dir + '）')
  console.log('[updates] 客户端用 $env:MOJI_UPDATE_FEED=\'http://127.0.0.1:' + port + '\' 指过来')
})
