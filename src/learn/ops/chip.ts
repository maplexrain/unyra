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
import { docsInfoOf, nodePathOf, resolveNode, splitDocPath } from '../paths'
import { chipResolveProblem } from '../chipRef'
import { nodeDocPath } from '../files/build'
import { superDocsOf, type KnowledgeNode, type LearnStore } from '../types'
import { wsRelOf } from '../workspace'
import { ancestors, nodeById } from '../graph'
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
  const finish = (p: ChipPayload): { ok: true; chip: string; type: string; title: string; path?: string; docPath?: string; deliveryPath?: string; nodeId?: string; note: string } | { ok: false; problem: string } => {
    const problem = chipResolveProblem(store0(), p)
    if (problem) return { ok: false, problem }
    const docPath = p.nodeId ? nodePathOf(store0(), scope().goalId, p.nodeId) : undefined
    return {
      ok: true,
      chip: chipToken(p),
      type: p.type,
      title: p.title ?? '',
      path: p.path,
      ...(docPath ? { docPath } : {}),
      deliveryPath: docPath || p.title || p.path,
      ...(p.nodeId ? { nodeId: p.nodeId } : {}),
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
            'chip.build 的 type 只认：教学文档(doc)、笔记(note)、大纲(outline)、超级文档(super)、试卷(exam/attempt)、工作区文件(ws)、网页(web) 或本地文件(local)。要引用什么就给什么字段：文档类给 path（省略 = 当前节点）、web 给 url、exam/attempt 给 examId、super 带 name、note 带 note。',
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
        if (!exam && attemptId) {
          exam = store.exams.find((e) => e.attempts.some((a) => a.id === attemptId))
        }
        if (!exam && !examId) {
          // 没指名试卷：当前节点最新的一份（出卷 / 阅卷都作用在当前节点上，同一条口径）
          const current = deps.nodeId()
          exam = current
            ? store.exams.filter((e) => e.nodeId === current).sort((a, b) => b.createdAt - a.createdAt)[0]
            : undefined
          if (!exam) return { ok: false, problem: '当前节点还没有试卷；要引用别处的试卷就带 examId 或 attemptId' }
        }
        if (!exam) return { ok: false, problem: '没有这份试卷（examId 从 exam.read 的回执里抄）' }

        const resolvedAttemptId = attemptId ?? (type === 'attempt' && exam.attempts.length > 0 ? exam.attempts[exam.attempts.length - 1].id : undefined)

        if (type === 'attempt') {
          if (!resolvedAttemptId) return { ok: false, problem: '这份试卷还没有任何考试记录；考过之后才能引用作答记录' }
          if (!exam.attempts.some((a) => a.id === resolvedAttemptId)) {
            return { ok: false, problem: '这份试卷里没有这一次考试（attemptId 从 exam.read 的 history 里抄）' }
          }
        }
        const effectiveType: ChipPayload['type'] = resolvedAttemptId ? 'attempt' : 'exam'
        return finish({
          type: effectiveType,
          examId: exam.id,
          nodeId: exam.nodeId,
          ...(resolvedAttemptId ? { attemptId: resolvedAttemptId } : {}),
          ...(title ? { title } : { title: exam.title }),
        })
      }
      // doc / note / outline / super：先解析节点（优先认 nodeId / uuid，再按路径解析；支持 '文档/笔记'）
      const kind = type as ChipPayload['type']
      const directId = str('nodeId') ?? str('uuid')
      const rawPath = str('path')
      const splitted = splitDocPath(rawPath)
      let got: { ok: true; node: KnowledgeNode } | { ok: false; problem: string }
      if (directId) {
        const found = nodeById(store0(), directId.replace(/^#/, ''))
        got = found ? { ok: true, node: found } : { ok: false, problem: '没有找到 id 为「' + directId + '」的节点' }
      } else {
        const nodePath = splitted.segments.join('/')
        got = nodeFor(nodePath || undefined)
      }
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
        const note = str('note') ?? (splitted.kind === 'note' && splitted.note ? splitted.note : (names.length === 1 ? names[0] : undefined))
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
     * 交付前自查：自查文本中的 #[{…}] 引用 chip 及 [文案](moji:doc/...) 跳转链接。
     * 避免误放行假绿 (B2)，准确定位每个引用的真实性。
     */
    check: (text: string) => {
      const rawText = String(text ?? '')
      const likeChip = (rawText.match(/#\[\s*\{/g) ?? []).length
      const chips = splitChips(rawText).filter((s) => s.kind === 'chip')
      const problems: Array<{ chip: string; problem: string }> = []

      for (const c of chips) {
        const problem = chipResolveProblem(store0(), c.payload)
        if (problem) problems.push({ chip: c.token, problem })
      }

      // 提取 Markdown moji:doc/... 链接并校验目标
      const linkRegex = /\[([^\]]+)\]\(moji:doc\/([^)#@\s]+)(?:#[^)]*)?\)/g
      let linkCount = 0
      let linkValid = 0
      for (let m = linkRegex.exec(rawText); m; m = linkRegex.exec(rawText)) {
        linkCount++
        const targetPath = m[2].trim()
        const resolved = resolveNode(store0(), scope(), targetPath)
        if (resolved.ok) {
          linkValid++
        } else {
          problems.push({ chip: m[0], problem: `链接引用的目标节点「${targetPath}」不存在：${resolved.message}` })
        }
      }

      const unparsed = Math.max(0, likeChip - chips.length)
      const chipValid = chips.length - problems.filter((p) => p.chip.startsWith('#[')).length
      const total = chips.length + linkCount
      const valid = chipValid + linkValid
      const invalid = problems.length

      let note = ''
      if (total === 0 && unparsed === 0) {
        note = '文本中未检测到任何引用 chip 或跳转链接。若回复中引用了知识点或文档，请使用 api.chip.build 生成标准引用。'
      } else if (invalid === 0 && unparsed === 0) {
        note = '全部引用与跳转链接均定位成功，可以交付。'
      } else {
        note = '存在未能成功定位的引用，请根据 problems 清单修改（用 api.chip.build 重新生成或修正跳转目标）。'
      }

      return {
        total,
        valid,
        invalid,
        ...(unparsed > 0 ? { unparsed } : {}),
        ...(problems.length ? { problems } : {}),
        note,
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
