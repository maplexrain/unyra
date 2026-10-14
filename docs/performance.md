# 性能：怎么量、量到了什么

这份文档管两件事：**怎么录一份能用的性能日志并把它读成几个数字**，以及**这个应用
当前已知的常驻性能负担长什么样**。

它回答的是「页签切换为什么慢」这类问题——而这类问题的答案往往不是「切换本身慢」，
是「切换要排队」。

---

## 一、录之前先知道三件事

1. **录制的成本会混进数字里。** DevTools 的 Performance 面板一开始录，V8 就会做两件事：
   把所有已优化代码反优化一遍（`CpuProfiler::StartProfiling`），以及给每个异步任务
   记账（`v8::Debugger::AsyncTaskRun` / `V8Console::runTask` / `createTask`）。
   在 2026-10-14 那份 5.14s 的日志里，这两项合计 **2.6s，占窗口的 50%**。
   分析脚本会把它们单独剔出来，但**读数字时永远先看「净应用开销」那一行**。

2. **CPU 节流会等比放大一切。** 那份日志是 **4× 节流**录的，所以「一次 Commit 2ms」
   换算到不节流大约是 0.5ms。跨日志对比时必须先看节流档位——不同档位的日志不能直接比大小。

3. **要录到你想看的那个动作。** 那份 5.14s 的日志里**只有一次真正的 click，耗时 0.81ms**。
   也就是说它没录到「慢的页签切换」本身，录到的是**点击之前的常驻负担**。
   想量一次切换，就让录制从点下去之前开始，并且把 DevTools 关掉——面板自己也在抢主线程。

---

## 二、把它读成数字

```bash
npm run perf:trace -- "C:/path/Trace-20261014T220042.json.gz"
```

`perf-lab/analyze-trace.mjs` 会把日志过一遍，打印：

| 段落 | 回答什么问题 |
| --- | --- |
| 概况 | 窗口多长、节流几倍、主线程忙多少、**录制开销 vs 净应用开销** |
| 每秒发生多少次 | 哪些事件是「每帧都在跑」的常驻负担 |
| 常驻帧管线 | 有多少帧是**任务里没有 JS** 的纯合成帧（= 背景动画在推帧） |
| React 调度循环 | `performWorkUntilDeadline` 跑了多少次、合计多久、单次多长 |
| 最长的一次同步阻塞 | 哪一次同步计算卡住了主线程，以及它的调用栈 |
| 按函数的 self time | 钱花在哪个函数上 |
| 强制布局读 | 谁在读几何（读到几何 = 把样式与布局就地结算） |
| 输入事件 | 用户到底点了什么、那一下花了多久 |

两个读法上的坑（脚本里已经处理，但自己看日志时会踩）：

- **日志里可能内嵌多个 CPU profile**——渲染进程一个、Electron 主进程一个。
  `ProfileChunk` 必须按 `pid` 过滤，否则两条时间轴会被首尾相接拼成两倍长。
- **Vite dev 模块的行号对不上源码。** 日志里 `storage.ts:330`、`chrome.tsx:803`
  这种位置是 esbuild 转换后的行号（注释被删掉了），跟仓库里的行号差几十到上百行。
  **认函数名和文件名，别认行号。**

---

## 三、2026-10-14 那份日志读出了什么

窗口 5.14s，4× 节流，渲染主线程忙 4105.70ms = **79.9%**。
扣掉录制开销后，**净应用 + 浏览器开销 1508.28ms = 29.3%**。

### 3.1 常驻帧管线：~40fps，一直不停

| 事件 | 次数 | 速率 | self 合计 |
| --- | --- | --- | --- |
| `Commit`（合成帧提交） | 205 | 39.9/s | 414.52ms（平均 2.02ms） |
| `UpdateLayoutTree`（样式重算） | 220 | 42.8/s | 238.04ms（平均 1.08ms） |
| `Layerize` | 205 | 39.9/s | 110.73ms |
| `PrePaint` | 312 | 60.7/s | 80.18ms |
| `Paint` | 147 | 28.6/s | 36.38ms |
| `HitTest` | 113 | 22.0/s | 71.59ms |
| `PageAnimator::serviceScriptedAnimations` | 205 | 39.9/s | 43.17ms |
| `FireAnimationFrame` | 251 | 48.8/s | — |

其中 **205 帧是「任务里没有一行 JS」的纯合成帧**——那就是
`components/learn/SystemAudioWave.tsx` 里那个 rAF 循环：侧栏底部那块 canvas 律动，
静音时每 2 帧画一次（`frames % 2 === 0`），有声时每帧。

