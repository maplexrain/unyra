/**
 * 引用 chip（chip.*）这一组 ops 的宿主实现：**生成**与**校验**。
 *
 * 为什么要有这一组：交付清单里的 `#[{…}]` 由模型手写时，path 全靠它自己拼——
 * 拿节点标题或「教学」这类别称手拼出来的路径（【目标】/教学）在数据树里不存在，
 * 学习者点开就是一片空，而且这种错不报任何错。chip.build 把「拼对路径」这件事
 * 从模型手里拿走：它当场对 store 解析（与 doc.* 同一个解析器、同一套寻址），生成
 * 的 payload 永远带 nodeId（渲染端点击优先认它）——build 过的 chip 一定点得开；
 * chip.check 让模型在发出交付前把草稿里的 chip 逐颗验一遍。
 */

import { chipToken, splitChips, type ChipPayload } from '../../lib/chipSyntax'
import { docsInfoOf, nodePathOf, resolveNode } from '../paths'
import { ancestors, nodeById } from '../graph'
import { superDocsOf, type KnowledgeNode, type LearnStore } from '../types'
import { wsRelOf } from '../workspace'
import type { AgentOpsDeps } from './deps'

const BUILD_TYPES = ['doc', 'note', 'outline', 'super', 'exam', 'attempt', 'ws', 'web', 'local'] as const

