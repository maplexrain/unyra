/*
 * 页签切换性能实验台（最小化链路复刻）。
 *
 * 这个文件负责什么：把 Trace-20261014T220042.json.gz 里量出来的那条链路，
 * 压缩成一台可以开关、可以调参、可以量化的小机器——不依赖 Electron、不依赖
 * 应用数据、不依赖网络，双击生成的 HTML 就能跑。
 *
 * 复刻的是**机制**，不是界面。链路共六段，对应下面六个开关：
 *
 *   1. 输入       点页签 → setState（并发 startTransition 或同步渲染）
 *   2. 渲染       React 把整棵工作区树（侧栏节点 + 页签栏 + 正文 + 对话栏 + 四组 dock）重渲
 *   3. 提交       DOM 变更 → 样式重算 / 布局 / 绘制 / 合成
 *   4. 背景动画   侧栏底部那块 canvas 律动（rAF，静音时每 2 帧画一次）
 *                  ——应用里它现在**看不见就停**（滚出视口 / 页面切到后台），
 *                  所以这个开关的「开」对应的是「可见且在前台」那一档；
 *                  要量「切到后台能省多少」，就把这个开关关掉再看。
 *   5. 防抖落盘   320ms 后同步跑 buildDocs（逐节点 JSON.stringify）+ diffDocs + assetMoves
 *   6. 秒级心跳   1s 一次：强制布局读（getBoundingClientRect）+ 同步重渲
 *
 * 另外单独复刻两处「读到几何就强制全树重排」的点：
 *   - 面包屑（NodeTrail）的 scrollWidth 读 + smooth 滚动
 *   - 页签栏（TabBar）的 scrollWidth 读
 *
 * 数字的来历见 docs/perf/2026-10-14-tab-switch-trace.md。这里的默认值就是那份
 * 日志的取值：节点 120、每节点正文 2KB、防抖 320ms、心跳 1000ms、动画 60fps
 * 每 2 帧画一次、时间切片 5ms。
 *
 * 指标只看三样，都是用户能感觉到的东西：
 *   - 点击 → 首帧（click-to-paint）：等价于 INP 里的「呈现延迟」
 *   - 长任务（>50ms）：一次卡顿就是一次「点了没反应」
 *   - 主线程占用：把上面六段加起来除以墙钟时间
 */

import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, startTransition, flushSync } from 'react'
import { createRoot } from 'react-dom/client'

/* oxlint-disable react/only-export-components -- 单文件实验台：所有组件都住在这一个文件里，
   本来就不指望 Fast Refresh 能单独换掉其中一个。 */

/* ============================ 1. 参数 ============================ */

const DEFAULTS = {
  nodes: 120,            // 知识节点数（侧栏树的规模）
  docKb: 2,              // 每个节点正文的体量（KB），决定 buildDocs 的序列化成本
  sliceMs: 5,            // React 并发渲染的时间切片（React 默认就是 5ms）
  debounceMs: 320,       // 落盘防抖（= lib/storage.ts 的 WRITE_DELAY）
  beatMs: 1000,          // 阅读心跳周期（= learn/reading 的 BEAT_MS）
  animFps: 60,           // 背景动画的 rAF 频率上限
  animEvery: 2,          // 静音时每几帧画一次（= SystemAudioWave 的 frames % 2）
  // 六个机制开关
  useConcurrent: true,   // false = 同步渲染（flushSync），复刻 performSyncWorkOnRoot
  useCanvas: true,       // 侧栏 canvas 律动
  useSave: true,         // 防抖落盘
  useBeat: true,         // 秒级心跳
  useTrail: true,        // 面包屑 scrollWidth 读
  useTabs: true,         // 页签栏 scrollWidth 读
}

/* ============================ 2. 量具 ============================ */

/**
 * 一台只往前走的量具：把每次「点击 → 首帧」记下来，同时把长任务与主线程占用也收进来。
 * 长任务用 PerformanceObserver('longtask')——浏览器自己认定的「卡了」比我们自己算的可信。
 *
 * 起始时刻与墙钟都放在 effect / state 里更新，不在渲染期读 `performance.now()`：
 * 那是渲染期的副作用，会让 React 编译器跳过这个组件（本项目 lint 也会拦）。
 */
