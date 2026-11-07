/**
 * 这个文件负责什么：**沙箱里能调到的全部 api 的门面**。buildApi 把 SandboxOptions 上的宿主能力
 * 装配成一份 api：各能力组的实现按组拆在同目录 api/*.ts（learn / web / browser / host /
 * see / ui / res / delegate / files / process / skill / project），这里只做三件事——
 * 1) 建临时变量仓库 tmp 并注册 tmp.*（tmp 实例随 buildApi 返回，注册留在这里）；
 * 2) 按拆分前的顺序调用各组的 install*（调用顺序即注册顺序）；
 * 3) 收尾的节点宇宙：registerNodeApi（**敏感口径**：__node 门面克隆必炸→折成
 *    uuid/kind/title/relations 快照）+ node.finish 收尾仪式 + api.help/__help。
 * 每个 api 都是调用时才读 opts，不持有快照。
 */
import { TmpVars, type TmpInfo } from '../../lib/tmpStore'
import { MAX_RESULT_CHARS } from './limits'
import { asRecord, asText } from './refs'
import { renderRootHelp } from './apiRegistry'
import { attachNodeFacade, registerNodeApi } from './nodeObject'
import { wrapApi, imagesOf } from './wrap'
import type { SandboxCall, SandboxOptions } from './types'
import { installLearn } from './api/learn'
import { installWeb } from './api/web'
import { installBrowser } from './api/browser'
import { installHost } from './api/host'
import { installSee } from './api/see'
import { installUi } from './api/ui'
import { installRes } from './api/res'
import { installDelegate } from './api/delegate'
import { installFiles } from './api/files'
import { installProcess } from './api/process'
import { installSkill } from './api/skill'
import { installProject } from './api/project'

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
  log: SandboxCall[] = [],
  /**
   * nodeFacade：要不要把 api.node.get 包成「进程内节点对象门面」。**默认关**——
   * 门面对象带吐 Promise 的 getter 与函数成员，只能活在进程内；真 Worker 通道的
   * 回执要过结构化克隆，api.node.get 必须回纯 manifest（Worker 侧自己包成门面，
   * 见 sandboxRuntime 的 wrapManifest）。进程内直调（编排测试 / 探针的 fakeRunner /
   * 超级文档桥）才开。
   */
  addons?: { nodeFacade?: boolean },
): BuiltApi {
  const api: Record<string, unknown> = {}
  const tmpView = opts.tmp?.()
  const tmp = tmpView ? new TmpVars(tmpView) : null

  // 各能力组的实现拆在同目录 api/*.ts；下面调用顺序即注册顺序（与拆分前逐行一致）

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

  // 学习编排域：exam / memory / schedule / method / wf / code / workspace / compact / chip / delivery
  installLearn(api, opts, log)
  // 网络域：fetch / web.fetch / web.search（批量 ≤5 + maxChars 的敏感口径在 api/web.ts）
  installWeb(api, opts, log)
  // 内置浏览器域：browser.*
  installBrowser(api, opts, log)
  // 宿主交互域：mcp / userInfo / wait / ask / tiktok
  installHost(api, opts, log)
  // 视觉输入域：see
  installSee(api, opts, log)
  // 页面反馈域：ui.*（docRef / nodeRef 随组进了 api/ui.ts）
  installUi(api, opts, log)
  // 资源库域：res.*
  installRes(api, opts, log)
  // 导师专用域：subagent.* / permission.*
  installDelegate(api, opts, log)
  // 真实文件系统域：files.*（路径映射与 chat.json 硬挡的敏感口径在 api/files.ts）
  installFiles(api, opts, log)

  // 自描述 api.help()：与 api.__help() 同义（注册表渲染，避免这里再抄一份组清单）
  wrapApi(api, 'help', () => {
    return { ok: true, help: renderRootHelp() }
  }, log)

  // 受控进程域：process.*（不走 opts，直接问原生桥）
  installProcess(api, log)
  // 技能域：skill.*
  installSkill(api, opts, log)

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

  // 项目与视频节点域：project.* / video.*
  installProject(api, opts, log)

  if (addons?.nodeFacade) attachNodeFacade(api)

  // 根 help：顶层函数与各组的总览。真沙箱由 sandboxRuntime 再挂一次（同步、不花宿主往返）
  ;(api as unknown as { __help: () => string }).__help = () => renderRootHelp()

  return { api, tmp }
}
