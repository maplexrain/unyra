/**
 * 「按住说话」的会话：从按下快捷键到文字落进输入框的全过程。
 *
 * 为什么是「重跑一遍」而不是真正的流式：whisper 不是流式模型，它一次吃一段音频
 * 吐一段文字（上限 30 秒）。所谓实时转写，实际是**一边录一边把已经录到的重跑一遍**。
 * 全量重跑在长句子里会越来越慢，所以这里按**块**来：
 *
 *   [已定稿][当前块] ← 每次都只重跑「当前块」，块长到 22 秒就定稿并开下一块；
 *   界面上显示的是「已定稿 + 当前块」拼起来的全文。
 *
 * 这样每一趟要解的音频都不超过 22 秒，按住说一两分钟也不会越拖越卡。
 * 代价是块边界上偶尔会切在词中间（whisper 看不到块之前的那点上下文），
 * 讲课时这点瑕疵可以接受——真要精确，松手之后那一趟会把最后一块补齐。
 *
 * 文字怎么落进输入框：输入框是受控组件（React state 说了算），直接改 value 没用，
 * 要用原生 setter 改 value 再派发一个 input 事件，React 才会当成用户输入收下。
 * 插入区间在按下那一刻就冻结（before / after），之后每次重写都是「before + 全文 + after」，
 * 所以光标停在哪就往哪写，而且不会把用户原有的文字吃掉。
 */

import { t } from '../../i18n'
import { acquireEngine, releaseEngine } from './engine'
import { voiceGpu } from './settings'
import { readModelBytes, modelStatus } from './model'
import { SAMPLE_RATE, startMic, type MicSession } from './mic'

/*
 * 三个时间常数，照着实测的引擎速度定（2026-02，本机实测数字见 voice/whisper/README.md）：
 *
 *   解 1 秒音频 17.1s ｜ 3 秒 16.8s ｜ 6 秒 16.9s ｜ 11 秒 17.3s
 *
 * 看清楚这张表就明白该怎么设计了：**耗时几乎与音频长短无关**——whisper 每次都把输入
 * 补齐到 30 秒过一遍编码器，那一趟就是十几秒，跟你说了几句没关系。
 *（原先按「耗时 ∝ 长度」的猜测把块定在 6 秒，那是错的：短块只会让「每 17 秒出一小截」，
 *  白白多切了几刀。）
 *
 * 所以策略是：**一趟能多解就多解**。未定稿的那一段一直攒着，上一趟回来才发下一趟，
 * 攒到 COMMIT_SECONDS 才定稿切开——一趟 17 秒的成本是固定的，那就让它覆盖尽量多的语音。
 * 用户看到的效果：松手后十几秒出全文；一直按着的话，每 17 秒左右刷新一次、每次都是「到现在为止」
 * 的全文。这就是这台机器上单线程 WASM 能给的实时性，别的写法只会更差。
 */
/**
 * 未定稿的音频攒够这么多秒才跑一趟（第一趟也一样）。
 *
 * 为什么不是「一有两秒就开跑」：一趟的成本是固定的十几秒（见表），短促的一句
 * 「帮我查一下这个」根本不该在说话中间就白跑一趟——那一趟的结果还会在松手时被丢掉，
 * 而松手后真正要跑的那一趟还得排在它后面，用户就要多等一个十几秒。
 * 攒到 8 秒：短句（≤8 秒）只会在松手后跑**唯一的一趟**，长句则每 8 秒滚一次全文。
 */
const PASS_EVERY_MAX = 8
/** 还没测过速度时的间隔（保守：先按 2 秒走，量到了再自适应） */
const PASS_EVERY_DEFAULT = 2
/** 当前块最短多少才值得跑一趟：太短的音频 whisper 只会给幻觉 */
const MIN_PASS_SECONDS = 0.8
/** 当前块长到这个长度就定稿，开下一块（whisper 自己最多吃 30 秒） */
const COMMIT_SECONDS = 15

/**
 * 这台机器上 WebGPU 到底行不行：null = 还没试过。
 * 一次运行里只试一次——试失败的那次要几十毫秒到几秒，没必要每次说话都重试。
 */
