/**
 * 这个文件负责什么：**沙箱里能调到的全部 api 的定义**。buildApi 把 SandboxOptions 上的宿主能力
 * 逐个包成 api 方法（doc / node / state / tmp / exam / memory / method / sdoc / wf / code /
 * reading / attention / focus / compact / web / userInfo / wait / ask /
 * tiktok / ui / res），wrapApi 负责记账与失败判定；每个 api 都是调用时才读 opts，不持有快照。
 */
import { needleForDoc } from '../../lib/docDom'
import { TmpVars, type TmpInfo } from '../../lib/tmpStore'
import { normalizeAskForm } from './askForm'
import { compileBody } from './body'
import { MAX_RESULT_CHARS } from './limits'
import { asIndex, asOptionalPath, asRecord, asText, type DocRef, type NodeRef } from './refs'
import { renderRootHelp } from './apiRegistry'
import { attachNodeFacade, registerNodeApi } from './nodeObject'
import { wrapApi, imagesOf } from './wrap'
import { filesAccessError } from './dataPaths'
import type { SandboxCall, SandboxOptions } from './types'
import { getLoadedSkills, getActiveSkills } from '../skill/registry'
import {
  getSkillScriptAbsPath,
  getSkillAbsDir,
  getSkillsAbsPath,
  getSkillPathsInfo,
  loadSkillsFromDisk,
  saveSkillToDisk,
  deleteSkillFromDisk,
} from '../skill/fs'
import type { SkillDef } from '../skill/types'
import { vfsBus } from '../../vfs'
import { userAbsPath, userAbsPrefix, storageAbsPath } from '../../lib/storage'

/** 把结果裁到上限：宁可给模型一段被截断的内容，也不要它被 413 顶回来 */
export function clip(text: string, limit = MAX_RESULT_CHARS): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n…（结果过长已截断，共 ' + text.length + ' 字符；可改用临时变量分段处理）'
}

/* ---------- 沙箱 api ---------- */

interface BuiltApi {
  api: Record<string, unknown>
  tmp: TmpVars | null
}

export { imagesOf }

/**
 * 组装一次编排可用的 api。
 *
 * 全部按 path 寻址（见 SandboxOptions 的说明）：解析失败不抛异常，而是把「找不到 +
 * 候选清单」当成正常返回值交回去——模型读到就能自己改对，抛异常只会得到一句栈。
 */
