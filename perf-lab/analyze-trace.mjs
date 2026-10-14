/*
 * 一份 DevTools 性能日志的体检脚本。
 *
 * 为什么要有它：Performance 面板要人拖着时间轴一格一格看，而「页签切换为什么慢」
 * 这类问题需要的是**几个能对比的数字**——主线程占用率、每秒多少次 Commit、
 * 最长的一次同步阻塞是谁、录制本身占了多少。这些数字用眼睛在面板里读不出来，
 * 用脚本一遍就出来了。
 *
 * 用法：
 *   node perf-lab/analyze-trace.mjs <trace.json.gz|trace.json> [--json]
 *
 * 它做三件事：
 *   1. 从 traceEvents 里算主线程的占用与事件速率（谁在每秒跑 40 次）
 *   2. 从内嵌的 CPU profile 里算按函数的 self time（钱花在哪个函数上）
 *   3. 按已知模式点名几个「性能嫌疑犯」：常驻帧管线、React 调度循环、
 *      同步落盘、强制布局读、录制开销本身
 *
 * 两个坑（踩过，写在这里免得再踩）：
 *   - trace 里可能内嵌**多个** profile（渲染进程一个、Electron 主进程一个），
 *     ProfileChunk 必须按 pid 过滤，否则两条时间轴会被首尾相接拼成两倍长。
 *   - CpuProfiler::StartProfiling 那一笔动辄一两秒，是「开始录制」本身的成本
 *     （V8 会把所有已优化代码反优化一遍），不是应用的问题，必须单独剔出来。
 */

import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

/* ---------- 读入 ---------- */

const file = process.argv[2]
const asJson = process.argv.includes('--json')
if (!file) {
  console.error('用法：node perf-lab/analyze-trace.mjs <trace.json.gz|trace.json>')
  process.exit(2)
}
const raw = file.endsWith('.gz') ? gunzipSync(readFileSync(file)) : readFileSync(file)
const trace = JSON.parse(raw.toString('utf8'))
const ev = trace.traceEvents ?? trace
const meta = trace.metadata ?? {}

const ms = (us) => (us / 1000).toFixed(2) + 'ms'
const s = (us) => (us / 1e6).toFixed(2) + 's'
const pct = (a, b) => ((100 * a) / b).toFixed(1) + '%'

/* ---------- 1. 找渲染主线程 ---------- */

const perThread = new Map()
for (const e of ev) {
  if (e.ph !== 'X' || e.dur == null) continue
  const k = `${e.pid}:${e.tid}`
  const a = perThread.get(k) ?? { n: 0, total: 0, max: 0 }
  a.n++; a.total += e.dur; a.max = Math.max(a.max, e.dur)
  perThread.set(k, a)
}
const threads = [...perThread.entries()].sort((a, b) => b[1].total - a[1].total)
const MAIN_KEY = threads[0][0]
const [PID, TID] = MAIN_KEY.split(':').map(Number)

const slices = ev
  .filter((e) => e.ph === 'X' && e.pid === PID && e.tid === TID && e.dur != null)
  .sort((a, b) => a.ts - b.ts || b.dur - a.dur)

/* ---------- 2. 事件树 ---------- */

const roots = []
{
  const st = []
  for (const e of slices) {
    const end = e.ts + e.dur
    while (st.length && st[st.length - 1].end <= e.ts) st.pop()
    const n = { e, end, children: [] }
    if (st.length) st[st.length - 1].children.push(n)
    else roots.push(n)
    st.push(n)
  }
}
const selfOf = (n) => n.e.dur - n.children.reduce((a, c) => a + c.e.dur, 0)

const winStart = Math.min(...roots.map((r) => r.e.ts))
const winEnd = Math.max(...roots.map((r) => r.e.ts + r.e.dur))
const WINDOW = winEnd - winStart
const busy = roots.reduce((a, r) => a + r.e.dur, 0)

/* ---------- 3. 按名字聚合 ---------- */

const byName = new Map()
const walk = (n) => {
  const a = byName.get(n.e.name) ?? { n: 0, total: 0, self: 0 }
  a.n++; a.total += n.e.dur; a.self += selfOf(n)
  byName.set(n.e.name, a)
  for (const c of n.children) walk(c)
}
for (const r of roots) walk(r)

/** 录制本身的成本：这几样与被测应用无关，单独记账 */
const RECORDING = /^(CpuProfiler::StartProfiling|V8Console::runTask|V8Console::TimeStamp|v8::Debugger::AsyncTaskRun|v8::Debugger::AsyncTaskScheduled|v8::Debugger::AsyncTaskCanceled|UserTiming::Measure|StubScriptCatchup|ScriptCatchup)$/
/**
 * 只算**最外层**的那一个：这些事件层层嵌套（AsyncTaskRun 包着 V8Console::runTask，
 * 而 CpuProfiler::StartProfiling 又被 AsyncTaskRun 包着），逐个累加 total 会翻好几倍。
 */
