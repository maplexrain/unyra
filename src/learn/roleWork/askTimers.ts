/**
 * ask 气泡的宿主侧到期定时器登记表。
 *
 * 气泡在聊天层渲染，真正挂住沙箱的是 toolRig 里的 setTimeout；鼠标悬停时
 * 界面只能冻结自己的进度条，不能拦住宿主的定时器。这里让渲染层通过 ask id
 * 找到那个定时器，暂停 / 恢复同一份剩余时间，避免「用户正在填表，宿主已经到期」。
 *
 * 纯登记表，不持有 React 状态；ask settle 时由 toolRig 注销。
 */
export interface AskTimerControl {
  pause: () => void
  resume: () => void
}

const controls = new Map<string, AskTimerControl>()

/** 登记一枚 ask；返回注销函数，settle 时必须调用。 */
export function registerAskTimer(askId: string, control: AskTimerControl): () => void {
  controls.set(askId, control)
  return () => {
    if (controls.get(askId) === control) controls.delete(askId)
  }
}

/** 鼠标进入气泡：暂停宿主到期计时（重复调用无副作用）。 */
export function pauseAskTimer(askId: string): void {
  controls.get(askId)?.pause()
}

/** 鼠标离开气泡：按暂停时剩余的时长恢复宿主到期计时。 */
export function resumeAskTimer(askId: string): void {
  controls.get(askId)?.resume()
}