它每帧的账是：`Commit` 2.0 + `UpdateLayoutTree` 1.1 + `Layerize` 0.5 + `PrePaint` 0.3
+ `Paint` 0.3 ≈ **4.2ms 浏览器侧**，再加画布那段 JS ≈ **5ms/帧 → 约 200ms/秒 = 主线程的 20%**。
60Hz 的预算是 16.7ms/帧，它一个人吃掉三分之一；再叠加 React 那一摊，就没有余量给交互了。

### 3.2 React 调度循环：一直排不完的更新队列

`performWorkUntilDeadline`（React 调度器的 MessageChannel 回调）在 5.14s 里跑了
**123 次，合计 917.16ms = 窗口的 17.8%**；单次中位数 5.47ms——正好是 React 的时间片
（5ms）——说明**每次都跑到时间片用尽才让出，然后马上又被叫回来**。

CPU profile 侧的印证（按出现在采样栈里的时间算，彼此有重叠）：

| 标记 | 时间 | 占比 |
| --- | --- | --- |
| `performWorkUntilDeadline` | 896.6ms | 17.4% |
| `workLoopConcurrentByScheduler` | 671.6ms | 13.1% |
| `renderWithHooks` | 675.7ms | 13.1% |
| `workLoopSync`（**同步**渲染） | 199.8ms | 3.9% |
| `commitPassiveMountOnFiber`（useEffect 冲刷） | 134.0ms | 2.6% |

被反复重渲的是**整棵工作区树**：侧栏每个节点（`NodeRow`）、页签栏（`TabBar`）、
正文、对话栏（`MessageBubble` 那一列）、四组 dock（番茄钟 / 阅读 / 打卡 / 复习）。
按渲染次数排前几的是 `NodeRowComponent`、`TabBar`、`LearnWorkspace`、
`ProcessGroup`、`StatusBranch`、`ExplorerSidebarComponent`、`RollingDigits`、`Composer`。

**同步渲染占了不小一块**（`workLoopSync` 199.8ms）。它来自 `useSyncExternalStore`：
React 对「外部存储变了」这件事是按同步优先级冲刷的（避免撕裂），所以
`lib/clock` 的时钟、`lib/readingPulse` 的脉搏、learn store 的任何一次通知，
都会变成一次**不可切片、必须跑完**的渲染。心跳每秒一次，就每秒来一次。

### 3.3 一次性阻塞：落盘 99ms

窗口里最长的一次同步阻塞：

```
 98.77ms  (anon)  @storage.ts（lib/storage.ts 的 scheduleCommit 里那个 setTimeout 回调）
           ↳ 72.80ms  buildDocs   @learn/files/build.ts
           ↳ 16.77ms  diffDocs    @learn/files/diff.ts
           ↳  6.04ms  parseJson   @learn/files/meta.ts（被 assetMoves 逐份 meta 调用）
           ↳  1.09ms  assetMoves  @learn/files/diff.ts
```

调用链是 `scheduleCommit` 的 320ms 防抖定时器 → `Commit.run()` →
`planOf()` → `buildDocs` + `buildState` + `assetMoves`，然后 `diffDocs`。

**这里有个容易看错的地方**：`persist.ts` 的注释说「挪进已经防抖的回调之后，这笔账只在
真要写盘的那一次付」——这是对的，但**防抖只是把成本推到 320ms 之后，并没有把它挪出主线程**。
回调里全是同步代码（`planOf()` 在任何 `await` 之前），所以每存一次就阻塞一次主线程。
日志里就是一次 ~99ms 的硬卡，紧接着还有两次 42ms 级别的 `UpdateLayoutTree` 爆发
（31.68ms / 42.35ms / 41.86ms）。

### 3.4 强制布局读

CPU profile 里 `get scrollWidth` 一个人占了 **49.9ms**（92 个采样，每次约 0.54ms——
一次完整的布局结算）。调用点是 `components/learn/workspace/chrome.tsx` 里
`NodeTrail` 那个 effect：

```ts
useEffect(() => {
  const el = scrollRef.current
  if (!el) return
  el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })   // ← 读到几何
}, [node?.id])
```

读 `scrollWidth` 会把待处理的样式与布局**就地结算掉**；`TabBar` 里
（`readScrollWidth` 那条路）也是同一套写法。这些点在渲染提交之后跑，所以每次
节点/页签切换都会额外付一次全量布局。

另外 `learn/tracker` 的每秒心跳也会量一次几何（`ReadingTracker.attribute` →
`sections.ts` 的 `measureSections`，里面 4 次 `getBoundingClientRect`）。这一份在日志里
只有 0.1ms，量级很小，但它是「每秒一次强制布局读」这个形状。

