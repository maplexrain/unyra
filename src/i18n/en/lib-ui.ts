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

  /* ---------- lib/voice/session.ts：语音输入的提示与错误 ---------- */
  '有声音但没认出字——检查系统默认输入设备，或者靠近一点、说慢一点':
    'There was sound but no words came out — check the default system input device, move closer, or speak more slowly',
  '转写失败': 'Transcription failed',
  '话筒一点声音都没进来（设备：{0}）。检查系统默认输入设备、麦克风静音键，以及系统是否允许本应用使用麦克风':
    'No sound reached the microphone at all (device: {0}). Check the default system input device, the microphone mute switch, and whether the system allows this app to use the microphone',
  '把光标放进输入框里再用语音输入': 'Put the cursor into an input field before using voice input',
  '正在准备语音模型…': 'Preparing the voice model...',
  '还没下载语音模型：设置 → 输入 → 语音转文字，下一份（约 57 MB）': 'The voice model is not downloaded yet: Settings → Input → Speech to text, download it (about 57 MB)',
  '语音输入启动失败': 'Voice input failed to start',

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

  /* ---------- lib/voice/engine.ts ---------- */
  '语音 worker 启动失败：{0}': 'The voice worker failed to start: {0}',
  '语音引擎还没准备好': 'The voice engine is not ready yet',

  /* ---------- lib/voice/model.ts ---------- */
  '读不到语音模型': 'Could not read the voice model',

  /* ---------- lib/voice/whisper/engine.ts：引擎错误 ---------- */
  '语音识别引擎已释放（dispose），请重新创建引擎。': 'The speech engine has been disposed; create a new engine.',
  '语音识别引擎尚未就绪：请先 await init() 并 await loadModel(bytes)。': 'The speech engine is not ready: await init() and await loadModel(bytes) first.',
  'loadModel 需要 Uint8Array（模型文件的完整字节）。': 'loadModel requires a Uint8Array (the complete bytes of the model file).',
  'loadModel 收到的模型字节为空。': 'loadModel received empty model bytes.',
  'whisper 模型加载失败：{0}': 'Failed to load the whisper model: {0}',
  '语音转写失败：{0}': 'Transcription failed: {0}',
  'transcribe 需要 Float32Array（16 kHz 单声道，-1..1）。': 'transcribe requires a Float32Array (16 kHz mono, -1..1).',

  /* ---------- lib/voice/whisper/runtime.ts：wasm 运行时错误 ---------- */
  'wasm 资源请求失败（{0}）：{1}。若页面是 file://，请确认 Electron 允许同源 file:// fetch；若配了 CSP，请确认 connect-src 放行 \'self\'。':
    'The wasm asset request failed ({0}): {1}. If the page is file://, make sure Electron allows same-origin file:// fetch; if a CSP is configured, make sure connect-src allows \'self\'.',
  'wasm 资源返回 HTTP {0}（{1}）。': 'The wasm asset returned HTTP {0} ({1}).',
  'wasm 资源是空文件（{0}）。': 'The wasm asset is an empty file ({0}).',
  '加载到的是 whisper.cpp 的多线程 WASM 构建，本应用没有 SharedArrayBuffer，无法运行。请确认引入的是 wasm/whisper-node.wasm（单线程）而不是 wasm/whisper-node.threads.wasm。':
    'The loaded WASM build of whisper.cpp is the multi-threaded one, which this app cannot run (no SharedArrayBuffer). Make sure wasm/whisper-node.wasm (single-threaded) is used, not wasm/whisper-node.threads.wasm.',
  'WASM 运行时没有导出预期的 whisper 入口（__wasm_init_whisper / __wasm_transcribe / __wasm_free_whisper）。本模块针对 @fugood/node-whisper-wasm@{0} 编写，依赖被升级过的话需要同步调整。':
    'The WASM runtime does not export the expected whisper entry points (__wasm_init_whisper / __wasm_transcribe / __wasm_free_whisper). This module targets @fugood/node-whisper-wasm@{0}; adjust it if the dependency was upgraded.',
  '模型写入 WASM 内存文件系统失败：{0}': 'Failed to write the model into the WASM memory file system: {0}',
  'whisper 上下文创建失败：{0}': 'Failed to create the whisper context: {0}',
  '模型文件无法解析': 'The model file could not be parsed',
  'whisper 推理没有返回结果': 'whisper inference returned no result',
}

export default dict
