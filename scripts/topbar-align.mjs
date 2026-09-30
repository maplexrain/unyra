/**
 * 顶栏对齐探针：把三颗入口用**真实组件**渲染出来，量每段文字的基线。
 *
 * 为什么要有它：「齐不齐」在 Node 里量不出来（没有布局），而看截图只能得出
 * 「看着有点低」，说不出差几像素、差在谁身上。这里用仓库自己的 Electron 打开一份
 * 夹具（挂构建产物里那份 CSS），夹具渲染的是 components/learn/*Button.tsx 本人
 * （见 topbar-align-entry.tsx），再用 Range 取每一段文字的紧贴矩形：
 * 同一行里这些 rect.top 应当相等，谁高谁低一目了然，还能顺手截一张图给人看。
 *
 * 用法：
 *   node scripts/topbar-align.mjs [--theme dark|light] [--png 输出路径]
 * 前置：跑过一次 npm run build（要 dist/assets 里那份 CSS）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** electron 只有 CJS 入口：ESM 脚本里要自己造一个 require（与 startup-trace.mjs 同一套） */
const require = createRequire(import.meta.url)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const ASSETS = path.join(ROOT, 'dist', 'assets')
if (!existsSync(ASSETS)) {
  console.error('[align] 先构建一次：npm run build（探针要挂构建产物里的那份 CSS）')
  process.exit(1)
}
const css = readdirSync(ASSETS).find((f) => f.startsWith('index-') && f.endsWith('.css'))
if (!css) {
  console.error('[align] dist/assets 里没有打包后的 index-*.css')
  process.exit(1)
}
const theme = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'dark'
const pngArg = process.argv.indexOf('--png')
const png = pngArg > 0 ? process.argv[pngArg + 1] : path.join(os.tmpdir(), 'moji-topbar-align.png')

/* ---------- 1. 用 esbuild 把夹具入口打成一份能在页面里跑的包 ---------- */
const bundle = path.join(os.tmpdir(), 'moji-topbar-align-bundle.js')
const built = spawnSync('node', [
  path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
  path.join(ROOT, 'scripts', 'topbar-align-entry.tsx'),
  '--bundle',
  '--format=iife',
  '--jsx=automatic',
  '--define:process.env.NODE_ENV="production"',
  '--log-level=warning',
  '--outfile=' + bundle,
], { cwd: ROOT, stdio: 'inherit' })
if (built.status !== 0) process.exit(built.status ?? 1)

/* ---------- 2. 夹具页面 ---------- */
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/')
const html = `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl(path.join(ASSETS, css))}">
</head><body><div id="root"></div><script src="${fileUrl(bundle)}"></script></body></html>`
const fixture = path.join(os.tmpdir(), 'moji-topbar-align.html')
writeFileSync(fixture, html, 'utf8')

/* ---------- 3. 量文字：每个「有文字的叶子元素」取一次紧贴矩形 ---------- */
const measure = `(() => {
  const rows = []
  for (const row of document.querySelectorAll('[data-row]')) {
    const cells = []
    for (const el of row.querySelectorAll('button *')) {
      if (el.children.length) continue                      // 只看叶子
      if (/sr-only/.test(String(el.className))) continue     // 读屏那一份是隐藏的，不参与
      const node = el.firstChild
      if (!node || node.nodeType !== 3 || !node.nodeValue.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(el)
      const r = range.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      cells.push({
        text: node.nodeValue.trim().slice(0, 14),
        top: +r.top.toFixed(2),
        th: +r.height.toFixed(2),
        boxTop: +box.top.toFixed(2),
        boxH: +box.height.toFixed(2),
        cls: String(el.className).slice(0, 34),
      })
    }
    const svg = [...row.querySelectorAll('button > svg')].map((s) => [+s.getBoundingClientRect().top.toFixed(2), +s.getBoundingClientRect().height.toFixed(2)])
    rows.push({ row: row.dataset.row, cells, svg })
  }
  // 番茄钟的面板：在不在 DOM 里、落在哪儿（探针的夹具把番茄钟放在最左边，
  // 面板是从按钮右缘往左铺的，所以在这个夹具里它会有一部分在屏幕外——真实顶栏里它在窗口右半边）
  const hits = [...document.querySelectorAll('div')].filter((d) => (d.textContent || '').includes('一段专注多长'))
  const panel = hits.length ? hits[hits.length - 1] : null
  const pr = panel ? panel.getBoundingClientRect() : null
  return { rows, panel: pr ? { x: +pr.x.toFixed(1), y: +pr.y.toFixed(1), w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) } : null }
})()`

/* ---------- 4. 主进程那一小段（模块入口必须是文件，所以写到临时目录） ---------- */
const mainCode = `
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // show: true 是必须的：隐藏窗口不产新帧，capturePage 拿到的是打开浮层之前那一帧
  // （探针会在屏幕上闪一下，这是开发工具，可以接受）
  const win = new BrowserWindow({ width: 1000, height: 620, show: true, webPreferences: { offscreen: false } })
  await win.loadFile(process.env.MOJI_FIXTURE)
  await new Promise((r) => setTimeout(r, 500))
  // 把番茄钟那一颗的浮层叫出来：用**真实**的鼠标移动（sendInputEvent），
  // 合成的 MouseEvent 不一定能让 React 认下 onMouseEnter
  const at = await win.webContents.executeJavaScript(process.env.MOJI_HOVER)
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(at.x), y: Math.round(at.y) })
  await new Promise((r) => setTimeout(r, 700))
  const data = await win.webContents.executeJavaScript(process.env.MOJI_MEASURE)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(process.env.MOJI_PNG, img.toPNG())
  console.log('@@JSON@@' + JSON.stringify(data))
  app.exit(0)
})
`
const mainFile = path.join(os.tmpdir(), 'moji-topbar-align-main.cjs')
writeFileSync(mainFile, mainCode, 'utf8')

const hover = `(() => {
  const r = document.querySelector('[data-row] button').getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})()`

const child = spawn(require('electron'), [mainFile], {
  cwd: ROOT,
  env: { ...process.env, MOJI_FIXTURE: fixture, MOJI_PNG: png, MOJI_MEASURE: measure, MOJI_HOVER: hover },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let buf = ''
child.stdout.on('data', (d) => { buf += String(d) })
child.on('exit', () => {
  const line = buf.split('@@JSON@@')[1]
  if (!line) {
    console.error('[align] 探针没拿到读数：\n' + buf.slice(-800))
    process.exit(1)
  }
  const parsed = JSON.parse(line.split('\n')[0])
  if (parsed.panel) console.log('[align] 番茄钟面板：' + JSON.stringify(parsed.panel))
  else console.log('[align] 番茄钟面板：没打开')
  const rows = parsed.rows
  for (const r of rows) {
    // 基准取这一行里出现最多的那个 top：多数文字本来就该在同一个基线上
    const tops = r.cells.map((c) => c.top)
    const base = tops.sort((a, b) => a - b)[Math.floor(tops.length / 2)]
    console.log('\n' + r.row + '（基准 ' + base + '，图标 ' + JSON.stringify(r.svg) + '）')
    for (const c of r.cells) {
      const d = c.top - base
      console.log(
        '  ' + String(c.text).padEnd(16) +
        ' 文字顶 ' + String(c.top).padStart(8) +
        '  偏差 ' + (d >= 0 ? '+' : '') + d.toFixed(2).padStart(6) +
        '  文字高 ' + String(c.th).padStart(5) +
        '  行盒 ' + String(c.boxH).padStart(6) +
        '  ' + c.cls,
      )
    }
  }
  console.log('\n[align] 截图：' + png)
})
