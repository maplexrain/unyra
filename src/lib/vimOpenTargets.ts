/**
 * Vim :open / :o 命令的目标目录与拼音检索提供者：
 * 支持按拼音首字母、全拼或中文检索当前目标名下的教学文档、大纲导读、笔记、
 * 考试记录、超级文档、视频、文件、项目中的文件、设置页签、用量页签与考试窗口。
 */

import PinyinModule from 'pinyin-match'
import type { LearnStore, TabRef } from '../learn/types'

const PinyinMatch: { match: (input: string, keys: string) => [number, number] | false } =
  (PinyinModule as any)?.default || PinyinModule

export type VimOpenKind =
  | 'teaching'
  | 'outline'
  | 'guide'
  | 'note'
  | 'examRecord'
  | 'superdoc'
  | 'video'
  | 'file'
  | 'ws'
  | 'settings'
  | 'user'
  | 'usage'
  | 'examWindow'

export interface VimOpenTarget {
  id: string
  title: string
  subtitle?: string
  badge: string
  kind: VimOpenKind
  action: () => void
}

export interface BuildOpenTargetsParams {
  store: LearnStore
  openTab: (ref: TabRef) => void
  openExam: (examId: string) => void
  openExamCopy: (nodeId: string, examId: string, attemptId: string) => void
  newExam: (nodeId: string) => void
  openWsFile?: (nodeId: string, seg: string) => void
  openLocalFile?: (path: string) => void
}

