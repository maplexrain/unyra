/**
 * 英文字典：主进程的用户可见文案（应用菜单、托盘、原生对话框、错误弹回渲染层的 error 串）。
 *
 * 键是「中文原文」——与源码里写的字符串逐字相同（含全角标点），渲染层（src/i18n/en）
 * 是同一方案的另一份字典，两份各自独立：主进程与渲染层负责的文案不重叠。
 * 一条一行；键含任何非纯汉字字符一律加引号；值里不出现中文（品牌词用 Unyra）。
 *
 * 注意：模块顶层的中文常量（如 voice.ts 的 MODEL_SOURCES.name）不在这里翻译，
 * 在使用处再包 t()——顶层求值一次会把语言冻结进去。
 */
const dict: Record<string, string> = {
  /* ---------- app/icon.ts：应用菜单 ---------- */
  '编辑': 'Edit',
  '撤销': 'Undo',
  '重做': 'Redo',
  '剪切': 'Cut',
  '复制': 'Copy',
  '粘贴': 'Paste',
  '全选': 'Select All',
  '视图': 'View',
  '重新加载': 'Reload',
  '强制重新加载': 'Force reload',
  '开发者工具': 'Developer tools',
  '实际大小': 'Actual size',
  '放大': 'Zoom in',
  '缩小': 'Zoom out',
  '全屏': 'Full screen',

  /* ---------- app/tray.ts：托盘菜单与气泡 ---------- */
  '显示主窗口': 'Show main window',
  '收进托盘': 'Hide to tray',
  '退出': 'Quit',
  '归一仍在后台运行': 'Unyra is still running in the background',
  '点托盘图标可以重新打开窗口；右键菜单里可以退出。': 'Click the tray icon to reopen the window; right-click it to quit.',

  /* ---------- app/examWindow.ts ---------- */
  '归一 Unyra · 考试': 'Unyra · Exam',
  '考试窗口打不开': "Couldn't open the exam window",

  /* ---------- app/ipc.ts：截图与导出 ---------- */
  '没有可用的窗口': 'No available window',
  '截出来是空的': 'The screenshot came out empty',
  '截图失败': 'Screenshot failed',
  '导出': 'Export',
  '全部文件': 'All files',
  '写入失败': 'Write failed',
  '没有可导出的内容': 'Nothing to export',
  '导出 PDF': 'Export PDF',
  'PDF 文档': 'PDF document',
  '导出 PDF 失败': 'PDF export failed',

  /* ---------- app/exportPdf.ts：保存对话框与 PDF 页脚 ---------- */
  '文件': 'File',
  '第 <span class="pageNumber"></span> / 共 <span class="totalPages"></span> 页': 'Page <span class="pageNumber"></span> of <span class="totalPages"></span>',

  /* ---------- plugins.ts ---------- */
  '插件文件名不合法': 'Invalid plugin file name',
  '这不是一个文件': 'Not a file',
  '插件文件不在了': 'The plugin file is gone',
  '插件标识不合法': 'Invalid plugin id',
  '插件目录建不出来：{0}': "Couldn't create the plugins directory: {0}",
  '插件目录读不出来：{0}': "Couldn't read the plugins directory: {0}",
  '插件文件太大了（{0} KB，上限 {1} KB）': 'The plugin file is too large ({0} KB; the limit is {1} KB)',
  '插件读不出来：{0}': "Couldn't read the plugin: {0}",

  /* ---------- proxy.ts：llm-proxy 协议的错误（弹回渲染层显示） ---------- */
  '请求地址不合法': 'Invalid request URL',
  '不支持的协议：{0}': 'Unsupported protocol: {0}',
  '(没写)': '(missing)',
  '代理目标不在白名单内：{0}。请在设置里保存一次该提供商的配置。': 'The proxy target is not on the allowlist: {0}. Save the provider settings once to allow it.',
  '转发到 {0} 失败：{1}': 'Forwarding to {0} failed: {1}',

  /* ---------- runner.ts：代码产物与联网出口 ---------- */
  '键不合法': 'Invalid key',
  '无输出标记不合法（缺 code）': 'Invalid silent mark (missing code)',
  '产物键不合法': 'Invalid artifact key',
  '产物不合法（缺 js 或太大了）': 'Invalid artifact (missing js, or too large)',
  '只能访问 http/https 地址': 'Only http/https URLs are allowed',
  '不支持的方法：{0}': 'Unsupported method: {0}',
  '请求体太大了（上限 1MB）': 'The request body is too large (the limit is 1MB)',
  '请求失败：{0}': 'Request failed: {0}',
  '产物写不进去：{0}': "Couldn't write the artifact cache: {0}",

  /* ---------- web-core.ts / web.ts：抓网页 ---------- */
  '这个地址读不出来——要写成 https://example.com/page 这样的完整地址': "Couldn't parse this URL — use a complete address like https://example.com/page",
  '只支持 http / https 地址': 'Only http / https URLs are supported',
  '地址里没有主机名': 'The URL has no host name',
  '不能抓本机与内网地址（{0}）': "Local and private-network addresses can't be fetched ({0})",
  '这个地址回了 {0}（{1}）': 'The address returned {0} ({1})',
  '这不是能读的网页（{0}）：只读 HTML 与纯文本': "This isn't a readable web page ({0}): only HTML and plain text",
  '抓取超时（超过 {0} 秒）：这个站点太慢或连不上': 'Fetching timed out (over {0} s): the site is too slow or unreachable',
  '抓取失败：{0}': 'Fetching failed: {0}',

  /* ---------- storage/files.ts ---------- */
  '路径不合法': 'Invalid path',
  '不能移动数据根目录': "The data root directory can't be moved",
  '不能移动到数据根目录': "The destination can't be the data root directory",
  '目标目录不能在源目录之内': "The destination directory can't be inside the source directory",
  '目标已存在': 'The destination already exists',
  '不能删除数据根目录': "The data root directory can't be deleted",
  '同名文件或目录已存在': 'A file or directory with the same name already exists',
  '文件尚未写入磁盘': "The file hasn't been written to disk yet",
  'YAML 解析失败：{0}': "Couldn't parse the YAML: {0}",
  'YAML 序列化失败：{0}': "Couldn't serialize the YAML: {0}",

  /* ---------- storage/local.ts ---------- */
  '这个文件类型不能在这里打开（只支持 md / txt / html）': "This file type can't be opened here (only md / txt / html)",
  '这个文件类型不能在这里编辑（文本类：md / txt / 代码等；媒体文件会自动进预览）': "This file type can't be edited here (text files like md / txt / code; media files open in preview automatically)",
  '这个文件类型不能在这里预览': "This file type can't be previewed here",
  '文件太大（超过 200MB），用系统播放器打开吧': 'The file is too large (over 200 MB); open it with your system player instead',
  '文件不在了（可能已被移动或删除）': 'The file is gone (it may have been moved or deleted)',
  '读取失败': 'Failed to read',
  '这个文件类型不能在这里保存': "This file type can't be saved here",
  '保存失败（文件可能被占用或没有写权限）': 'Save failed (the file may be locked, or you lack write permission)',
  '路径不对': 'Invalid path',
  '打开本地文件': 'Open local file',
  '文本文件': 'Text files',

  /* ---------- storage/attach.ts ---------- */
  '路径无效': 'Invalid path',
  '文件超过 32MB，压小一点再发': 'The file is over 32MB; make it smaller before sending',
  '选择要发给超级导师的文件': 'Choose files to send to Super Tutor',

  /* ---------- storage/binary.ts ---------- */
  '只允许写入图片文件': 'Only image files can be written here',
  '图片内容不合法': 'Invalid image data',
  '图片内容不是 base64 data URL': 'The image data is not a base64 data URL',
  '图片内容为空': 'The image data is empty',
  '图片超过 16MB': 'The image is over 16MB',
  '只允许读取图片文件': 'Only image files can be read here',
  '内容不合法': 'Invalid data',
  '内容不是 base64 data URL': 'The data is not a base64 data URL',
  '内容为空': 'The data is empty',
  '文件超过 32MB': 'The file is over 32MB',

  /* ---------- storage/settings.ts ---------- */
  '选择用户数据存储位置': 'Choose where to store your data',
  '目录不可写：{0}': "The directory isn't writable: {0}",
  '设置未能保存：{0}': "The settings couldn't be saved: {0}",

  /* ---------- voice.ts：语音模型（SenseVoiceSmall）与识别 ---------- */
  'HuggingFace 官方': 'HuggingFace (official)',
  'hf-mirror 镜像': 'hf-mirror (mirror)',
  '备用源': 'a fallback source',
  '已经在下一次了': 'A download is already in progress',
  '正在下载 {0}…': 'Downloading {0}…',
  '正在从{0}下载 {1}…': 'Downloading {1} from {0}…',
  '{0} 只下回来 {1} MB（应有 {2} MB），不像是完整文件': '{0} came down at only {1} MB (expected {2} MB) — that does not look like a complete file',
  '已取消': 'Canceled',
  '{0}：{1}': '{0}: {1}',
  '；': '; ',
  '每个下载源都不通——{0}。也可以在这台机器上用「用本机文件」挑一份下好的模型目录': 'None of the download sources worked — {0}. You can also point "Use a local file" at a model you already have on this machine.',
  '选择 SenseVoice 模型（model.int8.onnx）': 'Choose the SenseVoice model (model.int8.onnx)',
  'ONNX 模型': 'ONNX model',
  '这个文件只有 {0} MB，int8 的 SenseVoice 应该接近 {1} MB': 'This file is only {0} MB; the int8 SenseVoice model should be close to {1} MB',
  '同一个目录里没有找到 tokens.txt——两份文件要放在一起': 'No tokens.txt next to it — the two files have to sit in the same folder',
  '复制失败': 'Copy failed',
  '删除失败': 'Delete failed',
  '还没下载语音模型': 'The speech model has not been downloaded yet',
  '这段录音是空的': 'That recording is empty',
  '识别失败：{0}': 'Recognition failed: {0}',
}

export default dict
