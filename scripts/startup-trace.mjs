/**
 * 启动耗时追踪：跑一次应用，把主进程与渲染层的打点读回来，印成一张表。
 *
 * 打点本身在主进程（electron/startup.ts）与渲染层（src/lib/startupTrace.ts），
 * 平时完全不做事；这个脚本负责设 MOJI_STARTUP_TRACE、等结果、清理进程。
 *
 * 用法（先确保没有别的实例在跑：单实例锁会让新进程直接退出）：
 *   node scripts/startup-trace.mjs                  # 用 dist/ + dist-electron/ 跑生产构建
 *   node scripts/startup-trace.mjs --packaged       # 跑 release/win-unpacked 里打好的 exe
 *   node scripts/startup-trace.mjs --runs 3         # 跑三次，印每次的读数
 *   node scripts/startup-trace.mjs --user-data <dir> --keep   # 指定数据目录、不删结果文件
 *
 * 前提：dist/ 与 dist-electron/ 是最新的（npm run build）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const argv = process.argv.slice(2)
const flag = (name) => argv.includes('--' + name)
const opt = (name, fallback = '') => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const packaged = flag('packaged')
const runs = Math.max(1, Number(opt('runs', '1')) || 1)
const keep = flag('keep')
const userData = opt('user-data')

const exe = packaged
  ? join(ROOT, 'release', 'win-unpacked', '归一 Unyra.exe')
  : require('electron')

const appArgs = packaged ? [] : ['.']
if (userData) appArgs.push('--user-data-dir=' + userData)

const pad = (s, n) => String(s).padEnd(n)
const num = (v) => (typeof v === 'number' ? v.toFixed(0) : '—')

/** 主进程那串点：印成「相对上一笔」的增量，看的是每一段各自花了多久 */
function printMain(marks, t0) {
  console.log('  主进程（段内耗时 / 相对 spawn 的墙钟）')
  let prev = 0
  for (const m of marks) {
    const wall = t0 ? m.wall - t0 : NaN
    console.log(
      '    ' + pad(m.label, 20) + pad('+' + num(m.ms - prev), 10) + pad('段内', 5) + '   第 ' + num(wall) + ' ms',
    )
    prev = m.ms
  }
}

function printRenderer(r) {
  if (!r) {
    console.log('  渲染层：没有回传（页面没走到报告那一步？）')
    return
  }
  console.log('  渲染层（相对导航开始）')
  let prev = 0
  for (const [label, ms] of r.marks) {
    console.log('    ' + pad(label, 20) + pad(num(ms) + ' ms', 12) + '+' + num(ms - prev) + ' ms')
    prev = ms
  }
  for (const [k, v] of Object.entries(r.paint ?? {})) console.log('    ' + pad(k, 20) + num(v) + ' ms')
  for (const [k, v] of Object.entries(r.nav ?? {})) console.log('    ' + pad(k, 20) + num(v) + ' ms')
  if (r.screen) console.log('  这一屏：元素 ' + r.screen.elements + ' 个，文字 ' + r.screen.text + ' 字，登录页=' + r.screen.login)
  const spans = Object.entries(r.spans ?? {})
  if (spans.length) {
    console.log('  计时段（次数 / 合计 / 最长）')
    for (const [k, [n, sum, max]] of spans) {
      console.log('    ' + pad(k, 26) + pad(n + ' 次', 8) + pad(sum.toFixed(0) + ' ms', 10) + '最长 ' + max.toFixed(0) + ' ms')
    }
  }
}

async function once(i) {
  const out = join(mkdtempSync(join(tmpdir(), 'moji-startup-')), 'trace.json')
  const t0 = Date.now()
  const child = spawn(exe, appArgs, {
    cwd: packaged ? join(ROOT, 'release', 'win-unpacked') : ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MOJI_STARTUP_TRACE: out, MOJI_STARTUP_TRACE_EXIT: '1' },
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const deadline = Date.now() + 40000
  while (!existsSync(out) && Date.now() < deadline && child.exitCode === null) {
    await new Promise((r) => setTimeout(r, 100))
  }
  const exited = child.exitCode !== null
  if (!exited) child.kill()
  if (!existsSync(out)) {
    console.log('第 ' + i + ' 次：没拿到结果。' + (exited ? '进程提前退出了（有别的实例在跑？看下面的输出）' : '等超时了'))
    const interesting = log.split(/\r?\n/).filter((l) => /startup|renderer|Error|error/.test(l)).slice(0, 20)
    if (interesting.length) console.log(interesting.map((l) => '    | ' + l).join('\n'))
    return null
  }
  const data = JSON.parse(readFileSync(out, 'utf-8'))
  data.__t0 = t0
  if (!keep) rmSync(out, { force: true })
  else console.log('    结果文件：' + out)
  console.log('第 ' + i + ' 次运行')
  printMain(data.main, t0)
  printRenderer(data.renderer)
  const shown = data.main.find((m) => m.label === 'main:shown')
  if (shown) console.log('    → 从 spawn 到窗口显示：' + num(shown.wall - t0) + ' ms')
  return data
}

if (!packaged && !existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/index.html 不存在：先 npm run build')
  process.exit(1)
}
if (packaged && !existsSync(exe)) {
  console.error('没有 ' + exe + '：先 npm run release:win')
  process.exit(1)
}

const all = []
for (let i = 1; i <= runs; i++) {
  const d = await once(i)
  if (d) all.push(d)
  await new Promise((r) => setTimeout(r, 600))
}
if (!all.length) process.exit(1)

/** 汇总：只挑几段关键的，看多次运行的稳定性 */
if (all.length > 1) {
  const wall = (d, label) => {
    const m = d.main.find((x) => x.label === label)
    return m ? m.wall - d.__t0 : NaN
  }
  const rows = [
    ['主进程求值完（main:eval）', (d) => wall(d, 'main:eval')],
    ['app ready（main:ready）', (d) => wall(d, 'main:ready')],
    ['窗口建好（main:window）', (d) => wall(d, 'main:window')],
    ['页面加载完（main:loadFile）', (d) => wall(d, 'main:loadFile')],
    ['窗口显示（main:shown）', (d) => wall(d, 'main:shown')],
  ]
  console.log('\n汇总（相对 spawn 的墙钟，ms）')
  console.log('  ' + pad('阶段', 30) + '每次读数')
  for (const [label, get] of rows) {
    console.log('  ' + pad(label, 30) + all.map((d) => num(get(d))).join('  '))
  }
}
