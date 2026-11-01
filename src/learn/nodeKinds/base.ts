/**
 * 节点对象的**基类契约**——整个节点宇宙只有一个抽象：`GNode`。
 *
 * ## 架构（2026-10-24 全图化重构定稿）
 *
 * - **单一份事实源**：store（nodes + edges + exams）。节点对象是从 store 水合的**行为外壳**，
 *   每次读写都现取（`ctx.store()`），不缓存、不成第二真相；一切写操作走 graph/* 纯函数
 *   落回 store（`ctx.commit`）。
 * - **uuid 即身份**：文档 = 知识节点 id；大纲 = `o:{文档id}`（与文档一对一）；
 *   入口 = `entry:{根文档id}`（与目标一对一）；笔记 / 试卷 / 超级文档 = 各自的持久 id。
 *   uuid 一经分配永不改变（改名不改 id），画布坐标、页签、agent 句柄全都只认它。
 * - **关系是派生视图**：树边（store.edges）+ 挂件归属（存在谁的 parts 里）+ 入口绑定（目标根）。
 *   没有第二张关系表，也就没有「两张表对不齐」这一类 bug。
 * - **连接是双边协商**：`connect(target, type)` 里 type 是 target 的接入身份；先问接入方的
 *   上游过滤、再问接纳方的下游过滤，两个都点头才落库——规则长在各类型自己身上，
 *   没有中央连线矩阵。
 * - **自描述**：`help()` 回 { description, edit, connection } 三段，且**随当前上游变化**——
 *   提示词不再背每种节点的用法，agent 拿到对象问它本人。
 */

import type { LearnStore } from '../types'

/** 全部节点类型（键 = uuid 派生前缀之外的判别字段） */
export type GNodeKind = 'entry' | 'outline' | 'doc' | 'note' | 'exam' | 'superdoc' | 'video' | 'project'

/** 一条关系记录：type 是**对方相对我**的身份（对方是我的上游 / 下游） */
export interface NodeRelation {
  id: string
  type: 'up' | 'down'
  /**
   * 接口认领（**只在下游一侧的关系上出现**）：我作为下游，认领了上游的哪个接口。
   * 上游在自己的 relations 里看不到这条——认领本来就是下游的动作。
   */
  portKey?: string
}

/** 一个固定接口：提供方声明、下游按 key 认领（key 在同一个提供方内唯一） */
export interface NodePort {
  key: string
  /** 人读的名字（界面上就是「这一条要写什么」） */
  label: string
  /** 提供方自定义的载荷（基类只透传，形状由各类型自己定义） */
  data: unknown
}

/* ---------- uuid 方案（全节点宇宙唯一的身份语法，画布 / 页签 / agent 句柄共用） ---------- */

/** 文档的 uuid 就是知识节点的 id（不带前缀） */
/** 大纲 uuid：与宿主文档一对一，`o:{文档id}`——大纲从不单独改名，这一形态天然稳定 */
export const outlineUuid = (docId: string): string => 'o:' + docId
/** 从大纲 uuid 取宿主文档 id */
export const docIdOfOutlineUuid = (uuid: string): string | null =>
  uuid.startsWith('o:') && uuid.length > 2 ? uuid.slice(2) : null
/** 入口 uuid：与目标的根文档一对一，`entry:{根文档id}` */
export const entryUuid = (rootDocId: string): string => 'entry:' + rootDocId
/** 从入口 uuid 取根文档 id */
export const docIdOfEntryUuid = (uuid: string): string | null =>
  uuid.startsWith('entry:') && uuid.length > 6 ? uuid.slice(6) : null

/** help() 的回执：三段自述，文案依赖节点当下的状态与上游 */
export interface NodeHelp {
  /** 这个节点是什么 */
  description: string
  /** 内容怎么编辑（schema / 格式 / 纪律） */
  edit: string
  /** 连接规则（谁能连我、我能连谁） */
  connection: string
}

/** 写操作回执：失败必须带一句模型能据此改对的原因（回执即人话） */
export type NodeResult = { ok: true; note?: string } | { error: string }

