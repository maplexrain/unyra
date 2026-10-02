/**
 * 这个文件负责什么：唯一的工具 execute 本体——参数说明、一次编排的执行流程
 * （编译 body → 建 api → 跑沙箱 → 收失败与图片 → 拼回执）与结果顶部的失败清单，以及几个体量上限。
 */
import { domOp } from '../../lib/docDom'
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
        '返回值会被回给你（超过 3.2 万字符会截断）。api 上挂着：' +
        'doc.read(path) / doc.readRange(path,start,end) / doc.find(path,要查的文字) / ' +
        'doc.write(path,content) / doc.replace(path,{start,end,content,expected}) / doc.append(path,content) / ' +
        'doc.annotate({term,occurrence?,body})（在正文上划一条注解，注解挂在节点上）、' +
        'node.list() / node.read(path) / node.create({parent,title,description})（parent 必填：写标题或 #id，' +
        '不再隐式建在当前节点下）/ node.title(path) / ' +
        'node.rename(path,title) / node.update(path,{title,description,status}) / node.delete(path) / ' +
        'node.move(path, 新父节点)（迁移节点）、description.read(path) / description.update(path,content)、' +
        'outline.read(path?)（读节点的大纲：{ intro, children:[{ key, title, summary }] }，没有时 null）/ ' +
        'outline.write(path?, { intro, children:[{ title, summary }] })（整份写入大纲；' +
        'children 只列直接子层级一层，key 由标题自动生成）、' +
        'tmp.set({key,value,ttlMs}) / tmp.get(key) / tmp.has(key) / tmp.del(key) / tmp.list() / tmp.clear()、' +
        '以及 exam 这一组（有试卷时才挂）：exam.create(payload) / exam.read(attemptId?) / ' +
        'exam.grade(payload) / exam.explain({ content, attemptId? })（错题讲解，判分之后的第二步）。' +
        'userInfo.get() / userInfo.update({字段:值})（学习者画像，增量写；画像不在系统提示词里，要用得自己取）、' +
        '还有 wait（等待）/ ask（表单提问，阻塞等用户）/ mind（长期记忆）/ iwanna（计划预告）/ tiktok（响铃）' +
        '/ method（目标级持久化函数：create / list / call / delete）/ sdoc（超级文档：list / read / write / delete）' +
        '/ ui.switchMain / ui.toast / ui.point / ui.scroll / ui.screenshot / ui.superdoc（界面操作），' +
        '/ browser.open / browser.tabs / browser.activate / browser.close / browser.click / browser.drag / ' +
        'browser.scroll / browser.type / browser.key / browser.capture' +
        '（内置浏览器：开网页、管页签、模拟鼠标键盘、截图——看页面用截图），' +
        '完整签名与使用时机见系统提示词的 execute 一节。' +
        'create 的 payload —— title、kind:"quiz"|"test"|"exam"、level:"easy"|"medium"|"hard"|"extreme"、' +
        'minutes（时限分钟数；小测不用给，其余不得低于题目数 × 2）、' +
        'questions:[{ type:"single"|"multiple"|"truefalse"|"fill"|"short", stem:"题干", ' +
        'options:[{id:"A",text:"选项文字"},{id:"B",text:"…"}], answer:["A"], rubric:"解析", points:2 }]。' +
        '单选/多选/对错必须给 answer（选项 id 数组）；填空/简答的 answer 写参考答案' +
        '（填空给了就按它严格判分，简答只作阅卷参考），rubric 写评分要点或解析；' +
        'grade 的 payload —— { passed:boolean, summary:"总评", results:[{ questionId, correct, score, comment }] }。' +
        "path 省略即「当前节点的教学文档」；\"笔记\" 指当前节点的笔记（一个节点可以有多份），"+
        "\"笔记/错题本\" 指其中叫「错题本」的那一份（没有就新建），\"极限/笔记\" 指节点「极限」的笔记。"+
        "写笔记时给个有意义的名字（如 \"笔记/错题本\"），别把不同用处的东西都堆进同一份；"+
        "node.read(path) 的 docs 里列着这个节点现有的笔记名，拿不准就先看一眼。"+
        '资源库（本目标 static/ 下的文件，用 uuid 寻址）：' +
        'res.list() / res.info(uuid) / res.read(uuid) / res.create({name, ext, content}) / ' +
        'res.update(uuid, {name, description, content}) / res.delete(uuid, {force}) / res.refs(uuid?)。' +
        'res.read 读图片时**不会**把图片数据给你——图片会直接出现在你的下一步里，所以一次只看真正需要的几张；' +
        '文档里引用资源写成 ![说明](moji:static/uuid)。' +
        '调试用 api.log(...)，它的输出会随结果一起回给你。沙箱里没有 window / document / fetch。',
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
      : '执行一段 JS 来操作学习数据。文档读写、节点增删改、描述、试卷、临时变量都只能通过这里调用——' +
        '没有别的工具。一次编排可以同时操作多个节点：用 path 指名是哪个节点的哪份文档' +
        "（path 省略 = 当前节点的教学文档，\"笔记\" = 当前节点的笔记，"+
        "\"笔记/名字\" = 其中某一份，没有就新建）。"+
        '多步、批量、需要判断或循环的活都用代码一次做完，不要把中间结果写进对话。' +
        '体量大的中间数据用 api.tmp 暂存（可设过期时间），只把键名或结论带回来。' +
        '出题用 exam.create：题型只认 single / multiple / truefalse / fill / short，' +
        '单选/多选/对错必须给 answer（选项 id 数组，如 ["A"]），题目对象的完整写法见 body 的参数说明；' +
        '除随堂小测外还要给 minutes（时限，不得低于题目数 × 2）。' +
        'exam.read 任何时候都能调（没有卷子也是一种答案），exam.delete 只能删一次都没考过的卷子。' +
        '学习者的学习状态（自评 / 掌握度 / 错误记忆 / 检验记录）用 state.* 读写：' +
        'state.read() 看当前节点，state.update() 修正掌握度或自评，state.mistake() 记一次错误，' +
        'state.check() 记一次探针或主动回忆的结果。' +
        '本目标 static/ 下的资源（图片、PDF、附件）用 res.* 管理：清单、读、改、删、引用扫描都在那里；' +
        'res.read 读图片不会返回 base64，图片会直接出现在你的下一步里。' +
        '界面里开着的网页页签用 browser.* 操作：开站、列/切/关页签、模拟鼠标键盘（click/drag/scroll/type/key）、' +
        '页面截图。看页面只用 browser.capture 截图（落进资源库并出现在你的下一步里），没有读页面文字的通道；' +
        '要动页面先跟用户说一声。',
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