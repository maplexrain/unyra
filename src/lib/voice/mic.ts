/**
 * 麦克风采集：把话筒里的声音变成识别引擎要的那一种数据。
 *
 * SenseVoice 只认 **16 kHz 单声道 Float32**（-1..1）。三条路走到这个形状：
 *
 * 1. `new AudioContext({ sampleRate: 16000 })` 让 Chromium 自己重采样——最省事，
 *    实际拿到的可能不是 16000（设备不支持时它会给别的），所以下面还留了一手线性插值；
 * 2. `getUserMedia` 先按「回声消除 + 降噪 + 自动增益」要，**要不到就退回最朴素的约束**。
 *    这一条是踩出来的：某些 Windows / USB / 蓝牙设备在三件套全开时会给出一路**静音**，
 *    而 getUserMedia 本身不报错——用户看到的现象就是「界面在听，一个字都没有」。
 *    这里改成：按最强约束开一次，**1.5 秒内没收到任何采样就换最简约束重开**。
 * 3. 采集节点优先用 **AudioWorklet**（见 pcm-worklet.js），拿不到就退回 ScriptProcessorNode。
 *    worklet 要 `ctx.audioWorklet.addModule(url)`，在 `file://` 页面下不一定成（成了更好，
 *    不成就退回旧的，功能不受影响）。
 *
 * 采集到的数据攒在内存里，由外层 `drain()` **一截一截取走**（见 session.ts）：
 * 取走的那一段立刻从缓存里删掉，于是缓存长度由外层控制（转写按段进行，不会越攒越长）。
 * 这一层另外给几个查问题用的读数（收到了多少、什么设备、什么参数）——出问题时
 * 这几行字比任何猜测都值钱。
 */
import { t } from '../../i18n'

/** 识别引擎要的采样率 */
export const SAMPLE_RATE = 16000

/** 等这么久还没收到任何采样，就换一套约束重开话筒 */
const SILENCE_SWITCH_MS = 1500

export interface MicChunk {
  /** 这一截的采样（16 kHz 单声道） */
  samples: Float32Array
  /**
   * 这一截里最大的 RMS（0..1）。
   * 判断「这一段有没有人声」用它，而不是拿 `level()` 逐帧采样：话筒一块可能是 8ms、
   * 也可能是 256ms，按拍读最后一个值会漏掉大部分声音。
   */
  peak: number
}

export interface MicSession {
  /**
   * 取走「上次取走之后」新到的全部采样（取完即清空）。
   * 分段识别靠它：每次送进模型的音频是完整的一段话，缓存不会越攒越长。
   */
  drain(): MicChunk
  /** 已经录了多久（秒） */
  seconds(): number
  /** 已经收到的采样总数——用来分辨「没声音」与「没在采」 */
  samples(): number
  /** 当前的音量（0..1 的均方根），界面上的电平条用它 */
  level(): number
  /** 话筒的名字与关键参数（界面上显示，出问题时给人看） */
  device(): string
  /** 用的是什么采集节点（worklet / script） */
  capture(): 'worklet' | 'script'
  /** 停止采集并释放设备（话筒指示灯熄灭就靠它） */
  stop(): void
}

/** 线性插值重采样；只有 AudioContext 给不到 16 kHz 时才会走到 */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const length = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(input.length - 1, i0 + 1)
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0)
  }
  return out
}

/**
 * 三套约束，从「最好的一路」退到「最简单的能出声的一路」。
 * 降噪与自动增益对讲课确实有用，不该一上来就放弃，所以先要全的。
 */
const CONSTRAINT_SETS: MediaStreamConstraints[] = [
  {
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  },
  { audio: { channelCount: 1 } },
  { audio: true },
]

/** 话筒的名字与参数，写进日志与界面：出问题时这几行字最有用 */
export function describeTrack(stream: MediaStream): string {
  const track = stream.getAudioTracks()[0]
  if (!track) return t('没有音轨')
  const s = track.getSettings ? track.getSettings() : {}
  const parts = [
    track.label || t('未知设备'),
    s.sampleRate ? s.sampleRate + ' Hz' : '',
    s.channelCount ? t('{0} 声道', s.channelCount) : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

async function openStream(): Promise<MediaStream> {
  let last: unknown = null
  for (const constraints of CONSTRAINT_SETS) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      console.info('[voice] 话筒已打开：', JSON.stringify(constraints.audio), describeTrack(stream))
      return stream
    } catch (err) {
      last = err
    }
  }
  const name = last instanceof Error ? last.name : ''
  if (name === 'NotAllowedError') {
    throw new Error(
      t('麦克风权限被拒绝了：请在系统设置里允许本应用使用麦克风（Windows：设置 → 隐私和安全性 → 麦克风）'),
    )
  }
  if (name === 'NotFoundError') throw new Error(t('没有找到可用的麦克风设备'))
  throw new Error(t('打不开麦克风：{0}', last instanceof Error ? last.message : String(last)))
}

