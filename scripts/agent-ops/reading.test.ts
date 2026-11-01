/**
 * 探针分组：跟随滚动（原文件第 5 节）。
 *
 * scrollTests：跟随最新 / 脱离自动滚动的折算与两个阈值（错了就是「读着读着被拽回底部」）。
 *
 * 共享 fixture（ok / NOW / baseStore / childId / rootId / harness）见 ./harness。
 */
import type { Exam } from '../../src/learn/exam'
import { buildDocs, parseDocs } from '../../src/learn/files'
import {
  clampMastery,
  learningLine,
  normalizeLearning,
  parseCheck,
  selfReportOf,
  withMistake,
  withVisit,
} from '../../src/learn/learning'
import {
  abandonAttempt,
  addCheck,
  applyExplanation,
  applyGradeResult,
  knowledgeDepth,
  noteMistake,
  startAttempt,
  submitAttempt,
  updateLearning,
  upsertExam,
} from '../../src/learn/graph'
import { recordInput } from '../../src/learn/examRecords'
import { MAX_CHECKS, MAX_MISTAKES } from '../../src/learn/types'
import { bottomGap, isAtBottom, isUserScrollUp, shouldDetachByWheel, wheelPixels } from '../../src/lib/scrollFollow'
import { NOW, baseStore, childId, goalId, harness, ok, rootId } from './harness'

/**
 * 5. 跟随最新 / 脱离自动滚动的判据。
 *
 * 这些阈值与折算靠肉眼审不出来（一个数字写错就是「读着读着被拽回底部」或「怎么滚都不脱离」），
 * 而它们又和模型输出速度纠缠在一起，很难手动复现，所以把边界一条条钉住。
 */
export function scrollTests() {
  // deltaMode 折算：像素原样、行按 16px、页按一屏高
  ok(wheelPixels({ deltaY: 100, deltaMode: 0 }, 800) === 100, '像素模式原样')
  ok(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800) === 48, '行模式按 16px 折算')
  ok(wheelPixels({ deltaY: 1, deltaMode: 2 }, 800) === 800, '页模式按一屏高折算')

  // 累计与时间窗
  const t0 = 1_000_000
  const latch = { last: 0, up: 0 }
  ok(!shouldDetachByWheel(latch, { deltaY: -100, deltaMode: 0 }, t0, 800), '一格滚轮（100px）还不脱离')
  ok(shouldDetachByWheel(latch, { deltaY: -100, deltaMode: 0 }, t0 + 50, 800), '窗口内累计到 200px → 脱离')
  const latch2 = { last: 0, up: 0 }
  ok(!shouldDetachByWheel(latch2, { deltaY: -130, deltaMode: 0 }, t0, 800), '130px 差一点点，不脱离')
  ok(shouldDetachByWheel(latch2, { deltaY: -20, deltaMode: 0 }, t0 + 30, 800), '再过 20px 就跨过阈值')
  const latch3 = { last: 0, up: 0 }
  shouldDetachByWheel(latch3, { deltaY: -120, deltaMode: 0 }, t0, 800)
  ok(!shouldDetachByWheel(latch3, { deltaY: -120, deltaMode: 0 }, t0 + 2000, 800), '隔了 2 秒：窗口重置，重新累计')
  const latch4 = { last: 0, up: 0 }
  shouldDetachByWheel(latch4, { deltaY: -120, deltaMode: 0 }, t0, 800)
  ok(!shouldDetachByWheel(latch4, { deltaY: 60, deltaMode: 0 }, t0 + 30, 800), '中间往下滚过：不脱离')
  ok(latch4.up === 0, '往下滚会把累计清零', latch4.up)

  // 离底部的距离与「是否已回到最新」
  ok(bottomGap({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }) === 100, 'bottomGap 正常值')
  ok(bottomGap({ scrollHeight: 1000, scrollTop: 700, clientHeight: 400 }) === 0, '回弹给的负值按 0 算')
  ok(isAtBottom(0) && isAtBottom(32) && !isAtBottom(33), 'isAtBottom 的边界就是 REPIN_PX')

  // 谁把位置往上挪的
  ok(isUserScrollUp(400, 500, 5000), '往上走且不是刚滚过滚轮 → 是用户干的')
  ok(!isUserScrollUp(400, 500, 10), '刚滚过滚轮：留给滚轮那套累计判据')
  ok(!isUserScrollUp(500, 400, 5000), '往下走不算')
  ok(!isUserScrollUp(500, 501, 5000), '1px 的抖动不算')
}
