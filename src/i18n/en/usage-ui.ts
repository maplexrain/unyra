/**
 * 「用量统计」分片的英文字典（设置面板的用量页，见 settings/UsagePanel）。
 * 键 = 界面里的中文原文；已有分片认过的键（试卷 / 全部 / 其他…）不在这里重复。
 */

export default {
  /* ---------- 设置页签本体 ---------- */
  设置: 'Settings',
  用量统计: 'Usage',
  放弃改动: 'Discard changes',

  /* ---------- 用途 ---------- */
  导师对话: 'Tutor chat',
  专注守卫: 'Focus guard',
  会话标题: 'Conversation titles',
  注解释义: 'Annotations & glosses',
  连接测试: 'Connection tests',

  /* ---------- 过滤条 ---------- */
  今天: 'Today',
  '近 7 天': 'Last 7 days',
  '近 30 天': 'Last 30 days',
  全部提供商: 'All providers',
  全部模型: 'All models',
  全部用途: 'All purposes',
  清空记录: 'Clear records',
  再点一次确认清空: 'Click again to confirm',
  这个过滤条件下没有请求: 'No requests match these filters',

  /* ---------- 总量卡 ---------- */
  请求数: 'Requests',
  '{0} 条为估算': '{0} estimated',
  '总 token': 'Total tokens',
  输入: 'Input',
  输出: 'Output',
  缓存命中率: 'Cache hit rate',
  总耗时: 'Total time',
  '平均 {0}': 'avg. {0}',

  /* ---------- 图表 ---------- */
  每日用量: 'Daily usage',
  缓存命中: 'Cache hit',
  新算输入: 'Fresh input',
  '点按只看这个模型，再点一次取消': 'Click to show only this model; click again to clear',
  按模型: 'By model',
  按用途: 'By purpose',

  /* ---------- 模型明细表 ---------- */
  模型明细: 'Model breakdown',
  模型: 'Model',
  总计: 'Total',
  命中率: 'Hit rate',
  平均耗时: 'Avg. time',

  /* ---------- 最近请求 ---------- */
  最近请求: 'Recent requests',
  '（最多 {0} 条，新的在前）': '(up to {0}, newest first)',
  时间: 'Time',
  用途: 'Purpose',
  耗时: 'Time',
  '≈ 表示该条的 token 数是本地估算（服务端没回报用量）。': '≈ marks locally estimated tokens (the server did not report usage).',

  /* ---------- 空态 ---------- */
  还没有用量记录: 'No usage recorded yet',
  '从这一版开始，每次 AI 请求的 token 数、缓存命中率与耗时都会记在这里（跟着当前用户走）。':
    'From this version on, every AI request logs its tokens, cache hit rate and duration here (tracked per user).',
} as Record<string, string>
