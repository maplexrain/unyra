/**
 * 从 public/logo.svg 生成运行时与安装包要用的位图。
 *
 * 为什么需要这一步：窗口图标、托盘图标、界面里的标志、以及安装包的图标**都只能用位图**
 * （Electron 的 nativeImage 与 electron-builder 都不吃 SVG），所以矢量原稿要光栅化成：
 *   public/logo.png    256×256   运行时：窗口图标、托盘、界面标志、favicon
 *   build/icon.png    1024×1024  electron-builder 由它生成安装包与 exe 的多尺寸 .ico
 *
 * 为什么用 Electron 自己渲染，而不是装 sharp / resvg：Electron 本来就在依赖里，
 * 而为了转一张图再装几十 MB 的原生包不划算；把 SVG 画进 canvas 再导出 PNG，
 * 浏览器内核做得比任何库都准（透明通道也照原样保留）。
 *
 * 跑法：npm run icons（改 logo 时跑一次；生成物要一起提交，构建不依赖这个脚本）
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

/** __dirname 在 electron 里就是本文件所在目录 */
const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'public/logo.svg')

/**
 * 生成目标。size 是边长。
 */
const TARGETS = [
  { out: 'public/logo.png', size: 256 },
  { out: 'build/icon.png', size: 1024 },
]
/**
 * 按目标把 SVG 转成 dataURL。
 * 换配色靠的是替换 SVG 源码里的填充色——比在 canvas 上做像素操作可靠，
 * 而且原稿（public/logo.svg）不用为了第二枚图标改一个字。
 */
function sourceFor(target, svg) {
  const colored = target.ink ? svg.replace(/#A23A24/gi, target.ink) : svg
  return 'data:image/svg+xml;base64,' + Buffer.from(colored, 'utf8').toString('base64')
}

/** 把 SVG 按指定边长画进 canvas，导出 PNG 的 dataURL；出错时回一个可读的结果而不是抛异常 */
function renderScript(dataUrl, target) {
  const size = target.size
  // 一行一句、用换行分开：拼成一长串时漏个分号就会变成
  // 「new Image() await …」这种语法错误，而 executeJavaScript 只会回一句
  // 'Script failed to execute'，非常难查（这个坑踩过一次）
  return [
    '(async () => {',
    '  try {',
    '    const img = new Image()',
    '    const loaded = await new Promise((res) => {',
    '      img.onload = () => res("ok")',
    '      img.onerror = () => res("load failed")',
    '      img.src = ' + JSON.stringify(dataUrl),
    '    })',
    '    if (loaded !== "ok") return { ok: false, error: loaded + " natural=" + img.naturalWidth }',
    '    const c = document.createElement("canvas")',
    '    c.width = ' + size,
    '    c.height = ' + size,
    '    const ctx = c.getContext("2d")',
    '    if (!ctx) return { ok: false, error: "no 2d context" }',
    // 底板：圆角方块。用的是 canvas 自带的圆角矩形，省得手写四段弧
    '    const plate = ' + JSON.stringify(target.plate || null),
    '    if (plate) {',
    '      ctx.beginPath()',
    '      ctx.roundRect(0, 0, ' + size + ', ' + size + ', Math.round(' + size + ' * 0.18))',
    '      ctx.fillStyle = plate',
    '      ctx.fill()',
    '    }',
    // 标志按 scale 居中缩小：直接铺满时，边缘会顶到图标框，看着比旁边的图标大一圈
    '    const side = ' + size + ' * ' + (target.scale || 1),
    '    const off = (' + size + ' - side) / 2',
    '    ctx.drawImage(img, off, off, side, side)',
    '    return { ok: true, data: c.toDataURL("image/png") }',
    '  } catch (e) {',
    '    return { ok: false, error: String(e && e.stack ? e.stack : e) }',
    '  }',
    '})()',
  ].join('\n')
}

app
  .whenReady()
  .then(async () => {
    const svg = fs.readFileSync(SOURCE, 'utf8')
    // 隐藏窗口只为拿一个渲染环境：canvas 的像素操作不依赖窗口可见
    const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } })
    // 渲染层出什么错都要看得见，否则只会得到一句 'Script failed to execute'
    win.webContents.on('console-message', (_e, _level, message) => console.log('[renderer] ' + message))
    await win.loadURL('data:text/html,<body></body>')
    for (const t of TARGETS) {
      const data = await win.webContents.executeJavaScript(renderScript(sourceFor(t, svg), t), true)
      if (data && data.ok === false) throw new Error('画不出来：' + data.error)
      const buf = Buffer.from(String(data.data).split(',')[1], 'base64')
      const out = path.join(ROOT, t.out)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, buf)
      console.log('[icons] ' + t.out + '  ' + t.size + '×' + t.size + '  ' + Math.round(buf.length / 1024) + ' KB')
    }
    app.exit(0)
  })
  .catch((err) => {
    console.error('[icons] 失败：' + (err && err.message ? err.message : err))
    app.exit(1)
  })
