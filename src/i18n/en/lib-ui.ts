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
  '视频 / 音频来源': 'Video / audio sources',
  '给「视频学习」页签提供流与字幕，或把音频交给语音识别。':
    'Provides streams and transcripts for the Video study tab, or hands audio to speech recognition.',
  '视频来源': 'Video source',
  '音频来源': 'Audio source',
  '播放流': 'playable stream',
  '字幕直取': 'subtitles',
  '插件的 {0} 必须是数组': "The plugin's {0} must be an array",
  '插件的 settings 必须是数组': "The plugin's settings must be an array",
  'settings 里的每一项都必须是对象': 'Every settings entry must be an object',
  'settings 字段缺少 key': 'A settings field is missing its key',
  'settings 字段 key 重复：{0}': 'Duplicate settings key: {0}',
  'settings 字段「{0}」的 type 不认识': 'Unknown settings type for field “{0}”',
  'settings 字段「{0}」缺少 label': 'Settings field “{0}” is missing a label',
  'settings 字段「{0}」是 select，必须给 options': 'Settings field “{0}” is a select and needs options',
  '插件需要 apiVersion: 1（当前宿主契约 v1，插件里写的是 {0}）':
    'The plugin needs apiVersion: 1 (host contract v1; the plugin declares {0})',
  '插件的 kinds 必须是 video / audio 之一': "The plugin's kinds must include video or audio",
  '插件的 provides 必须是 stream / transcript 之一': "The plugin's provides must include stream or transcript",
  '插件缺少 match(input) 函数': 'The plugin is missing match(input)',
  '插件缺少 resolve(host, matched) 函数': 'The plugin is missing resolve(host, matched)',
  '插件「{0}」没有装载上下文（重启应用后重试）': 'Plugin “{0}” has no host context (restart the app and retry)',
  '没有插件支持这个输入：{0}。视频来源插件在「设置 → 插件 → 视频 / 音频来源」里安装与配置。':
    'No plugin handles this input: {0}. Install and configure video source plugins under Settings → Plugins → Video / audio sources.',
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
  '函数图像绘制失败：{0}': 'Plotting failed: {0}',
  /* ---------- plot 错误卡片上的「让导师修复」 ---------- */
  '让导师修复': 'Ask the tutor to fix it',
  '已把报错发给导师': 'Sent to the tutor',
  '已把报错发给导师，请看对话栏': 'Sent to the tutor — see the chat panel',
  '这一页没有对应的导师会话，无法自动发送': 'This page has no matching tutor conversation, so it cannot be sent automatically',
  '函数图像没有画出可见曲线：表达式在绘图区间内没有取值（定义域外、分母为零，或变量名不是 x）。请检查表达式与 xAxis / yAxis 的区间': 'The plot drew no visible curve: the expression has no value over the plotted range (outside its domain, division by zero, or the variable is not x). Check the expression and the xAxis / yAxis range',

  /* ---------- lib/builtinPlugins.ts：plot 占位与回退 ---------- */
  '函数图像内容为空': 'The plot is empty',
  '函数图像表达式含有不被允许的内容': 'The plot expression contains disallowed content',
  '正在绘制函数图像…': 'Drawing the plot...',

  /* ---------- lib/mermaid.ts：超高图表的折叠 ---------- */
  '展开图表': 'Expand chart',
  '收起图表': 'Collapse chart',

  /* ---------- lib/annotation/popup.ts：浮层上的「修改 / 删除」 ---------- */
  '修改这条笔记': 'Edit this note',
  '修改': 'Edit',
  '删除这条笔记': 'Delete this note',

  /* ---------- lib/voice/session.ts：一次录音的提示与错误 ---------- */
  '识别失败': 'Recognition failed',
  '这一段没有听清（{0} 秒），再说一次试试': 'Nothing was recognised in those {0} seconds — try again',
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
  '系统音频未激活或设备无声音输出': 'System audio is inactive or device has no sound output',
  '音频子系统没有启动（AudioContext 处于 {0}）': 'The audio subsystem did not start (AudioContext is {0})',
  '正在监听系统音频': 'Listening to system audio',
  '输出设备变了，重新接系统音频': 'Output device changed, reconnecting to system audio',
  '系统音频拿不到：{0}': 'System audio is unavailable: {0}',

  /* ---------- lib/voice/plugin.ts 与函数性插件的守卫 ---------- */
  '语音输入': 'Voice input',
  '暂时判断不了能不能启用（应用没跑在 Electron 里？）': 'Cannot tell right now whether this can be enabled (is the app running outside Electron?)',
  '功能性插件': 'Functional plugins',
  '可配置': 'configurable',
  '开箱即用': 'works out of the box',
  '配置': 'Configure',
  /* ---------- 语音输入的配置页（settings/PluginVoicePage） ---------- */
  '模型': 'Model',
  '识别': 'Recognition',
  '识别语言': 'Language',
  '自动': 'Auto',
  '中文': 'Chinese',
  '粤语': 'Cantonese',
  '开': 'on',
  '关': 'off',
  /* ---------- 能力接入（设置 → 模型 → 能力接入，见 settings/CapabilitiesPage） ---------- */