let recordingTotal = 0
{
  const stack = [...roots]
  while (stack.length) {
    const n = stack.pop()
    if (RECORDING.test(n.e.name)) { recordingTotal += n.e.dur; continue } // 命中就不再往里走
    for (const c of n.children) stack.push(c)
  }
}

/* ---------- 4. CPU profile（只取渲染进程） ---------- */

const chunks = ev.filter((e) => e.name === 'ProfileChunk' && e.pid === PID)
const nodesById = new Map()
for (const c of chunks) for (const n of c.args?.data?.cpuProfile?.nodes ?? []) nodesById.set(n.id, n)
const parentOf = new Map()
for (const [id, n] of nodesById) if (n.parent != null) parentOf.set(id, n.parent)

const chainCache = new Map()
function chain(id) {
  if (chainCache.has(id)) return chainCache.get(id)
  const out = []
  let cur = id, g = 0
  while (cur != null && g++ < 400) {
    const n = nodesById.get(cur)
    if (!n) break
    const cf = n.callFrame ?? {}
    out.push({ fn: cf.functionName || '(anon)', url: (cf.url || '').replace(/^.*[\\/]/, '').split('?')[0], line: cf.lineNumber })
    cur = parentOf.get(cur)
  }
  chainCache.set(id, out)
  return out
}

const profileStart = ev.find((e) => e.name === 'Profile' && e.pid === PID)?.args?.data?.startTime
const samples = []
if (profileStart != null) {
  let t = profileStart
  for (const c of chunks) {
    const ss = c.args?.data?.cpuProfile?.samples ?? []
    const ds = c.args?.data?.timeDeltas ?? []
    for (let i = 0; i < ss.length; i++) { samples.push({ t, id: ss[i] }); t += ds[i] ?? 0 }
  }
}
const sampleDt = (i) => (i + 1 < samples.length ? samples[i + 1].t - samples[i].t : 0)

/** 采样时刻落在 [from, to) 里的样本，按叶子函数聚合 */
function profileIn(from, to, top = 6) {
  const m = new Map()
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].t < from || samples[i].t >= to) continue
    const c = chain(samples[i].id)
    const k = c.slice(0, 4).map((f) => `${f.fn}@${f.url}:${f.line}`).join(' <- ')
    m.set(k, (m.get(k) ?? 0) + sampleDt(i))
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
}

/* ---------- 5. 已知模式：点名嫌疑犯 ---------- */

/** 常驻帧管线：每帧一次 Commit / 样式重算 / Layerize，且任务里没有 JS —— 那就是背景动画 */
const commitCount = byName.get('Commit')?.n ?? 0
const frameTasks = roots.filter((r) => r.children.some((c) => c.e.name === 'Commit') && !r.children.some((c) => c.e.name === 'FunctionCall'))

/** React 调度循环：performWorkUntilDeadline 连续不断地被调用 */
const pwCalls = []
{
  const stack = [...roots]
  while (stack.length) {
    const n = stack.pop()
    if (n.e.name === 'FunctionCall' && n.e.args?.data?.functionName === 'performWorkUntilDeadline') pwCalls.push(n)
    for (const c of n.children) stack.push(c)
  }
}

/** 同步阻塞：单个 FunctionCall 的 self time 超过阈值，且没有子 slice —— 纯同步计算 */
const blockers = []
{
  const stack = [...roots]
  while (stack.length) {
    const n = stack.pop()
    if (n.e.name === 'FunctionCall' && selfOf(n) > 40000) {
      const d = n.e.args?.data ?? {}
      blockers.push({ dur: selfOf(n), fn: d.functionName || '(anon)', url: String(d.url || '').replace(/^.*[\\/]/, ''), line: d.lineNumber, ts: n.e.ts })
    }
    for (const c of n.children) stack.push(c)
  }
  blockers.sort((a, b) => b.dur - a.dur)
}

/** 强制布局读：get scrollWidth / getBoundingClientRect / getComputedStyle 的 self time */
const forced = new Map()
for (const s of samples) {
  const c = chain(s.id)
  const i = c.findIndex((f) => /^get (scrollWidth|clientWidth|offsetWidth|offsetHeight|boundingClientRect)$|^getBoundingClientRect$|getComputedStyle/.test(f.fn))
  if (i < 0) continue
  const k = c.slice(0, 5).map((f) => `${f.fn}@${f.url}:${f.line}`).join(' <- ')
  forced.set(k, (forced.get(k) ?? 0) + 1)
}

/** 输入事件 */
const inputs = slices.filter((e) => e.args?.data?.type && /^(click|mousedown|keydown|DOMActivate)$/.test(e.args.data.type))

/* ---------- 6. 输出 ---------- */

