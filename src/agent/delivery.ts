/**
 * 这个文件负责什么：一轮对话「交付了什么」的记录——改了哪些文件、引用了哪些来源。
 *
 * 为什么单独做成一份结构化记录，而不是让模型在正文里复述：正文里的「## 参考资料」
 * 与 chip 是**叙述**，模型每次写得都不一样（有的漏、有的格式各异），界面也没法据此
 * 做统一展示。把交付单独登记成数据，界面才能在消息底部固定展示一行一条，且能随会话落盘。
 *
 * 只记「结果」，不记「过程」：文件变动是这次产出/修改的产物，参考引证是这次真正读过并
 * 引用到的来源。工具调用日志不进来（那是过程，见 tool 部分）。
 */

/** 文件变动类型：新增 / 修改 / 删除 */
export type DeliveryAction = 'created' | 'updated' | 'deleted'

export interface DeliveryFile {
  /** 面向用户的路径：数据树路径（如「微积分/极限」）或工作区相对路径 */
  path: string
  action: DeliveryAction
  /** 一句话说明改了什么（可省） */
  note?: string
  goalId?: string
  nodeId?: string
}

export interface DeliverySource {
  title: string
  url: string
}

export interface DeliveryRecord {
  files: DeliveryFile[]
  sources: DeliverySource[]
}

/** 单条消息最多记多少：组件一行一条，溢出的交给省略号与 title，不铺满屏 */
export const MAX_DELIVERY_FILES = 12
export const MAX_DELIVERY_SOURCES = 12

export function emptyDelivery(): DeliveryRecord {
  return { files: [], sources: [] }
}

/** 有没有东西可展示（空记录不渲染组件） */
export function hasDelivery(d?: DeliveryRecord | null): boolean {
  return !!d && (d.files.length > 0 || d.sources.length > 0)
}

const ACTIONS: readonly DeliveryAction[] = ['created', 'updated', 'deleted']
const isAction = (v: unknown): v is DeliveryAction => typeof v === 'string' && (ACTIONS as readonly string[]).includes(v)

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 只收 http(s)：组件里的来源是可点的，别的协议点开没有意义 */
function httpUrl(v: unknown): string {
  const s = str(v)
  return /^https?:\/\//i.test(s) ? s : ''
}

/**
 * 读盘时的归一化：形状钉死，长度截断，按路径 / URL 去重。
 *
 * 与其它 normalize 同一条纪律：老数据没有这个字段、或手改坏了，这里一律回 undefined
 * 或空记录，绝不让界面拿到一个奇怪形状（组件按数组遍历，缺一项就整块炸）。
 */
export function normalizeDelivery(raw: unknown): DeliveryRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { files?: unknown; sources?: unknown }

  const files: DeliveryFile[] = []
  const seenPath = new Set<string>()
  if (Array.isArray(r.files)) {
    for (const item of r.files) {
      if (!item || typeof item !== 'object') continue
      const f = item as { path?: unknown; action?: unknown; note?: unknown; goalId?: unknown; nodeId?: unknown }
      const path = str(f.path)
      if (!path || seenPath.has(path)) continue
      seenPath.add(path)
      const note = str(f.note)
      const goalId = str(f.goalId)
      const nodeId = str(f.nodeId)
      files.push({
        path,
        action: isAction(f.action) ? f.action : 'updated',
        ...(note ? { note } : {}),
        ...(goalId ? { goalId } : {}),
        ...(nodeId ? { nodeId } : {}),
      })
      if (files.length >= MAX_DELIVERY_FILES) break
    }
  }

  const sources: DeliverySource[] = []
  const seenUrl = new Set<string>()
  if (Array.isArray(r.sources)) {
    for (const item of r.sources) {
      if (!item || typeof item !== 'object') continue
      const s = item as { title?: unknown; url?: unknown }
      const url = httpUrl(s.url)
      if (!url || seenUrl.has(url)) continue
      seenUrl.add(url)
      sources.push({ title: str(s.title) || url, url })
      if (sources.length >= MAX_DELIVERY_SOURCES) break
    }
  }

  if (!files.length && !sources.length) return undefined
  return { files, sources }
}

/**
 * 把一次 submit 并进本轮的总账：同一轮里分几次登记（先写完文件、再补来源）也只有一个组件。
 * 同一路径 / 同一 URL 只留第一次，后到的 note 不覆盖先到的判断。
 */
export function mergeDelivery(into: DeliveryRecord, next: DeliveryRecord): DeliveryRecord {
  const existingByPath = new Map(into.files.map((f) => [f.path, f]))
  for (const f of next.files) {
    const existing = existingByPath.get(f.path)
    if (existing) {
      if (!existing.nodeId && f.nodeId) existing.nodeId = f.nodeId
      if (!existing.goalId && f.goalId) existing.goalId = f.goalId
      continue
    }
    existingByPath.set(f.path, f)
    if (into.files.length < MAX_DELIVERY_FILES) into.files.push(f)
  }
  const urls = new Set(into.sources.map((s) => s.url))
  for (const s of next.sources) {
    if (urls.has(s.url)) continue
    urls.add(s.url)
    if (into.sources.length < MAX_DELIVERY_SOURCES) into.sources.push(s)
  }
  return into
}