let gpuWorks: boolean | null = null

/** 上一趟转写花了多久（毫秒）。下一趟的间隔按它自适应 */
let lastPassMs = 0

/**
 * 下一趟该等多少新音频。
 *
 * 这是 GPU 加速带来的直接好处：同一份代码在 GPU 上解一趟只要零点几秒（实测 0.4~1.3 s），
 * 那就可以每 1 秒滚一次——用户边说边看到字；在 CPU 上解一趟要十几秒，
 * 间隔就该拉大到 8 秒，别把时间浪费在「刚说完两个字就开跑」上。
 * 用上一趟的实测耗时来定，比写死一个数更经得起换机器。
 */
function passEvery(): number {
  if (lastPassMs <= 0) return PASS_EVERY_DEFAULT
  return Math.min(PASS_EVERY_MAX, Math.max(1, lastPassMs / 1000))
}

/** 上次用的是哪个后端（设置面板上显示，出问题时一眼能看出跑在哪儿） */
export function voiceBackend(): 'gpu' | 'cpu' | null {
  return gpuWorks === null ? null : gpuWorks ? 'gpu' : 'cpu'
}

/**
 * 把模型交给引擎：先试 WebGPU，起不来再退回 CPU。
 *
 * 为什么值得这么绕：实测同一台机器上 base 模型解 3 秒音频，CPU 16.4 s、GPU 1.3 s——
 * 差一个数量级，「实时转写」能不能成立全看这一下。而 WebGPU 的可用性取决于显卡与驱动，
 * 所以不能默认它一定有：试一次，不行就换 CPU，并且这次运行里记住结论。
 * 模型字节用「现取」的回调而不是值：GPU 那次失败时字节已经转移进那个 worker 了，
 * 换 CPU 要重新读一份（57 MB，几十毫秒）。
 */
async function loadEngine(getBytes: () => Promise<Uint8Array>, token: number): Promise<void> {
  if (voiceGpu() && gpuWorks !== false) {
    try {
      const bytes = await getBytes()
      if (token !== tokenSeq) return
      const t0 = Date.now()
      await acquireEngine().load(bytes, { gpu: true })
      gpuWorks = true
      console.info('[voice] 引擎就绪：WebGPU（' + (Date.now() - t0) + ' ms）')
      return
    } catch (err) {
      gpuWorks = false
      console.warn('[voice] WebGPU 起不来，改用 CPU：', err)
      // 那个 worker 可能已经半死（wasm 初始化到一半炸的），换一个干净的再来
      releaseEngine()
    }
  }
  const bytes = await getBytes()
  if (token !== tokenSeq) return
  const t0 = Date.now()
  await acquireEngine().load(bytes, { gpu: false })
  console.info('[voice] 引擎就绪：CPU（' + (Date.now() - t0) + ' ms）')
}

export type VoicePhase = 'idle' | 'preparing' | 'listening' | 'error'

export interface VoiceAnchor {
  left: number
  top: number
  width: number
  height: number
}

export interface VoiceState {
  phase: VoicePhase
  /** 给用户看的一句话（准备中 / 出错的原因） */
  message: string
  /** 已经识别到的全文 */
  text: string
  /** 录了多久（秒） */
  seconds: number
  /** 电平 0..1 */
  level: number
  /** 已经收到多少采样（一直是 0 就说明话筒没给东西，见 tick 里的看门狗） */
  samples: number
  /** 话筒是谁（界面上显示，出问题时给人看） */
  device: string
  /** 有一趟转写正在跑（界面据此显示「识别中」：字还没出来不代表没在干活） */
  busy: boolean
  /** 目标输入框的位置（HUD 贴着它显示）；没有目标时为 null */
  anchor: VoiceAnchor | null
}

const IDLE: VoiceState = {
  phase: 'idle',
  message: '',
  text: '',
  seconds: 0,
  level: 0,
  samples: 0,
  device: '',
  busy: false,
  anchor: null,
}

let state: VoiceState = IDLE
const listeners = new Set<() => void>()