export function buildApi(
  opts: SandboxOptions,
  log: SandboxCall[],
  /**
   * nodeFacade：要不要把 api.node.get 包成「进程内节点对象门面」。**默认关**——
   * 门面对象带吐 Promise 的 getter 与函数成员，只能活在进程内；真 Worker 通道的
   * 回执要过结构化克隆，api.node.get 必须回纯 manifest（Worker 侧自己包成门面，
   * 见 sandboxRuntime 的 wrapManifest）。进程内直调（编排测试 / 探针的 fakeRunner /
   * 超级文档桥）才开。
   */
  addons?: { nodeFacade?: boolean },
): BuiltApi {  const api: Record<string, unknown> = {}
  const tmpView = opts.tmp?.()
  const tmp = tmpView ? new TmpVars(tmpView) : null

  const docRef = (path: unknown): { ref: DocRef } | { error: string } => {
    const r = opts.resolveDoc(asText(path))
    return r.ok ? { ref: r.ref } : { error: r.message }
  }
  const nodeRef = (path: unknown): { ref: NodeRef } | { error: string } => {
    const r = opts.resolveNode(asText(path))
    return r.ok ? { ref: r.ref } : { error: r.message }
  }

  if (tmp) {
    // 局部别名：下面几个闭包里要的是「确定非空」的那一份
    const store = tmp
    wrapApi(api, 'tmp.set', (args) => {
      const a = asRecord(args[0])
      const key = asText(a.key)
      const ttl = typeof a.ttlMs === 'number' ? a.ttlMs : undefined
      store.set(key, a.value, ttl)
      return { ok: true, key, remainingMs: store.list().find((x) => x.key === key)?.remainingMs ?? null }
    }, log)
    wrapApi(api, 'tmp.get', (args) => {
      const key = asText(args[0])
      return { key, found: store.has(key), value: store.get(key) }
    }, log)
    wrapApi(api, 'tmp.has', (args) => ({ key: asText(args[0]), found: store.has(asText(args[0])) }), log)
    wrapApi(api, 'tmp.del', (args) => ({ key: asText(args[0]), deleted: store.del(asText(args[0])) }), log)
    wrapApi(api, 'tmp.list', (): { items: TmpInfo[] } => ({ items: store.list() }), log)
    wrapApi(api, 'tmp.clear', () => ({ removed: store.clear() }), log)
  }

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

  // 工作区目录：节点的真实系统目录（见 learn/workspace），只收文本
  if (opts.workspace) {
    const ws = opts.workspace
    wrapApi(api, 'workspace.list', (args) => ws.list(asOptionalPath(args[0])), log)
    wrapApi(api, 'workspace.read', (args) => ws.read(asOptionalPath(args[0])), log)
    wrapApi(api, 'workspace.write', (args) => ws.write(asRecord(args[0])), log)
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
  // 网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）
  if (opts.web) {
    const web = opts.web
    const fetchOne = async (item: unknown): Promise<unknown> => {
      let url = ''
      if (typeof item === 'string') {
        url = item.trim()
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        url = asText(obj.url ?? obj.link ?? obj.href).trim()
      }
      if (!url) {
        return {
          ok: false,
          title: '',
          content: '',
          error: 'fetch 需要有效的 url 参数，例如 api.fetch({ url: "https://..." }) 或 api.fetch("https://...")',
        }
      }
      return web.fetch(item && typeof item === 'object' ? { ...(item as Record<string, unknown>), url } : { url })
    }
    /** maxChars 截断：省掉模型每次 slice 的手脚；单篇与批量同一套 */
    const clipContent = (maxChars: number | undefined) => (r: unknown): unknown => {
      const rec = r as { content?: unknown } | null
      if (maxChars && rec && typeof rec.content === 'string' && rec.content.length > maxChars) {
        return {
          ...rec,
          content: rec.content.slice(0, maxChars) + '\n…（已按 maxChars 截断，全文共 ' + rec.content.length + ' 字符）',
        }
      }
      return r
    }
    /**
     * 单篇与批量同一入口：api.fetch(url 或 {url}, { maxChars? })；
     * 批量 api.fetch([url, {url}, …], { maxChars? })——并发抓、逐条返回 {ok}，
     * 一篇失败只标记它自己，不拖累其他篇（省掉串行试错整轮整轮地烧）。
     */
    const handleFetch = async (args: unknown[]): Promise<unknown> => {
      const options = args[1] && typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : {}
      const maxChars = typeof options.maxChars === 'number' && options.maxChars > 0 ? Math.floor(options.maxChars) : undefined
      const clip = clipContent(maxChars)
      if (Array.isArray(args[0])) {
        const items = args[0]
        if (!items.length) return { ok: false, error: '批量 fetch 要给 url 数组：api.fetch([url1, url2], { maxChars })' }
        if (items.length > 5) {
          return { ok: false, error: '一次最多并发抓 5 篇（收到 ' + items.length + '）——挑最权威的几篇就够' }
        }
        const results = await Promise.all(
          items.map(async (item) => {
            try {
              return await fetchOne(item).then(clip)
            } catch (err) {
              return { ok: false, title: '', content: '', error: err instanceof Error ? err.message : String(err) }
            }
          }),
        )
        return { ok: true, results }
      }
      return fetchOne(args[0]).then(clip)
    }
    // 支持 api.fetch 与 api.web.fetch
    // 顶层 fetch 是 web.fetch 的快捷别名：提示词里教的就是 api.fetch，别删
    wrapApi(api, 'fetch', handleFetch, log)
    wrapApi(api, 'web.fetch', handleFetch, log)

    // web.search（完全支持 DeepSeek Search API 参数）
    if (web.search) {
      const webSearch = web.search
      wrapApi(
        api,
        'web.search',
        (args) => {
          const first = args[0]
          if (typeof first === 'object' && first !== null) {
            return webSearch(first)
          }
          const query = asText(first).trim()
          if (!query) {
            return {
              ok: false,
              results: [],
              error:
                'web.search 需要有效的 query 搜索词，例如 api.web.search({ query: "知识点" }) 或 api.web.search("知识点", { count: 5 })',
            }
          }
          const second = asRecord(args[1])
          return webSearch({ query, ...second })
        },
        log,
      )
    }
  }

  // 内置浏览器（browser.*，见 learn/web/browserOps）：界面上开着的网页页签的打开、
  // 管理、快照/阅读与受控 DOM 操作（看=snapshot/read，动手=dom，突出=point）。
  // 依赖界面注入（webview 元素在渲染层），未注入就没有这一组。
  if (opts.browser) {
    const browser = opts.browser
    wrapApi(api, 'browser.open', (args) => browser.open(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.tabs', () => browser.tabs(), log)
    wrapApi(api, 'browser.activate', (args) => browser.activate(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.close', (args) => browser.close(Array.isArray(args[0]) ? (args[0].map((v) => asText(v).trim()) as string[]) : asText(args[0]).trim()), log)
    wrapApi(api, 'browser.snapshot', (args) => {
      const tabId = args.length ? asText(args[0]).trim() || undefined : undefined
      return browser.snapshot(tabId, asRecord(args[1]))
    }, log)
    /*
     * 带目标的方法（point）收两种写法：方法(目标) 与 方法(tabId, 目标)。
     * tabId 一定是 tabs() 回的 w: 开头的 id，而 CSS 选择器不可能以 w: 开头，
     * 凭这个区分第一参是不是页签。
     */
    const tabIdOf = (v: unknown): string | undefined =>
      typeof v === 'string' && v.startsWith('w:') ? v : undefined
    /** 日志/直发这组**必须显式给 tabId**（跟着页签走，不吃焦点默认）——少参数就指路 */
    const requireTabId = (v: unknown, what: string): string => {
      const id = tabIdOf(v)
      if (!id) throw new Error(what + ' 必须显式给 tabId（browser.tabs() 里查的 w: 开头页签号）——日志与请求都跟着页签走，不吃焦点默认')
      return id
    }
    const targetOf = (v: unknown): string | { ref: number } => {
      if (typeof v === 'string' && v.trim()) return v.trim()
      const o = asRecord(v)
      if (typeof o.ref === 'number') return { ref: o.ref }
      throw new Error('目标要给 browser.snapshot 清单里的 { ref } 或 CSS 选择器字符串')
    }
    wrapApi(api, 'browser.point', (args) => {
      const tabId = tabIdOf(args[0])
      const rest = tabId ? args.slice(1) : args
      return browser.point(tabId, targetOf(rest[0]))
    }, log)
    // dom 两种写法：dom(ref, op, arg?) 与 dom(tabId, ref, op, arg?)；ref 认数字或 { ref }（与 text/point 一致）
    wrapApi(api, 'browser.dom', (args) => {
      const tabId = tabIdOf(args[0])
      const rest = tabId ? args.slice(1) : args
      const refRaw = rest[0]
      const ref =
        typeof refRaw === 'object' && refRaw !== null
          ? Number(asRecord(refRaw).ref)
          : Number(refRaw)
      if (!Number.isFinite(ref)) throw new Error('ref 要给编号数字或 { ref }（browser.snapshot 清单里的，两种写法都认）')
      const arg = rest[2] === undefined ? undefined : asText(rest[2])
      return browser.dom(tabId, ref, asText(rest[1]).trim(), arg)
    }, log)
    wrapApi(api, 'browser.read', (args) => browser.read(args.length ? asText(args[0]).trim() || undefined : undefined), log)
    wrapApi(api, 'browser.capture', (args) => browser.capture(args.length ? asText(args[0]).trim() || undefined : undefined), log)
    /*
     * 日志与直发这四条**必须显式给 tabId**（跟着页签走，不吃焦点默认）；
     * fetch 的目标认两种写法：网址字符串，或 { reqId }（重放网络清单里捕获的请求）。
     */
    wrapApi(api, 'browser.logs', (args) => browser.logs(requireTabId(args[0], 'browser.logs'), asRecord(args[1])), log)
    wrapApi(api, 'browser.logDetail', (args) => {
      // 条目号照抄清单行也认：96 / 'n96' / 'c96'
      const raw = args[1]
      const seq = typeof raw === 'number' ? raw : Number(String(asText(raw)).replace(/^[nc]/i, ''))
      if (!Number.isFinite(seq)) throw new Error('seq 要给清单行里的条目号（96、"n96" 都行）')
      return browser.logDetail(requireTabId(args[0], 'browser.logDetail'), seq, asRecord(args[2]))
    }, log)
    wrapApi(api, 'browser.fetch', (args) => {
      const target = typeof args[1] === 'string' ? args[1].trim() : asRecord(args[1])
      if (typeof target !== 'string' && !('reqId' in (target as Record<string, unknown>))) {
        throw new Error('目标要给 http(s) 网址，或 { reqId }（browser.logs 网络清单里的条目号）')
      }
      const o = asRecord(args[2])
      const toTmp = typeof o.toTmp === 'string' && o.toTmp.trim() ? o.toTmp.trim() : undefined
      if (toTmp) {
        // 全文落 tmp：上限放宽到 256k（页面侧同步放宽采文本上限），正文不进上下文
        o.maxBody = 262_144
        o.maxText = 262_144
      }
      const p = browser.fetch(requireTabId(args[0], 'browser.fetch'), target as string | { reqId: number }, o)
      if (!toTmp) return p
      return Promise.resolve(p).then((r) => {
        const rec = r as Record<string, unknown>
        const body = typeof rec.body === 'string' ? rec.body : undefined
        if (body === undefined) return r
        if (!tmp) return { ...rec, note: 'toTmp 需要临时变量（当前注入里没有 tmp）——去掉 toTmp 直接拿 body' }
        tmp.set(toTmp, rec)
        return {
          status: rec.status,
          ...(rec.contentType ? { contentType: rec.contentType } : {}),
          ...(rec.chars ? { chars: rec.chars } : {}),
          ...(rec.replayed ? { replayed: rec.replayed } : {}),
          tmp: toTmp,
          preview: body.slice(0, 400),
          note:
            '全文已落 tmp.' + toTmp + '（含 status/contentType/body）：在代码里 api.tmp.get(\'' + toTmp + '\') 取出来 JSON.parse 解析，只把提炼结果 return——别把全文交回来',
        }
      })
    }, log)
    wrapApi(api, 'browser.waitFor', (args) => {
      const req = asRecord(args[1])
      return browser.waitFor(requireTabId(args[0], 'browser.waitFor'), req)
    }, log)
    wrapApi(api, 'browser.record', (args) => {
      const action = asText(args[1]).trim()
      if (action !== 'start' && action !== 'stop') throw new Error('record 的动作只有 "start" / "stop"')
      return browser.record(requireTabId(args[0], 'browser.record'), action, asRecord(args[2]))
    }, log)
    // 区域文本：目标认 '选择器' 或 { ref }（同 point 的双写法，但不吃焦点默认）
    wrapApi(api, 'browser.text', (args) => {
      const target = typeof args[1] === 'string' ? args[1].trim() : asRecord(args[1])
      if (typeof target !== 'string' && !('ref' in (target as Record<string, unknown>))) {
        throw new Error('目标要给 snapshot 清单里的 { ref } 或 CSS 选择器')
      }
      return browser.text(requireTabId(args[0], 'browser.text'), target as string | { ref: number }, asRecord(args[2]))
    }, log)
    wrapApi(api, 'browser.scroll', (args) => {
      const req = asRecord(args[1])
      return browser.scroll(requireTabId(args[0], 'browser.scroll'), req)
    }, log)
  }

  // 外部 MCP 服务（mcp.*，见 agent/mcp/ops）：用户配置的真实外部工具。
  // MCP 总开关关着就没有这一组——与旧做法「关闭时不注入任何 MCP 工具」同一口径。
  if (opts.mcp) {
    const mcp = opts.mcp
    wrapApi(api, 'mcp.list', () => mcp.list(), log)
    wrapApi(
      api,
      'mcp.discover',
      (args) => mcp.discover(args.length ? asText(args[0]).trim() || undefined : undefined),
      log,
    )
    wrapApi(api, 'mcp.call', (args) => {
      const server = asText(args[0]).trim()
      const tool = asText(args[1]).trim()
      if (!server || !tool) {
        return {
          ok: false,
          error: 'mcp.call 需要服务与工具名：mcp.call(服务, 工具, 参数对象?)——服务和工具名见 api.mcp.list()',
        }
      }
      return mcp.call(server, tool, args[2])
    }, log)
  }

  // 学习者画像：get 回给模型看的那份（不含头像），update 是增量的（只写传进来的字段）
  if (opts.userInfo) {
    const userInfo = opts.userInfo
    wrapApi(api, 'userInfo.get', () => userInfo.get(), log)
    wrapApi(api, 'userInfo.update', (args) => userInfo.update(asRecord(args[0])), log)
  }

  // 阻塞等待：范围收在 0~120000，长睡只会让用户以为卡死了
  if (opts.wait) {
    const wait = opts.wait
    wrapApi(api, 'wait', (args) => {
      const first = args[0]
      let ms = 0
      if (typeof first === 'object' && first !== null) {
        const obj = first as Record<string, unknown>
        if (typeof obj.seconds === 'number') {
          if (obj.seconds < 0) return { ok: false, error: 'wait 时间不能为负数' }
          ms = Math.round(obj.seconds * 1000)
        } else if (typeof obj.ms === 'number') {
          if (obj.ms < 0) return { ok: false, error: 'wait 时间不能为负数' }
          ms = Math.round(obj.ms)
        }
      } else {
        const raw = typeof first === 'number' ? first : Number(first)
        if (Number.isFinite(raw)) {
          if (raw < 0) return { ok: false, error: 'wait 时间不能为负数' }
          ms = Math.round(raw)
        }
      }
      ms = Math.min(120_000, ms)
      return wait(ms).then(() => ({ ok: true, waited: ms }))
    }, log)
  }

  // 结构化表单：形状先归一化，校验失败把「第几题、哪个字段」说清楚再回给模型
  if (opts.ask) {
    const ask = opts.ask
    wrapApi(api, 'ask', (args) => {
      const parsed = normalizeAskForm(args[0])
      if (!parsed.ok) return parsed
      return ask(parsed.form)
    }, log)
  }

  if (opts.tiktok) {
    const tiktok = opts.tiktok
    wrapApi(api, 'tiktok', () => Promise.resolve(tiktok()).then(() => ({ ok: true, note: '已响铃' })), log)
  }

  // 看图 / 看 PDF 页（顶层 api）：字符串与对象两种写法都收，图片本身由宿主挂到下一跳（见 learn/see）
  if (opts.see) {
    const see = opts.see
    wrapApi(api, 'see', (args) => {
      const first = args[0]
      if (typeof first === 'string') return see({ raw: first })
      const obj = asRecord(first)
      if (!Object.keys(obj).length) {
        return {
          error:
            'see 需要一张图或一份 PDF：api.see(\'https://…/图.png\')、api.see({ pdf: \'https://…/论文.pdf\', page: 3 })、' +
            "api.see({ base64: '…', mime: 'image/png', name: '叫什么' })。",
        }
      }
      const rawPage = obj.page
      const page = Array.isArray(rawPage)
        ? rawPage.map((v) => Number(v)).filter((v) => Number.isFinite(v))
        : typeof rawPage === 'number' || typeof rawPage === 'string'
          ? Number(rawPage)
          : undefined
      return see({
        ...(obj.raw !== undefined ? { raw: asText(obj.raw) } : {}),
        ...(obj.url !== undefined || obj.link !== undefined || obj.href !== undefined
          ? { url: asText(obj.url ?? obj.link ?? obj.href) }
          : {}),
        ...(obj.base64 !== undefined || obj.dataUrl !== undefined || obj.b64 !== undefined
          ? { base64: asText(obj.base64 ?? obj.dataUrl ?? obj.b64) }
          : {}),
        ...(obj.mime !== undefined ? { mime: asText(obj.mime) } : {}),
        ...(obj.name !== undefined ? { name: asText(obj.name) } : {}),
        ...(obj.pdf !== undefined ? { pdf: asText(obj.pdf) } : {}),
        ...(page !== undefined && (!Array.isArray(page) || page.length) ? { page } : {}),
      })
    }, log)
  }

  if (opts.ui) {
    const ui = opts.ui
    if (ui.toast) {
      const toast = ui.toast
      wrapApi(api, 'ui.toast', (args) => {
        const message = asText(args[0]).trim()
        if (!message) return { error: '消息不能为空' }
        toast(message.slice(0, 200))
        return { ok: true }
      }, log)
    }
    if (ui.point) {
      const point = ui.point
      wrapApi(api, 'ui.point', async (args) => {
        /**
         * 两种写法都收：ui.point(path, { line, regex }) 与 ui.point({ path, line, regex })。
         * path 省略 = 当前节点的教学文档（与 doc.* 的约定一致）。
         */
        const hasPathFirst = typeof args[0] === 'string'
        const path = hasPathFirst ? asText(args[0]) : asText(asRecord(args[0]).path)
        const obj = asRecord(hasPathFirst ? args[1] : args[0])
        const r = docRef(path)
        if ('error' in r) return { error: r.error }
        const ref = r.ref
        const content = opts.docOps.read(ref.id, ref.kind, ref.note)
        // 行号 → 定位文字 + 比例兜底：这一套规则与文档跳转语法（moji:doc/…#L12）共用，
        // 见 lib/docDom 的 needleForDoc
        const byLine = needleForDoc(content, { line: asIndex(obj.line) })
        let needle = byLine.needle ?? ''
        let fallbackRatio: number | undefined = byLine.fallbackRatio
        const pattern = asText(obj.regex)
        if (!needle && pattern) {
          try {
            const flags = asText(obj.flags)
            const m = new RegExp(pattern, flags).exec(content)
            if (m && m[0]) {
              needle = m[0].replace(/\s+/g, ' ').trim().slice(0, 160)
              fallbackRatio = m.index / Math.max(1, content.length)
            }
          } catch (err) {
            return { error: '正则不合法：' + (err instanceof Error ? err.message : String(err)) }
          }
        }
        const res = await point({
          nodeId: ref.id,
          kind: ref.kind,
          ...(ref.note ? { note: ref.note } : {}),
          ...(needle ? { needle } : {}),
          ...(fallbackRatio !== undefined ? { fallbackRatio } : {}),
        })
        const hasSpecificTarget = !!needle || !!pattern || asIndex(obj.line) !== undefined
        return {
          ok: true,
          path: ref.docLabel,
          located: res.located,
          note: !hasSpecificTarget
            ? '已在页签里打开教学文档，用户看得到。'
            : res.located
              ? '已在页签里打开并定位，用户看得到。'
              : '文档已打开；没能在正文里精确选中（这一行可能是公式或代码），已按大致位置滚动。要指给用户看，请说明去看什么。',
        }
      }, log)
    }
    if (ui.scroll) {
      const scroll = ui.scroll
      wrapApi(api, 'ui.scroll', (args) => {
        const a = asRecord(args[0])
        const to = a.to === 'top' || a.to === 'bottom' ? a.to : undefined
        const by = typeof a.by === 'number' ? Math.max(-20_000, Math.min(20_000, Math.round(a.by))) : undefined
        if (!to && !by) return { error: "要给出方向：ui.scroll({ to: 'top' | 'bottom' }) 或 ui.scroll({ by: 像素，负数往上 })" }
        scroll({ ...(to ? { to } : {}), ...(by !== undefined ? { by } : {}) })
        return { ok: true }
      }, log)
    }
    if (ui.capture) {
      const capture = ui.capture
      wrapApi(api, 'ui.screenshot', () => capture(), log)
    }
    if (ui.openSuper) {
      const openSuper = ui.openSuper
      wrapApi(api, 'ui.superdoc', async (args) => {
        // 两种写法都收：ui.superdoc(path, name) 与 ui.superdoc({ path, name })
        const obj = asRecord(args.length === 1 ? args[0] : args[1])
        const path = args.length === 1 ? asText(obj.path) : asText(args[0])
        const name = (args.length === 1 ? asText(obj.name) : asText(args[1])).trim()
        if (!name) return { error: '要给出超级文档的名字：ui.superdoc(path?, name)' }
        const r = nodeRef(path)
        if ('error' in r) return { error: r.error }
        const res = await openSuper({ nodeId: r.ref.id, name })
        return {
          ok: true,
          opened: res.opened,
          note: res.opened
            ? '已在页签里打开「' + name + '」，用户看得到。'
            : '这个节点下尚未找到叫「' + name + '」的超级文档（请确认已通过 api.files.write 写入对应节点的 superdocs/' + name + '.html 文件）。',
        }
      }, log)
    }
    // ui.dom 不在这里注册：回调函数无法穿过 Worker 边界，Worker 侧特判成
    // 「先建会话、再逐个操作」（见 sandboxRuntime 与 createExecuteTool 的 callApi）
  }

  if (opts.resources) {
    const res = opts.resources
    const uuid = (v: unknown): string => asText(v).trim()
    wrapApi(api, 'res.list', () => res.list(), log)
    wrapApi(api, 'res.info', (args) => res.info(uuid(args[0])), log)
    wrapApi(api, 'res.read', (args) => {
      // 区间读法：res.read(uuid, { start, end })
      const a = asRecord(args[1])
      return res.read(uuid(args[0]), { start: asIndex(a.start), end: asIndex(a.end) })
    }, log)
    wrapApi(api, 'res.create', (args) => {
      const a = asRecord(args[0])
      return res.create({ name: asText(a.name), ext: asText(a.ext), content: asText(a.content) })
    }, log)
    wrapApi(api, 'res.update', (args) => {
      const p = asRecord(args[1])
      const patch: { name?: string; description?: string; content?: string } = {}
      if (typeof p.name === 'string') patch.name = p.name
      if (typeof p.description === 'string') patch.description = p.description
      if (typeof p.content === 'string') patch.content = p.content
      return res.update(uuid(args[0]), patch)
    }, log)
    wrapApi(api, 'res.delete', (args) => {
      // res.delete(uuid, { force: true }) 与 res.delete(uuid, true) 都收
      const force = args[1] === true || asRecord(args[1]).force === true
      return res.remove(uuid(args[0]), force)
    }, log)
    wrapApi(api, 'res.refs', (args) => res.refs(args.length ? uuid(args[0]) : undefined), log)
  }

  // 子代理管理（subagent.*）：**导师专用**——SUBAGENT_ALLOWED_GROUPS 里没有这一组，
  // 子代理的 apiAllow 白名单永远放不进来（不递归在通道口硬挡）。实现在 subagent/manager。
  if (opts.subagent) {
    const sa = opts.subagent
    wrapApi(api, 'subagent.create', (args) => sa.create(asRecord(args[0])), log)
    wrapApi(api, 'subagent.run', (args) => sa.run(asRecord(args[0])), log)
    wrapApi(api, 'subagent.resume', (args) => sa.resume(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.intervene', (args) => sa.intervene(asText(args[0]).trim(), asText(args[1])), log)
    wrapApi(api, 'subagent.interrupt', (args) => sa.interrupt(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.view', (args) => sa.view(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.delete', (args) => sa.remove(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.wait', (args) => {
      const first = args[0]
      const payload = typeof first === 'number' ? { seconds: first } : asRecord(first)
      return sa.wait(payload)
    }, log)
  }

  // 路径放行（permission.*）：外部目录的查看、撤销与审批。宿主实现见 agent/permissions；
  // **导师专用**——SUBAGENT_ALLOWED_GROUPS 里没有这一组，改放行配置不从子代理手里过。
  if (opts.permission) {
    const perm = opts.permission
    wrapApi(api, 'permission.list', () => perm.list(), log)
    wrapApi(api, 'permission.revoke', (args) => {
      const raw = asText(args[0]).trim()
      if (!raw) return { ok: false, error: 'permission.revoke 需要一个 path（要撤销放行的目录）' }
      return perm.revoke(raw)
    }, log)
    wrapApi(api, 'permission.request', (args) => {
      const a = asRecord(args[0])
      const rawPath = asText(a.path).trim()
      if (!rawPath) {
        return { ok: false, error: 'permission.request 需要 path（要放行的目录），可附 reason 说明给用户看' }
      }
      return perm.request({ path: rawPath, ...(asText(a.reason).trim() ? { reason: asText(a.reason).trim() } : {}) })
    }, log)
  }

  // 基础系统真实文件系统与受控系统进程 (files.* / process.*)
  const getNativeFiles = () => {
    if (typeof window !== 'undefined') {
      if (window.mojiNative?.files) return window.mojiNative.files
      if (window.mojiNative?.base?.files) return window.mojiNative.base.files
    }
    return null
  }

  const getNativeProcess = () => {
    if (typeof window !== 'undefined') {
      if (window.mojiNative?.process) return window.mojiNative.process
      if (window.mojiNative?.base?.process) return window.mojiNative.base.process
    }
    return null
  }

  /**
   * 将 Agent 传入的相对路径映射到当前活跃用户的作用域根目录。
   * 彻底解决数据契约路径错位 (A3) 并防止泄露应用根的私有文件 (C5)。
   */
  const resolveSandboxedPath = (raw: string): string => {
    let p = raw.trim().replace(/\\/g, '/')
    if (!p || p === '.') {
      return userAbsPrefix()?.replace(/\\/g, '/') ?? p
    }

    // 快捷形式支持：若以 笔记/ 或 notes/ 开头，自动解析至当前打开节点的笔记目录
    if (p.startsWith('笔记/') || p.startsWith('notes/')) {
      const noteName = p.replace(/^(?:笔记|notes)\//, '').replace(/\.md$/, '')
      const curDoc = opts.resolveDoc('')
      if (curDoc.ok) {
        const label = curDoc.ref.label.replace(/\\/g, '/')
        p = `docs/${label}.notes/${noteName}.md`
      }
    }

    // 绝对路径（Windows 盘符如 C:/ 或 POSIX 绝对路径）原样放行，供白名单校验
    if (/^[A-Za-z]:\//.test(p) || p.startsWith('/')) {
      return p
    }
    // 显式以 users/ 开头的路径已自带相对根前缀
    if (p.startsWith('users/')) {
      return p
    }
    // 技能目录：skills/... 位于数据根目录（与 users/ 平级），直接映射到 {root}/skills/...
    if (p === 'skills' || p.startsWith('skills/')) {
      const absSkills = storageAbsPath(p)
      if (absSkills) return absSkills.replace(/\\/g, '/')
    }
    // 相对路径（docs/...、workflows/...、stats/...、tmp/...）一律解析为当前用户目录下的绝对路径
    const abs = userAbsPath(p)
    return abs ? abs.replace(/\\/g, '/') : p
  }

  /**
   * 将写入磁盘的教学正文或大纲双向同步至当前内存 Store 及快照。
   * 彻底根治 A2（正文写入被 UI 空 Store 覆盖清空为 0 字节的问题）。
   */
  const syncFileToStore = (filePath: string, content?: string) => {
    if (typeof content !== 'string') return
    try {
      const norm = filePath.replace(/\\/g, '/')
      const matchDoc = norm.match(/(?:^|\/)docs\/(.+)$/)
      if (!matchDoc) return
      const relDoc = matchDoc[1] // 例如 '微积分/极限/极限.md' 或 '微积分/极限/极限.outline.json' 或 '微积分/极限.notes/错题本.md'
      const isOutline = relDoc.endsWith('.outline.json')
      const isMd = relDoc.endsWith('.md')
      if (!isOutline && !isMd) return

      // 处理笔记模式: *.notes/*.md
      const noteMatch = relDoc.match(/(?:^|\/)([^/]+)\.notes\/([^/]+)\.md$/)
      if (noteMatch) {
        const nodeTarget = noteMatch[1]
        const noteName = noteMatch[2]
        const resolved = opts.resolveDoc(nodeTarget)
        if (resolved.ok && opts.docOps?.write) {
          opts.docOps.write(resolved.ref.id, 'note', noteName, content)
        }
        return
      }

      const cleanTarget = relDoc
        .replace(/\.outline\.json$/, '')
        .replace(/\.md$/, '')
      const resolved = opts.resolveDoc(cleanTarget)
      if (!resolved.ok) return
      const nodeId = resolved.ref.id

      if (isMd && opts.docOps?.write) {
        const kind = resolved.ref.kind === 'note' ? 'note' : 'teaching'
        opts.docOps.write(nodeId, kind, resolved.ref.note, content)
      } else if (isOutline) {
        // 大纲镜像：解析成对象交给大纲节点的 editContent（节点宇宙的正规写入口）
        try {
          const parsed = JSON.parse(content)
          opts.nodes?.service()?.get('o:' + nodeId)?.editContent(parsed)
        } catch {
          // 忽略非标准 json
        }
      }
    } catch {
      // 容错捕获，保证 files.write/edit 主通道不受干扰
    }
  }

  const isProtectedChatFile = (p: string): boolean => {
    const norm = p.replace(/\\/g, '/').toLowerCase()
    return norm === 'chat.json' || norm.endsWith('/chat.json')
  }

  const resolveSandboxedDocPath = (raw: string): { ok: true; path: string } | { ok: false; error: string } => {
    const trimmed = raw.trim()
    if (!trimmed) {
      const curDoc = opts.resolveDoc('')
      if (curDoc.ok) {
        const disk = opts.docPath?.(curDoc.ref.id)
        if (disk) {
          return { ok: true, path: resolveSandboxedPath(disk) }
        }
        const label = curDoc.ref.label.replace(/\\/g, '/')
        const title = curDoc.ref.title
        return { ok: true, path: resolveSandboxedPath(`docs/${label}/${title}.md`) }
      }
      return { ok: false, error: '未指定文件路径且当前无激活的教学节点，请显式提供目标文件路径（例如 "docs/..." 或用 api.workspace.list() 查）' }
    }
    return { ok: true, path: resolveSandboxedPath(trimmed) }
  }

  wrapApi(api, 'files.read', async (args) => {
    const rawP = asText(args[0])
    const resolved = resolveSandboxedDocPath(rawP)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.path
    const denied = filesAccessError(rawP || p, 'read')
    if (denied) return denied
    const optArg = args[1]
    const opt = typeof optArg === 'string' ? { encoding: optArg } : asRecord(optArg)
    const nf = getNativeFiles()
    if (!nf) return { ok: true, content: '', encoding: 'utf8', size: 0 }
    return await nf.read(p, {
      encoding: opt.encoding === 'base64' ? 'base64' : opt.encoding === 'binary' ? 'binary' : 'utf8',
      offset: typeof opt.offset === 'number' ? opt.offset : undefined,
      maxBytes: typeof opt.maxBytes === 'number' ? opt.maxBytes : undefined,
    })
  }, log)

  wrapApi(api, 'files.write', async (args) => {
    const rawP = asText(args[0])
    const resolved = resolveSandboxedDocPath(rawP)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.path
    const denied = filesAccessError(rawP || p, 'write')
    if (denied) return denied
    if (isProtectedChatFile(p)) {
      return { ok: false, error: 'chat.json 属于系统核心会话状态，禁止由脚本直接写入或修改' }
    }
    const rawContent = args[1]
    if (rawContent === undefined || rawContent === null) {
      return { ok: false, error: 'files.write 的 content 参数不能为空 (undefined/null)' }
    }
    const content =
      typeof rawContent === 'string'
        ? rawContent
        : typeof rawContent === 'object'
          ? JSON.stringify(rawContent, null, 2)
          : String(rawContent)
    const opt = asRecord(args[2])
    const nf = getNativeFiles()
    if (!nf) {
      syncFileToStore(rawP, content)
      return { ok: true, path: p, bytesWritten: Buffer.byteLength(content, 'utf8') }
    }
    const res = await nf.write(p, content, {
      encoding: opt.encoding === 'base64' ? 'base64' : 'utf8',
      overwrite: opt.overwrite !== false,
    })
    if (res.ok) {
      syncFileToStore(rawP, content)
      vfsBus.notifyExternalChange({ path: p, action: 'write', content, source: 'agent' })
      if (p.includes('/skills/') || p.endsWith('/skills') || p.includes('\\skills\\') || p.endsWith('\\skills')) {
        void loadSkillsFromDisk()
      }
    }
    return res
  }, log)

  wrapApi(api, 'files.edit', async (args) => {
    const rawP = asText(args[0])
    const resolved = resolveSandboxedDocPath(rawP)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    const p = resolved.path
    const denied = filesAccessError(rawP || p, 'edit')
    if (denied) return denied
    if (isProtectedChatFile(p)) {
      return { ok: false, error: 'chat.json 属于系统核心会话状态，禁止由脚本直接修改' }
    }
    const opt = asRecord(args[1])
    const nf = getNativeFiles()
    if (!nf) return { ok: true, path: p, modified: false }
    const replaceObj = opt.replace ? asRecord(opt.replace) : undefined
    const editsArr = Array.isArray(opt.edits) ? opt.edits.map(asRecord) : undefined
    const res = await nf.edit(p, {
      replace: replaceObj
        ? {
            target: asText(replaceObj.target ?? replaceObj.old ?? replaceObj.search ?? replaceObj.find),
            replacement: asText(replaceObj.replacement ?? replaceObj.new ?? replaceObj.replace),
            all: replaceObj.all === true,
          }
        : undefined,
      edits: editsArr
        ? editsArr.map((e) => ({
            ...e,
            target: e.target ?? e.old ?? e.search ?? e.find ? asText(e.target ?? e.old ?? e.search ?? e.find) : undefined,
            replacement: e.replacement ?? e.new ?? e.replace ? asText(e.replacement ?? e.new ?? e.replace) : undefined,
            append: typeof e.append === 'string' ? e.append : undefined,
            prepend: typeof e.prepend === 'string' ? e.prepend : undefined,
            insert: typeof e.insert === 'string' ? e.insert : undefined,
            after: typeof e.after === 'string' ? e.after : undefined,
            before: typeof e.before === 'string' ? e.before : undefined,
            all: e.all === true,
          }))
        : undefined,
      content: typeof opt.content === 'string' ? opt.content : undefined,
      append: typeof opt.append === 'string' ? opt.append : undefined,
      prepend: typeof opt.prepend === 'string' ? opt.prepend : undefined,
      start: typeof opt.start === 'number' ? opt.start : undefined,
      end: typeof opt.end === 'number' ? opt.end : undefined,
    })
    if (res.ok) {
      let latestContent: string | undefined
      try {
        const latest = await nf.read(p, { encoding: 'utf8' })
        if (latest.ok && typeof latest.content === 'string') {
          latestContent = latest.content
          syncFileToStore(rawP, latest.content)
        }
      } catch {
        // ignore
      }
      vfsBus.notifyExternalChange({ path: p, action: 'edit', content: latestContent, source: 'agent' })
      if (p.includes('/skills/') || p.endsWith('/skills') || p.includes('\\skills\\') || p.endsWith('\\skills')) {
        void loadSkillsFromDisk()
      }
    }
    return res
  }, log)

  wrapApi(api, 'files.list', async (args) => {
    const rawP = args.length ? asText(args[0]) : '.'
    const denied = filesAccessError(rawP, 'list')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    const nf = getNativeFiles()
    if (!nf) return { ok: true, path: p, entries: [] }
    const res = (await nf.list(p)) as { ok: boolean; path?: string; entries?: Array<string | { name?: string }> }
    if (res && res.ok && Array.isArray(res.entries)) {
      res.entries = res.entries.filter((e) => {
        const name = typeof e === 'string' ? e : e?.name
        return name !== 'chat.json'
      })
    }
    return res
  }, log)

  wrapApi(api, 'files.stat', async (args) => {
    const rawP = asText(args[0])
    const denied = filesAccessError(rawP, 'stat')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    const nf = getNativeFiles()
    if (!nf) return { ok: true, stat: { exists: true, isDirectory: false, isFile: true, size: 0, mtimeMs: 0, ctimeMs: 0 } }
    return await nf.stat(p)
  }, log)

  wrapApi(api, 'files.mkdir', async (args) => {
    const rawP = asText(args[0])
    const denied = filesAccessError(rawP, 'mkdir')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    return await nf.mkdir(p)
  }, log)

  wrapApi(api, 'files.copy', async (args) => {
    const from = resolveSandboxedPath(asText(args[0]))
    const to = resolveSandboxedPath(asText(args[1]))
    const opt = asRecord(args[2])
    const denied = filesAccessError(asText(args[0]) || from, 'copy') ?? filesAccessError(asText(args[1]) || to, 'copy')
    if (denied) return denied
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    return await nf.copy(from, to, { overwrite: opt.overwrite !== false })
  }, log)

  wrapApi(api, 'files.move', async (args) => {
    const from = resolveSandboxedPath(asText(args[0]))
    const to = resolveSandboxedPath(asText(args[1]))
    const denied = filesAccessError(asText(args[0]) || from, 'move') ?? filesAccessError(asText(args[1]) || to, 'move')
    if (denied) return denied
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    return await nf.move(from, to)
  }, log)

  wrapApi(api, 'files.delete', async (args) => {
    const rawP = asText(args[0])
    const denied = filesAccessError(rawP, 'delete')
    if (denied) return denied
    const p = resolveSandboxedPath(rawP)
    if (isProtectedChatFile(p)) {
      return { ok: false, error: 'chat.json 属于系统核心会话状态，禁止由脚本删除' }
    }
    const nf = getNativeFiles()
    if (!nf) return { ok: true }
    const res = await nf.delete(p)
    if (res.ok) {
      vfsBus.notifyExternalChange({ path: p, action: 'delete', source: 'agent' })
      if (p.includes('/skills/') || p.endsWith('/skills') || p.includes('\\skills\\') || p.endsWith('\\skills')) {
        void loadSkillsFromDisk()
      }
    }
    return res
  }, log)

  // 自描述 api.help()：与 api.__help() 同义（注册表渲染，避免这里再抄一份组清单）
  wrapApi(api, 'help', () => {
    return { ok: true, help: renderRootHelp() }
  }, log)

  wrapApi(api, 'process.create', async (args) => {
    const opt = asRecord(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: 'proc_mock_1', command: asText(opt.command), args: [], cwd: '' }
    return await np.create({
      command: asText(opt.command),
      args: Array.isArray(opt.args) ? opt.args.map(asText) : undefined,
      cwd: typeof opt.cwd === 'string' ? opt.cwd : undefined,
      env: opt.env && typeof opt.env === 'object' ? (opt.env as Record<string, string>) : undefined,
    })
  }, log)

  wrapApi(api, 'process.start', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: pid, pid: 1234 }
    return await np.start(pid)
  }, log)

  wrapApi(api, 'process.status', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, status: { process_id: pid, command: '', args: [], cwd: '', running: false, exited: true, exitCode: 0, signal: null } }
    return await np.status(pid)
  }, log)

  wrapApi(api, 'process.output', async (args) => {
    const pid = asText(args[0])
    const opt = asRecord(args[1])
    const np = getNativeProcess()
    if (!np) return { ok: true, stdout: '', stderr: '', text: '', offset: 0, next_offset: 0 }
    return await np.output(pid, {
      offset: typeof opt.offset === 'number' ? opt.offset : undefined,
      reset: opt.reset === true,
    })
  }, log)

  wrapApi(api, 'process.stop', async (args) => {
    const pid = asText(args[0])
    const opt = asRecord(args[1])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: pid, stopped: true }
    return await np.stop(pid, {
      timeoutMs: typeof opt.timeoutMs === 'number' ? opt.timeoutMs : undefined,
      force: opt.force === true,
    })
  }, log)

  wrapApi(api, 'process.list', async () => {
    const np = getNativeProcess()
    if (!np) return { ok: true, processes: [] }
    return await np.list()
  }, log)

  wrapApi(api, 'process.get', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process: { process_id: pid, command: '', args: [], cwd: '', running: false, exited: true, exitCode: 0, signal: null } }
    return await np.get(pid)
  }, log)

  wrapApi(api, 'process.delete', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: pid, deleted: true }
    return await np.delete(pid)
  }, log)

  wrapApi(api, 'skill.paths', async (args) => {
    const id = args.length ? asText(args[0]) : undefined
    return await getSkillPathsInfo(id)
  }, log)

  wrapApi(api, 'skill.list', async () => {
    const skills = getActiveSkills()
    const root = await getSkillsAbsPath()
    return {
      ok: true,
      root,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        dir: `${root}\\${s.id}`,
        description: s.description,
        whenToUse: s.whenToUse,
        category: s.category,
        tags: s.tags,
        scripts: s.scripts ?? [],
        references: s.references ?? [],
      })),
    }
  }, log)

  wrapApi(api, 'skill.read', async (args) => {
    const id = asText(args[0])
    if (!id) return { ok: false, error: '缺少技能 id 参数' }
    const skills = getLoadedSkills()
    const target = skills.find((s) => s.id === id)
    if (!target) {
      return {
        ok: false,
        error: `未找到技能 "${id}"。当前已启用的技能: ${skills.filter((s) => s.enabled).map((s) => s.id).join(', ')}`,
      }
    }
    // 动态触发宿主注入该技能作为后续上下文消息
    opts.onPromptModule?.(`skill:${target.id}`)
    const paths = await getSkillPathsInfo(target.id)
    return {
      ok: true,
      id: target.id,
      name: target.name,
      description: target.description,
      whenToUse: target.whenToUse,
      instructions: target.instructions,
      scripts: target.scripts ?? [],
      references: target.references ?? [],
      dir: paths.dir,
      scriptsDir: paths.scriptsDir,
      referencesDir: paths.referencesDir,
      skillMd: paths.skillMd,
    }
  }, log)

  wrapApi(api, 'skill.write', async (args) => {
    const def = asRecord(args[0])
    const id = asText(def.id)
    if (!id) return { ok: false, error: '缺少技能 id 属性' }
    const skill: SkillDef = {
      id,
      name: asText(def.name) || id,
      description: asText(def.description) || '',
      whenToUse: asText(def.whenToUse) || undefined,
      category: (asText(def.category) as SkillDef['category']) || 'general',
      tags: Array.isArray(def.tags) ? def.tags.map(asText).filter(Boolean) : [],
      instructions: asText(def.instructions) || '',
      enabled: def.enabled !== false,
    }
    const ok = await saveSkillToDisk(skill)
    if (!ok) return { ok: false, error: `写入技能 "${id}" 失败` }
    const paths = await getSkillPathsInfo(id)
    return { id, ...paths }
  }, log)

  wrapApi(api, 'skill.delete', async (args) => {
    const id = asText(args[0])
    if (!id) return { ok: false, error: '缺少技能 id 参数' }
    const ok = await deleteSkillFromDisk(id)
    return { ok, id }
  }, log)

  wrapApi(api, 'skill.run', async (args) => {
    const skillId = asText(args[0])
    const scriptName = asText(args[1])
    const scriptArgs = args[2]

    if (!skillId) return { ok: false, error: '缺少技能 id 参数' }
    if (!scriptName) return { ok: false, error: '缺少脚本名称参数' }

    const np = getNativeProcess()
    if (!np) {
      return {
        ok: true,
        output: `[mock] 执行技能脚本: ${scriptName} (参数: ${JSON.stringify(scriptArgs)})`,
        exitCode: 0,
      }
    }

    const scriptPath = await getSkillScriptAbsPath(skillId, scriptName)
    if (!scriptPath) {
      return { ok: false, error: `技能脚本路径无效或越界: skills/${skillId}/scripts/${scriptName}` }
    }

    const scriptDir = await getSkillAbsDir(skillId)

    let command = 'node'
    let cmdArgs: string[] = [scriptPath]
    if (scriptName.endsWith('.py')) {
      command = 'python'
      cmdArgs = [scriptPath]
    } else if (scriptName.endsWith('.sh')) {
      command = 'bash'
      cmdArgs = [scriptPath]
    } else if (scriptName.endsWith('.bat') || scriptName.endsWith('.cmd')) {
      command = 'cmd'
      cmdArgs = ['/c', scriptPath]
    } else if (scriptName.endsWith('.ps1')) {
      command = 'powershell'
      cmdArgs = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]
    }

    const envPayload = scriptArgs !== undefined ? JSON.stringify(scriptArgs) : ''
    const createRes = await np.create({
      command,
      args: cmdArgs,
      cwd: scriptDir || undefined,
      env: envPayload ? { SKILL_ARGS: envPayload } : undefined,
    })

    if (!createRes.ok) {
      return { ok: false, error: `创建脚本执行进程失败: ${createRes.error || '未知错误'}` }
    }
    const procId = createRes.process_id
    if (!procId) {
      return { ok: false, error: '创建脚本执行进程失败: 未返回 process_id' }
    }

    const startRes = await np.start(procId)
    if (!startRes.ok) {
      await np.delete(procId)
      return { ok: false, error: `启动脚本执行进程失败: ${startRes.error || '未知错误'}` }
    }

    // 等待脚本完成 (最多 30s)
    const startTime = Date.now()
    const maxWaitMs = 30000
    let exitCode = 0
    let exited = false

    while (Date.now() - startTime < maxWaitMs) {
      const st = await np.status(procId)
      if (st.ok && st.status) {
        if (st.status.exited || !st.status.running) {
          exited = true
          exitCode = st.status.exitCode ?? 0
          break
        }
      }
      await new Promise((r) => setTimeout(r, 150))
    }

    if (!exited) {
      await np.stop(procId, { force: true })
      await np.delete(procId)
      return { ok: false, error: `技能脚本执行超时 (${maxWaitMs / 1000}s)` }
    }

    const out = await np.output(procId)
    await np.delete(procId)

    const stdout = out.ok ? out.stdout || '' : ''
    const stderr = out.ok ? out.stderr || '' : ''
    const totalOut = stdout + (stderr ? (stdout ? '\n[stderr]\n' : '') + stderr : '')

    return {
      ok: exitCode === 0,
      output: totalOut || (exitCode === 0 ? '（脚本执行成功，无输出）' : '（脚本退出非零，无输出）'),
      exitCode,
      ...(exitCode !== 0 ? { error: `脚本退出异常，退出码: ${exitCode}` } : {}),
    }
  }, log)

  /*
   * 节点宇宙（api.node）：create / get / list / delete 四条传输 + 对象门面。
   * 行为在 learn/nodeKinds 的类型子类里（多态），这里只透传（见 sandbox/nodeObject）。
   * 放最后：门面要读已注册的 node.get / node.invoke。
   */
  registerNodeApi(api, opts.nodes, log)

  /**
   * 收尾仪式一次做完（node.finish）：content / state / memory / delivery / open 五件事
   * 一个调用，省掉五连发里任一参数写错整批回退的开销。**content 先落**——它失败就
   * 直接回（后面全部不做，不会出现「文档没写、账都记了」的倒挂）；其余步骤逐个
   * 落、逐个如实报告（哪一步没落上看 steps，单独补一次就行）。
   */
  if (opts.nodes) {
    wrapApi(api, 'node.finish', async (args) => {
      const service = opts.nodes?.service()
      if (!service) return { error: '这一轮没有节点能力（宿主未注入 NodeService）' }
      const uuid = asText(args[0]).trim()
      const plan = args[1] && typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : {}
      const node = service.get(uuid)
      if (!node) return { error: '没有 uuid 为「' + uuid + '」的节点；先 api.node.list() 查清楚' }
      const steps: Record<string, unknown> = {}

      if (plan.content !== undefined) {
        const reason = opts.nodes?.guard?.('edit', node.kind, plan.content)
        if (reason) return { error: reason }
        const r = node.editContent(plan.content)
        if ('error' in r) return { error: 'content：' + r.error }
        steps.content = 'written'
        opts.nodes?.afterEdit?.(node.uuid, node.kind)
      }

      const stepOf = (r: unknown, name: string, done: string): void => {
        steps[name] = r && typeof r === 'object' && typeof (r as { error?: unknown }).error !== 'undefined' ? (r as { error: unknown }).error : done
      }
      if (plan.memory && typeof plan.memory === 'object' && opts.memory) {
        stepOf(opts.memory.create(plan.memory as Record<string, unknown>), 'memory', 'written')
      }
      if (plan.delivery && typeof plan.delivery === 'object' && opts.delivery) {
        stepOf(opts.delivery.submit(plan.delivery as Record<string, unknown>), 'delivery', 'written')
      }
      // 镜头最后切：账都落好了才把用户看到的东西指给他
      if (plan.open === true) {
        const listed = service.list() as { nodes?: Array<{ uuid?: string; path?: string }> }
        const path = listed.nodes?.find((n) => n.uuid === uuid)?.path || uuid
        const point = path ? (api as { ui?: { point?: (t: unknown) => Promise<unknown> } }).ui?.point : undefined
        if (typeof point === 'function') {
          await point(path)
          steps.open = 'done'
        } else {
          steps.open = 'skipped（这一轮没有 ui.point）'
        }
      }

      const allGood = Object.values(steps).every((v) => v === 'written' || v === 'done' || (typeof v === 'string' && v.startsWith('skipped')))
      return allGood
        ? { ok: true, steps, note: '收尾五件事一次落完' }
        : { ok: true, steps, note: 'content 已写入；有一步没落上（看 steps 里的说明），单独补一次即可' }
    }, log)
  }

  if (opts.video) {
    wrapApi(api, 'video.list', async () => {
      return opts.video?.list() ?? []
    }, log)
    wrapApi(api, 'video.get', async (args) => {
      const target = asText(args[0]).trim()
      if (!target) return { ok: false, error: 'video.get 需要提供 videoId 或视频节点的 uuid' }
      return await opts.video?.get(target)
    }, log)
  }

  if (opts.project) {
    const po = opts.project
    wrapApi(api, 'project.list', async () => {
      return po.list()
    }, log)
    wrapApi(api, 'project.tree', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.tree 需要项目节点的 uuid（api.node.list() 的 projects 段）' }
      const sub = typeof args[1] === 'string' ? args[1] : ''
      return po.tree(uuid, sub)
    }, log)
    wrapApi(api, 'project.read', async (args) => {
      const uuid = asText(args[0]).trim()
      const sub = asText(args[1])
      if (!uuid) return { ok: false, error: 'project.read 需要项目节点的 uuid 与它内部的相对路径（subPath，根写空串）' }
      const rawOpt = args[2]
      const opt = typeof rawOpt === 'string' ? { encoding: rawOpt as 'utf8' | 'base64' } : asRecord(rawOpt)
      return po.read(uuid, sub, opt as { encoding?: 'utf8' | 'base64'; maxBytes?: number; offset?: number })
    }, log)
    wrapApi(api, 'project.write', async (args) => {
      const uuid = asText(args[0]).trim()
      const sub = asText(args[1])
      if (!uuid) return { ok: false, error: 'project.write 需要项目节点的 uuid 与它内部的相对路径（subPath，根写空串）' }
      const content = args[2]
      if (content === undefined || content === null) return { ok: false, error: 'project.write 缺少 content' }
      const opt = asRecord(args[3])
      return po.write(uuid, sub, typeof content === 'string' ? content : JSON.stringify(content, null, 2), opt as { encoding?: 'utf8' | 'base64'; overwrite?: boolean })
    }, log)
    wrapApi(api, 'project.edit', async (args) => {
      const uuid = asText(args[0]).trim()
      const sub = asText(args[1])
      if (!uuid) return { ok: false, error: 'project.edit 需要项目节点的 uuid 与它内部的相对路径（subPath）' }
      const edit = asRecord(args[2])
      if (!Object.keys(edit).length) return { ok: false, error: 'project.edit 需要 { content | replace | append } 之一的编辑参数' }
      return po.edit(uuid, sub, edit as { content?: string; replace?: { target: string; replacement: string; all?: boolean }; append?: string })
    }, log)
    wrapApi(api, 'project.mkdir', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.mkdir 需要项目节点的 uuid 与要建的目录路径（相对该项目根）' }
      return po.mkdir(uuid, asText(args[1]))
    }, log)
    wrapApi(api, 'project.move', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.move 需要 uuid、from（项目内相对路径）与 to（同样是项目内相对路径）' }
      const from = asText(args[1])
      const to = asText(args[2])
      if (!from || !to) return { ok: false, error: 'project.move 的 from / to 都要给（项目内的相对路径）' }
      return po.move(uuid, from, to)
    }, log)
    wrapApi(api, 'project.copy', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.copy 需要 uuid、from 与 to（项目内的相对路径）' }
      const from = asText(args[1])
      const to = asText(args[2])
      if (!from || !to) return { ok: false, error: 'project.copy 的 from / to 都要给（项目内的相对路径）' }
      const opt = asRecord(args[3])
      return po.copy(uuid, from, to, opt as { overwrite?: boolean })
    }, log)
    wrapApi(api, 'project.delete', async (args) => {
      const uuid = asText(args[0]).trim()
      if (!uuid) return { ok: false, error: 'project.delete 需要 uuid 与要删的路径（项目内的相对路径；不可逆，先确认）' }
      const sub = asText(args[1])
      if (!sub) return { ok: false, error: 'subPath 不能是空串：删除项目根本身请走 api.node.delete 撤掉这条声明' }
      return po.delete(uuid, sub)
    }, log)
  }

  if (addons?.nodeFacade) attachNodeFacade(api)

  // 根 help：顶层函数与各组的总览。真沙箱由 sandboxRuntime 再挂一次（同步、不花宿主往返）
  ;(api as unknown as { __help: () => string }).__help = () => renderRootHelp()

  return { api, tmp }
}