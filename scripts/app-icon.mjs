/**
 * 图标染色探针：跑一遍**真实的** lib/appIcon 染色链路（SVG 换色 → canvas → PNG data URL），
 * 再按主进程那条 resize 出一份托盘图，与「同一张 SVG 画满 64×64 画布」的参照图逐像素对 alpha。
 *
 * 为什么要有它：这条链路上出过一次静默事故——画布从 256 缩到 64 之后 drawImage 仍然只给
 * 起点，浏览器按 SVG 的固有尺寸(256×256)作画，64×64 的画布就只剩左上角那一块。任务栏与
 * 托盘于是常年顶着一小片残图。单测在 Node 里看不见 canvas，看截图又只能说「好像不对」。
 *
 * 用法：
 *   node scripts/app-icon.mjs [--color '#3BA55D'] [--png 输出目录]
 * 前置：无（探针自己把 src/lib/appIcon.ts 打成能在页面里跑的包）
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** electron 只有 CJS 入口：ESM 脚本里要自己造一个 require（与 topbar-align.mjs 同一套） */
const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SIZE = 64
const TRAY = 16

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const color = arg('--color', '#3BA55D')
const outDir = arg('--png', '')

/* ---------- 1. 把渲染层那份染色代码打成页面能跑的包 ---------- */
const bundle = path.join(os.tmpdir(), 'moji-app-icon-bundle.js')
const built = spawnSync('node', [
  path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  '--bundle',
  '--format=iife',
  '--loader=ts',
  '--log-level=warning',
  '--outfile=' + bundle,
], {
  // stdin 的 import 按 cwd 解析（esbuild 的 CLI 没有 --resolve-dir，那是 API 上的事）
  cwd: ROOT,
  input: "import { syncAppIcon } from './src/lib/appIcon'\nwindow.__sync = syncAppIcon\n",
  stdio: ['pipe', 'inherit', 'inherit'],
})
if (built.status !== 0) process.exit(built.status ?? 1)

/* ---------- 2. 夹具页面：桥是假的，染色那一段是真的 ---------- */
const svg = readFileSync(path.join(ROOT, 'public', 'logo.svg'), 'utf-8')
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>
<script>
window.__svg = ${JSON.stringify(svg).replace(/<\//g, '<\\/')}
window.__color = ${JSON.stringify(color)}
window.__icon = ''
window.mojiNative = {
  window: {
    logoSource: () => Promise.resolve(window.__svg),
    setAppIcon: (url) => { window.__icon = url; return Promise.resolve(true) },
  },
}
</script>
<script src="${pathToFileURL(bundle).href}"></script>
</body></html>`
const fixture = path.join(os.tmpdir(), 'moji-app-icon.html')
writeFileSync(fixture, html, 'utf8')

/* ---------- 3. 页面里量：染色结果 vs 画满画布的参照图 ---------- */
const measure = `(async () => {
  const load = (src) => new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('读不到图：' + String(src).slice(0, 40)))
    img.src = src
  })
  const mask = (img) => {
    const c = document.createElement('canvas')
    c.width = c.height = ${SIZE}
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE})
    const d = ctx.getImageData(0, 0, ${SIZE}, ${SIZE}).data
    const a = new Array(${SIZE} * ${SIZE})
    let minX = ${SIZE}, minY = ${SIZE}, maxX = -1, maxY = -1, count = 0
    for (let i = 0; i < a.length; i++) {
      const v = d[i * 4 + 3]
      a[i] = v
      if (v <= 8) continue
      count++
      const x = i % ${SIZE}, y = (i - x) / ${SIZE}
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    return { bbox: [minX, minY, maxX, maxY], count, alpha: a }
  }
  await window.__sync(window.__color)
  const app = mask(await load(window.__icon))
  // 参照：同一张 SVG、同一个尺寸，但目标矩形给全（画满画布）
  const ref = mask(await load('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.__svg.replace(/#A23A24/gi, window.__color))))
  let diff = 0
  for (let i = 0; i < ref.alpha.length; i++) if (Math.abs(app.alpha[i] - ref.alpha[i]) > 8) diff++
  return { app: { bbox: app.bbox, count: app.count }, ref: { bbox: ref.bbox, count: ref.count }, diff, url: window.__icon }
})()`

/* ---------- 4. 主进程那一半：data URL → nativeImage → 托盘那份 16px ---------- */
const mainCode = `
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.disableHardwareAcceleration()

