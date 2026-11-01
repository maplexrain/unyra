/**
 * 载入 / 保存 / 落盘的门面：模块级缓存（loaded / snapshot / journalCache）只住在这里，其他模块只能经函数访问。
 * 当前用户是谁（docsUid）搬去了 ./session——那一个数 assets 也要读，留在这里会与 assets 成环。
 */

/**
 * 学习数据的持久化。
 *
 * 一份数据摊在 `{root}/users/{uid}/docs/` 的目录树里（结构见 learn/files.ts）：
 * 正文是 .md，结构化字段在同目录的 .meta.json，对话在同目录的 chat.json。
 *
 * 读在启动：lib/boot.ts 载入用户时把整棵树读进内存并解析（hydrateLearnStore），
 * 之后 loadLearnStore() 是同步读内存。写则是「整份摊平 → 与上次快照比对 →
 * 只写变了的文件、删掉作废的目录」，500ms 防抖（见 useLearnStore）。
 *
 * 校验走 normalizeLearnStore：磁盘上的东西可能被人手改过，与导入一份备份没有
 * 本质区别，用同一条路最省心。
 */

import type { LearnStore } from '../types'
import {
  DOCS_DIR,
  assetMoves,
  buildDocs,
  buildDocsChunked,
  buildState,
  diffDocs,
  parseDocs,
} from '../files'
import {
  flushCommits,
  listFilesRecursive,
  readJson,
  readText,
  removePath,
  scheduleCommit,
  setUserScope,
  userRel,
  writeJson,
  writeText,
} from '../../lib/storage'
import { adoptStrayRootDocs, assetMoveItems, dropStranded, isAssetBinary, moveAssets } from './assets'
import { currentDocsUid, rememberDocsUid } from './session'

/* ---------- 文件读写 ---------- */

const STATE_FILE = 'state.json'

/** 当前已载入的数据；null 表示这个用户还没有任何教学文档 */
let loaded: LearnStore | null = null
/** 上一次写出去（或读进来）的文件内容：保存时据此只写真正变了的 */
let snapshot: Map<string, string> | null = null
/**
 * 载入某个用户的教学文档；uid 为 null 表示未登录，回到空。
 * 由 lib/boot.ts 在启动与切换用户时调用。
 */
export async function hydrateLearnStore(uid: string | null): Promise<void> {
  rememberDocsUid(uid)
  loaded = null
  snapshot = null
  // 资源/图片引用里的路径是「相对当前用户」的（docs/…），前缀靠这一句补上。
  // 必须早于任何读写：漏了它就是「资源写到 {root}/docs、清单写到 users/{uid}/docs」。
  setUserScope(uid)
  if (!uid) return
  // 一次性修复：老版本写错位置的那些文件先并回来（见 adoptStrayRootDocs）
  await adoptStrayRootDocs(uid)

  const prefix = `users/${uid}/`
  const paths = await listFilesRecursive(userRel(uid, DOCS_DIR))
  const files = new Map<string, string>()
  await Promise.all(
    paths
      .filter((rel) => !isAssetBinary(rel))
      .map(async (rel) => {
        const text = await readText(rel)
        // 统一成相对用户目录的路径：比对与落盘用的都是这一套
        if (text !== null) files.set(rel.slice(prefix.length), text)
      }),
  )

  const state = await readJson<unknown>(userRel(uid, STATE_FILE))
  loaded = parseDocs(files, state)

  if (loaded) {
    // 快照用「解析结果再摊平一次」的内容：与将要写出的字节一致，保存时不会无谓重写
    snapshot = buildDocs(loaded)
  } else if (files.size) {
    // 目录里明明有东西却读不出结构（被人手改坏了？）：
    // 留空快照 → 之后的保存只写不删，绝不把读不懂的数据抹掉
    console.warn('[learn] docs 目录无法解析，本次按空数据启动，已存在的文件不会被删除')
  }
}

/** 启动时已载入的数据；null 表示新用户，界面用空库 */
export function loadLearnStore(): LearnStore | null {
  return loaded
}

/**
 * 落盘。整份摊平后与上次快照比对，只写变了的文件、删掉作废的目录。
 * 500ms 内连续调用只会真正写一次（见 useLearnStore 的防抖）。
 */
