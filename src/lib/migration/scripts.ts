/**
 * 数据迁移脚本注册表。
 *
 * ## 序号制（不要再写版本号）
 *
 * 每个脚本只有 `step`（第几次迁移），没有 `fromVersion / toVersion`。
 * 加一次迁移就往后接一个序号；**发版不涨序号**，序号只跟着"数据形状改了几回"走。
 *
 * ## 上线前怎么合并迁移
 *
 * 开发期常常连着改几回数据形状（第 4、5、6 次），但都还没发出去。发版前把它们合成一次：
 *
 * 1. 只合并 `step > RELEASED_SCHEMA_STEP` 的脚本——发出去过的不能动，用户数据里已经有记录；
 * 2. 把它们的 `migrate` 逻辑按顺序合成一个函数，**保留最小的那个序号**（4），其余删掉；
 * 3. `LATEST_SCHEMA_STEP` 是从这张表算出来的，删完自动跟着降，不用手改常量；
 * 4. 发版之后，把 `RELEASED_SCHEMA_STEP` 改成当时的最新序号，把这一批"冻结"。
 *
 * 合并前后的判据只有一条：**这批脚本有没有随公开版本发出去过**。
 * 只要没发出去，怎么合都安全（没有用户数据跑过它们）。
 *
 * ## 加一个迁移
 *
 * 1. 在 `MIGRATION_SCRIPTS` 里追加一个脚本，`step = LATEST_SCHEMA_STEP + 1`；
 * 2. 脚本自己保证幂等（重跑不冲掉用户摆好的东西）；
 * 3. 补一条测试（见 `tests/migration.test.ts` 的"序号"一节）。
 */

import type { MigrationScript } from './types'
import { outlineToStructure, structureTopology } from './outlineStructure'
import { nodeFiles } from './v3Nodes'
import { flattenGoalNodes } from './flattenGoalNodes'

/**
 * 迁移脚本清单。
 *
 * 顺序即执行顺序，但**排序以 `step` 为准**（下面会排一次），列表顺序只是给人看的。
 */
export const MIGRATION_SCRIPTS: MigrationScript[] = [
  outlineToStructure,
  structureTopology,
  nodeFiles,
  flattenGoalNodes,
].sort((a, b) => a.step - b.step)

/**
 * 当前最新的迁移序号 = 清单里最大的那个。
 *
 * **故意算出来而不是手写常量**：手写的常量总有一天会忘记改，而算出来的不会。
 * `LATEST_SCHEMA_STEP` 是启动那一刻的快照（界面显示用）；运行期动态注册脚本之后
 * 要用 `latestStep()` 重新算，`planChain` 的默认目标就是它。
 */
export function latestStep(): number {
  return MIGRATION_SCRIPTS.reduce((max, s) => Math.max(max, s.step), 0)
}

export const LATEST_SCHEMA_STEP: number = latestStep()

/**
 * 已经随**公开版本**发出去的最后一个序号。
 *
 * `step <= 这个值` 的脚本不能再改、不能合并——用户数据里已经有它的执行记录。
 * 每次发版后把它更新成当时的最新序号即可。
 */
export const RELEASED_SCHEMA_STEP = 2

/** 供外部或插件动态注册迁移脚本（序号重复会被拒绝，否则执行顺序没有意义） */
export function registerMigrationScript(script: MigrationScript): void {
  if (MIGRATION_SCRIPTS.some((s) => s.step === script.step || s.id === script.id)) return
  MIGRATION_SCRIPTS.push(script)
  MIGRATION_SCRIPTS.sort((a, b) => a.step - b.step)
}
