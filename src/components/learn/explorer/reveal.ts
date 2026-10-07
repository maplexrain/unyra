/**
 * 这个文件负责：「当前页签 → 资源管理器里那一行」的定位。
 *
 * 切页签时，树里对应的那一行要自己亮出来——父级目录没展开的展开、分区收着的打开，
 * 最后滚过去闪一下。难处在于**目标行的开合状态散在各自手里**（节点的文档目录、
 * 试卷的历次考试、收藏的分组、工作区的逐层目录都是本地 state），外壳够不着它们；
 * 而工作区的子目录还要等 IPC 列完才挂载，晚生的行听不见已经播完的广播。
 *
 * 所以是三段式：
 * 1. `revealOfTab` 纯算——页签换算成目标行的键、要展开的节点链 / 文档目录 / 试卷 / 分组；
 * 2. `publishReveal` 广播——树里各层订阅着，轮到自己的就展开；晚挂载的行用 `peekReveal`
 *    补看当前这条（工作区逐层展开靠它接力），广播几秒后作废，过时的展开指令不再生效；
 * 3. `revealRow` 兜底——按 data-reveal 属性找那一行，找到了滚动 + 闪光；没找到就等几拍
 *    重试（展开动画与逐层列目录都需要时间），超过就算了。
 */
import type { LearnStore, TabRef } from '../../../learn/types'
import { ancestors } from '../../../learn/graph'
import { wsRevealOfAbs } from '../../../learn/workspace'

/** 一次定位请求：目标行 + 沿路要展开的东西（全是「打开」，绝不顺手收起） */
export interface RevealRequest {
  /** 目标行的候选键（行上的 data-reveal 属性值，按优先级排） */
  keys: string[]
  /** 要展开的节点链（含目标节点自己；工作区 / 文档行都活在节点底下） */
  nodes: string[]
  /** 要展开「文档」目录的节点（笔记 / 超级文档 / 试卷副本都收在里面，默认收着） */
  docs: string[]
  /** 要展开历次考试的那份试卷（nodeId + examId；一次只开一份的规矩由行自己管） */
  exams: { nodeId: string; examId: string }[]
  /** 要展开的收藏分组（null = 顶层收藏，或不适用） */
  favGroup: string | null
  /** 目标行所在的分区（收着的先打开；null = 不属于哪个分区） */
  section: 'nodes' | 'favorites' | 'local' | 'reports' | null
  /** 广播的轮次：行用它认「这条广播是不是新来的」 */
  nonce: number
}

/* ---------- 广播：发布 / 订阅 / 补看 ---------- */

let seq = 0
let current: RevealRequest | null = null
let clearTimer: number | undefined
const listeners = new Set<(req: RevealRequest) => void>()

/**
 * 广播一条定位请求：订阅者当场各就各位。current 留几秒再清——工作区的子目录要等
 * 父目录列完盘才挂载，晚生的行靠 peekReveal 补看；过期的展开指令不该永远有效。
 */
export function publishReveal(req: Omit<RevealRequest, 'nonce'>): void {
  seq += 1
  current = { ...req, nonce: seq }
  for (const fn of listeners) fn(current)
  window.clearTimeout(clearTimer)
  clearTimer = window.setTimeout(() => {
    current = null
  }, 4000)
}

/** 当前这条广播（可能已作废为 null）；晚挂载的行挂载时补看一眼用 */
export function peekReveal(): RevealRequest | null {
  return current
}