function emit(next: Partial<VoiceState>): void {
  state = { ...state, ...next }
  for (const cb of [...listeners]) cb()
}

export function voiceState(): VoiceState {
  return state
}

export function subscribeVoice(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function isVoiceActive(): boolean {
  return state.phase === 'preparing' || state.phase === 'listening'
}

/* ---------- 目标输入框 ---------- */

type Editable = HTMLInputElement | HTMLTextAreaElement

/** 现在光标在哪个能打字的框里；不在就返回 null（那时候不该开始录音） */
export function editableTarget(): Editable | null {
  const el = document.activeElement as HTMLElement | null
  if (!el) return null
  if (el instanceof HTMLInputElement) {
    const no = ['button', 'checkbox', 'radio', 'file', 'range', 'color', 'submit', 'reset', 'image', 'hidden']
    return no.includes(el.type) || el.readOnly || el.disabled ? null : el
  }
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el
  return null
}

/**
 * 往受控输入框里写值并让 React 认账。
 * 关键是拿原型上的原生 setter：直接 `el.value = x` 走的是 React 改写过的那一层，
 * 它不会认为值变了，onChange 也不会触发。
 */
function writeValue(el: Editable, value: string, caret: number): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  try {
    el.setSelectionRange(caret, caret)
  } catch {
    // 某些 input 类型不支持选区操作：无所谓，值已经写进去了
  }
}

/* ---------- 会话 ---------- */

interface Session {
  /** 令牌：松开之后旧的那一趟异步流程看到它变了就自己退出 */
  token: number
  el: Editable
  before: string
  after: string
  mic: MicSession | null
  committed: string
  /** 已定稿覆盖到第几个采样 */
  committedAt: number
  /** 上一次跑重写时的「未定稿音频」长度（采样数） */
  lastPassedAt: number
  /** 当前块的最新文本 */
  tailText: string
  busy: boolean
  timer: number | null
  /** 失败/结束时的收尾定时器：错误提示显示一会儿再消失 */
  resetTimer: number | null
  /** 这一趟是什么时候开始的：看门狗按它算「已经等了多久」 */
  startedAt: number
  /** 连着几趟回来是空的（有声音但认不出字，界面上要给人一句提示） */
  emptyPasses: number
}

let session: Session | null = null
let tokenSeq = 0

function currentText(s: Session): string {
  if (s.committed && s.tailText) return s.committed + ' ' + s.tailText
  return s.committed || s.tailText
}

/** 把当前全文写进输入框（每一次重跑之后都要调） */
function flushText(s: Session): void {
  if (!s.el.isConnected) return
  const text = currentText(s)
  writeValue(s.el, s.before + text + s.after, s.before.length + text.length)
  emit({ text })
}