/** BGRA 位图里 alpha 的墨迹范围与覆盖数（与页面里那把尺子同一口径：alpha > 8 算墨） */
function inkRange(bitmap, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0
  for (let i = 0; i < w * h; i++) {
    if (bitmap[i * 4 + 3] <= 8) continue
    count++
    const x = i % w, y = (i - x) / w
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { bbox: [minX, minY, maxX, maxY], count }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 320, height: 240 })
  await win.loadFile(process.env.MOJI_FIXTURE)
  const data = await win.webContents.executeJavaScript(process.env.MOJI_MEASURE)
  const image = nativeImage.createFromDataURL(data.url)
  const tray = image.resize({ width: ${TRAY}, height: ${TRAY} })
  // 参照：设计源 public/logo.png 走同一条 resize（托盘在染色回来之前用的就是它）
  const logo = nativeImage.createFromPath(path.join(process.env.MOJI_ROOT, 'public', 'logo.png')).resize({ width: ${TRAY}, height: ${TRAY} })
  if (process.env.MOJI_PNG) {
    fs.writeFileSync(path.join(process.env.MOJI_PNG, 'app-icon-${SIZE}.png'), image.toPNG())
    fs.writeFileSync(path.join(process.env.MOJI_PNG, 'tray-${TRAY}.png'), tray.toPNG())
    fs.writeFileSync(path.join(process.env.MOJI_PNG, 'tray-logo-${TRAY}.png'), logo.toPNG())
  }
  console.log('@@JSON@@' + JSON.stringify({
    app: data.app, ref: data.ref, diff: data.diff,
    size: image.getSize(), empty: image.isEmpty(),
    tray: inkRange(tray.toBitmap(), ${TRAY}, ${TRAY}),
    logo: inkRange(logo.toBitmap(), ${TRAY}, ${TRAY}),
  }))
  app.exit(0)
})
`
const mainFile = path.join(os.tmpdir(), 'moji-app-icon-main.cjs')
writeFileSync(mainFile, mainCode, 'utf8')

if (outDir) mkdirSync(outDir, { recursive: true })

const child = spawn(require('electron'), [mainFile], {
  cwd: ROOT,
  env: {
    ...process.env,
    MOJI_ROOT: ROOT,
    MOJI_FIXTURE: fixture,
    MOJI_MEASURE: measure,
    MOJI_PNG: outDir,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let buf = ''
child.stdout.on('data', (d) => { buf += String(d) })
child.on('exit', () => {
  const line = buf.split('@@JSON@@')[1]
  if (!line) {
    console.error('[icon] 探针没拿到读数：\n' + buf.slice(-800))
    process.exit(1)
  }
  process.exit(report(JSON.parse(line.split('\n')[0])))
})

/** 打印读数并给出结论：0 通过 / 1 不过 */
function report(r) {
  const box = (b) => '(' + b[0] + ',' + b[1] + ')-(' + b[2] + ',' + b[3] + ')'
  console.log('[icon] 染色图 ' + r.size.width + '×' + r.size.height + '：墨迹 ' + box(r.app.bbox) + '，覆盖 ' + r.app.count + '/' + SIZE * SIZE + ' px')
  console.log('[icon] 参照（画满画布）：墨迹 ' + box(r.ref.bbox) + '，覆盖 ' + r.ref.count + '/' + SIZE * SIZE + ' px')
  const sameBox = r.app.bbox.every((v, i) => v === r.ref.bbox[i])
  const diffLimit = Math.round(SIZE * SIZE * 0.01)
  const shapeOk = sameBox && r.diff <= diffLimit
  console.log('[icon] 与参照的 alpha 差异 ' + r.diff + ' px（容差 ' + diffLimit + '）：' + (shapeOk ? '一致' : '不一致'))
  console.log('[icon] 托盘 ' + TRAY + '×' + TRAY + '：墨迹 ' + box(r.tray.bbox) + '，覆盖 ' + r.tray.count + '/' + TRAY * TRAY + ' px' +
    '；logo.png 那份 ' + box(r.logo.bbox) + '，覆盖 ' + r.logo.count)
  const near = (a, b, slack) => Math.abs(a - b) <= slack
  const trayOk = r.tray.count > 0 &&
    r.tray.bbox.every((v, i) => near(v, r.logo.bbox[i], 1)) &&
    r.tray.count >= r.logo.count * 0.6
  console.log('[icon] 托盘与 logo.png 同形：' + (trayOk ? '是' : '否'))
  if (outDir) console.log('[icon] 出图：' + outDir)
  const ok = shapeOk && trayOk
  console.log('[icon] 结论：' + (ok ? '通过' : '不过——染出来的不是完整那枚图标'))
  return ok ? 0 : 1
}