function useMetrics() {
  const [state, setState] = useState({ clicks: [], longTasks: [], busyMs: 0 })
  const [wall, setWall] = useState(1000)
  const startedAt = useRef(0)

  useEffect(() => {
    startedAt.current = performance.now()
    const id = setInterval(() => setWall(Math.max(1, performance.now() - startedAt.current)), 1000)
    return () => clearInterval(id)
  }, [])

  // 长任务：一次 >50ms 的主线程占用
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return
    let obs
    try {
      obs = new PerformanceObserver((list) => {
        const add = list.getEntries().map((e) => e.duration)
        if (!add.length) return
        setState((s) => ({ ...s, longTasks: [...s.longTasks, ...add].slice(-200) }))
      })
      obs.observe({ entryTypes: ['longtask'] })
    } catch {
      /* 有的浏览器没有 longtask，忽略 */
    }
    return () => obs?.disconnect()
  }, [])

  const addBusy = useCallback((ms) => {
    setState((s) => ({ ...s, busyMs: s.busyMs + ms }))
  }, [])
  const addClick = useCallback((ms) => {
    setState((s) => ({ ...s, clicks: [...s.clicks, ms].slice(-200) }))
  }, [])
  const reset = useCallback(() => {
    startedAt.current = performance.now()
    setWall(1000)
    setState({ clicks: [], longTasks: [], busyMs: 0 })
  }, [])

  return { state, wall, addBusy, addClick, reset }
}

/** 记一次「点击 → 首帧」：点下去打点，等浏览器真的画出来（两层 rAF）再收 */
function markClickToPaint(done) {
  const t0 = performance.now()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => done(performance.now() - t0))
  })
}

/* ============================ 3. 数据与序列化（复刻 buildDocs / diffDocs） ============================ */

/**
 * 造一份和 LearnStore 同构的数据：节点带 meta、正文、笔记、试卷。
 * 它存在的意义是让 buildDocs 有真东西可序列化——成本就来自这里的对象图。
 */
function makeStore(nodeCount, docKb) {
  const body = 'x'.repeat(docKb * 1024)
  const nodes = []
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `n${i}`,
      goalId: `g${i % 6}`,
      title: `节点 ${i} · ${'标题'.repeat(6)}`,
      key: `k${i}`,
      description: `描述 ${i} ${'说明'.repeat(20)}`,
      status: i % 5 === 0 ? 'mastered' : i % 3 === 0 ? 'learning' : 'todo',
      origin: 'ai',
      createdAt: 1700000000000 + i,
      updatedAt: 1700000000000 + i * 7,
      annotations: [],
      learning: { attempts: i % 9, correct: i % 7 },
      notes: [{ name: `笔记${i}`, content: body.slice(0, 400), createdAt: 1, updatedAt: 2 }],
      docs: { teaching: body },
      outline: { version: 1, items: [{ id: `o${i}`, title: `大纲 ${i}`, children: [] }] },
    })
  }
  const edges = []
  for (let i = 1; i < nodeCount; i++) edges.push({ from: `n${i}`, to: `n${i - 1}`, createdAt: 1 })
  return { nodes, edges, exams: [], goals: [], conversations: [], resources: {}, minds: {}, methods: {}, workflows: { byGoal: {} }, reading: { byGoal: {} }, checkin: { byGoal: {} }, tmp: {} }
}