export function createChipOps(deps: AgentOpsDeps) {
  const store0 = () => deps.getLatest()
  const scope = () => ({ goalId: deps.goalId(), currentNodeId: deps.nodeId() })

  /** path → 节点；解析失败把候选清单那句话原样带回（模型据此一轮改对） */
  const nodeFor = (path: string | undefined): { ok: true; node: KnowledgeNode } | { ok: false; problem: string } => {
    const r = resolveNode(store0(), scope(), path)
    return r.ok ? { ok: true, node: r.value } : { ok: false, problem: r.message }
  }

  /** 一个节点属不属于当前目标（沿父线走到根，或它自己就是根） */
  const inGoal = (node: KnowledgeNode): boolean => {
    const goal = store0().goals.find((g) => g.id === scope().goalId)
    if (!goal) return false
    return node.id === goal.rootNodeId || ancestors(store0(), node.id).includes(goal.rootNodeId)
  }

  /** 笔记名的现清单（定位与报错都要用「现在真的有哪几份」） */
  const noteNamesOf = (node: KnowledgeNode): string[] =>
    docsInfoOf(node)
      .filter((d) => d.doc === 'note')
      .map((d) => d.note ?? '')
      .filter(Boolean)

  /**
   * 一颗 payload 能不能定位到真东西：能回 null，不能回一句人话。
   * build 用它做生成前的最后一道校验，check 用它逐颗验证草稿里的 chip。
   */
  const locate = (p: ChipPayload): string | null => {
    const store = store0()
    if (p.type === 'web') {
      if (!p.url) return '缺 url'
      try {
        const u = new URL(p.url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'url 只认 http/https'
      } catch {
        return 'url 解析不开（要完整网址，如 https://…）'
      }
      return null
    }
    if (p.type === 'local') return p.path ? null : '缺 path（本地文件的完整绝对路径）'
    if (p.type === 'ws') {
      if (!p.path) return '缺 path（workspace api 回执里的 rel，原样抄）'
      return ownerNodeOfWs(store, scope().goalId, p.path) ? null : '这个工作区路径不属于本目标的任何节点（path 要用 workspace api 回执里的 rel，原样抄）'
    }
    if (p.type === 'exam' || p.type === 'attempt') {
      const exam = p.examId ? store.exams.find((e) => e.id === p.examId) : undefined
      if (!exam) return '没有这份试卷（examId 要从 exam.read 的回执里抄）'
      if (p.type === 'attempt') {
        if (!p.attemptId) return 'attempt 型要带 attemptId'
        if (!exam.attempts.some((a) => a.id === p.attemptId)) return '这份试卷里没有这一次考试（attemptId 从 exam.read 的 history 里抄）'
      }
      return null
    }
    // doc / note / outline / super：先定位节点（nodeId 优先，path 兜底反查）
    let node: KnowledgeNode | undefined
    if (p.nodeId) {
      node = nodeById(store, p.nodeId)
    } else {
      const got = nodeFor(p.path ?? undefined)
      if (got.ok) node = got.node
    }
    if (!node || !inGoal(node)) return '定位不到节点（path 不是本目标里真实存在的数据树路径）'
    if (p.type === 'super') {
      if (!p.name) return 'super 型要带 name（超级文档名）'
      if (!superDocsOf(node).some((s) => s.name === p.name)) return '这个节点上没有叫「' + p.name + '」的超级文档'
      return null
    }
    if (p.type === 'note') {
      const names = noteNamesOf(node)
      if (!p.note) return 'note 型要带 note（笔记名）'
      if (!names.includes(p.note)) return '这个节点上没有叫「' + p.note + '」的笔记（现有：' + (names.join('、') || '还没有任何笔记') + '）'
      return null
    }
    // doc / outline：教学文档与大纲随节点存在（创建时就位），节点在就定位得到
    return null
  }

  return {
    /**
     * 生成一颗 chip。入参是「引用什么」（寻址与 doc.* 同构），不是 chip 的 JSON——
     * 拼路径、补 nodeId、定标题都是这里的活；生成前先 locate 一遍，定位不到就 ok:false。
     */
    build: (input: Record<string, unknown>) => {
      const type = typeof input.type === 'string' ? input.type.trim() : ''
      if (!(BUILD_TYPES as readonly string[]).includes(type)) {
        return {
          ok: false,
          problem:
            'chip.build 的 type 只认：' + BUILD_TYPES.join(' / ') +
            '。要引用什么就给什么字段：path 类给 path（省略 = 当前节点）、web 给 url、exam/attempt 给 examId（attempt 再带 attemptId）、super 带 name、note 带 note。',
        }
      }
      const str = (k: string): string | undefined => {
        const v = input[k]
        return typeof v === 'string' && v.trim() ? v.trim() : undefined
      }
      const store = store0()
      const title = str('title')

      if (type === 'web') {
        const p: ChipPayload = { type: 'web', url: str('url'), ...(title ? { title } : {}) }
        const problem = locate(p)
        return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
      }
      if (type === 'local') {
        const p: ChipPayload = { type: 'local', path: str('path'), ...(title ? { title } : {}) }
        const problem = locate(p)
        return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
      }
      if (type === 'ws') {
        const rel = str('path')
        if (!rel) return { ok: false, problem: 'ws 型要给 path（workspace api 回执里的 rel，原样抄，不要自己拼）' }
        const owner = ownerNodeOfWs(store, scope().goalId, rel)
        if (!owner) return { ok: false, problem: '这个工作区路径不属于本目标的任何节点：path 要用 workspace api 回执里的 rel，原样抄' }
        const p: ChipPayload = {
          type: 'ws',
          path: rel,
          nodeId: owner.id,
          ...(input.dir === true ? { dir: true } : {}),
          ...(title ? { title } : { title: baseName(rel) }),
        }
        const problem = locate(p)
        return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
      }
      if (type === 'exam' || type === 'attempt') {
        const examId = str('examId')
        const attemptId = str('attemptId')
        let exam = examId ? store.exams.find((e) => e.id === examId) : undefined
        if (!exam && !examId) {
          // 没指名试卷：当前节点最新的一份（出卷 / 阅卷都作用在当前节点上，同一条口径）
          const current = deps.nodeId()
          exam = current
            ? store.exams.filter((e) => e.nodeId === current).sort((a, b) => b.createdAt - a.createdAt)[0]
            : undefined
          if (!exam) return { ok: false, problem: '当前节点还没有试卷；要引用别处的试卷就带 examId' }
        }
        if (!exam) return { ok: false, problem: '没有这份试卷（examId 从 exam.read 的回执里抄）' }
        if (type === 'attempt') {
          if (!attemptId) return { ok: false, problem: 'attempt 型要带 attemptId（exam.read 的 history 里每条考试的 id）' }
          if (!exam.attempts.some((a) => a.id === attemptId)) {
            return { ok: false, problem: '这份试卷里没有这一次考试（attemptId 从 exam.read 的 history 里抄）' }
          }
        }
        const p: ChipPayload = {
          type,
          examId: exam.id,
          ...(type === 'attempt' && attemptId ? { attemptId } : {}),
          ...(title ? { title } : { title: exam.title }),
        }
        const problem = locate(p)
        return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
      }
      // doc / note / outline / super：先解析节点（path 与 doc.* 同构；省略 = 当前节点）
      const got = nodeFor(str('path'))
      if (!got.ok) return { ok: false, problem: got.problem }
      const node = got.node
      const nodePath = nodePathOf(store, scope().goalId, node.id)
      if (type === 'super') {
        const name = str('name')
        if (!name) return { ok: false, problem: 'super 型要给 name（超级文档名）' }
        const p: ChipPayload = { type: 'super', name, path: nodePath, nodeId: node.id, ...(title ? { title } : { title: name }) }
        const problem = locate(p)
        return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
      }
      if (type === 'note') {
        const names = noteNamesOf(node)
        const note = str('note') ?? (names.length === 1 ? names[0] : undefined)
        if (!note) {
          return {
            ok: false,
            problem: names.length
              ? '这个节点有好几份笔记，note 要指名其中一份（现有：' + names.join('、') + '）'
              : '这个节点还没有任何笔记——先 doc.append 写进一份再引用，或要引用教学文档就用 type:"doc"',
          }
        }
        const p: ChipPayload = { type: 'note', path: nodePath, note, nodeId: node.id, ...(title ? { title } : { title: note }) }
        const problem = locate(p)
        return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
      }
      // doc / outline：教学文档与大纲随节点存在（创建时就位）
      const p: ChipPayload = { type, path: nodePath, nodeId: node.id, ...(title ? { title } : { title: node.title }) }
      const problem = locate(p)
      return problem ? { ok: false, problem } : { ok: true, ...emit(p) }
    },

    /**
     * 交付前自查：任意一段文字（通常是回复草稿）里每一颗 `#[{…}]` 都对 store
     * 验一遍定位。长得像 chip 但解析不开的段落单独点出来——那也是要修的。
     */
    check: (text: string) => {
      const chips = splitChips(text ?? '').filter((s) => s.kind === 'chip')
      const problems: Array<{ chip: string; problem: string }> = []
      for (const c of chips) {
        const problem = locate(c.payload)
        if (problem) problems.push({ chip: c.token, problem })
      }
      const likeChip = (text.match(/#\[\s*\{/g) ?? []).length
      const unparsed = likeChip - chips.length
      const valid = chips.length - problems.length
      return {
        total: chips.length,
        valid,
        invalid: problems.length,
        ...(unparsed > 0 ? { unparsed } : {}),
        ...(problems.length ? { problems } : {}),
        note:
          valid === chips.length && unparsed === 0
            ? '全部 chip 都定位得到，可以交付。'
            : '坏的照 problem 改——用 build 重新生成再原样抄回来，不要手改 JSON。',
      }
    },
  }
}

/* ---------- 小工具 ---------- */

/** 生成回执的公共部分：chip 字符串 + 界面上会显示的名字 */
function emit(p: ChipPayload): { chip: string; type: string; title: string; note: string } {
  return {
    chip: chipToken(p),
    type: p.type,
    title: p.title ?? '',
    note: '把这串 chip 原样抄进回复（不要手改里面的 JSON）。',
  }
}

/** 一个工作区 rel 属于哪个节点（dir chip 与文件 chip 同一条判据：落在节点的 workspace 基目录下） */
function ownerNodeOfWs(store: LearnStore, goalId: string, rel: string): KnowledgeNode | undefined {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) return undefined
  for (const n of store.nodes) {
    const base = wsRelOf(store, n.id)
    if (!base || !(rel === base || rel.startsWith(base + '/'))) continue
    if (n.id === goal.rootNodeId || ancestors(store, n.id).includes(goal.rootNodeId)) return n
  }
  return undefined
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}
