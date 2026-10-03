/**
 * 系统音频回环采集：把「电脑正在播什么」变成频谱数据，供顶栏的柱形可视化用。
 *
 * Windows 下 Chromium 能直接给「系统回环」（WASAPI loopback，不占麦克风、系统
 * 也不弹录制提示），但拿它有两条路，优先级如下：
 *
 * 1. **getDisplayMedia**（官方路子）：主进程 `session.setDisplayMediaRequestHandler`
 *    把声音定成 `audio: 'loopback'`（见 electron/app/windows.ts），渲染层要一路
 *    屏幕+声音、到手就把视频轨停掉。近几版 Electron 的官方文档只认这一条；
 * 2. **getUserMedia 的 desktop 音源**（老路子）：`chromeMediaSource: 'desktop'`
 *    的遗留约束，Windows 上多年来一直可用——第 1 条被拒或不支持时兜底。
 *
 * 两条都走不通（Linux 无回环、无声卡）就抛错，柱形画成一行底座，原因写进
 * canvas 的 title。这里只管采集与释放，画柱在 SystemAudioWave。
 */
import { t } from '../../i18n'
import { describeTrack } from '../voice/mic'

/** 分析窗大小：2048 采样 → 1024 个频点，分辨率 ≈ 21.5Hz @44.1kHz，画柱足够 */
const FFT_SIZE = 2048

export interface LoopbackSession {
  /**
   * 取当前一帧频谱（0..255 的 dB 整形值）写进 into（长度必须 = bins()）。
   * 会话已停止时返回 false——调用方据此画底座。
   */
  spectrum(into: Uint8Array<ArrayBuffer>): boolean
  /** 频点数（fftSize 的一半），分配 into 与算频段都用它 */
  bins(): number
  /** 采样率：barRanges 换算频段用 */
  sampleRate(): number
  /** 诊断信息：走的哪条通道、什么设备。出问题时这几行字比猜测值钱 */
  via(): string
  /** 停止采集并释放（音轨停掉、AudioContext 关掉） */
  stop(): void
}

export async function startLoopback(opts?: { onEnded?: () => void }): Promise<LoopbackSession> {
  if (!navigator.mediaDevices?.getDisplayMedia || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(t('这个运行环境拿不到音频（navigator.mediaDevices 不可用）'))
  }

  const { stream, via } = await openLoopbackStream()
  // 输出设备切换/拔掉时回环音轨会结束：报告给外层，让它重连
  stream.getAudioTracks()[0]?.addEventListener('ended', () => opts?.onEnded?.())

  const ctx = new AudioContext()
  // Electron 默认不拦自动播放（autoplayPolicy = no-user-gesture-required），但别的壳
  // 不一定；挂起状态下 analyser 一个数都不会动，症状同样是「永远一行底座」
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {
      // 恢复不了就下面统一判
    }
  }
  if (ctx.state !== 'running') {
    for (const track of stream.getTracks()) track.stop()
    void ctx.close().catch(() => undefined)
    throw new Error(t('音频子系统没有启动（AudioContext 处于 {0}）', ctx.state))
  }

  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = FFT_SIZE
  // 频谱自身的帧间平滑（0..1）：柱子的原始数据就先顺一遍，重力再叠一道
  analyser.smoothingTimeConstant = 0.8
  source.connect(analyser)
  // analyser 不接 destination 也会被驱动——这里只读不播，不像 mic.ts 那样需要 sink

  let stopped = false
  return {
    spectrum(into: Uint8Array<ArrayBuffer>): boolean {
      if (stopped || into.length !== analyser.frequencyBinCount) return false
      analyser.getByteFrequencyData(into)
      return true
    },
    bins: () => analyser.frequencyBinCount,
    sampleRate: () => ctx.sampleRate,
    via: () => via,
    stop(): void {
      if (stopped) return
      stopped = true
      try {
        source.disconnect()
        analyser.disconnect()
      } catch {
        // 已经断开了：无所谓
      }
      for (const track of stream.getTracks()) track.stop()
      void ctx.close().catch(() => undefined)
    },
  }
}

async function openLoopbackStream(): Promise<{ stream: MediaStream; via: string }> {
  // 第 1 条：display-media（主进程给 audio:'loopback'）。视频轨到手就停，只要声音
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    for (const track of stream.getVideoTracks()) track.stop()
    if (stream.getAudioTracks().length > 0) {
      console.info('[sys-audio] 已走 display-media 回环：', describeTrack(stream))
      return { stream, via: 'display-media · loopback' }
    }
    for (const track of stream.getTracks()) track.stop()
    console.warn('[sys-audio] display-media 只给了画面没给声音，换老路子')
  } catch (err) {
    console.warn('[sys-audio] display-media 拿不到，换老路子：', err)
  }

  // 第 2 条：getUserMedia 的 desktop 音源（遗留约束，Windows 一直认）
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop' } } as unknown as MediaTrackConstraints,
  })
  console.info('[sys-audio] 已走 getUserMedia desktop 回环：', describeTrack(stream))
  return { stream, via: 'getusermedia · desktop' }
}
