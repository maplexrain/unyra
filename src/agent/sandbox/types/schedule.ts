/**
 * 这个文件负责什么：沙箱类型契约的**schedule（日程）**组的宿主实现 ScheduleOps
 * （给用户排日程、改、删、标记完成，见 learn/schedule）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/**
 * schedule.*：日程安排（见 learn/schedule）。
 *
 * 时间用 `date`（YYYY-MM-DD）+ `time`（HH:mm）；`date` 省略=今天（时间已过则顺延到明天）。
 * 失败一律回 `{ error }`（与 memory / res 同一约定）。
 */
export interface ScheduleOps {
  /** 列日程：from / to / days 都可选，默认今天起 7 天 */
  list: (query?: Record<string, unknown>) => unknown
  /** 新建：{ title, date?, time, minutes?, remindBefore?, note? } */
  create: (payload: Record<string, unknown>) => unknown
  /** 修改：只改给了的字段；done 可标记完成 */
  update: (id: string, patch: Record<string, unknown>) => unknown
  /** 标记完成（用户确认过的落账） */
  complete: (id: string) => unknown
  /** 删除一条 */
  remove: (id: string) => unknown
}