'尚未配置 DeepSeek 提供商。选择「DeepSeek 官方」接入的能力会复用它的 API Key——请先到「提供商与模型」创建。': 'No DeepSeek provider is configured yet. Capabilities set to "DeepSeek official" reuse its API key — create one under Providers & Models first.',
'「DeepSeek 官方」接入自动复用提供商（{0}）的 API Key，与网络搜索同源，无需重复填写。': 'Capabilities set to "DeepSeek official" reuse the API key of provider {0} — the same key as web search; no need to fill it again.',
'文字转语音 (TTS)': 'Text to speech (TTS)',
'朗读 AI 消息；结果本地缓存，重听不再计费': 'Reads AI messages aloud; results are cached locally, so replaying never bills twice',
'系统原生': 'System built-in',
'浏览器 Web Speech，免费离线': 'Browser Web Speech — free and offline',
'需要先配置 DeepSeek 提供商': 'Requires a configured DeepSeek provider first',
'复用提供商 API Key（按量计费）': 'Reuses the provider API key (pay per use)',
'本地适配器': 'Local adapter',
'自架 OpenAI 兼容 /audio/speech': 'Your own OpenAI-compatible /audio/speech service',
'自架 OpenAI 兼容 /audio/transcriptions': 'Your own OpenAI-compatible /audio/transcriptions service',
'自架 OpenAI 兼容视觉模型': 'Your own OpenAI-compatible vision model',
'关闭': 'Off',
'隐藏朗读按钮': 'Hides the read-aloud button',
'音色': 'Voice',
'Stella（女声）': 'Stella (female)',
'Tide（男声）': 'Tide (male)',
'服务地址（以 /v1 结尾）': 'Service URL (ending with /v1)',
'模型（选填）': 'Model (optional)',
'音色（选填）': 'Voice (optional)',
'API Key（选填）': 'API key (optional)',
'语音转文字 (STT)': 'Speech to text (STT)',
'导师输入框的麦克风按钮；录音只存在内存里': 'The microphone button in the mentor input; recordings stay in memory only',
'录音降噪（{0}）': 'Recording noise gate ({0})',
'越高越不怕环境噪声，也越容易漏掉轻声': 'Higher is sturdier against noise, but may drop soft speech',
'文字识别 (OCR)': 'Text recognition (OCR)',
'PDF 扫描件的文字层；每页结果落盘缓存': 'Text layer for scanned PDF pages; every page result is cached on disk',
'识别档位': 'Recognition mode',
'视觉模型（选填）': 'Vision model (optional)',
'云端文件 (Files API)': 'Cloud files (Files API)',
'可选能力': 'Optional capability',
'当前提供商未启用 Files API——可在提供商高级配置里打开。': 'The current provider has Files API disabled — enable it in the advanced settings of that provider.',
'配置 DeepSeek 提供商并启用 Files API 后，可以在这里管理云端文件（上传 / 列出 / 删除）。': 'Once a DeepSeek provider is configured with Files API enabled, you can manage cloud files here (upload / list / delete).',
'上传到 DeepSeek 云端的文件（user_data）': 'Files uploaded to DeepSeek cloud (user_data)',
'上传': 'Upload',
'刷新': 'Refresh',
'已上传：{0}': 'Uploaded: {0}',
'已删除：{0}': 'Deleted: {0}',
'删除云端文件': 'Delete cloud file',
'点「刷新」拉取云端文件列表。': 'Click Refresh to fetch the cloud file list.',
'云端还没有文件。': 'No files in the cloud yet.',
'上传失败': 'Upload failed',
'约 1.5 元/千页': 'about ¥1.5 per 1,000 pages',
'服务端工具': 'Server-side tools',
'由 DeepSeek 服务端执行的联网能力：搜索与抓取按次另计费，结果自动附带引用。仅 deepseek-flash 模型支持。': 'Web capabilities executed on the DeepSeek servers: search and fetch are billed per call, answers cite sources. Supported by the deepseek-flash model only.',
'联网搜索': 'Web search',
'模型需要最新信息时自动搜索；与智能导师的工具循环互斥（工具轮不注入），纯聊天可用': 'The model searches when it needs fresh info; mutually exclusive with the mentor tool loop (skipped on tool turns) - plain chat only',
'阅读链接': 'Read links',
'消息里的 URL 由服务端抓取正文后再作答（deepseek_read_url）': 'URLs in the message are fetched by the server before answering (deepseek_read_url)',
'Files API（云端文件）': 'Files API (cloud files)',
'并非所有提供商都提供云端文件能力。开启后可在「设置 → 模型 → 能力接入」里管理云端文件；不需要时保持关闭。': 'Not every provider offers cloud files. When enabled, cloud files are managed under Settings → Model → Capabilities; keep it off otherwise.',
'启用 Files API': 'Enable Files API',
'上传 / 列出 / 删除提供商侧的文件（DeepSeek：/files 端点，默认开箱即用）': 'Upload / list / delete files on the provider side (DeepSeek /files endpoint; works out of the box)',
'语音识别未接入：到「设置 → 模型 → 能力接入」里启用': 'Speech recognition is not set up: enable it under Settings → Model → Capabilities',
'语音识别未接入：到「设置 → 模型 → 能力接入」里启用（DeepSeek 或本地服务）': 'Speech recognition is not set up: enable it under Settings → Model → Capabilities (DeepSeek or a local service)',
'当前未接入 OCR 文字识别，扫描件页面文字暂无法直接框选与复制。可在「设置 → 模型 → 能力接入」中启用（DeepSeek 或本地服务）。': 'OCR is not set up, so text on scanned pages cannot be selected or copied yet. Enable it under Settings → Model → Capabilities (DeepSeek or a local service).',
'模型能力 (DeepSeek / 本地服务)': 'Model capabilities (DeepSeek / local service)',
'由「设置 → 模型 → 能力接入」决定：DeepSeek 官方音色或本地 OpenAI 兼容服务，结果本地缓存。': 'Decided by Settings → Model → Capabilities: official DeepSeek voices or a local OpenAI-compatible service; results are cached locally.',
'TTS 尚未接入：到「设置 → 模型 → 能力接入」选择 DeepSeek 或本地服务': 'TTS is not set up: pick DeepSeek or a local service under Settings → Model → Capabilities',
'本地音色 {0}': 'Local voice {0}',
'本地适配器默认音色': 'Local adapter default voice',
'管理 Markdown 语法增强与视频来源插件。': 'Manage Markdown syntax extensions and video-source plugins.',
'用户放置在数据目录下的本地插件具备与应用同等的运行权限（可读取笔记内容与访问本地磁盘）。请仅安装来源可靠、内容清晰的脚本插件。（语音与识别类能力已迁至「设置 → 模型 → 能力接入」，不再作为插件提供。）': 'Local plugins placed in the data folder run with the same rights as the app (they can read your notes and reach the disk). Only install scripts you can read and trust. (Speech and recognition capabilities have moved to Settings → Model → Capabilities and are no longer plugins.)',