/** 与 learn/files/build.ts 的 buildDocs 同构：逐节点 JSON.stringify(…, null, 2) */
function buildDocs(store) {
  const files = new Map()
  const byId = new Map(store.nodes.map((n) => [n.id, n]))
  const deps = new Map()
  for (const e of store.edges) {
    const l = deps.get(e.from)
    if (l) l.push(e)
    else deps.set(e.from, [e])
  }
  const examsOf = new Map()
  for (const e of store.exams) {
    const l = examsOf.get(e.nodeId)
    if (l) l.push(e)
    else examsOf.set(e.nodeId, [e])
  }
  const goalById = new Map()
  for (const g of store.goals) if (!goalById.has(g.id)) goalById.set(g.id, g)

  for (const id of byId.keys()) {
    const node = byId.get(id)
    const dir = `g${node.goalId}/n${id}`
    const path = ['docs', dir].join('/')
    files.set(`${path}/${id}.md`, node.docs?.teaching ?? '')
    if (node.outline) files.set(`${path}/${id}.outline.json`, JSON.stringify(node.outline))
    for (const note of node.notes ?? []) if (note.content.trim()) files.set(`${path}/notes/${note.name}.md`, note.content)
    for (const exam of examsOf.get(node.id) ?? []) files.set(`${path}/exams/${exam.id}.json`, JSON.stringify(exam))
    // 这一段是整份摊平里最贵的一笔（与源码注释一致）
    const meta = {
      version: 1, id: node.id, title: node.title, key: node.key, description: node.description,
      status: node.status, origin: node.origin, createdAt: node.createdAt, updatedAt: node.updatedAt,
      annotations: node.annotations,
      dependencies: (deps.get(node.id) ?? []).map((e) => ({ to: e.to, createdAt: e.createdAt })),
      exams: examsOf.get(node.id) ?? [], learning: node.learning,
      notes: (node.notes ?? []).map((n) => ({ name: n.name, createdAt: n.createdAt, updatedAt: n.updatedAt })),
    }
    files.set(`${path}/${id}.meta.json`, JSON.stringify(meta, null, 2))
  }
  return files
}

