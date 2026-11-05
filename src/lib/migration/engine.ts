/**
 * 链式数据迁移执行引擎。
 *
 * 负责：
 * 1. 按**序号**规划要跑哪几步（`step > 当前序号` 的全部，升序）；
 * 2. 构造隔离的迁移运行时上下文 (MigrationContext)；
 * 3. 逐步执行、写审计历史、推进 `schemaStep`。
 *
 * 与早先那版的差别只有一件事：规划不再是"在版本区间里找首尾相连的脚本"，
 * 而是"挑出序号比当前大的"。少了 fallback 分支，也再不会因为版本号没对齐而漏跑一步。
 */

import {
  listDir,
  mkdir,
  movePath,
  readJson,
  readText,
  readYaml,
  removePath,
  userRel,
  writeJson,
  writeText,
  writeYaml,
} from '../storage'
import { latestStep, MIGRATION_SCRIPTS } from './scripts'
import type {
  ChainPlan,
  MigrationContext,
  MigrationHistoryItem,
  MigrationScript,
  MigrationStepResult,
  SchemaMeta,
} from './types'
import { detectSchemaStep, saveSchemaMeta } from './version'

/**
 * 规划迁移链条：序号比 `fromStep` 大的脚本，按序号升序。
 *
 * **这里不需要知道用户装的是哪个应用版本**——只要知道"已经跑到第几步"，
 * 没跑过的那几步按序补上就行。版本号跨几代、中间跳过多少个版本，都不影响：
 * 脚本是线性的，1、2、3 依次执行即可。
 */
export function planChain(fromStep: number, toStep: number = latestStep()): ChainPlan {
  const scripts = MIGRATION_SCRIPTS.filter((s) => s.step > fromStep && s.step <= toStep).sort(
    (a, b) => a.step - b.step,
  )
  return {
    currentStep: fromStep,
    targetStep: toStep,
    scripts,
    isUpToDate: scripts.length === 0,
    dataAhead: fromStep > toStep,
  }
}

/** 构造迁移上下文 */
export function createMigrationContext(uid: string, onLog: (msg: string) => void): MigrationContext {
  return {
    uid,
    userDir: userRel(uid),
    storage: {
      readJson: (rel: string) => readJson(rel),
      writeJson: (rel: string, data: unknown) => writeJson(rel, data),
      readYaml: (rel: string) => readYaml(rel),
      writeYaml: (rel: string, data: unknown) => writeYaml(rel, data),
      readText: (rel: string) => readText(rel),
      writeText: (rel: string, content: string) => writeText(rel, content),
      listDir: (rel: string) => listDir(rel),
      removePath: (rel: string) => removePath(rel),
      mkdir: (rel: string) => mkdir(rel),
      movePath: (from: string, to: string) => movePath(from, to),
    },
    log: (msg: string) => {
      const time = new Date().toLocaleTimeString()
      onLog(`[${time}] ${msg}`)
    },
  }
}

/** 执行单个迁移脚本 */
export async function runSingleScript(
  uid: string,
  script: MigrationScript,
  onLog: (msg: string) => void,
): Promise<MigrationStepResult> {
  const ctx = createMigrationContext(uid, onLog)
  ctx.log(`========== 开始执行第 ${script.step} 次迁移：${script.title} (${script.id}) ==========`)

  try {
    const res = await script.migrate(ctx)
    if (!res.ok) {
      ctx.log(`[错误] 第 ${script.step} 次迁移失败：${res.error || '未知原因'}`)
      return res
    }

    const { step: prevStep, meta: prevMeta } = await detectSchemaStep(uid)
    const historyItem: MigrationHistoryItem = {
      step: script.step,
      scriptId: script.id,
      migratedAt: Date.now(),
      success: true,
      modifiedFiles: res.modifiedFiles,
      details: res.details,
    }

    /**
     * 序号只进不退：单步重跑一个更早的脚本（界面上有「重新执行」）不该把序号往回拨，
     * 否则下一次启动会把后面的脚本再跑一遍。
     */
    const nextMeta: SchemaMeta = {
      ...(prevMeta ?? {}),
      schemaStep: Math.max(prevStep, script.step),
      updatedAt: Date.now(),
      history: [...(prevMeta?.history ?? []), historyItem],
    }

    await saveSchemaMeta(uid, nextMeta)
    ctx.log(`[完成] 第 ${script.step} 次迁移成功，当前数据序号 = ${nextMeta.schemaStep}。`)
    return res
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    ctx.log(`[异常] 第 ${script.step} 次迁移发生未捕获异常：${errorMsg}`)
    return {
      ok: false,
      step: script.step,
      modifiedFiles: [],
      error: errorMsg,
    }
  }
}

/** 执行完整链式迁移流程 */
export async function runChain(
  uid: string,
  scripts: MigrationScript[],
  onProgress?: (current: number, total: number, script: MigrationScript) => void,
  onLog?: (msg: string) => void,
): Promise<{ ok: boolean; executed: MigrationStepResult[]; error?: string }> {
  const logger = onLog || (() => {})
  logger(`>>> 启动链式数据迁移任务，共 ${scripts.length} 个阶段`)
  const executed: MigrationStepResult[] = []

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]
    if (onProgress) onProgress(i + 1, scripts.length, script)

    const res = await runSingleScript(uid, script, logger)
    executed.push(res)

    if (!res.ok) {
      const err = `链式迁移在第 ${i + 1} 步（第 ${script.step} 次迁移 · ${script.title}）中断：${res.error}`
      logger(`[中断] ${err}`)
      return { ok: false, executed, error: err }
    }
  }

  logger(`>>> 链式数据迁移顺利完成，全部 ${scripts.length} 个阶段均已成功执行！`)
  return { ok: true, executed }
}