function anchorOf(el: Editable | null): VoiceAnchor | null {
  if (!el || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function clearTimers(s: Session): void {
  if (s.timer !== null) window.clearTimeout(s.timer)
  if (s.resetTimer !== null) window.clearTimeout(s.resetTimer)
  s.timer = null
  s.resetTimer = null
}

function finish(message: string, phase: VoicePhase): void {
  emit({ phase, message, level: 0, seconds: 0 })
  if (phase === 'error') {
    console.warn('[voice] ' + message)
    // 错误提示留 8 秒：这类提示多半要人去改系统设置（麦克风权限、输入设备），
    // 四秒太短——一闪而过的话用户只知道「它没反应」，不知道该去哪儿改
    const timer = window.setTimeout(() => {
      if (state.phase === 'error') emit({ ...IDLE })
    }, 8000)
    if (session) session.resetTimer = timer
  }
}

/**
 * 跑一趟转写：只解「还没定稿的那一段」。
 * busy 挡住重入——上一趟还没回来时再来一趟只会排更长的队。
 */
async function pass(s: Session): Promise<void> {
  if (s.busy || !s.mic || s.token !== tokenSeq) return
  const pcm = s.mic.read()
  const tail = pcm.subarray(s.committedAt)
  if (tail.length / SAMPLE_RATE < MIN_PASS_SECONDS) return
  s.busy = true
  emit({ busy: true })
  const began = Date.now()
  try {
    const engine = acquireEngine()
    // 不带 language：引擎缺省按 auto 走（让它自己判中英）——见 whisper/engine.ts 的说明。
    // 这里曾经留空，而 whisper.cpp 的默认语言是 en，于是说中文出来的是英文音译
    const text = await engine.transcribe(tail)
    /*
     * 松手不算「作废」——只有又开了一段新的才算（见 superseded）。
     * 这里原先比的是 tokenSeq，于是「按住说话、说完松手」这个最常见的动作会把
     * 正在进行的那一趟结果直接扔掉，而松手后的补跑还得排在它后面：
     * 用户看到的是「松手后要等两个十几秒才有字」，甚至以为它坏了。
     */
    if (superseded(s.token)) return
    /*
     * 这几行日志是排障用的：出问题时让用户把控制台里 [voice] 开头的行贴过来，
     * 「收到多少音频 / 认出几个字 / 每趟多久」一目了然。
     */
    console.info(
      '[voice] 转写：音频 ' +
        (tail.length / SAMPLE_RATE).toFixed(1) +
        ' 秒，用时 ' +
        Math.round(Date.now() - began) +
        ' ms，得到 ' +
        text.length +
        ' 字',
    )
    s.tailText = text.trim()
    s.lastPassedAt = pcm.length
    s.emptyPasses = s.tailText ? 0 : s.emptyPasses + 1
    // 记下这一趟花了多久：下一趟的间隔按它自适应（见 passEvery）
    lastPassMs = Math.max(1, Date.now() - began)
    // 连着两趟有声音但一个字都没有：多半是设备选错了（比如把「立体声混音」当成了话筒）
    if (s.emptyPasses >= 2 && !s.tailText) {
      emit({ message: t('有声音但没认出字——检查系统默认输入设备，或者靠近一点、说慢一点') })
    }
    flushText(s)
    // 这一块够长了：定稿，下一趟从这儿接着开新块
    if (tail.length / SAMPLE_RATE >= COMMIT_SECONDS) {
      s.committed = currentText(s)
      s.committedAt = pcm.length
      s.tailText = ''
    }
  } catch (err) {
    if (!superseded(s.token)) finish(err instanceof Error ? err.message : t('转写失败'), 'error')
  } finally {
    s.busy = false
    if (!superseded(s.token)) emit({ busy: false })
  }
}

/** 定时器：每 300ms 看一眼「攒够一趟的量没有」，够了就跑 */
function tick(s: Session): void {
  if (s.token !== tokenSeq) return
  if (s.mic) {
    const samples = s.mic.samples()
    emit({
      seconds: s.mic.seconds(),
      level: s.mic.level(),
      samples,
      device: s.mic.device(),
      anchor: anchorOf(s.el),
    })
    /*
     * 看门狗：三秒半还一段采样都没收到，就不是「 whisper 慢」而是「声音根本没进来」。
     * 这一条是踩出来的——用户那边的现象是「组件在转、一个字都没有」，而界面上一片安静，
     * 谁也说不清是话筒、权限还是引擎。现在当场说清楚，并把话筒名字带上。
     */
    if (samples === 0 && Date.now() - s.startedAt > 3500) {
      finish(
        t(
          '话筒一点声音都没进来（设备：{0}）。检查系统默认输入设备、麦克风静音键，以及系统是否允许本应用使用麦克风',
          s.mic.device() || t('未知'),
        ),
        'error',
      )
      s.mic.stop()
      s.mic = null
      session = null
      return
    }
    if ((samples - s.lastPassedAt) / SAMPLE_RATE >= passEvery()) void pass(s)
  }
  s.timer = window.setTimeout(() => tick(s), 300)
}

/**
 * 开始听（按住快捷键时调）。
 * 目标不在输入框里、或者模型还没准备好，都在这里当场给一句人话，不静默失败。
 */
export async function startVoice(): Promise<void> {
  if (isVoiceActive()) return
  const el = editableTarget()
  if (!el) {
    finish(t('把光标放进输入框里再用语音输入'), 'error')
    return
  }
  const token = ++tokenSeq
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  // 先建成局部常量再落进模块变量：模块级的 let 会被别处的函数调用「洗掉」类型收窄，
  // 直接 const s = session 在下面几处会变成 Session | null
  const created: Session = {
    token,
    el,
    before: el.value.slice(0, start),
    after: el.value.slice(end),
    mic: null,
    committed: '',
    committedAt: 0,
    lastPassedAt: 0,
    tailText: '',
    busy: false,
    timer: null,
    resetTimer: null,
    startedAt: Date.now(),
    emptyPasses: 0,
  }
  session = created
  const s = created
  console.info('[voice] 开始语音输入：目标输入框', el.tagName, '，准备模型与话筒')
  emit({ phase: 'preparing', message: t('正在准备语音模型…'), text: '', seconds: 0, busy: false, anchor: anchorOf(el) })

  try {
    const engine = acquireEngine()
    if (!engine.ready()) {
      const info = await modelStatus()
      if (token !== tokenSeq) return
      if (!info.exists) {
        finish(t('还没下载语音模型：设置 → 输入 → 语音转文字，下一份（约 57 MB）'), 'error')
        return
      }
      await loadEngine(readModelBytes, token)
      if (token !== tokenSeq) return
    }
    const mic = await startMic()
    if (token !== tokenSeq) {
      mic.stop()
      return
    }
    s.mic = mic
    console.info('[voice] 话筒就绪：', mic.device(), '，采集节点', mic.capture())
    emit({ phase: 'listening', message: '' })
    tick(s)
  } catch (err) {
    if (token === tokenSeq) finish(err instanceof Error ? err.message : t('语音输入启动失败'), 'error')
  }
}

/**
 * 这一趟的活儿还该不该干：松手之后马上又按下去时，前一段的收尾就不该再往输入框里写
 * （它按的是旧快照，写回去会把新说的字冲掉）。
 * 写成函数而不是就地判 session：模块级的 let 在函数体里读到的才是「这一刻」的值。
 */
function superseded(token: number): boolean {
  return session !== null && session.token !== token
}

/**
 * 松开快捷键：立刻收话筒、立刻把界面收回常态，最后那一段留在后台补。
 *
 * 为什么不等最后一段解完再收界面：那一趟要好几秒（单线程 base q5_1 解 6 秒音频要 4 秒左右），
 * 而用户已经松手了——界面上还挂着「正在听」只会让人以为它卡住了，
 * 何况这期间再按一次会被 isVoiceActive() 挡掉，等于快捷键失灵。
 * 所以：话筒当场停（灯灭），界面当场回 idle，后台那一趟解完再把字补上去。
 */
export function stopVoice(): void {
  const s = session
  if (!s || !isVoiceActive()) return
  tokenSeq++
  clearTimers(s)
  const mic = s.mic
  s.mic = null
  session = null
  mic?.stop()
  emit({ ...IDLE })
  // 松手瞬间那一小段还没解过：补一趟再落字，否则最后几个字会丢。
  // mic.read() 在 stop() 之后照样能读——采样早就攒在内存里了
  void (async () => {
    try {
      if (!mic) return
      const pcm = mic.read()
      const tail = pcm.subarray(s.committedAt)
      if (tail.length / SAMPLE_RATE >= 0.5) {
        const engine = acquireEngine()
        const text = await engine.transcribe(tail)
        // 松手之后马上又按下去：这一段就不补了。新的一段已经把当时的文本快照进去了，
        // 这时再按旧快照回写，只会把新说的字冲掉（宁可少最后半句，也不能倒回去）。
        if (superseded(s.token)) return
        s.tailText = text.trim() || s.tailText
      }
      flushText(s)
    } catch {
      // 收尾这一趟失败就不管了：前面的字已经落下去了，没必要再弹一次错
    }
  })()
}

/** 应用退出/换用户前收干净 */
export function abortVoice(): void {
  tokenSeq++
  if (session) {
    clearTimers(session)
    session.mic?.stop()
    session = null
  }
  emit({ ...IDLE })
}