/** 与 learn/files/diff.ts 的 diffDocs 同构：逐条比对 + 目录收敛 */
function diffDocs(prev, next) {
  const writes = []
  for (const [rel, text] of next) if (prev.get(rel) !== text) writes.push(rel)
  const stale = [...prev.keys()].filter((rel) => !next.has(rel))
  if (!stale.length) return { writes, removes: [] }
  const keep = [...next.keys()]
  const dirs = new Set()
  for (const rel of stale) {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  const emptyDirs = new Set([...dirs].filter((d) => !keep.some((k) => k.startsWith(`${d}/`))))
  const parentOf = (d) => d.slice(0, d.lastIndexOf('/'))
  const doomed = [...emptyDirs].filter((d) => !emptyDirs.has(parentOf(d))).sort()
  const removes = [...doomed]
  for (const rel of stale) if (!doomed.some((d) => rel.startsWith(`${d}/`))) removes.push(rel)
  return { writes, removes }
}

/** 与 learn/files/diff.ts 的 assetMoves 同构：改名时要搬的资源目录（要 parseJson 每一份 meta） */
function assetMoves(prev, next) {
  const dirsOf = (files) => {
    const out = new Map()
    for (const [rel, text] of files) {
      const parts = rel.split('/')
      const base = parts[parts.length - 2]
      if (parts[parts.length - 1] !== `${base}.meta.json`) continue
      try { const m = JSON.parse(text); if (m?.id) out.set(m.id, parts.slice(0, -1).join('/')) } catch { /* 忽略 */ }
    }
    return out
  }
  const before = dirsOf(prev)
  const after = dirsOf(next)
  const moves = []
  for (const [nodeId, from] of before) {
    const to = after.get(nodeId)
    if (to && to !== from) moves.push({ from, to })
  }
  return moves
}

/**
 * 落盘调度（= lib/storage.ts 的 scheduleCommit）。
 *
 * **关键点**：防抖只是「把成本推到 320ms 之后」，并没有把它挪出主线程。
 * 回调里跑的 buildDocs/diffDocs 全是同步的，所以每存一次就阻塞一次主线程。
 * 开关关掉时它整段消失——这就是这台机器要量出来的东西。
 */
function useSaver({ store, enabled, debounceMs, onCost }) {
  const snapshot = useRef(null)
  const pending = useRef(new Map())

  useEffect(() => {
    if (!enabled) return
    const key = 'docs:u1'
    const map = pending.current
    const prev = map.get(key)
    if (prev) clearTimeout(prev.timer)
    const timer = setTimeout(() => {
      map.delete(key)
      const t0 = performance.now()
      // 这三段就是日志里那 99ms：buildDocs 72.8ms + diffDocs 16.8ms + assetMoves 6ms
      const desired = buildDocs(store)
      const moves = assetMoves(snapshot.current ?? new Map(), desired)
      const { writes, removes } = diffDocs(snapshot.current ?? new Map(), desired)
      snapshot.current = desired
      onCost(performance.now() - t0, { files: desired.size, writes: writes.length, removes: removes.length, moves: moves.length })
    }, debounceMs)
    map.set(key, { timer })
    return () => { clearTimeout(timer); map.delete(key) }
  }, [store, enabled, debounceMs, onCost])

  // 卸载时把待写的清掉，避免关掉开关之后还有一笔在路上
  useEffect(() => {
    const map = pending.current
    return () => { for (const p of map.values()) clearTimeout(p.timer); map.clear() }
  }, [])
}

/* ============================ 4. 界面（复刻工作区的形状） ============================ */

/**
 * 侧栏底部那块 canvas 律动（= SystemAudioWave）。
 *
 * 它只做一件事：每帧画一遍。静音时每 2 帧画一次、有声时每帧——所以它长期占着
 * 一个 rAF 槽位，让主线程永远「有活干」，交互就只能排队。这是日志里
 * 205 次 Commit / 5.15s ≈ 40fps 的来源。
 */
function CanvasWave({ enabled, fps, every }) {
  const ref = useRef(null)
  const [stats, setStats] = useState({ frames: 0, draws: 0 })

  useEffect(() => {
    if (!enabled) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    let frames = 0
    let draws = 0
    let last = 0
    const interval = 1000 / Math.max(1, fps)
    let w = 0, h = 0, bars = 0
    let shown = new Float32Array(0)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()      // 强制布局读（和源码一致）
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, rect.width); h = Math.max(1, rect.height)
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bars = Math.max(8, Math.round(w / 6))
      shown = new Float32Array(bars)
    }

    const draw = (now) => {
      // 5 个图层，和源码同一套画法（底衬曲线 + 基垫 + 光柱 + 峰值珠 + 倒影）
      ctx.clearRect(0, 0, w, h)
      const step = w / bars
      const barW = Math.max(1.5, step - 1.5)
      const baseY = h - 4
      const usable = Math.max(10, baseY - 8)
      const seal = getComputedStyle(canvas).getPropertyValue('--seal').trim() || '#a8432f'

      for (let i = 0; i < bars; i++) {
        const v = 0.05 + 0.065 * (Math.sin(now * 0.0016 + i * 0.32) * 0.5 + 0.5)
        shown[i] = Math.max(shown[i] * 0.94, v)
      }
      ctx.beginPath()
      ctx.moveTo(0, baseY)
      for (let i = 0; i < bars; i++) ctx.lineTo(i * step + barW / 2, baseY - shown[i] * usable)
      ctx.lineTo(w, baseY)
      ctx.closePath()
      const g1 = ctx.createLinearGradient(0, baseY - usable, 0, baseY)
      g1.addColorStop(0, seal); g1.addColorStop(1, 'transparent')
      ctx.fillStyle = g1; ctx.globalAlpha = 0.1; ctx.fill()

      const g2 = ctx.createLinearGradient(0, baseY, 0, baseY - usable)
      g2.addColorStop(0, seal); g2.addColorStop(1, seal)
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(2, shown[i] * usable)
        ctx.fillStyle = g2; ctx.globalAlpha = 0.7
        ctx.beginPath(); ctx.roundRect(i * step, baseY - bh, barW, bh, [1, 1, 0.5, 0.5]); ctx.fill()
      }
      ctx.globalAlpha = 1
      draws++
    }

    const step = (now) => {
      frames++
      if (now - last >= interval) {
        last = now
        if (frames % every === 0) draw(now)
      }
      raf = requestAnimationFrame(step)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    raf = requestAnimationFrame(step)
    const tick = setInterval(() => setStats({ frames, draws }), 1000)
    return () => { ro.disconnect(); cancelAnimationFrame(raf); clearInterval(tick) }
  }, [enabled, fps, every])

  return (
    <div style={{ padding: '6px 8px 8px' }}>
      <canvas ref={ref} aria-hidden="true" style={{ display: 'block', width: '100%', height: 34, cursor: 'pointer' }} />
      <div className="muted" style={{ fontSize: 10, paddingTop: 4 }}>
        {enabled ? `rAF 帧 ${stats.frames} · 实际绘制 ${stats.draws}` : '律动已关闭'}
      </div>
    </div>
  )
}

