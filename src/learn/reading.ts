/**
 * 文档有效阅读记录（reading）：学习计划 / 注意力评级 / 打卡共用的那一层事实底座。
 *
 * 三条设计红线（改这个文件之前先读一遍）：
 *
 * 1. **只记事实，判断另算**。这里存的是会话、区间、分钟桶、中断、交互印记；
 *    注意力评级（learn/attention）与打卡判定（learn/checkin）都是纯函数派生。
 *    评级公式一定会改，改公式不该动数据——所以分数、档位、结论一个字都不许写进来。
 *
 * 2. **粒度到会话与分钟**。注意力是时间序列不是标量：番茄钟要知道「第几分钟开始散」，
 *    教学策略要知道「他能连续专注多久」。只存一个累计时长满足不了任何一个。
 *
 * 3. **按学习日聚合，而且是跨节点的**。打卡问的是「今天读了什么」（可能横跨好几个节点），
 *    而 23:40 学的那半小时不该被劈到两天——所以日界可配（默认 04:00），日索引在顶层。
 *
 * 汇总方式：**写入时聚合**。明细日志（sessions）只是给注意力回放用的，有上限、会被滚掉；
 * 节点与学习日的汇总单调累加，明细滚掉也不丢总量。这样 state.json 不会随使用无限长大。
 *
 * 锚为什么是「节」而不是行号：文档是 agent 反复改写的（逐字写、用户让改），
 * 行号与字符偏移第二天就失效。标题是文档里最稳的东西，一份文档 5~15 个，
 * 粒度刚好够计划说「第 3 节还没读」。
 */

/**
 * 本文件是 barrel：实现按职责拆在 learn/reading/ 下，这里只把原来的导出原样转出去，
 * 调用方的 import 一行都不用改。
 *
 * - reading/constants.ts  口径常量（停表 / 心跳 / 结算 / 日界 / 门槛 / 上限）
 * - reading/types.ts      落盘的四种形状与一次结算的增量
 * - reading/anchor.ts     锚与学习日（标题归一化、节认领）
 * - reading/aggregate.ts  写入侧：结算、折账、清理、搬迁与两道门槛
 * - reading/query.ts      读取侧：派生视图
 * - reading/normalize.ts  落盘数据的校验
 */

export {
  BEAT_MS,
  DAY_START_HOUR,
  DOC_DONE_MS,
  DOC_DONE_REACH,
  IDLE_MS,
  MAX_DAYS,
  MAX_SESSIONS_PER_NODE,
  MAX_SESSIONS_TOTAL,
  RESUME_GRACE_MS,
  SECTION_REACHED,
  SETTLE_MS,
  WARMUP_MS,
} from './reading/constants'
export type {
  BreakKind,
  DaySummary,
  DocReading,
  MarkKind,
  MinuteTick,
  NodeReading,
  ReadingBook,
  ReadingBreak,
  ReadingDelta,
  ReadingSession,
  ReadingStore,
  SectionRead,
} from './reading/types'
export {
  dayStartOf,
  looseSectionKey,
  matchSections,
  readingDocKey,
  sectionKey,
  seedSections,
  studyDayOf,
} from './reading/anchor'
export {
  applyReadingDelta,
  compactReading,
  emptyReading,
  moveDocReading,
  pruneDocReading,
  pruneReading,
  readToday,
  readingOfGoal,
  warmupDone,
  withGoalReading,
} from './reading/aggregate'
export {
  docReadingOf,
  lastBrowseAtOf,
  readingDay,
  readingIndex,
  readingLine,
  readingOf,
  readingSince,
  recentDays,
  sessionsOf,
} from './reading/query'
export type { ReadingRow } from './reading/query'
export { normalizeReading, normalizeReadingBook } from './reading/normalize'