/** 从 LearnStore 中构建当前目标下全部可打开的目标清单 */
export function buildOpenTargets(params: BuildOpenTargetsParams): VimOpenTarget[] {
  const { store, openTab, openExam, openExamCopy, newExam, openWsFile, openLocalFile } = params
  const targets: VimOpenTarget[] = []
  const activeGoalId = store.activeGoalId
  const goalNodes = store.nodes.filter((n) => !activeGoalId || n.goalId === activeGoalId)

  // 1. 教学文档
  for (const node of goalNodes) {
    targets.push({
      id: `teach:${node.id}`,
      title: node.title,
      subtitle: `教学文档 · ${node.title}`,
      badge: '教学文档',
      kind: 'teaching',
      action: () => openTab({ kind: 'teach', nodeId: node.id }),
    })
  }

  // 2. 大纲导读
  for (const node of goalNodes) {
    targets.push({
      id: `outline:${node.id}`,
      title: `${node.title} 大纲`,
      subtitle: `结构大纲与脑图`,
      badge: '大纲导读',
      kind: 'outline',
      action: () => openTab({ kind: 'outline', nodeId: node.id, goalId: activeGoalId ?? undefined }),
    })
    targets.push({
      id: `guide:${node.id}`,
      title: `${node.title} 大纲导读`,
      subtitle: `大纲导读讲解`,
      badge: '大纲导读',
      kind: 'guide',
      action: () => openTab({ kind: 'guide', outlineId: node.id, goalId: activeGoalId ?? undefined }),
    })
  }

  // 3. 笔记（绑定的 + 游离的）
  for (const node of goalNodes) {
    for (const note of node.notes || []) {
      targets.push({
        id: `note:${node.id}:${note.name}`,
        title: note.name,
        subtitle: `笔记 · ${node.title}`,
        badge: '笔记',
        kind: 'note',
        action: () => openTab({ kind: 'note', nodeId: node.id, note: note.name }),
      })
    }
  }
  if (activeGoalId && store.detached?.[activeGoalId]?.notes) {
    for (const note of store.detached[activeGoalId].notes) {
      targets.push({
        id: `note:detached:${note.id}`,
        title: note.name,
        subtitle: `游离笔记`,
        badge: '笔记',
        kind: 'note',
        action: () => openTab({ kind: 'note', nodeId: note.id, note: note.name }),
      })
    }
  }

  // 4. 考试记录 (Exam attempts)
  const goalExams = (store.exams || []).filter((ex) => !activeGoalId || ex.goalId === activeGoalId)
  for (const ex of goalExams) {
    const parentNode = store.nodes.find((n) => n.id === ex.nodeId)
    const nodeTitle = parentNode?.title || ''
    for (const att of ex.attempts || []) {
      const when = new Date(att.startedAt)
      const dateStr = `${when.getMonth() + 1}/${when.getDate()}`
      targets.push({
        id: `exam-record:${att.id}`,
        title: `${ex.title} 记录 (${dateStr})`.trim(),
        subtitle: `考试记录 · ${nodeTitle}`,
        badge: '考试记录',
        kind: 'examRecord',
        action: () => openExamCopy(ex.nodeId, ex.id, att.id),
      })
    }
  }

  // 5. 超级文档
  for (const node of goalNodes) {
    for (const sd of node.superdocs || []) {
      targets.push({
        id: `super:${node.id}:${sd.name}`,
        title: sd.name,
        subtitle: `超级文档 · ${node.title}`,
        badge: '超级文档',
        kind: 'superdoc',
        action: () => openTab({ kind: 'super', nodeId: node.id, name: sd.name }),
      })
    }
  }
  if (activeGoalId && store.detached?.[activeGoalId]?.superdocs) {
    for (const sd of store.detached[activeGoalId].superdocs) {
      targets.push({
        id: `super:detached:${sd.name}`,
        title: sd.name,
        subtitle: `游离超级文档`,
        badge: '超级文档',
        kind: 'superdoc',
        action: () => openTab({ kind: 'super', nodeId: '', name: sd.name }),
      })
    }
  }

  // 6. 视频
  const vList = (store.videoNodes || []).filter((vn) => !activeGoalId || vn.goalId === activeGoalId)
  for (const vn of vList) {
    targets.push({
      id: `video:${vn.id}`,
      title: vn.title || '视频学习',
      subtitle: `视频学习`,
      badge: '视频',
      kind: 'video',
      action: () => openTab({ kind: 'video', videoId: vn.id, goalId: activeGoalId ?? undefined }),
    })
  }
  targets.push({
    id: `video:new`,
    title: `新建视频学习`,
    subtitle: `打开视频学习页签`,
    badge: '视频',
    kind: 'video',
    action: () => openTab({ kind: 'video' }),
  })

  // 7. 文件（文件节点 / 本地文件）
  const goalFileNodes = (store.fileNodes || []).filter((fn) => !activeGoalId || fn.goalId === activeGoalId)
  for (const fn of goalFileNodes) {
    targets.push({
      id: `filenode:${fn.id}`,
      title: fn.title,
      subtitle: `文件 · ${fn.url}`,
      badge: '文件',
      kind: 'file',
      action: () => openTab({ kind: 'local', path: fn.url, title: fn.title }),
    })
  }
  for (const lf of store.localFiles || []) {
    if (!targets.some((t) => t.id === `file:${lf.path}`)) {
      targets.push({
        id: `file:${lf.path}`,
        title: lf.name,
        subtitle: `本地文件 · ${lf.path}`,
        badge: '文件',
        kind: 'file',
        action: () => (openLocalFile ? openLocalFile(lf.path) : openTab({ kind: 'local', path: lf.path, title: lf.name })),
      })
    }
  }

  // 8. 项目中的文件 (Workspace files)
  for (const g of store.docArea?.groups || []) {
    for (const t of g.tabs || []) {
      if (t.ref.kind === 'ws') {
        const ref = t.ref
        const id = `ws:${ref.nodeId}:${ref.seg}`
        if (!targets.some((x) => x.id === id)) {
          const segName = ref.seg.split('/').pop() || ref.seg
          targets.push({
            id,
            title: segName,
            subtitle: `项目文件 · ${ref.seg}`,
            badge: '项目文件',
            kind: 'ws',
            action: () => (openWsFile ? openWsFile(ref.nodeId, ref.seg) : openTab(ref)),
          })
        }
      }
    }
  }

  // 9. 设置页签
  targets.push({
    id: 'settings',
    title: '系统设置',
    subtitle: '应用外观、快捷键与模型配置',
    badge: '设置页签',
    kind: 'settings',
    action: () => openTab({ kind: 'settings' }),
  })

  // 9.5 用户中心页签
  targets.push({
    id: 'user',
    title: '用户中心',
    subtitle: '多用户切换、资料修改与个人画像设置',
    badge: '用户页签',
    kind: 'user',
    action: () => openTab({ kind: 'user' }),
  })

  // 10. 用量页签
  targets.push({
    id: 'usage',
    title: '模型用量统计',
    subtitle: 'Token 消耗与调用统计明细',
    badge: '用量页签',
    kind: 'usage',
    action: () => openTab({ kind: 'usage' }),
  })

  // 11. 考试窗口
  for (const ex of goalExams) {
    const parentNode = store.nodes.find((n) => n.id === ex.nodeId)
    const nodeTitle = parentNode?.title || ''
    targets.push({
      id: `exam-window:${ex.id}`,
      title: `开考: ${ex.title}`,
      subtitle: `进入考试独立窗口 · ${nodeTitle}`,
      badge: '考试窗口',
      kind: 'examWindow',
      action: () => openExam(ex.id),
    })
  }
  if (goalExams.length === 0 && goalNodes[0]) {
    targets.push({
      id: `exam-window:new`,
      title: `发起新考试`,
      subtitle: `为当前目标生成测试题并进入考场`,
      badge: '考试窗口',
      kind: 'examWindow',
      action: () => newExam(goalNodes[0].id),
    })
  }

  return targets
}

