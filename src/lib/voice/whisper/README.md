# 语音引擎（whisper.cpp + WASM）

这一层只干一件事：把 16 kHz 单声道 Float32 的音频变成文字。
模型下载、麦克风、写回输入框都在外面（`lib/voice/` 的其余文件），这里**没有**任何下载逻辑。

```ts
import { createWhisperEngine } from './engine'

const engine = createWhisperEngine()
await engine.init(undefined, { gpu: true })   // 起 wasm 运行时；gpu 走 WebGPU 后端
await engine.loadModel(bytes)                  // Uint8Array：整个 ggml-base-q5_1.bin
const text = await engine.transcribe(pcm)      // Float32Array，16 kHz 单声道
engine.dispose()
```

## 用了什么

| | |
| --- | --- |
| 引擎 | [whisper.cpp](https://github.com/ggml-org/whisper.cpp)（MIT），经 npm 包 [`@fugood/node-whisper-wasm`](https://github.com/mybigday/whisper.node) 1.1.3（**MIT**）的 WASM 构建 |
| 模型 | `ggml-base-q5_1.bin`（base 多语言、q5_1 量化，59,707,625 字节 ≈ 57 MB），来自 [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) |
| 后端 | **WebGPU（默认）**，起不来时自动退回 CPU。包里的 wasm 两个后端都编进去了：`__wasm_init_whisper(path, useGpu, useFlashAttn)` 的第二个参数就是那个开关 |
| 构建 | 单线程 CPU 版（`wasm/whisper-node.wasm`，4.1 MB）。包里还有一份 `threads.wasm`（pthread），本应用**用不了**：它要 `SharedArrayBuffer`，而那要求页面 cross-origin isolated（COOP/COEP），生产页面是 `file://` + 一段 CSP，实测 `crossOriginIsolated === false` |
| 线程模型 | 引擎跑在**单独的 Worker** 里（`lib/voice/engine.worker.ts`） |

## 实测：GPU 比 CPU 快 40 倍（2026-02，本机 i5-11400 + 一张 NVIDIA 显卡，Electron 44 / Chromium 152）

| 模型 | 后端 | 解 3 秒音频 | 解 11 秒音频 | 识别结果（输入是 whisper.cpp 仓库的 `samples/jfk.wav`） |
| --- | --- | --- | --- | --- |
| base q5_1 | CPU（单线程） | 16.4 s | 16.5 s | And so my fellow Americans / …ask what you can do for your country. |
| **base q5_1** | **WebGPU** | **1.3 s** | **0.41 s** | 同上（一字不差） |
| tiny q5_1 | CPU | 7.8 s | 7.7 s | 同上，准确率略低（模型只有 31 MB） |
| tiny q5_1 | WebGPU | 0.37 s | 0.33 s | 同上 |

两条结论：

1. **CPU 那条路，耗时几乎与音频长短无关**——whisper 每次都把输入补齐到 30 秒过一遍编码器，
   那一趟就是十几秒。所以 CPU 上「实时」不成立，只能攒着一起解。
2. **换成 WebGPU 就完全不一样**：不到一秒，且这时长才开始随音频长度变化。
   于是「边说边出字」成立：`session.ts` 按上一趟的实测耗时自适应间隔
   （GPU 上约 1 秒一趟，CPU 上退到 8 秒一趟）。

## WebGPU 怎么开的（以及为什么要有回退）

- 包入口的 `initWhisper({ useGpu })` 会先问 `runtime.__wasm_webgpu_enabled()`，拿不到就悄悄退回 CPU。
  本仓库的 `runtime.ts` 直接调 wasm 导出（`__wasm_init_whisper`），所以那一问由我们自己负责：
  `engine.init(onProgress, { gpu })` → `createContext(runtime, fsPath, useGpu)`。
- **可用性取决于显卡与驱动**：`navigator.gpu` 在、`requestAdapter()` 也给了适配器，才谈得上 GPU。
  所以 `session.ts` 的策略是「先试一次 GPU，抛了就换 CPU 并把结论记住」：
  失败那次的模型字节已经转移进那个 worker 了，换 CPU 时会重新读一份（57 MB，几十毫秒），
  并且把那个可能半死的 worker `terminate()` 掉、换一个干净的。
- 设置 → 输入里有个开关可以强制关掉 GPU（显卡驱动有毛病时用），默认开着。

## wasm 是怎么加载的（两个坑都在这儿）

1. **不让 Emscripten 自己 fetch**。它内部走 `locateFile` + fetch，失败时只丢一句
   "both async and sync fetching of the wasm failed"，看不出是路径错了还是被 CSP 拦了。
   这里用 Vite 的 `?url` 拿到资源地址、自己 `fetch` 成字节，再通过 `instantiateWasm` 塞给 Emscripten，
   报错里因此能带上 URL 与状态码。
2. **Worker 里的地址解析**。`?url` 在打包时按「相对于当前模块」重写：主线程那份是
   `new URL("assets/whisper-node-xxx.wasm", document.baseURI)`，Worker 那份是
   `new URL("whisper-node-xxx.wasm", self.location.href)`——两份都对，前提是**别自己去拼路径**。
   代码里 `typeof document !== "undefined" ? new URL(url, document.baseURI).href : url` 这一句就是为它写的。
3. CSP：`WebAssembly.instantiate` 需要 `script-src` 放行（本应用有 `'unsafe-eval'`，够用）；
   `fetch` 本地 wasm 走 `connect-src 'self'`（生产页面是 `file://`，同源资源实测可 fetch）。
   这两条都写在 `electron/csp.ts` 的注释里，改 CSP 时别把它们去掉。

## 行为约定（调用方按这个写就不会错）

- **串行排队**：同一时刻只跑一次。第二次调用不会打断第一次，它排在队尾**原样执行**——
  所以调用方必须自己限流（`session.ts` 的做法是「上一次没回来就不发新的」）。
- **进度回调只在 `init` 里给**：`loadModel` 没有回调参数，但它会继续用 `init` 传进来的那个回调
  上报 `phase: 'model'` 与 `phase: 'ready'`。
- **`dispose` 之后不可复用**：再调 `init` / `loadModel` / `transcribe` 一律抛错。
- 过短（< 0.1 秒）与纯静音返回空串：whisper 对这类输入会给幻觉文本，这里按「没有内容」处理，
  `[BLANK_AUDIO]` / `[ Silence ]` 这类标记也会被清掉。

## 内存

这一层是整个应用里最占内存的地方：wasm 线性内存 512 MB 起，模型本身在 MEMFS 里再占 57 MB，
GPU 后端还会额外要显存。所以运行时是**整个渲染进程共用一份**（`ensureRuntime` 幂等），
模型换掉时会先把旧上下文放掉再写新的。