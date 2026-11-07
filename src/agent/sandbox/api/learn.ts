/**
 * 这个文件负责什么：学习编排域的 api 装配（exam / memory / schedule / method / wf /
 * code / workspace / compact / chip / delivery）——出题作答、长期与工作记忆、日程提醒、
 * 方法库、工作流、代码块产物、工作区目录、上下文压缩、引用 chip 与交付账。
 * 能力本体都在宿主的 learn/* 与 agent/delivery 上，这里只做参数整形与注册。
 */
import { compileBody } from '../body'
import { asOptionalPath, asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 学习编排域：exam / memory / schedule / method / wf / code / workspace / compact / chip / delivery */
export function installLearn(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  if (opts.exam) {
    const exam = opts.exam
    // 出题走节点宇宙（api.node.create + editContent，阶段闸门在 NodeOps.guard）；
    // exam.* 只留作答侧：读卷、判分、讲解与删卷
    wrapApi(api, 'exam.read', (args) => exam.read(asText(args[0]).trim() || undefined), log)
    wrapApi(api, 'exam.grade', (args) => exam.grade(asRecord(args[0])), log)
    wrapApi(api, 'exam.rotateSheet', (args) => exam.rotateSheet(asRecord(args[0])), log)
    wrapApi(api, 'exam.previewCrop', (args) => exam.previewCrop(asRecord(args[0])), log)
    wrapApi(api, 'exam.cropAnswer', (args) => exam.cropAnswer(asRecord(args[0])), log)
    wrapApi(api, 'exam.explain', (args) => exam.explain(asRecord(args[0])), log)
    wrapApi(api, 'exam.delete', (args) => exam.remove(asRecord(args[0])), log)
  }

  if (opts.memory) {
    const memory = opts.memory
    wrapApi(api, 'memory.list', (args) => memory.list(args.length && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : undefined), log)
    wrapApi(api, 'memory.get', (args) => memory.get(asText(args[0]).trim()), log)
    wrapApi(api, 'memory.create', (args) => memory.create(asRecord(args[0])), log)
    // 更新是 (uuid, patch)：两个位置参数，不合并成一个对象——uuid 是身份，patch 是内容
    wrapApi(api, 'memory.update', (args) => memory.update(asText(args[0]).trim(), asRecord(args[1])), log)
    // 删除带可选 { confirm }：长期记忆要它，工作记忆不需要（见 learn/memory）
    wrapApi(api, 'memory.delete', (args) => memory.remove(asText(args[0]).trim(), args[1] && typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined), log)
    /**
     * 一页纸（开场先看它）：本目标记忆里最近的几条摘要拼成一页，省掉 list + 逐条 get 两步。
     * 画像、路线这类跨轮不变的东西，本就该在动手前先领一页。
     */
    wrapApi(api, 'memory.context', async (args) => {
      const q = args[0] && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : {}
      const scope = q.scope === 'long' ? 'long' : 'work'
      const maxChars = typeof q.maxChars === 'number' ? Math.max(200, Math.min(q.maxChars, 4000)) : 600
      const listed = await Promise.resolve(memory.list({ type: scope }))
      const rawItems = (listed as { items?: unknown })?.items
      const items: unknown[] = Array.isArray(rawItems) ? rawItems : Array.isArray(listed) ? (listed as unknown[]) : []
      const picked = items.slice(0, 3)
      const parts: string[] = []
      for (const it of picked) {
        const uuid = typeof (it as { uuid?: unknown })?.uuid === 'string' ? (it as { uuid: string }).uuid : typeof it === 'string' ? it : ''
        if (!uuid) continue
        const full = (await Promise.resolve(memory.get(uuid))) as { title?: unknown; content?: unknown; error?: unknown } | null
        if (!full || typeof full.error !== 'undefined') continue
        const title = typeof full.title === 'string' ? full.title : ''
        const content = typeof full.content === 'string' ? full.content.trim() : ''
        if (content) parts.push('## ' + title + '\n' + content)
      }
      let text = parts.join('\n\n')
      if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…（已截断，全文用 memory.get(uuid) 取）'
      return { ok: true, scope, count: parts.length, text }
    }, log)
  }

  // 日程：给用户排提醒（见 learn/schedule）。响铃与「确认」在宿主，agent 只写这张表
  if (opts.schedule) {
    const schedule = opts.schedule
    wrapApi(api, 'schedule.list', (args) => schedule.list(args.length && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : undefined), log)
    wrapApi(api, 'schedule.create', (args) => schedule.create(asRecord(args[0])), log)
    // 修改是 (id, patch)：与 memory.update 同一套位置参数写法
    wrapApi(api, 'schedule.update', (args) => schedule.update(asText(args[0]).trim(), asRecord(args[1])), log)
    wrapApi(api, 'schedule.complete', (args) => schedule.complete(asText(args[0]).trim()), log)
    wrapApi(api, 'schedule.remove', (args) => schedule.remove(asText(args[0]).trim()), log)
  }

  if (opts.methods) {
    const m = opts.methods
    wrapApi(api, 'method.list', () => m.list(), log)
    wrapApi(api, 'method.create', (args) => m.create(asRecord(args[0])), log)
    wrapApi(api, 'method.delete', (args) => m.remove(asText(args[0]).trim()), log)
    wrapApi(api, 'method.call', (args) => {
      const name = asText(args[0]).trim()
      const entry = m.find(name)
      if (!entry) {
        const names = m.list() as { items?: Array<{ name: string }> }
        const have = names.items?.map((x) => x.name).join('、') ?? ''
        return {
          error:
            '没有叫「' + name + '」的函数。' +
            (have ? '现有的：' + have + '。' : '这个目标还一个函数都没有（method.create 先建一个）。'),
        }
      }
      /**
       * 执行就发生在宿主这一侧：编译持久化的源码、把**当前这次编排的 api** 交给它。
       * 函数体里 await api.node.get(uuid) 的 content 用的就是这份 api——它与编排里的其它调用
       * 看到同一个 store，读写顺序与书写顺序一致。
       */
      const compiled = compileBody(entry.code)
      if (!compiled.ok) return { error: '「' + entry.name + '」的代码编译不过：' + compiled.content }
      try {
        const fn = new Function('api', 'return (' + compiled.body + ')')() as
          | ((...a: unknown[]) => unknown)
          | null
        if (typeof fn !== 'function') return { error: '「' + entry.name + '」不是一段函数源码' }
        return fn(api, ...args.slice(1))
      } catch (err) {
        return { error: '「' + entry.name + '」执行失败：' + (err instanceof Error ? err.message : String(err)) }
      }
    }, log)
  }

  if (opts.workflows) {
    const wfs = opts.workflows
    wrapApi(api, 'wf.list', (args) => {
      const opt = asRecord(args[0])
      return wfs.list(opt)
    }, log)
    if (wfs.get) {
      wrapApi(api, 'wf.get', (args) => {
        const ref = asText(args[0]).trim()
        if (!ref) return { ok: false, error: 'wf.get 需要工作流 ID 或名称，例如 wf.get("recall")' }
        return wfs.get!(ref)
      }, log)
    }
    wrapApi(api, 'wf.create', (args) => wfs.create(asRecord(args[0])), log)
    wrapApi(api, 'wf.remove', (args) => wfs.remove(asText(args[0]).trim()), log)
    /*
     * 触发（wf.invoke）：把这件事交给某条流程。它**不当场跑**那个流程——工作流的指令要
     * 作为一条新的 user 消息进上下文，而当前这一轮还在跑（在正在跑的循环底下插一条
     * 用户消息是不行的），只能等本轮收口后由宿主另起一轮。所以这里只把意图递上去排队。
     */
    wrapApi(api, 'wf.invoke', (args) => wfs.invoke(asText(args[0]).trim(), asRecord(args[1])), log)
  }

  // 代码块伪编译：导师把转译好的 JS 交回宿主（见 lib/codeArtifacts）
  if (opts.code) {
    const code = opts.code
    wrapApi(api, 'code.save', (args) => code.save(asRecord(args[0])), log)
    wrapApi(api, 'code.silent', (args) => code.silent(asRecord(args[0])), log)
  }

  // 工作区目录：节点的真实系统目录（见 learn/workspace），支持读写文本、检索、删除、移动与文件下载
  if (opts.workspace) {
    const ws = opts.workspace
    wrapApi(api, 'workspace.list', (args) => ws.list(asOptionalPath(args[0])), log)
    wrapApi(api, 'workspace.read', (args) => ws.read(asOptionalPath(args[0])), log)
    wrapApi(api, 'workspace.write', (args) => ws.write(asRecord(args[0])), log)
    if (ws.grep) {
      wrapApi(api, 'workspace.grep', (args) => {
        const first = args[0]
        if (typeof first === 'string') {
          return ws.grep!({ path: first, query: asText(args[1]) })
        }
        return ws.grep!(asRecord(first))
      }, log)
    }
    if (ws.delete) {
      wrapApi(api, 'workspace.delete', (args) => ws.delete!(args[0]), log)
    }
    if (ws.move) {
      wrapApi(api, 'workspace.move', (args) => ws.move!(args[0], args[1]), log)
    }
    if (ws.download) {
      wrapApi(api, 'workspace.download', (args) => ws.download!(args[0], args[1]), log)
      wrapApi(api, 'files.download', (args) => ws.download!(args[0], args[1]), log)
    }
  }
  // 上下文压缩：摘要由 agent 自己写（见 learn/compact）
  if (opts.compact) {
    const compactOps = opts.compact
    wrapApi(api, 'compact', (args) => compactOps.write(asRecord(args[0])), log)
  }
  // 引用 chip：生成（当场对 store 验证可定位）与交付前自查（见 learn/ops/chip）
  if (opts.chip) {
    const chipOps = opts.chip
    wrapApi(api, 'chip.build', (args) => chipOps.build(asRecord(args[0])), log)
    wrapApi(api, 'chip.check', (args) => chipOps.check(asText(args[0])), log)
  }
  // 这一轮的交付账（文件变动 / 参考引证）：宿主收在本轮消息上，见 agent/delivery
  if (opts.delivery) {
    const delivery = opts.delivery
    wrapApi(api, 'delivery.submit', (args) => delivery.submit(asRecord(args[0])), log)
  }
}
