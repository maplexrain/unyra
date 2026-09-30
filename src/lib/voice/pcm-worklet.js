/**
 * 采集用的 AudioWorklet：把话筒的采样一块块送回主线程。
 *
 * 为什么不用 ScriptProcessorNode（虽然它还能用）：它已经被标了废弃，控制台每次都会
 * 弹一条警告；而且它跑在主线程上，界面一卡就丢块。AudioWorklet 在音频线程上跑，
 * 128 帧一次回调，稳得多——这里把小块攒到 2048 帧（16 kHz 下约 128 ms）再发一条消息，
 * 免得每秒一百多条 postMessage 把主线程淹了。
 *
 * 注意 `slice(0)`：`inputs[0][0]` 指向的那块内存下一帧就会被复用，不复制就等着读到
 * 同一个缓冲区的后续内容（症状是满屏噪声/静音）。
 */

const FRAMES_PER_MESSAGE = 2048

class MojiPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(FRAMES_PER_MESSAGE)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i]
        if (this.filled === FRAMES_PER_MESSAGE) {
          this.port.postMessage(this.buffer.slice(0))
          this.filled = 0
        }
      }
    }
    // 永远返回 true：这个节点要一直活着，哪怕话筒暂时没有声音
    return true
  }
}

registerProcessor('moji-pcm-capture', MojiPcmCapture)