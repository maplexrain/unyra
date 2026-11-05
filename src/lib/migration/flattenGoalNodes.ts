/**
 * 第 4 次迁移：**目标节点同级平铺存储（解耦拓扑层级）**。
 *
 * ## 为什么要把嵌套目录展平成同级目录
 *
 * 旧存储结构里，子节点的物理目录嵌套在父节点目录下（例如 docs/{目标}/{父节点}/{子节点}/...）。
 * 这种分层存储导致磁盘物理路径与拓扑连线强耦合：一旦拓扑图中解开父子关系、重新连线或挂到另一父级，
 * 物理磁盘路径深度随之改变甚至冲突。
 *
 * 新结构（平级存储）：
 * 目标下的所有非根节点全部平铺在目标目录下的一级子目录中（docs/{目标}/{节点}/）。
 * 拓扑图的父子连线随时解耦变更，节点物理目录永远不动。
 *
 * ## 搬法
 *
 * 1. 扫描 docs/ 下所有节点文件，若不存在深度 > 4 的旧嵌套节点（形如 docs/{目标}/{父级}/{子级}/...），说明已平铺，直接跳过。
 * 2. 复用 parseDocsV3（读盘天然向下兼容多层路径）读取为完整内存 store。
 * 3. 用新平级 nodeLayout 配合 buildDocs 生成目标状态 desired。
 * 4. 对于物理路径发生变化的深层节点（如 oldDir !== newDir）：
 *    若存在 workspace/ 目录，安全迁移其工作区文件到新目录的 workspace/ 下。
 * 5. 覆盖写出所有新平级文件，并清理已被展平废弃的旧嵌套文件与空目录。
 * 6. 自查：读回数据并验证节点数不丢。
 *
 * ## 幂等
 *
 * 没有深层嵌套节点的目录直接跳过，重跑安全无副作用。
 */

import type { MigrationContext, MigrationScript, MigrationStepResult } from './types'
import { isAssetBinary } from '../../learn/store/assets'
import { DOCS_DIR, WORKSPACE_DIR, nodeLayout } from '../../learn/layout'
import { buildDocs } from '../../learn/files/build'
import { parseDocsV3 } from '../../learn/files/parse'
import { parseJson } from '../../learn/files/meta'

