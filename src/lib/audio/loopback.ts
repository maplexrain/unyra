/**
 * 系统音频回环采集：把「电脑正在播什么」变成频谱数据，供侧栏底部的柱形可视化用。
 *
 * Windows 下 Chromium 能直接给「系统回环」（WASAPI loopback，不占麦克风、系统
 * 也不弹录制提示）：
 *
 * - **getDisplayMedia**：主进程 `session.setDisplayMediaRequestHandler`
 *   把声音定成 `audio: 'loopback'`（见 electron/app/windows.ts），渲染层要一路
 *   屏幕+声音、到手就把视频轨停掉，只保留音频。
 *
 * 如果系统未接声卡、未插耳机音箱、驱动异常或在无音频重定向的虚拟机/RDP 环境中，
 * `getDisplayMedia` 会捕获到异常并安全抛出，由外层进入待机呼吸波；**严禁**回退至
 * 无效参数的 `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } } })`，
 * 否则会触发 Chromium 263 坏 IPC 安全拦截直接终止渲染进程导致白屏。
 */
import { t } from '../../i18n'
import { describeTrack } from '../voice/mic'
import { isWeb } from '../native'

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
  if (isWeb()) {
    throw new Error(t('Web 浏览器模式下不支持系统级音频回环采集'))
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(t('这个运行环境拿不到音频（navigator.mediaDevices 不可用）'))
  }

  const { stream, via } = await openLoopbackStream()
  // 输出设备切换/拔掉时回环音轨会结束：报告给外层，让它重连。
  // 闭包留一个引用，stop 时摘掉——音轨被 stop 之后本该随流一起回收，但显式摘除更稳，
  // 也免得将来给 track 换一个更长的生命周期时这里变成隐性泄漏。
  const audioTrack = stream.getAudioTracks()[0]
  const handleEnded = (): void => opts?.onEnded?.()
  audioTrack?.addEventListener('ended', handleEnded)

  /*
   * AudioContext 是这一步唯一会「外面出事」的地方：同时存在的上下文有上限，超了
   * 构造就抛。这时流与 ended 监听都已经挂上了，不还回去就是一路常亮的录制指示灯
   * 加一个被占住的输出设备。
   */
  let ctx: AudioContext
  try {
    ctx = new AudioContext()
  } catch (err) {
    audioTrack?.removeEventListener('ended', handleEnded)
    for (const track of stream.getTracks()) track.stop()
    throw err
  }
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
      audioTrack?.removeEventListener('ended', handleEnded)
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
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    for (const track of stream.getVideoTracks()) track.stop()
    if (stream.getAudioTracks().length > 0) {
      console.info('[sys-audio] 已走 display-media 回环：', describeTrack(stream))
      return { stream, via: 'display-media · loopback' }
    }
    for (const track of stream.getTracks()) track.stop()
    throw new Error(t('系统音频未激活或设备无声音输出'))
  } catch (err) {
    console.warn('[sys-audio] 系统音频回环捕获不可用（如无声卡、未接音箱耳机或权限受阻）：', err)
    throw err instanceof Error ? err : new Error(String(err))
  }
}
