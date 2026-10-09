/**
 * 英文字典：lib 层的用户可见文案（菜单、浮层、导出、语音等）。
 *
 * 键 = 界面里的中文原文，逐字节一致（含全角标点）；插值用 {0} {1}。
 * 本文件只由「lib 层」分片的接入者维护。
 * 某个键已在别的分片登记过的不在这里重复（如 shortcut 静态键名、update 静态文案、
 * 「复制 / 删除 / 收起 / 保存失败 / 下载失败 / 未命名文档 / '{0} 月 {1} 日'」等）。
 */
const dict: Record<string, string> = {
  /* ---------- lib/time.ts：相对时间（显示于最近打开列表） ---------- */
  '刚刚': 'Just now',
  '{0} 分钟前': '{0} min ago',
  '{0} 小时前': '{0} h ago',
  '昨天': 'Yesterday',
  '{0} 年 {1} 月 {2} 日': '{0}/{1}/{2}',

  /* ---------- lib/shortcuts.ts：改键报错（占用原因与冲突名等键在 shell 分片） ---------- */
  '{0} 是「{1}」用的，换一个': '{0} is reserved for "{1}"; pick another',
  '和「{0}」撞了，换一个': 'Clashes with "{0}"; pick another',
  '粘贴': 'Paste',
  '剪切': 'Cut',
  '全选': 'Select all',
  '撤销': 'Undo',
  '重做': 'Redo',
  '查找': 'Find',
  '打印': 'Print',
  '重新加载窗口': 'Reload the window',
  '关闭当前弹窗': 'Close the current dialog',

  /* ---------- lib/update.ts：http 失败分支与默认分支 ---------- */
  '下载服务器返回了错误：{0}。下次启动会自动再试。': 'The download server returned an error: {0}. It will retry on next launch.',
  '下载服务器返回了错误。下次启动会自动再试。': 'The download server returned an error. It will retry on next launch.',
  // 「这次检查更新没有成功。…」已在 shell 分片登记，这里不再重复

  /* ---------- lib/outline.ts ---------- */
  '未命名标题': 'Untitled heading',

  /* ---------- lib/modalConfirm.tsx ---------- */
  '确定': 'OK',

  /* ---------- lib/native.ts ---------- */
  '未检测到 Electron 运行环境：请用 npm run electron:dev 启动桌面应用，而不是直接在浏览器里打开。':
    'Electron runtime not detected: start the desktop app with npm run electron:dev instead of opening it directly in a browser.',

  /* ---------- lib/localFiles.ts ---------- */
  '读不到这个文件：应用没有跑在 Electron 里': 'Cannot read this file: the app is not running inside Electron',
  '保存失败：应用没有跑在 Electron 里': 'Save failed: the app is not running inside Electron',

  /* ---------- lib/plugins.ts：装载与开关插件时给设置页看的错误 ---------- */
  '未知的插件类别：{0}': 'Unknown plugin category: {0}',
  '插件没有交出对象': 'The plugin did not hand over an object',
  '插件缺少 id': 'The plugin is missing an id',
  '没有可用的插件类别': 'No plugin category is available',
  '插件 id「{0}」已被「{1}」占用': 'Plugin id "{0}" is already taken by "{1}"',
  '列不出插件目录：应用没有跑在 Electron 里': 'Cannot list the plugin folder: the app is not running inside Electron',
  '插件没有交出对象（需要调用 register({…})）': 'The plugin did not hand over an object (call register({…}))',
  // 「读不到插件文件：…」「没能保存」「打不开插件目录」已在 shell 分片登记，这里不再重复
  '应用没有跑在 Electron 里': 'The app is not running inside Electron',

  /* ---------- lib/renderPlugins.ts：形状校验与设置页摘要 ---------- */
  'text 必须是数组': 'text must be an array',
  'text 里的每一条都必须是对象': 'every entry of text must be an object',
  'text 规则缺少 match（正则）': 'a text rule is missing match (a regular expression)',
  'text 规则要有 wrap（类名）或 style（内联样式），否则什么都不会变':
    'a text rule needs wrap (a class name) or style (inline styling), otherwise nothing changes',
  'fences 必须是数组': 'fences must be an array',
  '围栏语言「{0}」已被插件「{1}」认领': 'Fence language "{0}" is already claimed by the plugin "{1}"',
  '认领了围栏语言却没有 render()': 'claimed a fence language but has no render()',
  'render 必须是函数': 'render must be a function',
  'hydrate 必须是函数': 'hydrate must be a function',
  '内置插件不能带 marked 扩展（marked 的扩展装上去摘不下来，关不掉）':
    'A built-in plugin cannot carry marked extensions (they cannot be uninstalled, so it could never be turned off)',
  '插件什么都没做（缺 fences / text / hydrate / marked）': 'The plugin does nothing (missing fences / text / hydrate / marked)',
  '{0} 条正文规则': '{0} text rules',
  '挂载 DOM': 'Mounts DOM',
  'marked 扩展': 'marked extensions',

  /* ---------- lib/codeBlockMenu.ts：代码块菜单与联网确认 ---------- */
  '导师判定这段代码没有输出：{0}': 'The tutor judged this code to have no output: {0}',
  '导师判定这段代码没有输出（跑起来不会有任何东西可看）': 'The tutor judged this code to have no output (running it would produce nothing to see)',
  '编译中': 'Compiling',
  '重新编译': 'Recompile',
  '编译': 'Compile',
  '这里没有超级导师的上下文（在文档区里才能编译）': 'No Super Tutor context here (compiling works inside the document area)',
  '运行输出': 'Run output',
  '（前面还有 {0} 行没显示）': '({0} earlier lines not shown)',
  '正在跑…': 'Running...',
  '已复制': 'Copied',
  '复制失败': 'Copy failed',
  '移动失败': 'Move failed',
  '不能把目录移进它自己里面': "A folder can't be moved into itself",
  '已复制到 {0}': 'Copied to {0}',
  '已移动到 {0}': 'Moved to {0}',
  '这段代码要联网': 'This code needs the network',
  '它想访问：\n{0}\n\n同意之后，本次运行里后续的联网请求都会一并放行。\n代码是 AI 转译出来的，请确认上面这个地址你认识。':
    'It wants to reach:\n{0}\n\nOnce allowed, further network requests in this run are let through as well.\nThe code was translated by AI; please make sure you recognize the address above.',
  '允许本次运行': 'Allow this run',
  '（联网被拒绝，代码可能在等数据）': '(Network access was denied; the code may be waiting for data)',
  '代码块操作': 'Code block actions',
  '运行': 'Run',
  '无输出': 'No output',

  /* ---------- lib/codeRun.ts：运行输出与失败原因 ---------- */
  '沙箱起不来：页面不允许创建 Worker（worker-src 被 CSP 限制）': 'The sandbox cannot start: the page does not allow creating Workers (worker-src is restricted by CSP)',
  '沙箱起不来': 'The sandbox cannot start',
  '运行超时（{0} 秒），已强制停止': 'Run timed out ({0} s); it was force-stopped',
  '运行超时': 'Run timed out',
  '已停止': 'Stopped',
  '沙箱内部错误': 'Sandbox internal error',
  '请求发不出去：{0}': 'The request could not be sent: {0}',

  /* ---------- lib/codeArtifacts.ts ---------- */
  '清不掉': 'Could not clear',

  /* ---------- lib/staticView.ts：资源占位与缺失 ---------- */
  '正在读取…': 'Reading...',
  '图片读取失败': 'Image failed to load',
  '文件缺失': 'File missing',
  '文件不在资源目录里': 'The file is not in the resource folder',
  '资源不存在 · {0}': 'Resource not found · {0}',
  '资源不存在': 'Resource not found',
  '资源不存在：{0}（清单里没有这条引用）': 'Resource not found: {0} (the manifest has no such reference)',
  '资源不存在（清单里没有这条引用）': 'Resource not found (the manifest has no such reference)',

  /* ---------- lib/exportDoc.ts：导出件与建议文件名 ---------- */
  '文档-{0}': 'Document-{0}',
  '归一 UNYRA · 学习文档': 'Unyra · Study document',
  '由 归一 Unyra 导出': 'Exported by Unyra',
  '［图片 {0} 未内嵌］': '[Image {0} not embedded]',
  '［图片不在：{0}］': '[Image missing: {0}]',
  '［图片不在］': '[Image missing]',

  /* ---------- lib/plot.ts：函数图像的错误占位 ---------- */
  '函数图像组件的导出形态异常': 'The plot library has an unexpected export shape',
  '函数图像格式不正确（需要一段含 data 的 JSON）': 'The plot is malformed (a JSON object with data is required)',
  '函数图像组件加载失败：{0}': 'Failed to load the plot library: {0}',
  '函数图像组件加载失败': 'Failed to load the plot library',
  '函数图像绘制失败，请检查表达式与参数': 'Plotting failed; please check the expression and parameters',

  /* ---------- lib/builtinPlugins.ts：plot 占位与回退 ---------- */
  '函数图像内容为空': 'The plot is empty',
  '函数图像表达式含有不被允许的内容': 'The plot expression contains disallowed content',
  '正在绘制函数图像…': 'Drawing the plot...',

  /* ---------- lib/annotation/popup.ts：浮层上的「修改 / 删除」 ---------- */
  '修改这条笔记': 'Edit this note',
  '修改': 'Edit',
  '删除这条笔记': 'Delete this note',

  /* ---------- lib/voice/session.ts：一次录音的提示与错误 ---------- */
  '还没下载语音模型：到「设置 → 插件 → 语音输入」里下载':
    'The speech model is not downloaded yet: get it in Settings → Plugins → Voice input',
  '识别失败': 'Recognition failed',
  '这一段没有听清（{0} 秒），再说一次试试': 'Nothing was recognised in those {0} seconds — try again',
  '语音输入需要先下载模型': 'Voice input needs the model first',
  '正在准备语音模型…': 'Preparing the voice model...',

  /* ---------- lib/voice/mic.ts：话筒错误与设备描述 ---------- */
  '没有音轨': 'No audio track',
  '未知设备': 'Unknown device',
  '{0} 声道': '{0} channels',
  '麦克风权限被拒绝了：请在系统设置里允许本应用使用麦克风（Windows：设置 → 隐私和安全性 → 麦克风）':
    'Microphone access was denied: allow this app to use the microphone in the system settings (Windows: Settings → Privacy & security → Microphone)',
  '没有找到可用的麦克风设备': 'No usable microphone device was found',
  '打不开麦克风：{0}': 'Could not open the microphone: {0}',
  '这个运行环境拿不到麦克风（navigator.mediaDevices 不可用）': 'The microphone is unavailable in this environment (navigator.mediaDevices is missing)',
  '音频子系统没有启动（AudioContext 处于 {0}）：换个输入设备或重启应用再试': 'The audio subsystem did not start (AudioContext is {0}); try another input device or restart the app',

  /* ---------- lib/audio/loopback.ts：系统音频回环与顶栏波浪 ---------- */
  '这个运行环境拿不到音频（navigator.mediaDevices 不可用）': 'Audio is unavailable in this environment (navigator.mediaDevices is missing)',
  '音频子系统没有启动（AudioContext 处于 {0}）': 'The audio subsystem did not start (AudioContext is {0})',
  '正在监听系统音频': 'Listening to system audio',
  '输出设备变了，重新接系统音频': 'Output device changed, reconnecting to system audio',
  '系统音频拿不到：{0}': 'System audio is unavailable: {0}',

  /* ---------- lib/voice/plugin.ts 与函数性插件的守卫 ---------- */
  '语音输入': 'Voice input',
  '先下载语音模型（{0}，约 {1} MB）才能打开——点进这一项去下。':
    'Download the speech model first ({0}, about {1} MB) — open this entry to do it.',
  '暂时判断不了能不能启用（应用没跑在 Electron 里？）': 'Cannot tell right now whether this can be enabled (is the app running outside Electron?)',
  '功能性插件': 'Functional plugins',
  '给应用加一项能力。默认关着：点名字进去把它需要的东西准备好，再打开。':
    'Adds a capability to the app itself. Off by default: open the entry, get what it needs ready, then switch it on.',
  '可配置': 'configurable',
  '开箱即用': 'works out of the box',
  '配置': 'Configure',
  '返回插件列表': 'Back to the plugin list',
  '用户插件（数据目录里那些 .js）与归一同权：启用之后它读得到正文与你的全部笔记，也用得上应用与磁盘之间的那条通道。只装自己看得懂、或者来源可信的插件。功能性插件是应用自己带的，没有这一层风险。':
    'User plugins (the .js files in your data folder) have the same rights as Unyra: once enabled they can read your documents and every note, and they can use the channel between the app and the disk. Only install plugins you can read or trust. Functional plugins ship with the app and carry no such risk.',

  /* ---------- 语音输入的配置页（settings/PluginVoicePage） ---------- */
  '模型': 'Model',
  '识别': 'Recognition',
  '还没下完（{0} / {1}）': 'Still downloading ({0} / {1})',
  '还没下载（约 {0} MB）': 'Not downloaded yet (about {0} MB)',
  '「用本机文件」挑的是 model.int8.onnx，词表 tokens.txt 要放在同一个目录里（从 HuggingFace 整份下下来的目录就是这个样子）。模型存在系统用户目录下，不属于任何一份学习数据——换用户、换数据目录都还在。':
    '"Use a local file" wants model.int8.onnx, with tokens.txt in the same folder (that is how a full download from HuggingFace looks). The model lives under your system user folder and belongs to no single set of study data — it survives switching users or data folders.',
  '识别语言': 'Language',
  '默认自动：SenseVoice 自己判断这一段是哪种语言，中英混说也不用切。话里夹着专业词、或者它认错了语种时，指定一种会更准。':
    'Auto by default: SenseVoice detects the language of each clip, so mixing Chinese and English needs no switching. Name one when the audio is full of jargon or the guess goes wrong.',
  '自动': 'Auto',
  '中文': 'Chinese',
  '粤语': 'Cantonese',
  'GPU 加速': 'GPU acceleration',
  '检测到显卡：{0}。默认就走它；语音运行时没带 GPU 版时会自己退回 CPU，识别照样出字，只是慢一点。':
    'GPU detected: {0}. It is used by default; if the speech runtime ships without a GPU build it falls back to the CPU on its own — recognition still works, just slower.',
  '有显卡': 'a GPU',
  '这台机器上没有检测到独立显卡，识别跑在 CPU 上——一段 5 秒的话约 0.2 秒，够用。':
    'No discrete GPU on this machine, so recognition runs on the CPU — about 0.2 s for a five-second clip, which is plenty.',
  '现在是「跟随设备」：上面这个值是按这台机器检测出来的，拨一下就固定下来（以后换机器也不会自己变）。':
    'Currently following the device: the value above was detected on this machine. Toggle it to pin it down (it then survives moving to another machine).',
  '已经手动固定成「{0}」；想交回自动判断，把开关拨回检测到的那一侧即可。':
    'Pinned to "{0}" by hand; to hand it back to auto-detection, toggle it back to the detected side.',
  '开': 'on',
  '关': 'off',
  '识别跑在应用主进程里的 sherpa-onnx 原生运行时（{0}）：录音在你按下结束之后才送去识别，一次出结果，不是边说边出字。':
    'Recognition runs in the sherpa-onnx native runtime inside the main process ({0}): the recording is sent off only after you stop it, and one pass produces the whole result — nothing comes out while you speak.',
  '音频只在这一次识别里存在内存中，不写盘、不出本机。': 'Audio exists in memory for that one recognition only: never written to disk, never sent off this machine.',

  /* ---------- 输入框上的麦克风按钮（agent/panel/MicButton） ---------- */
  '语音输入：点一下开始录，说完按空格结束': 'Voice input: click to start recording, press Space when you are done',
  '正在录音（{0}）——按空格或再点一下结束，Esc 丢弃': 'Recording ({0}) — press Space or click again to stop, Esc to discard',
  '空格结束': 'Space to stop',
  '空格': 'Space',

}

export default dict
