/** 资源搬迁与资源路径：目录改名时把资源目录跟着搬，以及「在资源管理器中打开」用的相对路径。 */

import type { DocKind, LearnStore } from '../types'
import { ASSET_DIRS, DOCS_DIR, MANIFEST_FILE, STATIC_DIR, nodeDocPath } from '../files'
import {
  listDir,
  listFilesRecursive,
  movePath,
  readBinary,
  removePath,
  userRel,
  writeBinary,
} from '../../lib/storage'
import type { FlushItem } from '../../lib/native'
import { currentDocsUid } from './session'

/**
 * 把误落在**数据根** `{root}/docs/` 下的文件并回 `users/{uid}/docs/`。
 *
 * 病根：静态资源与图片字节的路径少了「当前用户」这一层前缀，直接按相对数据根解析，
 * 于是**文件**写到 `{root}/docs/{目标}/…`、而**清单与对话**写在
 * `{root}/users/{uid}/docs/{目标}/…`——资源和清单分了家。前缀修好之后，那些老文件
 * 若不搬过来就再也读不到（文档里的 `![…](moji:static/…)` 会显示「文件缺失」，
 * 老会话里贴的图也会变成空图），所以登录时顺手搬一次。
 *
 * 三条纪律：**绝不覆盖**目标位置已有的文件（可能是别的用户的，也可能只是重复）；
 * 删**只删空目录**（remove 是递归的，先确认它空了）；任何一步失败都只跳过、不抛。
 * 数据根下没有 docs/ 时（绝大多数情况）这里什么都不做。
 */
export async function adoptStrayRootDocs(uid: string): Promise<void> {
  const stray = await listFilesRecursive(DOCS_DIR)
  if (!stray.length) return
  let moved = 0
  for (const rel of stray) {
    const target = userRel(uid, rel)
    // 目标已有同名文件：留着源文件不动（宁可多留一份，也不覆盖用户数据）
    if ((await readBinary(target)) !== null) continue
    const dataUrl = await readBinary(rel)
    if (!dataUrl) continue
    if (!(await writeBinary(target, dataUrl))) continue
    await removePath(rel)
    moved++
  }
  // 从最深的目录开始收空壳，父目录才有机会跟着变空
  const dirs = new Set<string>()
  for (const rel of stray) {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    if ((await listDir(dir)).length === 0) await removePath(dir)
  }
  if (moved) console.info(`[learn] 已把 ${moved} 个错放在数据根 docs/ 下的文件并回用户目录`)
}

/**
 * 是不是资源目录里的二进制文件。
 *
 * 整棵树是逐个 readText 读进来的，图片/PDF 按 utf-8 解出来只是一堆乱码，
 * 既白占内存又毫无用处（元数据已经在清单里了）。唯一要读的是清单本身。
 */
export function isAssetBinary(rel: string): boolean {
  const parts = rel.split('/')
  if (parts[parts.length - 1] === MANIFEST_FILE && parts[parts.length - 2] === STATIC_DIR) return false
  return parts.some((seg) => (ASSET_DIRS as readonly string[]).includes(seg))
}

/**
 * 某个节点某份文档在数据根下的相对路径（`users/{uid}/docs/{目标}/…/{节点}.md`）。
 * 供「在资源管理器中打开」用：未登录、或这个节点还没被归到任何目标目录里时返回 null。
 * 笔记要指名是哪一份（见 files 的 nodeDocPath）。
 */
export function nodeDocRel(
  store: LearnStore,
  nodeId: string,
  target: { kind: DocKind | 'outline'; note?: string } = { kind: 'teaching' },
): string | null {
  const uid = currentDocsUid()
  if (!uid) return null
  const rel = nodeDocPath(store, nodeId, target)
  return rel ? userRel(uid, rel) : null
}

/** 一次目录改名牵动的资源目录搬迁（两个：资源库与旧的聊天图片目录） */
export const assetMoveItems = (uid: string, m: { from: string; to: string }): FlushItem[] =>
  ASSET_DIRS.map((dir) => ({
    rel: userRel(uid, `${m.from}/${dir}`),
    to: userRel(uid, `${m.to}/${dir}`),
    move: true,
  }))

/** 从删除清单里摘掉「还有东西没搬出来」的目录：宁可留一个多余目录，也不删掉资源 */
export function dropStranded(removes: string[], stranded: Set<string>): string[] {
  if (!stranded.size) return removes
  return removes.filter((rel) => ![...stranded].some((d) => rel === d || rel.startsWith(d + '/')))
}

/**
 * 把资源目录搬到新位置，返回**没能搬空的旧目录**（那些目录不许删）。
 *
 * 源目录不存在（这个目标还没有资源）就跳过——不先查一下存在性，每次改名都会
 * 往主进程发两个注定失败的移动。
 *
 * 目标已经存在时要逐个文件并过去，**绝不能覆盖**：同一瞬间既改标题又贴图，
 * 新文件就落在新目录里了，而旧的资源还在旧目录里等着搬。movePath 对已存在的目标
 * 是直接拒绝（见 electron/storage.ts），这里顺着它做合并，撞名说明是同一个文件
 * （uuid 唯一），跳过即可。
 */
export async function moveAssets(uid: string, moves: Array<{ from: string; to: string }>): Promise<Set<string>> {
  const stranded = new Set<string>()
  for (const m of moves) {
    for (const dir of ASSET_DIRS) {
      const from = userRel(uid, `${m.from}/${dir}`)
      const to = userRel(uid, `${m.to}/${dir}`)
      // listDir 对不存在的目录回空数组，正好当存在性检查用
      const entries = await listDir(from)
      if (!entries.length) continue
      if (!(await listDir(to)).length) {
        // 目标还没有：整目录搬过去最省事（同卷 rename）
        if (!(await movePath(from, to))) {
          stranded.add(m.from)
          console.warn('[learn] 资源目录未能随目录改名搬迁，文件仍留在旧路径：', from)
        }
        continue
      }
      const existing = new Set((await listDir(to)).map((e) => e.name))
      for (const entry of entries) {
        // 工作区（见 learn/workspace）里目录与文件都是真实内容，合并时子目录也要整个搬过去；
        // 撞名（不分目录还是文件）的留在原地，绝不覆盖
        if (existing.has(entry.name)) continue
        if (!(await movePath(`${from}/${entry.name}`, `${to}/${entry.name}`))) {
          stranded.add(m.from)
          console.warn('[learn] 有个资源文件没能搬过去，它会被留在原处：', entry.name)
        }
      }
    }
  }
  return stranded
}
