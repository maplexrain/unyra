/**
 * 这个文件负责什么：唯一的工具 execute 本体——参数说明、一次编排的执行流程
 * （编译 body → 建 api → 跑沙箱 → 收失败与图片 → 拼回执）与结果顶部的失败清单，以及几个体量上限。
 */
import { domOp } from '../../lib/docDom'
import { promptModuleForApiName, promptModuleForContent, writableContentOf } from '../../learn/ai/promptModules'
import { MAX_TOOL_IMAGES, type MessageImage } from '../types'
import { buildApi, clip, imagesOf } from './api'
import { safeJson } from './askForm'
import { compileBody } from './body'
import { asText } from './refs'
import { DEFAULT_SANDBOX_TIMEOUT_MS, MAX_LOGGED_CALLS } from './limits'
import type { ExecuteTool, SandboxCall, SandboxOptions } from './types'
import { makeDomFacade, RENAMED_API_HINT, runInWorker } from './worker'

/* ---------- 工具本体 ---------- */
const DESCRIPTION_FIELD = {
  type: 'object' as const,
  description: '这段代码要做什么（一句话，给人看的，也会显示在界面上）',
}

const EXECUTE_PARAMETERS = {
  type: 'object',
  properties: {
    description: DESCRIPTION_FIELD,
    body: {
      type: 'string',
      description:
        '一段匿名函数源码，形如 ((api)=>{ ... return 结果 })，也可以写成 ((api)=>{...})()。可以用 await；' +
        '返回值会被回给你（超过 3.2 万字符会截断）。' +
        '**写操作的失败不抛异常**：回 { ok:false, content:"哪一步没做成、该怎么改" }，并汇总在结果最前面' +
        '那份「没有生效」清单里——判断成败看清单，不要用 try/catch，也不要追加读接口确认。' +
        'path 省略 = 当前节点的教学文档，"笔记" = 当前节点的笔记，"笔记/错题本" = 指名某一份（没有就新建）。' +
        'api 上有什么、各组的完整签名与使用时机，全部见系统提示词的 execute 一节；' +
        '低频组（sdoc / browser / web / res / exam / review / workspace / method / code / subagent / ui 细节等）' +
        '的规范会在你第一次调用该组时自动注入。调试用 api.log(...)，输出随结果一起回给你。' +
        '沙箱里没有 window / document / fetch。',
    },
  },
  required: ['description', 'body'],
  additionalProperties: false,
}

/** 子代理版 body 说明的骨架：前后是纪律，中间按会话授权生成 api 清单（见 apiBriefForGroups） */
const SUB_BODY_PREFIX =
  '一段匿名函数源码，形如 ((api)=>{ ... return 结果 })，也可以写成 ((api)=>{...})()。可以用 await；' +
  '返回值会被回给你（超过 3.2 万字符会截断）。api 上挂着（本次会话只开放了下面这些）：\n'
const SUB_BODY_SUFFIX =
  '\n写操作的失败不抛异常：返回值是 { ok:false, content:"哪一步没做成、怎么改" }，' +
  '并汇总在结果最前面的「没有生效」清单里——判断成败看清单，不要用 try/catch，也不要追加读接口确认。' +
  '调试用 api.log(...)，输出随结果一起回给你。沙箱里没有 window / document / fetch。'

/** apiBrief（子代理按需 api）存在时换掉 body 说明，只写它真有的 api */
function executeParameters(apiBrief?: string): typeof EXECUTE_PARAMETERS {
  if (!apiBrief) return EXECUTE_PARAMETERS
  return {
    ...EXECUTE_PARAMETERS,
    properties: {
      description: DESCRIPTION_FIELD,
      body: { type: 'string', description: SUB_BODY_PREFIX + apiBrief + SUB_BODY_SUFFIX },
    },
  }
}

/**
 * 唯一的工具：执行一段 JS 编排。
 * description 会作为工具卡片标题显示，因此要求模型写人话而不是复述代码。
 */