/** 侧栏树：每个节点一个组件（= NodeRow），全部无条件重渲——复刻「整棵树跟着重渲」 */
function SidebarTree({ store, activeId, onPick, trail }) {
  return (
    <div className="tree">
      {store.nodes.map((n) => (
        <NodeRow key={n.id} node={n} active={n.id === activeId} onPick={onPick} trail={trail} />
      ))}
    </div>
  )
}

function NodeRow({ node, active, onPick, trail }) {
  return (
    <div className={'row' + (active ? ' active' : '')} onClick={() => onPick(node.id)}>
      <span className={'dot s-' + node.status} />
      <span className="label">{node.title}</span>
      {/* 每个节点都挂一份面包屑尾巴：这就是「读 scrollWidth 强制全树重排」的落点 */}
      {trail && <span className="trail" data-trail={node.id} />}
    </div>
  )
}

/** 页签栏（= TabBar）：每枚页签都会读一次自己的 scrollWidth 来判断要不要显示省略号 */
function TabBar({ tabs, activeId, onPick, readScrollWidth }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <Tab key={t.id} tab={t} active={t.id === activeId} onPick={onPick} readScrollWidth={readScrollWidth} />
      ))}
    </div>
  )
}

function Tab({ tab, active, onPick, readScrollWidth }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    if (!readScrollWidth) return
    // 同步读几何 = 强制把待处理的样式与布局全部结算掉（Layout Thrashing）
    const el = ref.current
    if (el) void el.scrollWidth
  })
  return (
    <div ref={ref} className={'tab' + (active ? ' active' : '')} onClick={() => onPick(tab.id)}>
      <span className="tabtitle">{tab.title}</span>
    </div>
  )
}

/** 面包屑（= NodeTrail）：切换节点时读 scrollWidth 再 smooth 滚到底 */
function Trail({ activeId, enabled }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    void el.scrollWidth
    el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
  }, [activeId, enabled])
  return (
    <div ref={ref} className="breadcrumb">
      <span>目标</span><span>›</span><span>第 {activeId} 节点</span><span>›</span>
      <span>当前位置</span><span>›</span><span className="now">当前</span>
    </div>
  )
}

/** 正文（= DocBody）：把当前节点那一大段正文渲染出来 */
function DocBody({ node, big }) {
  return (
    <div className="doc">
      <h3>{node.title}</h3>
      <p className="muted">{node.description}</p>
      <div className="body">{big}</div>
    </div>
  )
}

/** 对话栏（= MessageBubble 那一列）：固定一屏消息，跟着整棵树一起重渲 */
function AgentPanel({ messages }) {
  return (
    <div className="agent">
      {messages.map((m, i) => (
        <div key={i} className="msg">
          <div className="who">{m.who}</div>
          <div className="text">{m.text}</div>
          <div className="meta">{m.meta}</div>
        </div>
      ))}
    </div>
  )
}

/** 秒级心跳（= learn/tracker/heartbeat.ts + ReadingTracker.beat） */
function useHeartbeat({ enabled, onBeat }) {
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(onBeat, DEFAULTS.beatMs)
    return () => clearInterval(id)
  }, [enabled, onBeat])
}

/* ============================ 5. 主界面 ============================ */

