/**
 * 链式数据迁移系统契约定义。
 *
 * ## 为什么用「序号」而不是「版本号」
 *
 * 早先每个迁移脚本写的是 `fromVersion → toVersion`，于是**每加一次迁移就得涨一次版本号**
 * ——数据格式改三回，发版号就被推到 0.8、0.9，而线上其实才 0.6.7。版本号一旦被迁移绑架，
 * 就再也没法用它表达「这次发版改了什么」，而且发版前想合并几次迁移还得重排版本区间。
 *
 * 现在改成**纯序号**：
 * - `step` 从 1 起、单调递增，只表示「第几次迁移」，与发版号完全解耦；
 * - 数据里记的是 `schemaStep`（已应用到第几次），不是版本字符串；
 * - 上线前要合并几次迁移，只要把 `step > RELEASED_SCHEMA_STEP` 的脚本合成一个、
 *   保留最小的那个序号即可（规则见 `scripts.ts` 顶部）。
 *
 * 版本号从此只属于「应用发版」，数据只认序号。
 *
 * ## 三条不变量
 *
 * 1. **序号唯一且递增**：同一序号只能有一个脚本，执行顺序就是序号顺序。
 * 2. **已发布的脚本不许改**：用户数据里已经有它的执行记录，改了就是两套行为。
 * 3. **每个脚本自己保证幂等**：重跑一次不该把用户摆好的东西冲掉。
 */

import type { StorageEntry } from '../native'

export interface MigrationContext {
  uid: string
  userDir: string
  storage: {
    readJson: <T>(rel: string) => Promise<T | null>
    writeJson: (rel: string, data: unknown) => Promise<boolean>
    readYaml: <T>(rel: string) => Promise<T | null>
    writeYaml: (rel: string, data: unknown) => Promise<boolean>
    readText: (rel: string) => Promise<string | null>
    writeText: (rel: string, content: string) => Promise<boolean>
    listDir: (rel: string) => Promise<StorageEntry[]>
    removePath: (rel: string) => Promise<boolean>
    mkdir: (rel: string) => Promise<boolean>
    movePath?: (from: string, to: string) => Promise<boolean>
  }
  log: (msg: string) => void
}

export interface MigrationStepResult {
  ok: boolean
  /** 这一步的序号（与 `MigrationScript.step` 一致） */
  step: number
  modifiedFiles: string[]
  details?: string
  error?: string
}

export interface MigrationScript {
  /**
   * 序号：从 1 起、单调递增，决定执行顺序。
   *
   * **它不跟发版号走**：加一次迁移才 +1，发版不涨。上线前合并迁移时保留最小的那个序号。
   */
  step: number
  /** 稳定标识：只用于历史记录与日志，不再编码版本区间 */
  id: string
  title: string
  summary: string
  changes: string[]
  /** 迁移执行逻辑 */
  migrate: (ctx: MigrationContext) => Promise<MigrationStepResult>
}

export interface MigrationHistoryItem {
  /** 新记录一定有序号；0.7.1 及更早写的旧记录没有，只有下面的 fromVersion/toVersion */
  step?: number
  scriptId: string
  /** 旧字段，只为把老历史记录读出来显示 */
  fromVersion?: string
  toVersion?: string
  migratedAt: number
  success: boolean
  modifiedFiles: string[]
  details?: string
  error?: string
}

export interface SchemaMeta {
  /** 已应用到第几次迁移；0 = 一次都没跑过 */
  schemaStep: number
  updatedAt: number
  /** 是否开启应用启动时自动检测并执行数据迁移（默认开启） */
  autoMigrate?: boolean
  history: MigrationHistoryItem[]
  /**
   * 旧字段：0.7.1 及更早写的是版本号。
   *
   * **只读**：用来把老数据折算成 `schemaStep`（见 `version.ts` 的 `stepOfLegacyVersion`），
   * 折算完就按新形状写回，不再产出这个字段。
   */
  schemaVersion?: string
}

export interface ChainPlan {
  currentStep: number
  targetStep: number
  scripts: MigrationScript[]
  isUpToDate: boolean
  /**
   * 数据序号比当前代码还新（`currentStep > targetStep`）。
   *
   * 两种来路：① 用户装回了旧版本应用；② 开发机上跑过某个还没发布的序号，
   * 之后在上线前把它合并进了前一次迁移。两种情况下都**不该静默当作"已是最新"**——
   * 数据形状可能是代码不认识的，得让人看见。
   */
  dataAhead: boolean
}
