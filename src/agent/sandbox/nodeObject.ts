/**
 * 节点对象通道（v2，全图化重构）：`api.node` 收缩为 **create / get / list / delete**
 * 四条传输，外加一条 `node.invoke` 代调用——读写内容、连线、自述全部是节点对象的成员。
 *
 * ## 分层
 *
 * - 行为在类型里（learn/nodeKinds 的 GNode 子类，多态）；这里只做**出清单**与**代调用**；
 * - 传输就这五条。沙箱两侧各有一层门面把 manifest 包成真的 JS 对象
 *   （真沙箱在 sandboxRuntime.js，进程内直调在 buildApi 末尾的 attachNodeFacade），
 *   模型看到与写到的就是：
 *
 *       const n = await api.node.get(uuid)
 *       await n.help()            // 节点自述：内容格式、连接规则（随上游动态变化）
 *       const c = await n.content // 读现状
 *       await n.editContent(c)    // 整份写回
 *       await a.connect(b, 'down')// 双边协商连接
 *
 * - connect / disconnect 的参数是**另一个节点对象**，穿不过结构化克隆：
 *   门面在发送前把它折成 uuid，宿主这一侧再由 service 还原成对象。
 */
import { NODE_MEMBERS_ORDER, type GNode, type GNodeKind, type NodeService } from '../../learn/nodeKinds'
import { asText } from './refs'
import { wrapApi } from './wrap'

/** 节点对象的成员（全类型同构；多态在行为与 help 文案，不在方法表） */
export const NODE_MEMBERS = NODE_MEMBERS_ORDER

/** manifest：node.get 的回执——身份 + 关系快照（方法表是固定的六件套，不必随单传输） */
export interface NodeManifest {
  ok: true
  /** 标记形状：沙箱门面据此再包一层真对象 */
  object: true
  uuid: string
  kind: GNodeKind
  title: string
  relations: Array<{ id: string; type: 'up' | 'down'; kind: GNodeKind; title: string; portKey?: string }>
}

export function isManifest(v: unknown): v is NodeManifest {
  return !!v && typeof v === 'object' && (v as { object?: unknown }).object === true && typeof (v as { uuid?: unknown }).uuid === 'string'
}

/** 宿主注入的节点通道：一个可空的 NodeService 柄 + 可选的业务守卫 */
export interface NodeOps {
  /** 当前可用的节点服务（没有目标 / 未注入时为 null，api.node 整组收「没有」回执） */
  service: () => NodeService | null
  /**
   * 业务守卫（可省）：挂在 create / editContent 之前的「纯模型之外」约束
   * （例如出题阶段闸门——有考试等着判分时不许再出新卷）。回一句拒绝原因或 null 放行。
   */
  guard?: (action: 'create' | 'edit', kind: GNodeKind, payload: unknown) => string | null
  /**
   * 编辑成功后的回调（可省）：出卷后的视觉自检这类「写完还要跟一步」的宿主动作挂这里。
   */
  afterEdit?: (uuid: string, kind: GNodeKind) => void
}

function manifestOf(service: NodeService, node: GNode): NodeManifest {
  const relations = node.relations.map((r) => {
    const other = service.get(r.id)
    return {
      id: r.id,
      type: r.type,
      kind: other?.kind ?? 'doc',
      title: other?.title ?? r.id,
      ...(r.portKey ? { portKey: r.portKey } : {}),
    }
  })
  return { ok: true, object: true, uuid: node.uuid, kind: node.kind, title: node.title, relations }
}

const NO_SERVICE = '这一轮没有节点能力（宿主未注入 NodeService）'

/**
 * 注册 api.node 四条传输 + invoke 代调用，并挂进程内门面（测试探针 / 超级文档桥那条
 * 直调通道）。真沙箱的门面在 sandboxRuntime.js，两边行为必须一致。
 */