/* ---------- PDF 浏览界面的右键菜单（learn/pdf/PdfContextMenu） ---------- */
'清除本文档 OCR 缓存': 'Clear the OCR cache of this document',
'查看本页 OCR 识别详情': 'Inspect OCR result of this page',
'OCR 识别详情 · 第 {0} 页': 'OCR details - page {0}',
'读取中…（缓存没有这一页时会当场识别一次）': 'Reading... (if this page is not cached it will be recognized now)',
'OCR（缓存命中）': 'OCR (cache hit)',
'OCR（本次现识）': 'OCR (recognized just now)',
'PDF 矢量文本（不经 OCR）': 'PDF vector text (no OCR involved)',
'本页没有任何文字层（快速识别档无坐标时不挂贴）': 'No text layer on this page (fast mode has no coordinates, so nothing is attached)',
'档位': 'Mode',
'未接入': 'not set up',
'{0} 行': '{0} lines',
'解析结果（挂贴用的就是这些行与坐标）': 'Parsed lines (exactly what the overlay uses)',
'文字': 'Text',
'宽': 'W',
'高': 'H',
'没有解析出任何行': 'No lines were parsed',
'识别服务原始返回（含标记原样）': 'Raw OCR response (markers as-is)',
'复制原始返回': 'Copy raw response',
'（无——矢量路径不经 OCR，或这一页没有识别结果）': '(none - vector path skips OCR, or this page has no OCR result)',
'接入 OCR': 'Set up OCR',
'快速识别（纯文字抽取，不可选区）': 'Fast (plain text, no selection layer)',
'版面识别（带定位坐标，可选区复制）': 'Layout-aware (positioned text, selectable & copyable)',
'系统自带': 'System built-in',
'Windows 内置 OCR，完全离线免费，词级定位': 'Windows built-in OCR - fully offline, free, word-level positioning',

