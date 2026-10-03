/**
 * 引用 chip（chip.*）这一组 ops 的宿主实现：**生成**与**校验**。
 *
 * 为什么要有这一组：交付清单里的 `#[{…}]` 由模型手写时，path 全靠它自己拼——
 * 拿节点标题或「教学」这类别称手拼出来的路径（【目标】/教学）在数据树里不存在，
 * 学习者点开就是一片空，而且这种错不报任何错。chip.build 把「拼对路径」这件事
 * 从模型手里拿走：
 * - 节点寻址沿用 doc.* 的宽容口径（标题、#id、别名都认），解析出节点后
 *   **换算成渲染端真正认的磁盘路径**（nodeDocPath，如 docs/微积分/极限/教学.md）——
 *   第一版发的是「目标/节点」这种寻址标签，opener 反查不到，点开是一片空；
 * - payload 永远带 nodeId（点击优先认它）；
 * - 生成前用 chipResolveProblem 校验——它与消息列表的打开逻辑（tabRefFromChip）
 *   同源，「build 能生成」与「点击打得开」是同一件事。
 */
import { chipToken, splitChips, type ChipPayload } from '../../lib/chipSyntax'
import { docsInfoOf, resolveNode } from '../paths'
import { chipResolveProblem } from '../chipRef'
import { nodeDocPath } from '../files/build'
import { superDocsOf, type KnowledgeNode, type LearnStore } from '../types'
import { wsRelOf } from '../workspace'
import { ancestors } from '../graph'
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

  /** 笔记名的现清单（定位与报错都要用「现在真的有哪几份」） */
  const noteNamesOf = (node: KnowledgeNode): string[] =>
    docsInfoOf(node)
      .filter((d) => d.doc === 'note')
      .map((d) => d.note ?? '')
      .filter(Boolean)

  /** 节点的教学文档磁盘路径；拿不到（节点不在数据目录里）给一句人话 */
  const teachingRelOf = (node: KnowledgeNode): { ok: true; rel: string } | { ok: false; problem: string } => {
    const rel = nodeDocPath(store0(), node.id, { kind: 'teaching' })
    return rel ? { ok: true, rel } : { ok: false, problem: '这个节点的文档不在数据目录里，引用不了' }
  }

  /** 生成前的最后一道校验 + 回执（定位规则与 opener 同源，见 chipRef.chipResolveProblem） */
  const finish = (p: ChipPayload): { ok: true; chip: string; type: string; title: string; note: string } | { ok: false; problem: string } => {
    const problem = chipResolveProblem(store0(), p)
    if (problem) return { ok: false, problem }
    return {
      ok: true,
      chip: chipToken(p),
      type: p.type,
      title: p.title ?? '',
      note: '把这串 chip 原样抄进回复（不要手改里面的 JSON）。',
    }
  }

  return {
    /**
     * 生成一颗 chip。入参是「引用什么」（寻址与 doc.* 同构），不是 chip 的 JSON——
     * 换算磁盘路径、补 nodeId、定标题都是这里的活。
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
        return finish({ type: 'web', url: str('url'), ...(title ? { title } : {}) })
      }
      if (type === 'local') {
        return finish({ type: 'local', path: str('path'), ...(title ? { title } : {}) })
      }
      if (type === 'ws') {
        const rel = str('path')
        if (!rel) return { ok: false, problem: 'ws 型要给 path（workspace api 回执里的 rel，原样抄，不要自己拼）' }
        // 目录 chip 点击跳到所属节点，nodeId 必带；文件 chip 也顺手带上（点击少一步反查）
        const owner = ownerNodeOfWs(store, scope().goalId, rel)
        return finish({
          type: 'ws',
          path: rel,
          ...(owner ? { nodeId: owner.id } : {}),
          ...(input.dir === true ? { dir: true } : {}),
          ...(title ? { title } : { title: baseName(rel) }),
        })
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
        return finish({
          type,
          examId: exam.id,
          ...(type === 'attempt' && attemptId ? { attemptId } : {}),
          ...(title ? { title } : { title: exam.title }),
        })
      }
      // doc / note / outline / super：先解析节点（path 与 doc.* 同构；省略 = 当前节点）
      const kind = type as ChipPayload['type']
      const got = nodeFor(str('path'))
      if (!got.ok) return { ok: false, problem: got.problem }
      const node = got.node
      if (type === 'super') {
        const name = str('name')
        if (!name) return { ok: false, problem: 'super 型要给 name（超级文档名）' }
        if (!superDocsOf(node).some((s) => s.name === name)) {
          return { ok: false, problem: '这个节点上没有叫「' + name + '」的超级文档' }
        }
        const teach = teachingRelOf(node)
        if (!teach.ok) return teach
        // 超级文档没有自己的文件：opener 按「节点教学文档路径 + name」认
        return finish({ type: 'super', name, path: teach.rel, nodeId: node.id, ...(title ? { title } : { title: name }) })
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
        if (!names.includes(note)) {
          return { ok: false, problem: '这个节点上没有叫「' + note + '」的笔记（现有：' + (names.join('、') || '还没有任何笔记') + '）' }
        }
        const rel = nodeDocPath(store, node.id, { kind: 'note', note })
        if (!rel) return { ok: false, problem: '这份笔记不在数据目录里，引用不了' }
        return finish({ type: 'note', path: rel, note, nodeId: node.id, ...(title ? { title } : { title: note }) })
      }
      // doc / outline：教学文档与大纲随节点存在（创建时就位）
      const teach = teachingRelOf(node)
      if (!teach.ok) return teach
      const rel =
        type === 'outline' ? nodeDocPath(store, node.id, { kind: 'outline' }) : teach.rel
      if (!rel) return { ok: false, problem: '这份大纲不在数据目录里，引用不了' }
      return finish({ type: kind, path: rel, nodeId: node.id, ...(title ? { title } : { title: node.title }) })
    },

    /**
     * 交付前自查：任意一段文字（通常是回复草稿）里每一颗 `#[{…}]` 都对 store
     * 验一遍定位。长得像 chip 但解析不开的段落单独点出来——那也是要修的。
     */
    check: (text: string) => {
      const likeChip = (text.match(/#\[\s*\{/g) ?? []).length
      const chips = splitChips(text ?? '').filter((s) => s.kind === 'chip')
      const problems: Array<{ chip: string; problem: string }> = []
      for (const c of chips) {
        const problem = chipResolveProblem(store0(), c.payload)
        if (problem) problems.push({ chip: c.token, problem })
      }
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

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 一个工作区 rel 属于当前目标的哪个节点（落在节点的 workspace 基目录下就是它的） */
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