/** 按拼音首字母、全拼与文本子串匹配目标 */
export function matchOpenTargets(targets: VimOpenTarget[], query: string): VimOpenTarget[] {
  const q = query.trim()
  if (!q) return targets

  const lowerQ = q.toLowerCase()
  const results: Array<{ target: VimOpenTarget; score: number }> = []

  for (const t of targets) {
    // 1. PinyinMatch 匹配标题
    try {
      const mTitle = PinyinMatch.match(t.title, q)
      if (mTitle !== false) {
        results.push({ target: t, score: 100 - (Array.isArray(mTitle) ? mTitle[0] : 0) })
        continue
      }
    } catch {
      // 容错
    }

    // 2. PinyinMatch 匹配 badge（如搜索 "jiaoxue", "biji", "kaoshi", "shezhi"）
    try {
      const mBadge = PinyinMatch.match(t.badge, q)
      if (mBadge !== false) {
        results.push({ target: t, score: 80 - (Array.isArray(mBadge) ? mBadge[0] : 0) })
        continue
      }
    } catch {
      // 容错
    }

    // 3. PinyinMatch 匹配副标题
    if (t.subtitle) {
      try {
        const mSub = PinyinMatch.match(t.subtitle, q)
        if (mSub !== false) {
          results.push({ target: t, score: 60 - (Array.isArray(mSub) ? mSub[0] : 0) })
          continue
        }
      } catch {
        // 容错
      }
    }

    // 4. 普通英文子串回退匹配
    if (t.title.toLowerCase().includes(lowerQ)) {
      results.push({ target: t, score: 50 })
      continue
    }
    if (t.subtitle?.toLowerCase().includes(lowerQ)) {
      results.push({ target: t, score: 30 })
      continue
    }
    if (t.badge?.toLowerCase().includes(lowerQ)) {
      results.push({ target: t, score: 20 })
      continue
    }
  }

  return results.sort((a, b) => b.score - a.score).map((r) => r.target)
}

/* ---------- 全局 Provider 注册与执行接口 ---------- */

type OpenTargetsProvider = () => VimOpenTarget[]
let targetsProvider: OpenTargetsProvider | null = null

export function setOpenTargetsProvider(provider: OpenTargetsProvider | null): void {
  targetsProvider = provider
}

export function getOpenTargets(query?: string): VimOpenTarget[] {
  const all = targetsProvider?.() || []
  if (!query) return all
  return matchOpenTargets(all, query)
}

export function executeOpenTarget(query: string): { success: boolean; message?: string } {
  const cleanQ = query.trim()
  if (!cleanQ) {
    return { success: false, message: '[请输入要打开的目标关键词]' }
  }
  const list = getOpenTargets(cleanQ)
  if (list.length === 0) {
    return { success: false, message: `[未找到匹配目标: ${cleanQ}]` }
  }
  const picked = list[0]
  picked.action()
  return { success: true, message: `[已打开: ${picked.title.slice(0, 16)}]` }
}