export function saveLearnStore(store: LearnStore): void {
  const uid = currentDocsUid()
  if (!uid) return
  /**
   * 摊平的时机：**第一次真要落盘时**（run 或 runSync 里），不是 saveLearnStore 被调的那一刻。
   *
   * 为什么可以往后挪：buildDocs / buildState 是纯函数，输入就是这个 store——
   * 而 store 是不可变的（图操作一律返回新 store，数组只换不原地改），所以「排一次队」
   * 与「真要写盘」之间它不会变。原先它们在这里同步跑，于是 500ms 一次的防抖保存、
   * 30 秒一次的阅读结算，每一次都要在**调用方那一帧**把整份数据摊平、逐个节点
   * JSON.stringify(…, null, 2) 一遍，主线程被整份序列化占住。挪进已经防抖的回调之后，
   * 这笔账只在真要写盘的那一次付。
   *
   * **但防抖只是把成本推后，没有把它挪出主线程**：回调里全是同步代码，日志里量到
   * 98.77ms 一次（buildDocs 72.8 + diffDocs 16.8 + assetMoves 6）。所以异步这条路
   * 改用 buildDocsChunked——按节点切片、片间把主线程让出去；同步那条（关窗前）没有
   * 「稍后」可言，仍然一次算完。
   *
   * 为什么两条路都要 `plan` 这份备忘录：run 与 runSync 只会走其中一条（见 lib/storage 的
   * flushCommits / flushCommitsSync），但两条路必须拿到**同一份清单**——下面的 assetMoves
   * 与 diffDocs 都要用同一个 desired，算两份就可能对不上。
   */
  type Plan = {
    desired: Map<string, string>
    state: Record<string, unknown>
    moves: ReturnType<typeof assetMoves>
  }
  let plan: Plan | null = null

  const finishPlan = (desired: Map<string, string>): Plan => {
    const next: Plan = {
      desired,
      state: buildState(store),
      /**
       * 目录改名时资源目录要跟着搬（见 files 的 assetMoves）：diff 只认文本文件，
       * 二进制不在它的视野里，只会给出「旧目录整个删掉」，那一删就把素材删没了。
       * 与 desired 出自同一次摊平：同步版（关窗前）也要用同一份清单。
       * 工作区目录（节点下的 workspace/，见 learn/workspace）也在 ASSET_DIRS 里，
       * 同一套搬法，不用单独算。
       */
      moves: assetMoves(snapshot ?? new Map(), desired),
    }
    plan = next
    return next
  }

  /** 同步算完（关窗前那条路） */
  const planOfSync = (): Plan => plan ?? finishPlan(buildDocs(store))

  /** 分片算完（平时的异步路径）：主线程在片间有机会处理输入 */
  const planOfChunked = async (): Promise<Plan> => plan ?? finishPlan(await buildDocsChunked(store))

  scheduleCommit(`docs:${uid}`, {
    run: async () => {
      const { desired, state, moves } = await planOfChunked()
      const { writes, removes } = diffDocs(snapshot ?? new Map(), desired)
      // 先搬后删：搬空之后，diff 给出的「删掉旧目录」才是安全的（工作区目录也在 ASSET_DIRS 里）
      const stranded = await moveAssets(uid, moves)
      await Promise.all([
        ...writes.map((rel) => writeText(userRel(uid, rel), desired.get(rel) ?? '')),
        ...dropStranded(removes, stranded).map((rel) => removePath(userRel(uid, rel))),
        writeJson(userRel(uid, STATE_FILE), state),
      ])
      snapshot = desired
    },
    // 关窗前的同步版：按同一套差异算出要写/要删的清单；move 项必须排在 remove 之前
    runSync: () => {
      const { desired, state, moves } = planOfSync()
      const { writes, removes } = diffDocs(snapshot ?? new Map(), desired)
      /**
       * 同步路径查不了「搬家的目标是否已存在」，因此对**搬家的源目录**一律不下删除指令：
       * 搬成功的话它已经空了（留着无害，下一次保存顺手收掉）；搬失败的话里面的资源还在，
       * 删了就真没了。代价是可能留下一个装着旧 .md 的目录，而 parseDocs 会按 key 去重，
       * 不会因此多出节点（见 normalizeLearnStore 的同目标去重）。
       */
      const sources = new Set(moves.map((m) => m.from))
      return [
        ...moves.flatMap((m) => assetMoveItems(uid, m)),
        ...writes.map((rel) => ({ rel: userRel(uid, rel), data: desired.get(rel) ?? '' })),
        ...dropStranded(removes, sources).map((rel) => ({ rel: userRel(uid, rel), remove: true })),
        { rel: userRel(uid, STATE_FILE), kind: 'json' as const, data: state },
      ]
    },
  })
}

/** 立刻把待写的内容落盘（Ctrl+S、切换用户前） */
export async function flushLearnStore(): Promise<void> {
  await flushCommits()
}
