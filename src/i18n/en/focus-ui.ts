/**
 * 英文字典的「专注 / 守卫」分片：严格专注模式、守卫 agent 页签与专注报告的文案。
 * 键 = 界面里的中文原文（与其余分片同一条规矩：同一个键的译法必须一致）。
 */
export default {
  // 番茄钟 tip（PomodoroButton）
  '严格专注': 'Strict focus',
  '守卫 agent 每分钟看一眼': 'Guard agent checks every minute',
  '勾选即开启': 'Tick to enable',
  '监控屏幕': 'Watch screen',
  '监控摄像头': 'Watch camera',
  '画面只用于判断学习状态、逐轮发给模型，不落盘；出现隐私画面会立即熔断停止专注。':
    'Frames are only used to judge your focus and are sent to the model per round — never stored. Privacy-sensitive frames trigger an immediate fuse.',
  '守卫发现你不在屏幕前，计时已暂停——回到应用随便点一下或敲个键就继续':
    'The guard noticed you are away from the screen. The timer is paused — click or press any key to resume.',
  '停下来这一段就不算数，要接着跑只能重新开始；只有跑完的专注段会记一笔。':
    'Stopping voids the current segment — start again to continue. Only completed focus segments are logged.',
  '守卫发现你离开会自动暂停计时，回来后自动继续。':
    'The guard pauses the timer when you leave and resumes when you are back.',

  // 顶栏 Dock（docks.tsx）
  '守卫暂停中——等你回来': 'Guard paused — waiting for you',
  '守卫当值 · 已看 {0} 眼': 'Guard on duty · {0} checks',
  '查看守卫': 'Open guard',
  '屏幕': 'Screen',
  '摄像头': 'Camera',
  '等待画面…': 'Waiting for video…',

  // 页签
  '守卫 Agent': 'Guard Agent',
  '专注报告': 'Focus reports',

  // 守卫页签（GuardView）
  '守卫还没有跑过。': 'The guard has not run yet.',
  '在顶栏番茄钟的 tip 里勾选「监控屏幕」或「监控摄像头」，开始专注后守卫就会在这里建起自己的上下文：每分钟看一眼画面，判断你在不在学、在不在屏幕前，涉及隐私会立即熔断。':
    'Tick "Watch screen" or "Watch camera" in the pomodoro tip and start a focus session — the guard will build its context here: checking the frames every minute to tell whether you are studying, whether you are at the screen, and fusing immediately on anything private.',
  '当值中': 'On duty',
  '已暂停——等你回来': 'Paused — waiting for you',
  '已熔断': 'Fused',
  '已结束': 'Ended',
  '已看 {0} 眼': '{0} checks',
  '因隐私保护熔断：{0}': 'Fused for privacy: {0}',
  '系统提示词（按勾选的监控现算）': 'System prompt (computed from the monitors you ticked)',
  '守卫在第 {0} 秒看到的画面': 'Frame the guard saw at second {0}',
  '点开看大图（这一帧已发给模型）': 'Click to enlarge (this frame was sent to the model)',
  '判定：': 'Verdict: ',
  '（无说明）': '(no explanation)',
  '模型的思考与回复原文': 'Model reasoning and raw reply',
  '随图发送：{0}': 'Sent with the frames: {0}',
  '没看懂这一轮': 'Round not understood',
  '在学': 'On task',
  '分心警告': 'Distraction warning',
  '判离开 · 已暂停': 'Away · paused',
  '隐私熔断': 'Privacy fuse',
  '还没有看过任何一眼——等第一轮监控（开始后约半分钟）。':
    'No checks yet — waiting for the first round (about half a minute after start).',

  // 专注报告页签（FocusReportView）
  '正在打开报告…': 'Opening the report…',
  '这份报告不见了（文件被移动或删掉）。': 'This report is missing (the file was moved or deleted).',
  '跑完了': 'Completed',
  '中途停止': 'Stopped',
  '共 {0} 分钟': '{0} min in total',
  '完成专注': 'Focus done',
  '{0}/{1} 组': '{0}/{1} rounds',
  '被暂停': 'Paused',
  '{0} 次 · {1} 分钟': '{0} times · {1} min',
  '没有': 'None',
  '{0} 次': '{0} times',
  '监控': 'Monitors',
  '屏幕 + 摄像头': 'Screen + camera',
  '没开（普通专注）': 'Off (plain focus)',
  '因隐私保护立即熔断：{0}': 'Fused immediately for privacy: {0}',
  '出过的事': 'What happened',
  '分心警告：{0}': 'Distraction warning: {0}',
  '守卫判离开，暂停 {0} 分钟': 'Guard judged you away, paused {0} min',
  '守卫判离开，暂停到收场': 'Guard judged you away, paused until the end',
  '守卫的判定（新 → 旧）': 'Guard verdicts (newest first)',
  '（没看懂这一轮）': '(round not understood)',
  '屏': 'S',
  '摄': 'C',
  '这一场没有开监控，报告里只有计时账目。要守卫盯着，在番茄钟 tip 里勾选「监控屏幕」或「监控摄像头」。':
    'No monitors were on for this session, so the report only has the timer ledger. Tick "Watch screen" or "Watch camera" in the pomodoro tip to have the guard watch.',

  // 资源管理器（sections.tsx）
  '{0}-{1} {2}:{3}': '{0}-{1} {2}:{3}',
  '{0} 开始的一场专注（{1} 分钟）': 'A focus session started at {0} ({1} min)',
  '{0} 分': '{0}m',

  // 宿主编排（LearnWorkspace）
  '守卫：{0}——番茄钟已暂停，回到应用就继续': 'Guard: {0} — the pomodoro is paused, come back to resume',
  '守卫：欢迎回来，番茄钟继续': 'Guard: welcome back, the pomodoro resumes',
  '专注报告已生成——资源管理器的「专注报告」里看': 'Focus report generated — see "Focus reports" in the explorer',
  '番茄钟没有在跑': 'The pomodoro is not running',
  '番茄钟：第 {0}/{1} 组{2}，还剩 {3}': 'Pomodoro: round {0}/{1}{2}, {3} left',
  '（休息）': ' (rest)',
  '守卫提醒：屏幕上的内容与学习无关': 'Guard: the screen is not on studying',
  '{0}（误判可直接忽略，这一条也会记进专注报告。）': '{0} (If this is a false positive, just dismiss it — it is recorded in the focus report.)',
  '回到学习': 'Back to studying',
  '严格专注已熔断': 'Strict focus fused',
  '守卫在画面里看到了涉及隐私的内容（{0}），已立即停止监控并结束这次专注；看到的画面不会保存。':
    'The guard saw something private in the frames ({0}). Monitoring stopped immediately and this focus session ended; the frames are not saved.',
  '知道了': 'Got it',

  // 守卫运行时（agent/guardRuntime）
  '屏幕与摄像头都没拿到，严格专注没有开起来（普通番茄钟继续）':
    'Neither screen nor camera could be captured — strict focus did not start (the plain pomodoro continues)',
  '有一路监控没拿到（权限或设备占用），按拿到的继续': 'One monitor could not be captured (permission or device busy) — continuing with the other',
  '还没有收到过任何交互': 'No interaction received yet',
  '距上一次与应用交互 {0} 秒': '{0} s since the last interaction with the app',
  '回复不是约定的 JSON，这一轮没有动作': 'The reply was not the agreed JSON — no action this round',
  '（模型没给说明）': '(the model gave no explanation)',
} as Record<string, string>