/** 连接过滤的回执：true = 收下；string = 拒绝原因 */
export type ConnectFilter = true | string

/** 服务上下文：宿主注入的四件套（读 store / 写回 store / 当前目标 / 按 uuid 还原节点对象） */
export interface NodeCtx {
  store: () => LearnStore
  commit: (next: LearnStore) => void
  goalId: () => string
  /** getPortData 用：把关系里的 uuid 还原成节点对象（实现在 NodeService，避免基类反向依赖它） */
  objectOf: (uuid: string) => GNode | undefined
}

/**
 * 节点基类。六种类型各自继承它；对外成员**完全同构**：
 * `content`（读）、`editContent(下一份)`（整份写）、`help()`（自述）、
 * `connect / disconnect`（连接）——多态体现在行为与文案，不体现在方法表。
 * 沙箱一侧的门面把这几个成员包成真对象（见 agent/sandbox/nodeObject）。
 */
export abstract class GNode {
  protected readonly ctx: NodeCtx
  readonly uuid: string

  constructor(ctx: NodeCtx, uuid: string) {
    this.ctx = ctx
    this.uuid = uuid
  }

  abstract get kind(): GNodeKind
  /** 展示名（卡片标题 / 回执称呼） */
  abstract get title(): string
  /** 派生关系（上游 + 下游），见文件头的「关系是派生视图」 */
  abstract get relations(): NodeRelation[]
  /** 当下内容的快照（长文本原样给出，模型自己分段处理） */
  abstract get content(): unknown
  /** 整份替换内容；各类型自己校验（schema / 上限 / 覆盖警告） */
  abstract editContent(next: unknown): NodeResult
  /** 动态自述（文案随上游与状态变化） */
  abstract help(): NodeHelp

  /* ---------- 固定接口（provider 侧声明，consumer 侧认领） ---------- */

  /**
   * 我对外提供的固定接口。默认没有；由「要向下游交代清楚该干什么」的类型声明
   * （大纲：每条目标项一个口）。从内容**派生**——内容一变接口就跟着变，不落第二份状态。
   */
  get ports(): NodePort[] {
    return []
  }

  /**
   * 拉取我认领到的接口数据：扫自己 relations 里**带 portKey 的上游项**，按 uuid 还原
   * 上游对象，到它的 ports 里对号取**整条**（含 key / label / data）——消费方因此
   * 不用猜「我挂在哪条计划下、该写什么」。接口被上游删了就静默缺席（认领随关系存在）。
   */
  getPortData(): NodePort[] {
    const out: NodePort[] = []
    for (const r of this.relations) {
      if (r.type !== 'up' || !r.portKey) continue
      const port = this.ctx.objectOf(r.id)?.ports.find((p) => p.key === r.portKey)
      if (port) out.push(port)
    }
    return out
  }

  /* ---------- 连接协议（双边协商；落库由上游一方的 link 实现） ---------- */

  /** 默认拒绝：能连谁由各类型自己声明，这里只给兜底措辞 */
  onUpstream(_node: GNode): ConnectFilter {
    return '「' + this.title + '」（' + this.kindLabel + '）不接受上游连接'
  }

  onDownstream(_node: GNode): ConnectFilter {
    return '「' + this.title + '」（' + this.kindLabel + '）不接受下游连接'
  }

