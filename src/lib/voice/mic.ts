/**
 * 麦克风采集：把话筒里的声音变成 whisper 要的那一种数据。
 *
 * whisper.cpp 只认 **16 kHz 单声道 Float32**（-1..1）。三条路走到这个形状：
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
 * 采集到的数据一路追加在内存里：转写是「拿整段重跑一遍」（见 session.ts 的说明），
 * 所以这一层只负责「给得出从按下到现在为止的全部采样」，外加几个查问题用的读数
 * （收到了多少、什么设备、什么参数）——出问题时这几行字比任何猜测都值钱。
 */
import { t } from '../../i18n'

/** whisper 要的采样率 */
export const SAMPLE_RATE = 16000

/** 等这么久还没收到任何采样，就换一套约束重开话筒 */
const SILENCE_SWITCH_MS = 1500

export interface MicSession {
  /** 到目前为止的全部采样（16 kHz 单声道）。每次调用都会重新拼一份，别在高频循环里调 */
  read(): Float32Array
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
 * 打开话筒并开始采集。
 * 返回的会话里带着「收到了多少采样」——外层据此判断是不是一路静音（见 session.ts 的看门狗）。
 */
export async function startMic(): Promise<MicSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(t('这个运行环境拿不到麦克风（navigator.mediaDevices 不可用）'))
  }

  let stream = await openStream()
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
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
    throw new Error(
      t('音频子系统没有启动（AudioContext 处于 {0}）：换个输入设备或重启应用再试', ctx.state),
    )
  }

  const chunks: Float32Array[] = []
  let total = 0
  let level = 0
  let cached: Float32Array | null = null
  let stopped = false

  const push = (raw: Float32Array): void => {
    const pcm = resample(raw, ctx.sampleRate, SAMPLE_RATE)
    // 拷贝一份：调用方给的那块内存下一帧还会被复用
    chunks.push(new Float32Array(pcm))
    total += pcm.length
    let sum = 0
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i]
    level = Math.sqrt(sum / Math.max(1, pcm.length))
    cached = null
  }

  let source = ctx.createMediaStreamSource(stream)
  let capture = await attach(ctx, push)
  source.connect(capture.node)
  capture.node.connect(capture.sink)

  /**
   * 一路静音就换约束重开一次。
   * 只在「一段采样都没收到」时换——有声音但很小是另一回事，不该连降噪一起丢掉。
   */
  const switchTimer = window.setTimeout(() => {
    if (stopped || total > 0) return
    console.warn('[voice] 1.5 秒内没收到任何采样，换最简约束重开话筒')
    void (async () => {
      const previous = { source, capture, stream }
      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (stopped) {
          for (const track of nextStream.getTracks()) track.stop()
          return
        }
        const nextSource = ctx.createMediaStreamSource(nextStream)
        const nextCapture = await attach(ctx, push)
        nextSource.connect(nextCapture.node)
        nextCapture.node.connect(nextCapture.sink)
        // 换成功之后才拆旧的：中间那几十毫秒宁可重复，也不要断开
        try {
          previous.source.disconnect()
          previous.capture.node.disconnect()
          previous.capture.sink.disconnect()
        } catch {
          // 已经断了：无所谓
        }
        for (const track of previous.stream.getTracks()) track.stop()
        source = nextSource
        capture = nextCapture
        stream = nextStream
        console.info('[voice] 已改用最简约束，设备：', describeTrack(nextStream))
      } catch (err) {
        console.warn('[voice] 换约束重开失败：', err)
      }
    })()
  }, SILENCE_SWITCH_MS)

  return {
    read(): Float32Array {
      if (cached) return cached
      const out = new Float32Array(total)
      let at = 0
      for (const c of chunks) {
        out.set(c, at)
        at += c.length
      }
      cached = out
      return out
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
      capture.stop()
      try {
        source.disconnect()
        capture.node.disconnect()
        capture.sink.disconnect()
      } catch {
        // 已经断开了：无所谓
      }
      for (const track of stream.getTracks()) track.stop()
      void ctx.close().catch(() => undefined)
    },
  }
}