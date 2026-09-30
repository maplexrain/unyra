/**
 * 学习数据持久化的对外入口（barrel）：实现按职责拆在 learn/store/ 下，
 * 这里只把原来的导出原样转出去，调用方的 import 一行都不用改。
 *
 * - store/normalize/  反序列化：磁盘或导入文件 → LearnStore
 * - store/empty.ts    空库的形状
 * - store/factories   新建目标 / 会话、合并导入
 * - store/persist.ts  载入 / 保存 / 落盘（模块级缓存只在那里）
 * - store/session.ts  当前用户是谁（persist 与 assets 都要读，单独放以免成环）
 * - store/assets.ts   资源搬迁与资源路径
 */

export { emptyLearnStore } from './store/empty'
export { makeConversation, makeGoal, mergeLearnStore } from './store/factories'
export { normalizeLearnStore, parseLearnStore } from './store/normalize'
export { normalizeExam } from './store/normalize/exam'
export { normalizeTab } from './store/normalize/tabs'
export {
  flushLearnStore,
  hydrateLearnStore,
  loadLearnStore,
  rememberJournalEntry,
  saveLearnStore,
} from './store/persist'
export { nodeDocRel } from './store/assets'