  /**
   * 连接两个节点。`type` 是 **target 的接入身份**：
   * - `'down'`：target 以下游身份接入 → 先问 target 的上游过滤，再问我的下游过滤；
   * - `'up'`：target 以上游身份接入 → 先问 target 的下游过滤，再问我的上游过滤。
   * 两个过滤都通过才落库（由上游一方的 link 写 store）；任何一步拒绝都不留半边状态。
   *
   * `portKey`（可选）：下游认领上游的一个固定接口（接口必须存在，且一个接口只认领
   * 一个下游）。谁发起连接都一样——认领记在**这条边**上，下游一侧读得到。
   */
  connect(target: unknown, type: unknown, portKey?: unknown): NodeResult {
    if (!(target instanceof GNode)) {
      return { error: 'connect 的第一个参数要是一个节点对象：const t = await api.node.get(uuid) 取到再连' }
    }
    if (target.uuid === this.uuid) return { error: '节点不能和自己连接' }
    const related = this.relations.some((r) => r.id === target.uuid)
    if (related && (portKey === undefined || portKey === null || portKey === '')) {
      return { error: '「' + this.title + '」和「' + target.title + '」已经连着了' }
    }
    // 带着认领重连一对已连着的节点 = **改认领**：继续走双边校验，由上游 link 更新那条边
    const t = type === 'up' ? 'up' : type === 'down' ? 'down' : ''
    if (!t) return { error: 'connect 的第二个参数是接入身份：connect(节点, "down") 表示对方作为我的下游接入（"up" 则为上游）' }
    const down = t === 'down' ? target : this
    const up = t === 'down' ? this : target
    const r1 = down.onUpstream(up)
    if (r1 !== true) return { error: r1 }
    const r2 = up.onDownstream(down)
    if (r2 !== true) return { error: r2 }
    let claim: string | undefined
    if (portKey !== undefined && portKey !== null && portKey !== '') {
      if (typeof portKey !== 'string' || !portKey.trim()) {
        return { error: 'portKey 要是非空字符串：认领上游的哪个接口（先看上游的 ports 里有哪些 key）' }
      }
      claim = portKey.trim()
      const port = up.ports.find((p) => p.key === claim)
      if (!port) {
        return {
          error: up.ports.length
            ? '「' + up.title + '」没有接口「' + claim + '」。可认领的：' + up.ports.map((p) => p.key + '（' + p.label + '）').join('、')
            : '「' + up.title + '」没有声明任何接口（ports），portKey 无处认领',
        }
      }
      const takenBy = this.claimTakenBy(up, claim, down.uuid)
      if (takenBy) {
        const other = this.ctx.objectOf(takenBy)
        return { error: '接口「' + port.label + '」已经被「' + (other?.title ?? takenBy) + '」认领了——一个接口只认领一个下游' }
      }
    }
    return up.link(down, claim)
  }

  /**
   * 认领占用查的是树边（portKey 存在边上）；今天能声明接口又能挂树边的上游只有大纲，
   * 锚在宿主文档上（游离大纲则用自己的 uuid 发声，两种拼法都查）。其余类型没有可
   * 占用的记录，返回 null 放行。
   */
  private claimTakenBy(up: GNode, portKey: string, exceptDownUuid: string): string | null {
    const hostId = docIdOfOutlineUuid(up.uuid)
    if (!hostId) return null
    const edge = this.ctx
      .store()
      .edges.find((e) => (e.from === hostId || e.from === up.uuid) && e.portKey === portKey && e.to !== exceptDownUuid)
    return edge ? edge.to : null
  }

  /** 摘掉一条连接（双向清除；对「大纲 ↔ 文档 / 大纲」就是拆掉那条树边） */
  disconnect(target: unknown): NodeResult {
    if (!(target instanceof GNode)) {
      return { error: 'disconnect 的参数要是一个节点对象（api.node.get(uuid) 取到再拆）' }
    }
    if (!this.relations.some((r) => r.id === target.uuid)) {
      return { error: '「' + this.title + '」和「' + target.title + '」之间没有连接' }
    }
    return this.unlink(target)
  }

  /** 落库：由**上游一方**实现（当前唯一可手工连接的组合是「大纲 → 文档」，见 outline.ts）；portKey 是下游的接口认领，随边落库 */
  protected link(_down: GNode, _portKey?: string): NodeResult {
    return { error: '这两个类型之间不能建立连接（help().connection 里有各自的连接规则）' }
  }

  /** 摘除落库：同样由上游一方实现 */
  protected unlink(_target: GNode): NodeResult {
    return { error: '这一条连接不是手工建立的，摘不掉（help().connection 里有说明）' }
  }

  /** 类型中文名（拒绝措辞用；各子类给常量） */
  protected abstract get kindLabel(): string

  /** 这个节点还在 store 里吗（被删后对象句柄会失效） */
  abstract exists(): boolean
}