/* ---------- 输入框上的麦克风按钮（agent/panel/MicButton） ---------- */
  '语音输入：点一下开始，边说边写进输入框':
    'Voice input: click to start — words land in the box as you speak',
  '完成（空格 / 回车）': 'Done (Space / Enter)',
  '正在录音（{0}）——按空格/回车或再点一下完成，Esc 丢弃剩余录音':
    'Recording ({0}) — press Space/Enter or click again to finish; Esc discards the rest',
  '空格结束': 'Space to stop',
  '空格': 'Space',

  /* ---------- lib/notice.ts：远程公告取不到时的说法（显示在公告弹窗里） ---------- */
  '公告功能需要在桌面应用里使用。': 'Announcements are only available in the desktop app.',
  '还没有配置公告地址（见 src/lib/noticeConfig.ts）。':
    'No announcement URL is configured yet (see src/lib/noticeConfig.ts).',
  '获取公告超时了。不影响使用，下次启动会自动再试。':
    'Timed out fetching the announcement. Nothing else is affected; it will retry on the next launch.',
  '没能获取公告：{0}': 'Could not fetch the announcement: {0}',
  '没能获取公告（网络或地址有问题）。': 'Could not fetch the announcement (network or URL problem).',
  '公告不是合法的 JSON，已忽略。': 'The announcement is not valid JSON and was ignored.',
  '公告缺少必需字段或字段类型不对，已忽略。':
    'The announcement is missing required fields or has the wrong types and was ignored.',

}

export default dict