/** 一个采集节点：worklet 或 ScriptProcessor，接口一样（外面不必关心用的是哪个） */
interface Capture {
  kind: 'worklet' | 'script'
  node: AudioNode
  /** 必须接一个到 destination 的节点，否则整条链不会被驱动；用 0 增益免得声音又放出来 */
  sink: AudioNode
  stop(): void
}

async function attach(ctx: AudioContext, push: (pcm: Float32Array) => void): Promise<Capture> {
  const sink = ctx.createGain()
  sink.gain.value = 0
  sink.connect(ctx.destination)

  // 优先 AudioWorklet：没有那条废弃警告，也不占主线程
  if (ctx.audioWorklet) {
    try {
      const url = new URL('./pcm-worklet.js', import.meta.url)
      await ctx.audioWorklet.addModule(url)
      const node = new AudioWorkletNode(ctx, 'moji-pcm-capture')
      node.port.onmessage = (e: MessageEvent<Float32Array>) => push(e.data)
      return { kind: 'worklet', node, sink, stop: () => node.port.close() }
    } catch (err) {
      // file:// 下 addModule 可能被拒；不致命，退回 ScriptProcessor 就行
      console.warn('[voice] AudioWorklet 不可用，退回 ScriptProcessor：', err)
    }
  }

  const node = ctx.createScriptProcessor(4096, 1, 1)
  node.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0))
  return {
    kind: 'script',
    node,
    sink,
    stop: () => {
      node.onaudioprocess = null
    },
  }
}

/**
 * 把「话筒流 → 采集节点 → 静音 sink」这一小张图接起来。
 *
 * 单独抽出来是为了**失败时能把自己接了一半的东西摘掉**：`createMediaStreamSource`
 * 成功、`attach` 失败的话，source 已经挂在流上；反过来也一样。调用方只管在 catch
 * 里释放流与 AudioContext，不必知道接到第几步了。
 */
async function openGraph(
  ctx: AudioContext,
  stream: MediaStream,
  push: (pcm: Float32Array) => void,
): Promise<{ source: MediaStreamAudioSourceNode; capture: Capture }> {
  const source = ctx.createMediaStreamSource(stream)
  try {
    const capture = await attach(ctx, push)
    source.connect(capture.node)
    capture.node.connect(capture.sink)
    return { source, capture }
  } catch (err) {
    try {
      source.disconnect()
    } catch {
      // 还没接上过：无所谓
    }
    throw err
  }
}

/**
 * 打开话筒并开始采集。
 * 返回的会话里带着「收到了多少采样」——外层据此判断是不是一路静音（见 session.ts 的看门狗）。
 */
