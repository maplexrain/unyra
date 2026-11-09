/**
 * 视频学习（实验）的英文分片：键 = 界面里的中文原文（见 src/i18n 的中文键方案）。
 * 覆盖三处：页签组件（components/video）、页签名（learn/tabs）、
 * 转录校验与插件错误（src/video）。
 */
const dict: Record<string, string> = {
  /* ---------- 页签与入口 ---------- */
  '视频学习': 'Video study',
  '视频学习（实验）': 'Video study (experimental)',
  '实验': 'Exp',
  '实验功能：视频接入由来源插件提供，应用本身不做任何平台解析。':
    'Experimental: video access is provided by source plugins; the app itself never parses any platform.',
  '视频学习仅桌面端可用': 'Video study is desktop-only',
  '视频流由主进程的本地媒体通道转发（防盗链头 `<video>` 发不出来），浏览器模式里没有这条通道。':
    'The media stream is relayed by a local channel in the main process (the hotlink headers cannot be set by <video>); that channel does not exist in browser mode.',
  '还没有可解析的内容': 'Nothing to resolve yet',

  /* ---------- 解析工具条 ---------- */
  '粘贴 B 站视频链接或 BV 号，回车解析': 'Paste a Bilibili link or BV id, press Enter to resolve',
  '解析': 'Resolve',
  '正在解析…': 'Resolving…',
  '解析视频与字幕': 'Resolve video and subtitles',
  '在上面粘贴一个 B 站视频链接或 BV 号，解析后即可播放并按字幕时间戳跳转。':
    'Paste a Bilibili link or BV id above; after resolving you can play the video and jump by subtitle timestamps.',
  '这条来源没有可用的转录。': 'No transcript available for this source.',
  '新建视频': 'New video',
  '粘贴链接或输入编号，插件会认领它。视频创建后绑定插件与输入，打开页签即自动播放。':
    'Paste a link or type an id and a plugin will claim it. Once created, the video is bound to that plugin and input and plays as soon as you open it.',
  '链接或编号（例如 B 站链接 / BV 号）': 'Link or id (e.g. a Bilibili link / BV id)',
  '创建': 'Create',
  '没有插件认领这段输入。已安装：{0}': 'No plugin claims this input. Installed: {0}',
  '还没有安装任何视频来源插件：到「设置 → 插件 → 视频 / 音频来源」安装并启用。':
    'No video source plugins installed yet — install and enable one under Settings → Plugins → Video / audio sources.',
  '上面填的是这个视频专属的数据；插件全局配置（如登录凭据）在「设置 → 插件」里。':
    'The fields above are specific to this video; plugin-wide settings (like credentials) live under Settings → Plugins.',
  '正在解析视频来源…': 'Resolving the video source…',
  '这个视频还没有解析出来：检查插件是否已启用、凭据是否配好，然后重新打开本页签。':
    'This video has not resolved yet: check that the plugin is enabled and its credentials are set, then reopen this tab.',
  '视频已删除': 'Video deleted',
  '这个页签绑定的视频资源已经不在了（可能被删除）：关掉页签即可。':
    'The video this tab was bound to no longer exists (it may have been deleted). Close the tab.',

  /* ---------- 登录设置（SESSDATA） ---------- */
  '登录设置（SESSDATA，可选）': 'Login (SESSDATA, optional)',
  'B 站登录态（SESSDATA，可选）': 'Bilibili login (SESSDATA, optional)',
  'AI 字幕通常要登录后才拿得到。值只存本机（浏览器存储），随请求发给 B 站。':
    'AI subtitles usually require login. The value stays on this machine (browser storage) and is sent to Bilibili with requests.',
  '这条来源没有字幕：AI 字幕通常需要登录——点右上角齿轮填入 SESSDATA 后重试。':
    'No subtitles for this source: AI subtitles usually require login — open the gear in the top right, fill in SESSDATA and retry.',
  '字幕获取失败：{0}': 'Failed to fetch subtitles: {0}',
  '字幕时间轴到 {0}，视频只有 {1}——平台侧字幕错配，已拦截不显示':
    'Subtitles run to {0} but the video is only {1} — a platform-side subtitle mismatch; blocked from display',
  '获取：浏览器登录 B 站 → F12 → 应用（Application）→ Cookies → www.bilibili.com → 复制「SESSDATA」的值粘贴到这里。':
    'How to get it: log in to bilibili.com in your browser → F12 → Application → Cookies → www.bilibili.com → copy the value of "SESSDATA" and paste it here.',
  '只粘贴 Value 本身（带 SESSDATA= 前缀也能存，会自动剥掉）':
    'Paste the value only (a "SESSDATA=" prefix is stripped automatically)',
  '已保存': 'Saved',

  /* ---------- 播放器 UI 控件与外挂字幕 ---------- */
  '播放倍速：{0}x': 'Playback rate: {0}x',
  '已静音': 'Muted',
  '已取消静音': 'Unmuted',
  '静音': 'Mute',
  '取消静音': 'Unmute',
  '画面已开启水平镜像': 'Horizontal mirror enabled',
  '画面已恢复正常': 'Normal display restored',
  '视频尚未就绪，无法截图': 'Video not ready for screenshot',
  '截图已保存并复制到剪贴板': 'Screenshot saved and copied to clipboard',
  '截图失败：{0}': 'Screenshot failed: {0}',
  '未从文件中解析出有效字幕': 'No valid subtitles parsed from file',
  '成功载入外挂字幕：共 {0} 条': 'Loaded external subtitles: {0} cues in total',
  '读取字幕文件失败': 'Failed to read subtitle file',
  '快退 5 秒': 'Rewind 5s',
  '快进 5 秒': 'Fast forward 5s',
  '暂停 (空格)': 'Pause (Space)',
  '播放 (空格)': 'Play (Space)',
  '取消静音 (M)': 'Unmute (M)',
  '静音 (M)': 'Mute (M)',
  '音量 {0}%': 'Volume {0}%',
  '字幕设置': 'Subtitle settings',
  '字幕开': 'CC On',
  '字幕轨道': 'Subtitle tracks',
  '关闭字幕': 'Turn off subtitles',
  '内置/转录字幕': 'Built-in / Transcript subtitles',
  '外挂：{0}': 'External: {0}',
  '自定义字幕': 'Custom subtitles',
  '导入外挂字幕 (.srt/.vtt)': 'Import external subtitles (.srt/.vtt)',
  '时间轴微调': 'Offset adjustment',
  '字幕字号': 'Subtitle size',
  '字幕大小：{0}x': 'Subtitle size: {0}x',
  '小': 'Small',
  '标准': 'Medium',
  '大': 'Large',
  '特大': 'Extra large',
  '复位': 'Reset',
  '倍速调节': 'Playback rate',
  '倍速': 'Speed',
  '播放倍速': 'Speed',
  '正常': 'Normal',
  '截图 (保存当前帧并复制到剪贴板)': 'Screenshot (save frame & copy to clipboard)',
  '水平镜像翻转': 'Flip horizontally',
  '关闭镜像翻转': 'Disable mirror',
  '退出全屏 (F)': 'Exit fullscreen (F)',
  '全屏 (F)': 'Fullscreen (F)',

  /* ---------- 视频总结（AI 一次性补全：总结+分段一个动作，见 learn/video/summarize） ---------- */
  '总结': 'Recap',
  '视频分段': 'Chapters',
  '重新分段': 'Re-segment',
  '重新生成 AI 视频分段': 'Regenerate AI video chapters',
  '生成中…': 'Generating…',
  '正在生成视频语义分段…': 'Generating semantic video chapters…',
  '暂无可用字幕，无法分段': 'No subtitles available for segmentation',
  '字幕共 {0} 字符（超出 50,000 字符限制）': 'Transcript has {0} characters (exceeds 50,000 character limit)',
  '为避免超出上下文窗口，长视频需手动生成': 'Manual generation required for long videos to prevent exceeding context window',
  '手动生成分段': 'Manually generate chapters',
  '播放视频时将自动生成分段': 'Chapters will be generated automatically during playback',
  '立即生成分段': 'Generate chapters now',
  '正在总结…': 'Summarizing…',
  '还没有总结：按字幕让 AI 生成内容总结与语义分段，分段点会钉在进度条上（生成后不再重复）':
    'No recap yet: let the AI generate a content recap and chapters from the subtitles — chapter dots pin onto the progress bar (generated once, never repeated)',
  '生成总结': 'Generate recap',
  '这条来源没有可用字幕，无法总结': 'No usable subtitles for this source — cannot summarize',
  '分段会与总结一并生成': 'Chapters are generated together with the recap',
  '总结文本缺失（数据不完整）': 'Recap text missing (incomplete data)',
  '自动总结已开启：打开视频时自动生成内容总结与分段（点一下关闭）':
    'Auto-recap is on: recap + chapters are generated whenever you open a video (click to turn off)',
  '自动总结已关闭：打开视频时自动生成内容总结与分段（点一下开启）':
    'Auto-recap is off: turn it on to generate recap + chapters whenever you open a video',
  '已生成总结与分段：{0} 段，分段点在进度条上': 'Recap and chapters generated: {0} parts, shown as dots on the progress bar',
  '已生成总结': 'Recap generated',
  '这份转录是空的，没有可总结的内容': 'The transcript is empty — nothing to summarize',

  /* ---------- 转录段面板 ---------- */
  '字幕': 'Subtitles',
  '语音识别': 'Speech-to-text',
  'AI 中文字幕': 'AI Chinese',
  '中文字幕': 'Chinese CC',
  '合集': 'Collection',
  '选集': 'Pages',
  '收起合集列表': 'Collapse list',
  '展开合集列表': 'Expand list',
  '导出选集字幕': 'Export page subtitles',
  '导出选集字幕（全部分 P 的转录合并为一个 Markdown）':
    'Export page subtitles (merge every part’s transcript into one Markdown)',
  '导出中 {0}/{1}': 'Exporting {0}/{1}',
  '导出失败': 'Export failed',
  '{0} 个视频': '{0} videos',
  '{0} 个选集': '{0} pages',
  '导出于 {0}': 'exported on {0}',
  '字幕缺失：{0}': 'Subtitles missing: {0}',

  /* ---------- 转录校验（src/video/transcript） ---------- */
  '转录稿不是合法对象': 'Transcript is not a valid object',
  '转录稿版本不支持：{0}': 'Unsupported transcript version: {0}',
  '转录稿来源未知：{0}': 'Unknown transcript origin: {0}',
  '转录稿缺少段列表': 'Transcript has no segment list',
  '第 {0} 条转录段不是合法对象': 'Segment {0} is not a valid object',
  '第 {0} 条转录段时间倒挂：{1} → {2}': 'Segment {0} has inverted times: {1} → {2}',
  '第 {0} 条转录段带着标签或换行：插件必须交纯文本': 'Segment {0} contains tags or line breaks: plugins must submit plain text',
  '转录段互相重叠（{0} 与 {1}）：插件必须自己合并或选主语言':
    'Segments overlap ({0} and {1}): the plugin must merge them or pick a primary language',
  '转录段时间不是合法毫秒数：{0}': 'Segment time is not a valid millisecond value: {0}',

  /* ---------- B 站插件与注册表（src/video） ---------- */
  '没有插件支持这个输入：{0}': 'No plugin handles this input: {0}',
  '这个来源没有可播放的流': 'This source has no playable stream',
  '这条来源没有可用字幕': 'This source has no usable subtitles',
  '粘贴视频链接或编号，回车解析（支持哪些来源取决于已安装的插件）':
    'Paste a video link or id and press Enter (supported sources depend on installed plugins)',
  '这条来源没有字幕：需要登录的平台，请到「设置 → 插件」的插件配置里填好凭据后重试。':
    'No subtitles for this source: for platforms that require login, fill in the credentials under Settings → Plugins and retry.',
  '在上面粘贴一个视频链接或编号，解析后即可播放并按字幕时间戳跳转。':
    'Paste a video link or id above; after resolving you can play it and jump by subtitle timestamps.',
  '来源由插件提供：到「设置 → 插件 → 视频 / 音频来源」查看已安装的插件，需要的凭据也在那里配置。':
    'Sources come from plugins: see Settings → Plugins → Video / audio sources for installed plugins and their credentials.',
  '这个页签没有可保存的内容': 'This tab has nothing to save',
  '本地文件流还没有接进播放通道': 'Local file streams are not wired into the player yet',
  '{0} 回的不是 JSON（status {1}）': '{0} did not return JSON (status {1})',
  '{0}：{1}': '{0}: {1}',
  '接口未说明原因': 'the API gave no reason',
  'B 站插件认不出这个输入': 'The Bilibili plugin cannot parse this input',
  '视频信息里没有分 P（cid）': 'No page (cid) in the video info',
  '播放接口没有给出可用流': 'The play API returned no usable stream',
  '这个视频返回了 {0} 段流，实验通道暂不支持': 'This video returned {0} stream parts; the experimental channel does not support that yet',

  /* ---------- 侧栏视频区（删除守卫） ---------- */
  '这个视频正被「{0}」绑着：先解绑（画布上的视频卡）再删':
    'This video is bound to "{0}": unbind it first (the video card on the canvas), then delete',
  '这个视频正被 {0} 等 {1} 个目标绑着：先解绑（画布上的视频卡）再删':
    'This video is bound to {1} goals ({0} and more): unbind first (the video cards on the canvas), then delete',
}

export default dict