### 3.5 为什么 profile 里 React 看着那么贵

`runWithFiberInDEV` 出现在 **20558 / 44228 = 46%** 的采样里，`logComponentRender`
（React DevTools 的逐组件渲染日志）65.4ms。这两个都是 **DEV 构建独有**的——
日志里 `react-dom_client.js?v=…`、`react_jsx-dev-runtime.js` 说明跑的是
`vite dev`（开发构建）。生产构建没有这些包装。

同时，profile 里两个没有 url 的原生帧 `createTask`（541.0ms）和 `run`（1133.8ms）
**是被 V8 调试器的异步任务记账记在了「当时正在跑的 JS 函数」头上的**——
它们的直接调用者是 `React.createElement`、`jsxDEV`、`runWithFiberInDEV`。
所以 **profile 里 React 那些函数看着贵，有相当一部分不是 React 自己花的**。
这也解释了为什么「录制开销」要从 trace 事件树里单独剔，而不能只信 profile。

---

## 四、这是新问题吗

不是新出现的形状。同样用 `npm run perf:trace` 读另外四份日志：

| 日志 | 窗口 | Commit 速率 | 常驻纯合成帧 | React 调度循环 |
| --- | --- | --- | --- | --- |
| 2026-10-11 21:34 | 4.19s | 48.0/s | 48.0/s | — |
| 2026-10-11 21:44 | 2.65s | 46.8/s | 46.8/s | — |
| 2026-10-11 21:56 | 1.80s | 37.7/s | 37.7/s | — |
| 2026-10-14 20:42 | 1.39s | 37.4/s | 37.4/s | 17.3% |
| 2026-10-14 22:00 | 5.14s | 39.9/s | 39.9/s | 17.8% |

**「~40-48fps 的常驻帧管线」和「~17% 的 React 调度循环」是长期基线**，10 月 11 日就有。
10 月 14 日那份多出来的东西是那次 **99ms 的同步落盘阻塞**（前四份里都没有
`buildDocs` / `diffDocs` 出现在采样栈里）。

所以「页签切换异常慢」的机制是：

> 主线程已经被常驻帧管线 + React 调度循环占掉 ~30%（4× 节流下接近 80%），
> 交互点下去之后，它的渲染要排在**当前这一帧的合成**、**当前这一片的 React 更新**
> 和**随时可能落下来的 99ms 同步落盘**后面。切换本身不慢，等待慢。

---

## 五、按性价比排序的改动方向

1. **把落盘的同步部分挪出主线程（收益最大、最确定）。**
   `planOf()` 里的 `buildDocs` / `assetMoves` / `diffDocs` 全是纯函数，输入是 store——
   放到 Web Worker 里算，主线程只负责收「要写哪些文件」的清单再发 IPC。
   或者退一步：把摊平拆到多帧里（每个节点一段，用 `scheduler` 的 `yield`），
   至少让 99ms 不再是一整块。**再退一步**：`scheduleCommit` 的防抖改成
   「空闲时再存」（`requestIdleCallback` / 切页签后 1s），避开交互窗口。

2. **让常驻帧管线在不需要时真的停下来。**
   侧栏收起、窗口失焦、`prefers-reduced-motion`、页面不可见（`visibilitychange`）时
   应该 `cancelAnimationFrame`。现在是「挂载了就永远跑」。省下来的是
   ~20% 的主线程和 40 次/秒的合成帧。

3. **`scrollWidth` 那两处别再读。**
   `NodeTrail` 的「滚到最右端」可以直接用 `el.scrollLeft = el.scrollWidth` 之外的办法
   （`scrollIntoView({ block:'nearest', inline:'end' })`，或者记 `scrollLeft = 1e9`），
   `TabBar` 判断要不要省略号可以交给 CSS（`overflow:hidden; text-overflow:ellipsis`）
   或 `IntersectionObserver`，而不是每次提交都读一次几何。

4. **收窄重渲的范围。**
   整棵树跟着每次 store 通知重渲，是 React 调度循环排不完的直接原因。
   `NodeRow`、`TabBar` 的每一枚页签、`MessageBubble` 的每一条消息都值得
   `React.memo` + 稳定的 props；四组 dock 与顶栏那一簇应该各自订阅自己需要的那一小片
   （`lib/clock` 与 `lib/readingPulse` 已经是这个路子，把它们推广开）。

5. **量的时候用生产构建。** 开发构建里 `runWithFiberInDEV` 覆盖了 46% 的采样，
   所有结论的绝对数值都被它放大了。打包后的应用才是用户手上的那个东西。

---

## 六、这一轮改了什么