export function createExecuteTool(opts: SandboxOptions): ExecuteTool {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS
  const runner = opts.runSandbox ?? runInWorker
  let lastCalls: SandboxCall[] = []
  /** 上一次失败的指纹：同样的写法再失败一次就明说「别重试了」 */
  let lastFailure = ''
  /**
   * ui.dom 的活动会话：会话 id → 文档区根元素。回调函数无法穿过 Worker 边界，
   * 所以 Worker 侧拿到的是「门面」，每个操作回到宿主来查这张表（见 callApi）。
   */
  const domSessions = new Map<string, Element>()

  return {
    name: 'execute',
    description: opts.apiBrief
      ? '执行一段 JS 来完成任务：api 按本会话的授权开放（完整签名见参数说明）。' +
        '多步、批量、需要判断或循环的活用代码一次做完，不要把中间结果写进对话；' +
        '体量大的中间数据用 api.tmp 暂存，只把键名或结论带回来。'
      : '执行一段 JS 来操作学习数据——**唯一的工具**：文档读写、节点增删改、描述、试卷、临时变量、' +
        '人机协作与界面操作都只能通过这里调用。多步、批量、需要判断或循环的活用代码一次做完，' +
        '不要把中间结果写进对话；体量大的用 api.tmp 暂存，只把键名或结论带回来。' +
        '各 api 组的签名与使用时机见系统提示词的 execute 一节（低频组的完整规范在首次调用时自动注入）。',
    parameters: executeParameters(opts.apiBrief),
    run: async (args) => {
      const description = asText(args.description).trim()
      const body = asText(args.body)
      /*
       * 形状与语法在交给沙箱之前先查一次：沙箱抛语法错时，行号指向它自己的包装代码，
       * 「await is only valid in async functions」这种话对模型没有任何指向性（见 compileBody）。
       */
      const compiled = compileBody(body)
      if (!compiled.ok) return { ok: false, content: compiled.content }
      const log: SandboxCall[] = []
      /**
       * 动态提示词注入的触发收集（见 learn/ai/promptModules）：写入内容里的标记在 callApi
       * 里当场记，低频 api 组在编排结束后按 log 统一记；都只在编排收尾报给宿主——
       * 宿主负责去重与落库，这里绝不改会话。
       */
      const moduleKeys = new Set<string>()
      const { api } = buildApi(opts, log)
      /**
       * 本次编排里 api 附带的图片（目前只有 res.read 会带）。它们不能进 content
       * （文本通道会把 base64 截成乱码），随工具结果的 images 交回运行时，
       * 由运行时作为图片片段挂到下一跳。
       */
      const attached: MessageImage[] = []
      const attachedIds = new Set<string>()
      const logs: string[] = []
      const logLine = (...items: unknown[]) => {
        if (logs.length < MAX_LOGGED_CALLS) {
          logs.push(items.map((x) => (typeof x === 'string' ? x : safeJson(x))).join(' '))
        }
      }
      const reply = await runner({
        body: compiled.body,
        timeoutMs,
        callApi: async (name, callArgs) => {
          /**
           * api 组白名单（子代理专用）的硬闸：名单外的组当场拒绝。
           * apiAllow 是「execute 按需开放」的承诺，这里才是让它算数的地方——
           * 名单内的组照常，名单外的一律「没有这个 api」，并把开放的组写进报错，
           * 模型据此改写调用而不是瞎试。log 是沙箱自己的通道，不受白名单管。
           */
          if (opts.apiAllow?.length && name !== 'log' && !opts.apiAllow.includes(name.split('.')[0])) {
            throw new Error(
              '沙箱里没有这个 api：' + name + '。本次会话只开放了这些 api 组：' + opts.apiAllow.join('、'),
            )
          }
          if (name === 'log') {
            logLine(...callArgs)
            return null
          }
          if (name === 'ui.dom.session') {
            const root = opts.ui?.domRoot?.() ?? null
            if (!root) {
              throw new Error('文档区现在没有可访问的 DOM：请先打开一份文档（api.ui.point 可以打开一个页签）')
            }
            const sid = 'dom-' + crypto.randomUUID()
            domSessions.set(sid, root)
            return sid
          }
          if (name === 'ui.dom.op') {
            const [sid, op, opArgs] = callArgs as [string, string, unknown[]]
            const root = typeof sid === 'string' ? domSessions.get(sid) : undefined
            if (!root) throw new Error('ui.dom 会话已失效（文档被切换或关闭了），请重新调 api.ui.dom')
            return domOp(root, String(op ?? ''), Array.isArray(opArgs) ? opArgs : [])
          }
          /**
           * ui.dom 的**进程内直调**通道：真沙箱里回调在 Worker 侧，走上面的
           * session/op 两步；测试探针的 api 是进程内 Proxy（见 agent-ops 探针的
           * fakeRunner），回调就地在宿主建门面执行。两条通道行为一致。
           */
          if (name === 'ui.dom') {
            const fn = callArgs[0]
            if (typeof fn !== 'function') {
              throw new Error('api.ui.dom 需要传入一个回调函数：await api.ui.dom(async (root) => { ... })')
            }
            const root = opts.ui?.domRoot?.() ?? null
            if (!root) {
              throw new Error('文档区现在没有可访问的 DOM：请先打开一份文档（api.ui.point 可以打开一个页签）')
            }
            return await fn(makeDomFacade(root))
          }
          const [group, method] = name.split('.')
          const bucket = api[group] as Record<string, (...a: unknown[]) => unknown> | undefined
          const fn = method ? bucket?.[method] : (bucket as unknown as (...a: unknown[]) => unknown)
          if (!fn) {
            const hint = RENAMED_API_HINT[name]
            throw new Error('沙箱里没有这个 api：' + name + (hint ? '。它已改名，现在写作 ' + hint : ''))
          }
          // 内容触发：这次写入的东西里带 plot 围栏或动画标记，对应模块就该在场
          if (opts.onPromptModule) {
            const content = writableContentOf(name, callArgs)
            if (content) for (const key of promptModuleForContent(content, name)) moduleKeys.add(key)
          }
          const value = await fn(...callArgs)
          const images = imagesOf(value)
          if (!images.length) return value
          for (const img of images) {
            if (attachedIds.has(img.id) || attached.length >= MAX_TOOL_IMAGES) continue
            attachedIds.add(img.id)
            attached.push(img)
          }
          // 沙箱里看到的是回执文字，不是一串图片引用：把 images 摘掉再交回去
          const rest: Record<string, unknown> = { ...(value as Record<string, unknown>) }
          delete rest.images
          return rest
        },
      })
      domSessions.clear()
      lastCalls = log

      /**
       * 组触发：本次编排里真实调用过的低频 api 组（log 是执行成功的通道——被 apiAllow
       * 拒掉的调用进不了它，也不会触发注入）。逐一报给宿主，去重是宿主的事。
       */
      if (opts.onPromptModule) {
        for (const c of log) {
          const key = promptModuleForApiName(c.name)
          if (key) moduleKeys.add(key)
        }
        for (const key of moduleKeys) opts.onPromptModule(key)
      }

      if (!reply.ok) {
        const detail = description ? '（这段代码的说明：' + description + '）' : ''
        /*
         * 重试纪律：模型很容易「换个写法再试一次」，一轮里刷出十条噪声调用。
         * 连续的同类失败在这里直接点破——换的若是同一处写法，它自己看不出区别。
         */
        const fingerprint = reply.error.slice(0, 80) + '|' + body.replace(/\s+/g, ' ').slice(0, 120)
        const repeated = fingerprint === lastFailure
        lastFailure = fingerprint
        const advice = repeated
          ? '\n这条报错与上一次**完全同类**，同样的写法再试也不会有不同结果：请换一种策略，' +
            '或先用最小调用（例如 return 1）确认沙箱语义，再回来改这段。连续失败两次以上就先停下来告诉我卡在哪。'
          : ''
        return { ok: false, content: '执行失败' + detail + '：' + reply.error + advice }
      }
      lastFailure = ''
      const result =
        reply.value === undefined
          ? '（这段代码没有 return 任何值）'
          : typeof reply.value === 'string'
            ? reply.value
            : safeJson(reply.value)
      /**
       * 有一次 api 调用没有生效（例如 expected 与现状不符），整次编排就算失败：
       * 光把 { ok: false } 交给模型是不够的——它可能没检查返回值就接着往下走，
       * 于是「明明没改成功」却被当成做完了。这里把它提成工具级失败，界面上也是红的。
       */
      const head = failureHeader(log)
      const tail = [whatHappened(log), logs.length ? '日志：\n' + logs.join('\n') : ''].filter(Boolean).join('\n')
      return {
        // 工具级的成败：有一次没生效就是失败（界面上是红的），但结果照旧交给模型去读
        ok: log.every((c) => c.ok),
        content: clip(head + result + (tail ? '\n\n' + tail : '')),
        ...(attached.length
          ? {
              images: attached,
              // 回执里点明「图在下一跳」：否则模型会以为 res.read 什么也没给它
              content: clip(
                head +
                  result +
                  (tail ? '\n\n' + tail : '') +
                  '\n\n（这次附上了 ' +
                  attached.length +
                  ' 张图片，它们会出现在你的下一步里。）',
              ),
            }
          : {}),
      }
    },
    lastCalls: () => lastCalls,
  }
}