/** 订阅定位广播，退订函数照旧 */
export function subscribeReveal(fn: (req: RevealRequest) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/* ---------- 页签 → 定位请求（纯算） ---------- */

/**
 * 一枚页签的定位签名：同一枚页签反复激活只定位一次。网页页签每次主框架导航都会
 * 换 url（对象跟着变），但 key 不变——签名跟着 key 走，导航途中不闪收藏夹。
 */
export function revealSigOf(tab: TabRef): string {
  if (tab.kind === 'web') return 'web:' + tab.key
  return JSON.stringify(tab)
}

/**
 * 页签换算成定位请求；侧栏里没有对应行的（没收藏过的网页、来路不明的本地文件）回 null，
 * 不定位。同一份东西可能同时活在两处（收藏过的本地文件）：树 > 收藏 > 本地文件列表，
 * 认最「正」的那一处。
 */
export function revealOfTab(
  tab: TabRef,
  store: LearnStore,
  userPrefix: string | null,
): Omit<RevealRequest, 'nonce'> | null {
  /** 节点链：从根到它自己（展开父级才谈得上看见孩子） */
  const chain = (nodeId: string): string[] => [...ancestors(store, nodeId), nodeId]
  const favs = store.favorites ?? []

  switch (tab.kind) {
    case 'teach':
      return {
        keys: [`row:doc:teach:${tab.nodeId}`],
        nodes: chain(tab.nodeId),
        docs: [],
        exams: [],
        favGroup: null,
        section: 'nodes',
      }
    case 'outline':
      return {
        keys: [`row:doc:outline:${tab.nodeId}`],
        nodes: chain(tab.nodeId),
        docs: [],
        exams: [],
        favGroup: null,
        section: 'nodes',
      }
    case 'note':
      return {
        keys: [`row:doc:note:${tab.nodeId}:${tab.note}`],
        nodes: chain(tab.nodeId),
        docs: [tab.nodeId],
        exams: [],
        favGroup: null,
        section: 'nodes',
      }
    case 'super':
      return {
        keys: [`row:doc:super:${tab.nodeId}:${tab.name}`],
        nodes: chain(tab.nodeId),
        docs: [tab.nodeId],
        exams: [],
        favGroup: null,
        section: 'nodes',
      }
    case 'exam':
      return {
        keys: [`row:doc:attempt:${tab.nodeId}:${tab.examId}:${tab.attemptId}`],
        nodes: chain(tab.nodeId),
        docs: [tab.nodeId],
        exams: [{ nodeId: tab.nodeId, examId: tab.examId }],
        favGroup: null,
        section: 'nodes',
      }
    case 'web': {
      // 起始页（还没有网址）没有可定位的东西；收藏过的网页按分组展开
      if (!tab.url) return null
      const fav = favs.find((f) => f.kind === 'web' && f.url === tab.url)
      if (!fav) return null
      return {
        keys: [`row:fav:u:${tab.url}`],
        nodes: [],
        docs: [],
        exams: [],
        favGroup: fav.group ?? null,
        section: 'favorites',
      }
    }
    case 'local': {
      // 工作区文件（local 页签、绝对路径落在某个节点工作区里）：树里逐层展开
      const ws = wsRevealOfAbs(store, tab.path, userPrefix)
      if (ws) {
        return {
          keys: [`row:ws:${ws.rel}`],
          nodes: chain(ws.nodeId),
          docs: [],
          exams: [],
          favGroup: null,
          section: 'nodes',
        }
      }
      const fav = favs.find((f) => f.kind === 'local' && f.path === tab.path)
      if (fav) {
        return {
          keys: [`row:fav:l:${tab.path}`],
          nodes: [],
          docs: [],
          exams: [],
          favGroup: fav.group ?? null,
          section: 'favorites',
        }
      }
      if ((store.localFiles ?? []).some((f) => f.path === tab.path)) {
        return {
          keys: [`row:local:${tab.path}`],
          nodes: [],
          docs: [],
          exams: [],
          favGroup: null,
          section: 'local',
        }
      }
      return null
    }
    case 'guard':
      // 守卫上下文不在侧栏的任何一行里，没有可定位的东西
      return null
    case 'settings':
    case 'usage':
      // 设置页与用量页是文档区的页签，但侧栏里没有它们的行（入口在顶栏），不定位
      return null
    case 'report':
      // 专注报告住在资源管理器自己的分类夹里；守卫页签不在侧栏，落不进来（不定位）
      return {
        keys: [`row:focus:${tab.reportId}`],
        nodes: [],
        docs: [],
        exams: [],
        favGroup: null,
        section: 'reports',
      }
  }
}

/* ---------- 滚动与闪光 ---------- */

/**
 * 把目标行滚进视口并闪一下。行此刻可能还**不可见但已在 DOM 里**——Collapse 收起时
 * 子树仍然挂着（裁成 0 高、整棵 inert），querySelector 一样找得到它；所以认行的条件是
 * 「没有 inert 祖先」，收着的目录要等广播把它展开、inert 摘掉才认数。展开是 200ms 的
 * 高度动画，滚动于是再来一拍补到位。闪光类什么时候摘由这里的定时器说了算
 * （reduced-motion 下没有 animationend 可等）。
 */
export function revealRow(root: HTMLElement | null, keys: readonly string[]): void {
  const query = keys.map((k) => `[data-reveal="${CSS.escape(k)}"]`).join(',')
  let tries = 0
  const tick = (): void => {
    const el = root?.querySelector<HTMLElement>(query)
    if (el && !el.closest('[inert]')) {
      const show = (): void => el.scrollIntoView({ block: 'nearest' })
      el.classList.remove('moji-reveal-flash')
      void el.offsetWidth
      el.classList.add('moji-reveal-flash')
      show()
      window.setTimeout(show, 260)
      window.setTimeout(() => el.classList.remove('moji-reveal-flash'), 1500)
      return
    }
    // 约 1.8s 的窗口：展开动画 200ms 一拍、工作区逐层列目录一层一次 IPC
    if (++tries < 30) window.setTimeout(tick, 60)
  }
  tick()
}