export async function startMic(): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(t('这个运行环境拿不到麦克风（navigator.mediaDevices 不可用）'))
  }

  let stream = await openStream()
  /*
   * 从这一行往下每一步都可能失败，而**失败必须把已经拿到的东西还回去**：
   * 话筒流不 stop，系统的录制指示灯就一直亮、设备一直被占；AudioContext 不 close，
   * 它就永远占着一个音频通道（同时存在的 AudioContext 有上限，攒几个之后新建的
   * 一律挂起，症状正是「点了语音没反应」）。原先 ctx 起不来时直接 throw，两样都留在原地。
   */
  let ctx: AudioContext
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  } catch (err) {
    for (const track of stream.getTracks()) track.stop()
    throw new Error(t('打不开麦克风：{0}', err instanceof Error ? err.message : String(err)))
  }
  // Electron 默认不拦自动播放（autoplayPolicy = no-user-gesture-required），但别的壳不一定：
  // 挂起状态下 process / onaudioprocess 一次都不会来，症状同样是「一个字都没有」
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      // 恢复不了就下面统一判
    }
  }
  if (ctx.state !== 'running') {
    // 先把状态读出来：close() 之后它就不是 running 了
    const state = ctx.state
    for (const track of stream.getTracks()) track.stop()
    void ctx.close().catch(() => undefined)
    throw new Error(
      t('音频子系统没有启动（AudioContext 处于 {0}）：换个输入设备或重启应用再试', state),
    )
  }

  const chunks: Float32Array[] = []
  /** 已经收到的全部采样数（seconds 用，永不回退） */
  let total = 0
  /** 还没被 drain 取走的采样数（缓存里现在有多少） */
  let buffered = 0
  let level = 0
  /** 自上次 drain 以来见过的最大 RMS：人声门限读它 */
  let peak = 0
  let stopped = false

  const push = (raw: Float32Array): void => {
    const pcm = resample(raw, ctx.sampleRate, SAMPLE_RATE)
    // 拷贝一份：调用方给的那块内存下一帧还会被复用
    chunks.push(new Float32Array(pcm))
    total += pcm.length
    buffered += pcm.length
    let sum = 0
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
    level = Math.sqrt(sum / Math.max(1, pcm.length))
    if (level > peak) peak = level
  }

  let source: MediaStreamAudioSourceNode
  let capture: Capture
  try {
    const graph = await openGraph(ctx, stream, push)
    source = graph.source
    capture = graph.capture
  } catch (err) {
    // 图没接起来：话筒和 AudioContext 都得还回去（见上面那段说明）
    for (const track of stream.getTracks()) track.stop()
    void ctx.close().catch(() => undefined)
    throw err
  }

  /**
   * 一路静音就换约束重开一次。
   * 只在「一段采样都没收到」时换——有声音但很小是另一回事，不该连降噪一起丢掉。
   */
  const switchTimer = window.setTimeout(() => {
    if (stopped || total > 0) return
    console.warn('[voice] 1.5 秒内没收到任何采样，换最简约束重开话筒')
    void (async () => {
      const previous = { source, capture, stream }
      let nextStream: MediaStream | null = null
      try {
        const opened = await navigator.mediaDevices.getUserMedia({ audio: true })
        nextStream = opened
        if (stopped) {
          for (const track of opened.getTracks()) track.stop()
          return
        }
        const nextGraph = await openGraph(ctx, opened, push)
        if (stopped) {
          // 接好之后才发现已经停了：新的一套（含 worklet 的 port）整份还回去
          try {
            nextGraph.capture.stop()
            nextGraph.source.disconnect()
            nextGraph.capture.node.disconnect()
            nextGraph.capture.sink.disconnect()
          } catch {
            // 已经断开：无所谓
          }
          for (const track of opened.getTracks()) track.stop()
          return
        }
        // 换成功之后才拆旧的：中间那几十毫秒宁可重复，也不要断开
        try {
          previous.capture.stop()
          previous.source.disconnect()
          previous.capture.node.disconnect()
          previous.capture.sink.disconnect()
        } catch {
          // 已经断了：无所谓
        }
        for (const track of previous.stream.getTracks()) track.stop()
        source = nextGraph.source
        capture = nextGraph.capture
        stream = opened
        console.info('[voice] 已改用最简约束，设备：', describeTrack(opened))
      } catch (err) {
        // 新的一路没接上：旧的还在跑，一根线都不能拆；只把刚拿到的那条流还回去
        if (nextStream) for (const track of nextStream.getTracks()) track.stop()
        console.warn('[voice] 换约束重开失败：', err)
      }
    })()
  }, SILENCE_SWITCH_MS)

  return {
    drain(): MicChunk {
      const seen = peak
      peak = 0
      if (!buffered) return { samples: new Float32Array(0), peak: seen }
      const out = new Float32Array(buffered)
      let at = 0
      for (const c of chunks) {
        out.set(c, at)
        at += c.length
      }
      chunks.length = 0
      buffered = 0
      return { samples: out, peak: seen }
    },
    seconds: () => total / SAMPLE_RATE,
    samples: () => total,
    level: () => level,
    device: () => describeTrack(stream),
    capture: () => capture.kind,
    stop(): void {
      if (stopped) return
      stopped = true
      window.clearTimeout(switchTimer)
      // stop 与三处 disconnect 放进同一个 try：任何一步抛都不能把后面几步连累掉，
      // 否则话筒指示灯会一直亮着（track 没 stop）、音频通道一直占着（ctx 没 close）
      try {
        capture.stop()
        source.disconnect()
        capture.node.disconnect()
        capture.sink.disconnect()
      } catch {
        // 已经断开 / 已经关闭：后果与成功执行一样
      }
      for (const track of stream.getTracks()) track.stop()
      void ctx.close().catch(() => undefined)
    },
  }
}