function Lab() {
  const [cfg, setCfg] = useState(DEFAULTS)
  const [nodeCount, setNodeCount] = useState(DEFAULTS.nodes)
  const [activeIdState, setActiveId] = useState('n0')
  const [saveInfo, setSaveInfo] = useState(null)
  const [beatInfo, setBeatInfo] = useState(null)
  const [busy, setBusy] = useState({ canvas: 0, save: 0, beat: 0, trail: 0, tabs: 0, render: 0 })
  const metrics = useMetrics()

  const beatProbe = useRef(null)
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }))

  /*
   * store 直接由参数派生，不在 effect 里 setState——那会白多一轮渲染，
   * 而且节点数/体量本来就是「渲染的输入」，不是「渲染之后才知道的状态」。
   */
  const store = useMemo(() => makeStore(nodeCount, cfg.docKb), [nodeCount, cfg.docKb])
  // 节点数调小之后旧 id 可能越界：渲染期夹一次，别让页签栏落空
  const activeId = store.nodes.some((n) => n.id === activeIdState) ? activeIdState : (store.nodes[0]?.id ?? 'n0')

  const tabs = useMemo(
    () => store.nodes.slice(0, Math.min(store.nodes.length, 24)).map((n) => ({ id: n.id, title: n.title })),
    [store],
  )
  const activeNode = store.nodes.find((n) => n.id === activeId) ?? store.nodes[0]
  const big = useMemo(() => activeNode?.docs?.teaching ?? '', [activeNode])

  // 固定一屏对话：让「整棵树重渲」这件事有真实的体量
  const messages = useMemo(() => {
    const out = []
    for (let i = 0; i < 24; i++) {
      out.push({
        who: i % 2 ? '超级导师' : '我',
        text: `第 ${i} 轮：${'这段是对话正文，用来把渲染成本抬到一个真实的量级。'.repeat(3)}`,
        meta: i % 3 === 0 ? '思考与工具 · 3 步 · 12.4k tokens' : '',
      })
    }
    return out
  }, [])

  // 落盘：store 一变就排队（和源码一样）
  useSaver({
    store, enabled: cfg.useSave, debounceMs: cfg.debounceMs,
    onCost: (ms, info) => { metrics.addBusy(ms); setSaveInfo({ ms, ...info, at: Date.now() }) },
  })

  // 心跳：每秒一次，先做一次强制布局读，再同步重渲一小块
  const onBeat = useCallback(() => {
    const t0 = performance.now()
    const el = beatProbe.current
    if (el) void el.getBoundingClientRect()
    // flushSync = 同步渲染，等价于日志里的 performSyncWorkOnRoot
    flushSync(() => setBeatInfo({ n: (n) => n }))
    const ms = performance.now() - t0
    metrics.addBusy(ms)
    setBeatInfo({ ms, at: Date.now() })
  }, [metrics])
  useHeartbeat({ enabled: cfg.useBeat, onBeat })

  /** 切换页签：这是被测量的那一次交互 */
  const pick = useCallback((id) => {
    markClickToPaint((ms) => metrics.addClick(ms))
    const t0 = performance.now()
    if (cfg.useConcurrent) {
      startTransition(() => setActiveId(id))
    } else {
      // 同步渲染：整棵树必须在这一次事件里渲完，期间谁也别想插队
      flushSync(() => setActiveId(id))
    }
    setBusy((b) => ({ ...b, render: b.render + (performance.now() - t0) }))
  }, [cfg.useConcurrent, metrics])

  /** 压力测试：连点 12 次，每次间隔 260ms */
  const stress = useCallback(() => {
    let i = 0
    const id = setInterval(() => {
      pick(`n${(i * 7) % nodeCount}`)
      if (++i >= 12) clearInterval(id)
    }, 260)
  }, [pick, nodeCount])

  const c = metrics.state
  const clicks = c.clicks
  const sorted = [...clicks].sort((a, b) => a - b)
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0)
  const wall = metrics.wall
  const busyTotal = c.busyMs

  return (
    <div className="lab">
      {/* ---------- 控制台 ---------- */}
      <aside className="panel">
        <h1>页签切换性能实验台</h1>
        <p className="muted small">
          把 Trace-20261014T220042 里的链路压成一台可开关的机器。默认参数就是日志里的取值，
          逐个关掉开关，就能看出每一段各占多少。
        </p>

        <fieldset>
          <legend>负载</legend>
          <label>知识节点数 <b>{nodeCount}</b>
            <input type="range" min="20" max="600" step="20" value={nodeCount}
              onChange={(e) => setNodeCount(Number(e.target.value))} />
          </label>
          <label>每节点正文 <b>{cfg.docKb} KB</b>
            <input type="range" min="0" max="16" step="1" value={cfg.docKb}
              onChange={(e) => set({ docKb: Number(e.target.value) })} />
          </label>
          <label>时间切片 <b>{cfg.sliceMs} ms</b>
            <input type="range" min="1" max="20" step="1" value={cfg.sliceMs}
              onChange={(e) => set({ sliceMs: Number(e.target.value) })} />
          </label>
          <label>落盘防抖 <b>{cfg.debounceMs} ms</b>
            <input type="range" min="0" max="2000" step="40" value={cfg.debounceMs}
              onChange={(e) => set({ debounceMs: Number(e.target.value) })} />
          </label>
        </fieldset>

        <fieldset>
          <legend>六个机制（逐个关掉看差别）</legend>
          {[
            ['useConcurrent', '并发渲染（关 = 同步渲染）'],
            ['useCanvas', '侧栏 canvas 律动（rAF）'],
            ['useSave', '320ms 防抖落盘（同步序列化）'],
            ['useBeat', '1 秒心跳（强制布局读 + 同步渲染）'],
            ['useTrail', '面包屑 scrollWidth 读'],
            ['useTabs', '页签栏 scrollWidth 读'],
          ].map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={cfg[k]} onChange={(e) => set({ [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>动作</legend>
          <button onClick={() => pick(`n${Math.floor(Math.random() * nodeCount)}`)}>切换一次页签</button>
          <button onClick={stress}>连续切换 12 次</button>
          <button className="ghost" onClick={metrics.reset}>清空指标</button>
        </fieldset>
      </aside>

      {/* ---------- 被测的工作区 ---------- */}
      <main className="work">
        <div className="topbar">
          <span className="bullseye">◎</span>
          <span className="goal">当前目标 · 性能实验</span>
          <Trail activeId={activeId} enabled={cfg.useTrail} />
          <span ref={beatProbe} className="beat" title="心跳探针（getBoundingClientRect）">
            {beatInfo ? `心跳 ${beatInfo.ms.toFixed(1)}ms` : '心跳 —'}
          </span>
        </div>

        <div className="split">
          <div className="sidebar">
            <div className="sidebarhead">学习目标 · {store.nodes.length} 个节点</div>
            <SidebarTree store={store} activeId={activeId} onPick={pick} trail={cfg.useTrail} />
            <CanvasWave enabled={cfg.useCanvas} fps={cfg.animFps} every={cfg.animEvery} />
          </div>

          <div className="docpane">
            <TabBar tabs={tabs} activeId={activeId} onPick={pick} readScrollWidth={cfg.useTabs} />
            <DocBody node={activeNode} big={big} />
          </div>

          <AgentPanel messages={messages} />
        </div>
      </main>

      {/* ---------- 指标 ---------- */}
      <aside className="metrics">
        <h2>指标</h2>
        <div className="kv"><span>点击 → 首帧</span>
          <b>{clicks.length ? `${pct(50).toFixed(1)} / ${pct(95).toFixed(1)} / ${Math.max(...clicks).toFixed(1)} ms` : '—'}</b>
          <em className="muted">p50 / p95 / max（{clicks.length} 次）</em>
        </div>
        <div className="kv"><span>长任务 &gt;50ms</span>
          <b>{c.longTasks.length} 次</b>
          <em className="muted">
            {c.longTasks.length
              ? `最长 ${Math.max(...c.longTasks).toFixed(0)}ms · 合计 ${c.longTasks.reduce((a, b) => a + b, 0).toFixed(0)}ms`
              : '一次都没有'}
          </em>
        </div>
        <div className="kv"><span>主线程占用</span>
          <b>{(busyTotal / 1000).toFixed(2)} s</b>
          <em className="muted">{(100 * busyTotal / wall).toFixed(1)}%（我们自己在六段里累计的同步耗时 ÷ 墙钟）</em>
        </div>
        <div className="kv"><span>最近一次落盘</span>
          <b>{saveInfo ? `${saveInfo.ms.toFixed(1)} ms` : '—'}</b>
          <em className="muted">
            {saveInfo ? `${saveInfo.files} 个文件 · 写 ${saveInfo.writes} · 删 ${saveInfo.removes} · 搬 ${saveInfo.moves}` : '还没触发'}
          </em>
        </div>

        <h3>六段各自累计（ms）</h3>
        <table>
          <tbody>
            <tr><td>渲染提交</td><td>{busy.render.toFixed(0)}</td></tr>
            <tr><td>落盘序列化</td><td>{(c.busyMs - busy.render - busy.beat).toFixed(0)}</td></tr>
            <tr><td>心跳</td><td>{busy.beat.toFixed(0)}</td></tr>
          </tbody>
        </table>
        <p className="muted small">
          提示：把六个开关全关掉，得到的是这台机器的「地板」；再逐个打开，
          差值就是那一段的真实代价。日志里 205 次 Commit / 5.15s ≈ 40fps 的常驻帧管线，
          对应的是「侧栏 canvas 律动」这一个开关。
        </p>
      </aside>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