/**
 * 没生效的那些调用，连同「为什么」一起顶到结果最前面。
 *
 * 这里刻意把话分两层说清楚，都是踩过的坑：
 * 1. **说「没有生效」而不是「出错」**：这里的失败几乎全是写操作被拒（位置校验不过、
 *    标题撞重名、题目格式不对），不是调用不进去；说「出错」会让模型以为要换写法重试。
 * 2. **把 name 与那句话一起列出来**：只说「有 N 次失败」，模型得自己回到 result 里翻，
 *    翻不到就会写 try/catch 去「判断成败」——而这条路走不通：写操作的失败不抛异常，
 *    try/catch 只接得到「这段代码根本没法跑」那类错。
 *
 * 同一类失败重复出现只列一次（同一句话写三遍只会淹没重点）。
 */
function failureHeader(log: SandboxCall[]): string {
  const failures = log.filter((c) => !c.ok)
  if (!failures.length) return ''
  const seen = new Set<string>()
  const lines: string[] = []
  for (const f of failures) {
    if (seen.has(f.name)) continue
    seen.add(f.name)
    lines.push('  - ' + f.name + (f.message ? '：' + f.message : ''))
  }
  return (
    '⛔ 本次有 ' +
    failures.length +
    ' 次调用**没有生效**（上面 result 里对应的那一项就是它）：\n' +
    lines.join('\n') +
    '\n请按这句话改正后重试。**写操作的失败不抛异常**（异常会带走整批调用），所以判断成败' +
    '看这份清单，不要用 try/catch——它只接得到「这段代码根本没法跑」那类错（api 名写错等）。' +
    '也不要为了确认「到底做成没有」再追加一次读接口。\n\n'
  )
}

/** 把这次编排调过哪些 api 说成一句人话，附在结果里，模型据此自查有没有漏做 */
function whatHappened(log: SandboxCall[]): string {
  if (!log.length) return ''
  const failed = log.filter((c) => !c.ok)
  const names = [...new Set(log.map((c) => c.name))]
  return (
    '本次调用：' +
    names.join('、') +
    '（共 ' +
    log.length +
    ' 次' +
    (failed.length ? '，其中 ' + failed.length + ' 次没有生效' : '') +
    '）'
  )
}