按上面量到的数字挑了四处动手，每处都带回归测试。

| # | 改的地方 | 原状（日志里的数） | 改法 |
| --- | --- | --- | --- |
| 1 | `components/learn/SystemAudioWave.tsx` | 205 帧纯合成帧 / 5.14s（≈40fps），主线程 20% | canvas **滚出视口**（`IntersectionObserver`）、**页面切到后台**（`visibilitychange`）时 `cancelAnimationFrame`，回来自动续上；主题色改由 `MutationObserver` 盯着 `data-theme`/`style`，不再每 90 帧轮询一次 `getComputedStyle`（那是一次强制样式结算） |
| 2 | `components/learn/workspace/chrome.tsx` 的 `NodeTrail` | `get scrollWidth` 49.9ms | 「滚到最右端」改成给 `scrollTo` 一个远超任何面包屑宽度的值，浏览器自己会夹到最大滚动位置——同样滚到最右端，但不读几何 |
| 3 | `learn/files/diff.ts` 的 `assetMoves` | `parseJson` 6.04ms | 「节点 id → 它所在的目录」这份索引按文件表缓存（`WeakMap`）：`prev` 就是上一次保存写出去的快照，同一个对象会被反复传进来 |
| 4 | `learn/files/build.ts` + `learn/store/persist.ts` | 一次 **98.77ms** 的同步阻塞 | `buildDocs` 改成**生成器**（同步版与分片版共用同一段逻辑，不会漂）；新增 `buildDocsChunked`：每片最多连跑 6ms，片间 `yieldToMain()`。异步落盘走分片版，关窗前的同步版保持一次算完 |

**第 4 条的取舍值得单独说**：防抖（320ms）**只是把成本推后，没有把它挪出主线程**——
回调里全是同步代码。切成 6ms 一片之后总时长不变，但主线程在片与片之间能处理输入、能画一帧。
「点下去有没有反应」取决于**最长的那一段**，不取决于总长。

新增：

- `src/lib/yieldToMain.ts` —— 让出主线程的三种实现，按代价从低到高挑：
  `scheduler.yield()`（Chromium 129+，不排到定时器队尾）→ `MessageChannel`（绕开
  `setTimeout` 的最小延迟）→ `setTimeout(0)`。
- `tests/buildDocsChunked.test.ts` —— 分片版与同步版**逐字节一致**、小 store 一片跑完
  不让出、大 store 确实分片。

**还没做的**：第 4 条改动只削掉了「最长的一段」，没有减少总工作量。而「整棵工作区树跟着
每次 store 通知重渲」（React 调度循环 17.8%）这条**没动**——查下来 `NodeRow` 早已 `memo`
（还带自定义比较器），`resident` / `readingPulse` / `clock` 也都在值没变时不通知，
所以「谁在 24 次/秒地推更新」还没定位到。那需要在 `scheduleUpdateOnFiber` 的各条入口
打上 User Timing 再录一次日志——靠猜改不动它。

---

## 七、实验台：把这条链路压成一台可开关的机器

```bash
npm run perf:lab        # 生成 perf-lab/tab-switch-lab.html（单文件，双击就能用）
npm run perf:lab:prod   # 同上，但用生产版 React——对比 DEV 构建本身有多贵
npm run perf:lab:check  # 构建 + 在 happy-dom 里自检（点页签能不能切、指标会不会动）
```

`perf-lab/tab-switch-lab.src.jsx` 把这条链路复刻成六个可开关的机制，
默认参数就是上面那份日志的取值（节点 120、每节点正文 2KB、防抖 320ms、心跳 1000ms、
每 2 帧画一次、时间切片 5ms）：

| 开关 | 复刻的东西 |
| --- | --- |
| 并发渲染 | 关掉 = `flushSync` 同步渲染（等价 `performSyncWorkOnRoot`） |
| 侧栏 canvas 律动 | `SystemAudioWave` 的 rAF 循环 |
| 320ms 防抖落盘 | `scheduleCommit` → `buildDocs` + `diffDocs` + `assetMoves` |
| 1 秒心跳 | `heartbeat.ts` 的 `beat()` + 一次强制布局读 + 一次同步渲染 |
| 面包屑 scrollWidth 读 | `NodeTrail` 的 effect |
| 页签栏 scrollWidth 读 | `TabBar` 的 `readScrollWidth` |

指标只看三个用户能感觉到的东西：**点击 → 首帧**（p50 / p95 / max）、
**长任务（>50ms）次数与总时长**、**主线程占用**。

用法：先把六个开关全关，得到这台机器的「地板」；再逐个打开，差值就是那一段的真实代价。