async function listFiles(ctx: MigrationContext, dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await ctx.storage.listDir(rel)
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`
      if (entry.dir) await walk(child)
      else out.push(child)
    }
  }
  await walk(dir)
  return out
}

export async function migrateFlattenGoalNodes(ctx: MigrationContext): Promise<MigrationStepResult> {
  const fail = (error: string): MigrationStepResult => ({
    ok: false,
    step: 4,
    modifiedFiles: [],
    error,
  })

  const docsRoot = `${ctx.userDir}/${DOCS_DIR}`
  const prefix = `${ctx.userDir}/`
  const all = await listFiles(ctx, docsRoot)
  const textFiles = all.filter((rel) => !isAssetBinary(rel))
  if (!textFiles.length) {
    return { ok: true, step: 4, modifiedFiles: [], details: '没有可迁移的数据' }
  }

  // 检查是否存在深度大于 4 的节点文件（docs/{目标}/{父级}/{子级}/{子级}.node.json 深度为 5）
  const files = new Map<string, string>()
  let hasNestedNodes = false

  for (const rel of textFiles) {
    const text = await ctx.storage.readText(rel)
    if (text === null) continue
    const userRel = rel.slice(prefix.length)
    files.set(userRel, text)
    if (userRel.endsWith('.node.json')) {
      const parts = userRel.split('/')
      if (parts[0] === DOCS_DIR && parts.length > 4) {
        hasNestedNodes = true
      }
    }
  }

  if (!hasNestedNodes) {
    return { ok: true, step: 4, modifiedFiles: [], details: '所有节点已在同一级存储（已迁移过）' }
  }

  ctx.log(`检测到多层嵌套节点，开始读取旧结构并平铺解耦…`)
  const state = await ctx.storage.readJson<unknown>(`${ctx.userDir}/state.json`)
  const store = parseDocsV3(files, state)
  if (!store || !store.goals.length) {
    return { ok: true, step: 4, modifiedFiles: [], details: '没有有效的学习目标数据' }
  }

  // 建立旧节点目录映射：nodeId -> oldDir (如 docs/微积分/极限/导数)
  const oldNodeDirs = new Map<string, string>()
  for (const [userRel, text] of files) {
    if (!userRel.endsWith('.node.json')) continue
    const parts = userRel.split('/')
    if (parts.length < 3 || parts[0] !== DOCS_DIR) continue
    const base = parts[parts.length - 1].slice(0, -'.node.json'.length)
    if (base !== parts[parts.length - 2]) continue
    const nodeFile = parseJson<{ id?: string }>(text)
    if (nodeFile?.id) {
      oldNodeDirs.set(nodeFile.id, parts.slice(0, -1).join('/'))
    }
  }

  // 计算平级新布局与文件
  const desired = buildDocs(store)
  const layout = nodeLayout(store)

  // 1. 迁移节点工作区（workspace/）：如果有节点目录改变且旧目录有工作区文件
  for (const node of store.nodes) {
    const oldDir = oldNodeDirs.get(node.id)
    const loc = layout.get(node.id)
    if (!oldDir || !loc) continue
    const newDir = [DOCS_DIR, ...loc.dir].join('/')
    if (oldDir === newDir) continue

    const oldWsPrefix = `${prefix}${oldDir}/${WORKSPACE_DIR}/`
    const newWsDir = `${prefix}${newDir}/${WORKSPACE_DIR}`
    const wsFiles = all.filter((p) => p.startsWith(oldWsPrefix))

    if (wsFiles.length > 0) {
      ctx.log(
        `迁移节点「${node.title}」工作区：${oldDir}/${WORKSPACE_DIR} → ${newDir}/${WORKSPACE_DIR} (${wsFiles.length} 个文件)`,
      )
      let moved = false
      if (ctx.storage.movePath) {
        try {
          moved = await ctx.storage.movePath(`${prefix}${oldDir}/${WORKSPACE_DIR}`, newWsDir)
        } catch {
          moved = false
        }
      }
      if (!moved) {
        for (const f of wsFiles) {
          const relInWs = f.slice(oldWsPrefix.length)
          const targetFile = `${newWsDir}/${relInWs}`
          const content = await ctx.storage.readText(f)
          if (content !== null) {
            await ctx.storage.writeText(targetFile, content)
            await ctx.storage.removePath(f)
          }
        }
      }
    }
  }

  // 2. 写出新平级布局文件
  const modifiedFiles: string[] = []
  for (const [rel, text] of desired) {
    const ok = await ctx.storage.writeText(`${prefix}${rel}`, text)
    if (!ok) return fail(`写入 ${rel} 失败`)
    modifiedFiles.push(rel)
  }
  ctx.log(`写出 ${modifiedFiles.length} 个平级布局文件`)

  // 3. 删除旧多层嵌套文件（新布局不再产出的旧路径）
  const keep = [...desired.keys()]
  const stale = [...files.keys()].filter((rel) => !desired.has(rel))
  for (const rel of stale) {
    const ok = await ctx.storage.removePath(`${prefix}${rel}`)
    if (!ok) ctx.log(`[注意] 清理旧路径失败：${rel}`)
  }
  ctx.log(`清理了 ${stale.length} 个旧多层嵌套文件`)

  // 4. 清理已被展平的旧嵌套空目录（只删新布局里不再有文件的深层目录，不碰目标目录）
  const oldParentDirs = new Set<string>()
  for (const rel of stale) {
    const parts = rel.split('/')
    for (let i = 3; i < parts.length; i++) {
      oldParentDirs.add(parts.slice(0, i).join('/'))
    }
  }
  const emptyDirs = [...oldParentDirs].filter((d) => !keep.some((k) => k.startsWith(`${d}/`)))
  const sortedDirs = emptyDirs.sort((a, b) => b.length - a.length)
  for (const d of sortedDirs) {
    await ctx.storage.removePath(`${prefix}${d}`)
  }

  // 5. 自查：新布局必须能被读回，且节点数逐一吻合
  const written = new Map<string, string>()
  for (const rel of modifiedFiles) written.set(rel, desired.get(rel) ?? '')
  const reread = parseDocsV3(written, state)
  if (!reread) return fail('迁移自查失败：新平铺结构无法被正常读回')
  if (reread.nodes.length !== store.nodes.length) {
    return fail(`迁移自查失败：节点数不匹配（前 ${store.nodes.length}，后 ${reread.nodes.length}）`)
  }

  return {
    ok: true,
    step: 4,
    modifiedFiles,
    details: `成功将 ${store.nodes.length} 个节点重构并平铺至目标同级存储（清理 ${stale.length} 个旧层级文件）`,
  }
}

export const flattenGoalNodes: MigrationScript = {
  step: 4,
  id: 'm4-flatten-goal-nodes',
  title: '目标节点同级平铺存储（解耦拓扑层级）',
  summary:
    '旧存储方式中子节点目录多层嵌套在父节点目录下（docs/{目标}/{父级}/{子级}/...），与拓扑图可随时解绑重构的特性产生强耦合。' +
    '本脚本将所有深层节点统一展平至目标直属的一级子目录中（docs/{目标}/{节点}/），拓扑增删改不再引发文件深层挪动。',
  changes: [
    '所有非根节点目录统一平铺在目标目录下（docs/{目标}/{节点}/）',
    '解耦物理路径与拓扑图父子连线关系，连线变更不再改变磁盘目录结构',
    '安全迁移节点内部的 workspace/ 工作区目录与真实工作文件',
    '清理迁移后的深层失效旧目录与旧文件',
    '已平级存储的数据自动跳过（支持幂等重复执行）',
  ],
  migrate: migrateFlattenGoalNodes,
}