if (asJson) {
  console.log(JSON.stringify({
    window: WINDOW, cpuThrottling: meta.cpuThrottling ?? null,
    busy, recordingTotal,
    byName: Object.fromEntries([...byName.entries()].map(([k, v]) => [k, v])),
    commits: commitCount, frameTasks: frameTasks.length,
    pwCalls: pwCalls.length, pwMs: pwCalls.reduce((a, n) => a + n.e.dur, 0),
    blockers, inputs: inputs.map((e) => ({ type: e.args.data.type, dur: e.dur, ts: e.ts })),
  }, null, 2))
  process.exit(0)
}

const L = (s = '') => console.log(s)
L('══════════════════════════════════════════════════════════════')
L(' 性能日志体检 · ' + file.replace(/^.*[\\/]/, ''))
L('══════════════════════════════════════════════════════════════')
L()
L(`录制窗口        ${s(WINDOW)}`)
L(`CPU 节流        ${meta.cpuThrottling ? meta.cpuThrottling + '×（所有数字都被放大了这么多）' : '未设置'}`)
L(`渲染主线程      pid ${PID} / tid ${TID}`)
L(`主线程忙        ${ms(busy)} = ${pct(busy, WINDOW)} 的窗口`)
L(`其中录制开销    ${ms(recordingTotal)} = ${pct(recordingTotal, WINDOW)}（CpuProfiler 启动 + 调试器异步任务记账）`)
L(`净应用开销      ${ms(busy - recordingTotal)} = ${pct(busy - recordingTotal, WINDOW)}`)
L()

L('── 每秒发生多少次（这些是「常驻负担」的指纹） ─────────────')
const rate = (name) => {
  const a = byName.get(name)
  return a ? `${(a.n / (WINDOW / 1e6)).toFixed(1).padStart(7)}/s  ×${String(a.n).padStart(6)}  self ${ms(a.self)}` : '      —'
}
for (const n of ['Commit', 'UpdateLayoutTree', 'Layerize', 'PrePaint', 'Paint', 'FireAnimationFrame',
  'PageAnimator::serviceScriptedAnimations', 'HitTest', 'LocalFrameView::performLayout', 'Layout',
  'TimerFire', 'EventDispatch', 'RunTask', 'FunctionCall']) {
  L(`  ${n.padEnd(40)} ${rate(n)}`)
}
L()

L('── 常驻帧管线 ─────────────────────────────────────────────')
L(`  带 Commit 且**任务内没有 JS** 的帧：${frameTasks.length} 次 = ${(frameTasks.length / (WINDOW / 1e6)).toFixed(1)}/s`)
L(`  → 这是背景动画（rAF 里画 canvas）在持续推合成帧；交互只能排在它后面。`)
L()

L('── React 调度循环 ─────────────────────────────────────────')
const pwMs = pwCalls.reduce((a, n) => a + n.e.dur, 0)
L(`  performWorkUntilDeadline：${pwCalls.length} 次，合计 ${ms(pwMs)} = ${pct(pwMs, WINDOW)} 的窗口`)
if (pwCalls.length) {
  const ds = pwCalls.map((n) => n.e.dur).sort((a, b) => b - a)
  L(`  单次：最长 ${ms(ds[0])} / 中位 ${ms(ds[Math.floor(ds.length / 2)])}`)
  L(`  → 每次都跑到时间片用尽才让出（≈5ms），说明更新队列一直排不完。`)
}
L()

L('── 最长的一次同步阻塞（>40ms 且无子调用） ─────────────────')
if (!blockers.length) L('  没有')
for (const b of blockers.slice(0, 8)) {
  L(`  ${ms(b.dur).padStart(10)}  ${b.fn}  @${b.url}:${b.line}`)
  const c = profileIn(b.ts, b.ts + b.dur, 4)
  for (const [k, v] of c) L(`               ↳ ${ms(v).padStart(9)}  ${k}`)
}
L()

L('── 按函数的 self time（渲染进程 CPU profile） ─────────────')
const selfAgg = new Map()
let profTotal = 0
for (let i = 0; i < samples.length; i++) {
  const c = chain(samples[i].id)
  const f = c[0]
  const k = `${f.fn}@${f.url}:${f.line}`
  selfAgg.set(k, (selfAgg.get(k) ?? 0) + sampleDt(i))
  profTotal += sampleDt(i)
}
if (!profTotal) L('  （这份日志没带 CPU profile）')
for (const [k, v] of [...selfAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
  L(`  ${ms(v).padStart(10)}  ${pct(v, profTotal).padStart(6)}  ${k}`)
}
L()

L('── 强制布局读（读到几何 = 把样式与布局就地结算） ───────────')
if (!forced.size) L('  没有')
for (const [k, v] of [...forced.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  L(`  ×${String(v).padStart(5)}  ${k}`)
}
L()

L('── 输入事件（用户真正点了什么） ───────────────────────────')
if (!inputs.length) L('  窗口里没有任何 click / mousedown / keydown')
for (const e of inputs) {
  L(`  +${((e.ts - winStart) / 1000).toFixed(1).padStart(8)}ms  ${ms(e.dur).padStart(10)}  ${e.args.data.type}`)
}
L()