export function registerNodeApi(api: Record<string, unknown>, ops: NodeOps | undefined, log: Parameters<typeof wrapApi>[3]): void {
  if (!ops) return

  const svc = (): NodeService | null => ops.service()

  wrapApi(api, 'node.get', (args) => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    const uuid = asText(args[0]).trim()
    if (!uuid) return { error: 'node.get 要给节点的 uuid（api.node.list() 里查）' }
    const node = service.get(uuid)
    if (!node) return { error: '没有 uuid 为「' + uuid + '」的节点；先 api.node.list() 查清楚' }
    return manifestOf(service, node)
  }, log)

  wrapApi(api, 'node.create', (args) => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    const input = args[0] && typeof args[0] === 'object' ? (args[0] as Record<string, unknown>) : { kind: asText(args[0]) }
    const reason = ops.guard?.('create', input.kind as GNodeKind, input)
    if (reason) return { error: reason }
    return service.create(input)
  }, log)

  wrapApi(api, 'node.setRoot', (args) => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    return service.setRoot(asText(args[0]).trim())
  }, log)

  wrapApi(api, 'node.list', () => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    return service.list()
  }, log)

  // 一页纸简报（写正文之前的那一眼）：self / port / siblings / taught 一次给齐
  wrapApi(api, 'node.brief', (args) => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    return service.brief(asText(args[0]).trim())
  }, log)

  wrapApi(api, 'node.delete', (args) => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    return service.delete(asText(args[0]).trim())
  }, log)

  wrapApi(api, 'node.invoke', async (args) => {
    const service = svc()
    if (!service) return { error: NO_SERVICE }
    const uuid = asText(args[0]).trim()
    const member = asText(args[1]).trim()
    const rest = Array.isArray(args[2]) ? args[2] : []
    const node = service.get(uuid)
    if (!node) return { error: '没有 uuid 为「' + uuid + '」的节点（可能刚被删除）；先 api.node.list() 查清楚' }
    if (!NODE_MEMBERS.includes(member as (typeof NODE_MEMBERS)[number])) {
      return {
        error:
          '节点对象没有 ' + (member || '(空)') + ' 这个成员。可用：' + NODE_MEMBERS.join(' / ') +
          '——先 await n.help() 看这个节点自己怎么说。',
      }
    }
    if (member === 'connect' || member === 'disconnect') {
      // 门面已把「另一个节点对象」折成了 uuid：这里还原成对象再交给双边协议
      const targetId = asText(rest[0]).trim()
      const target = targetId ? service.get(targetId) : undefined
      if (!target) return { error: 'connect / disconnect 的第一个参数要是另一个节点对象（api.node.get(uuid) 取到再传）' }
      const r =
        member === 'connect'
          ? node.connect(target, rest[1], rest[2])
          : node.disconnect(target)
      return r
    }
    if (member === 'getPortData') return node.getPortData()
    if (member === 'editContent') {
      const reason = ops.guard?.('edit', node.kind, rest[0])
      if (reason) return { error: reason }
      const r = node.editContent(rest[0])
      if ('ok' in r && r.ok) ops.afterEdit?.(node.uuid, node.kind)
      return r
    }
    if (member === 'help') return node.help()
    // content 是 getter
    return (node as unknown as { content: unknown }).content
  }, log)
}

/**
 * 进程内门面（测试探针 / 超级文档桥的直调通道）：把 manifest 包成真对象。
 * content 是异步 getter（await n.content 每次都取最新）；connect / disconnect 的
 * 节点对象参数在发送前折成 uuid。真沙箱的门面在 sandboxRuntime.js，行为必须一致。
 */
export function attachNodeFacade(api: Record<string, unknown>): void {
  const ns = api.node as
    | { get: (t: unknown) => Promise<unknown>; invoke: (t: unknown, m: string, a: unknown[]) => Promise<unknown> }
    | undefined
  if (!ns || typeof ns.get !== 'function' || typeof ns.invoke !== 'function') return

  const toWire = (args: unknown[]): unknown[] =>
    args.map((a) =>
      a && typeof a === 'object' && typeof (a as { uuid?: unknown }).uuid === 'string' && (a as { __node?: unknown }).__node === true
        ? (a as { uuid: string }).uuid
        : a,
    )

  const wrap = (m: NodeManifest): Record<string, unknown> => {
    const obj: Record<string, unknown> = {
      uuid: m.uuid,
      kind: m.kind,
      title: m.title,
      relations: m.relations,
      __node: true,
    }
    Object.defineProperty(obj, 'content', {
      get: () => ns.invoke(m.uuid, 'content', []),
      enumerable: true,
    })
    for (const name of ['editContent', 'help', 'connect', 'disconnect', 'getPortData'] as const) {
      obj[name] = (...callArgs: unknown[]) =>
        Promise.resolve(ns.invoke(m.uuid, name, toWire(callArgs))).then((v) => (isManifest(v) ? wrap(v) : v))
    }
    return obj
  }

  const wrapError = (errObj: unknown): Record<string, unknown> => {
    const err =
      errObj && typeof errObj === 'object' && 'error' in errObj
        ? String((errObj as { error: unknown }).error)
        : '获取节点失败'
    return {
      ok: false,
      error: err,
      __node: true,
      get content() {
        return Promise.resolve({ ok: false, error: err })
      },
      editContent: () => Promise.resolve({ ok: false, error: err }),
      help: () => Promise.resolve({ ok: false, error: err }),
      connect: () => Promise.resolve({ ok: false, error: err }),
      disconnect: () => Promise.resolve({ ok: false, error: err }),
      getPortData: () => Promise.resolve({ ok: false, error: err }),
    }
  }

  // 先把宿主侧原始 get 摘下来再替换：闭包里晚绑定 ns.get 会递归调到自己
  const rawGet = ns.get.bind(ns)
  const get = (uuid: unknown): Promise<unknown> => {
    const m = rawGet(uuid)
    return Promise.resolve(m).then((v) => (isManifest(v) ? wrap(v) : wrapError(v)))
  }
  Object.assign(api.node as object, { get })
}
