/**
 * 渲染层的落盘入口。
 *
 * 应用的数据不再放 localStorage，而是放在用户数据目录里（见 electron/storage.ts）：
 *
 *   {root}/users/{uid}/user.yaml      用户信息
 *   {root}/users/{uid}/setting.yaml   用户配置（外观 + AI）
 *   {root}/users/{uid}/state.json     学习区界面状态
 *   {root}/users/{uid}/docs/…         教学文档（见 learn/files.ts）
 *
 * 三条约定：
 * 1. **读在启动、写在平时**。启动时把要用的东西一次性读进内存（见 lib/boot.ts），
 *    之后各存储模块仍然是同步读内存——界面代码不必到处 await。
 * 2. **写是异步 + 防抖的**。设置面板每敲一个字都会调 save，每次都落盘既慢又没必要。
 * 3. **关窗前同步兜底**。页面卸载时异步队列已经排不上队，用 sendSync 把最后一批
 *    写完（`flushCommitsSync`），否则「刚改完就关窗」会丢。
 *
 * 所有失败都只记日志、不抛异常：磁盘出问题不该把界面打断，本次会话内的数据仍然可用。
 */

import { native, type FlushItem, type StorageEntry, type StorageInfo } from './native'

/** 用户数据根下的相对路径 */
export function userRel(uid: string, ...segments: string[]): string {
  return ['users', uid, ...segments.filter(Boolean)].join('/')
}

/* ---------- 用户**内**的相对路径 ---------- */

/**
 * 当前用户。
 *
 * 渲染层里的相对路径有两种，混用就是事故：
 * - **相对数据根**（`users/{uid}/docs/…`）：本模块其余函数的入参，也是主进程的入参，
 *   以及 store 里 `userRel(uid, rel)` 拼出来的那一种；
 * - **相对当前用户**（`docs/{目标}/static/…`）：教学文档、资源清单、图片引用
 *   （agent/types 的 MessageImage.rel）里存的全是这一种——它们不该知道 uid。
 *
 * 静态资源与图片字节曾经漏了这一步前缀：直接拿「相对当前用户」的路径调本模块，
 * 于是**文件**落在 `{root}/docs/…`、而**清单**（走 buildDocs → userRel）落在
 * `{root}/users/{uid}/docs/…`——资源与清单就这样分了家。
 * 现在用户内的路径一律走下面这组 `*User*` 包装，前缀只在这里补一次。
 */
let scopeUid: string | null = null

/** 由 learn/store 的 hydrate 调用；未登录传 null */
export function setUserScope(uid: string | null): void {
  scopeUid = uid
  // 绝对路径换算依赖数据根：登录 / 启动 / 换用户都顺手刷一次（异步，不阻塞 hydrate）
  void refreshStorageRoot()
}

/** 「相对当前用户」→「相对数据根」；未登录返回 null（调用方按中性值处理） */
export function userPath(rel: string): string | null {
  return scopeUid ? userRel(scopeUid, rel) : null
}

/* ---------- 数据根：把「相对当前用户」换算成磁盘绝对路径 ---------- */

/**
 * 工作区文件要以 **local 页签**打开（TabRef.path 的语义是磁盘绝对路径，LocalDoc
 * 用它直接读写真实文件），而工作区的 rel 只有「相对当前用户」这一种——中间隔着
 * 数据根（{root}）与 uid 两级。数据根只有 IPC 能问（storage.info），这里拉一次
 * 缓住：setUserScope（启动 / 登录）与换存储位置后各刷一次。
 */

let cachedRoot: string | null = null

/** 拉一次并记住数据根；拿不到就置 null（userAbsPath 随之给出中性失败） */
export async function refreshStorageRoot(): Promise<void> {
  try {
    cachedRoot = (await native().storage.info()).root || null
  } catch {
    cachedRoot = null
  }
}

/**
 * 「相对当前用户」→ 磁盘绝对路径（{root}/users/{uid}/{rel}）。
 * 未登录、或数据根还没拉到（启动头几拍）返回 null——调用方按中性值处理；
 * 同步可用（click / 拖放的芯片打开都是同步链），刷新靠 refreshStorageRoot。
 * rel 里带 `..` 的一律拒绝：这条路径要落成真实文件路径，不能给穿目录的口子。
 */
export function userAbsPath(rel: string): string | null {
  if (!cachedRoot || !scopeUid) return null
  const segs = rel.split('/').filter(Boolean)
  if (!segs.length || segs.some((s) => s === '..')) return null
  return [cachedRoot.replace(/[\\/]+$/, ''), 'users', scopeUid, ...segs].join('/')
}

/* ---------- 基本读写 ---------- */

export async function storageInfo(): Promise<StorageInfo> {
  return native().storage.info()
}

export async function setRoot(dir?: string): Promise<{ ok: boolean; root: string; error?: string }> {
  const r = await native().storage.setRoot(dir)
  if (r.ok && r.root) cachedRoot = r.root
  return r
}

export async function pickRoot(): Promise<{ ok: boolean; canceled?: boolean; root?: string; error?: string }> {
  const r = await native().storage.pickRoot()
  if (r.ok && r.root) cachedRoot = r.root
  return r
}

/** 读文本；不存在返回 null */
export async function readText(rel: string): Promise<string | null> {
  const res = await native().storage.read(rel)
  if (!res.ok) {
    console.warn('[storage] 读取失败：', rel, res.error)
    return null
  }
  return res.content
}

export async function readYaml<T>(rel: string): Promise<T | null> {
  const res = await native().storage.readYaml(rel)
  if (!res.ok) {
    console.warn('[storage] 读取失败：', rel, res.error)
    return null
  }
  return (res.data ?? null) as T | null
}

/** 读 JSON；不存在或损坏返回 null */
export async function readJson<T>(rel: string): Promise<T | null> {
  const text = await readText(rel)
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch (err) {
    // 解析失败 = 文件多半被截断过（非原子写时代的遗留、或磁盘问题）：
    // 把错误对象一起打出来，修数据才有线索
    console.warn('[storage] JSON 解析失败：', rel, err)
    return null
  }
}

export async function writeText(rel: string, content: string): Promise<boolean> {
  const res = await native().storage.write(rel, content)
  if (!res.ok) console.warn('[storage] 写入失败：', rel, res.error)
  return res.ok
}

export async function writeYaml(rel: string, data: unknown): Promise<boolean> {
  const res = await native().storage.writeYaml(rel, data)
  if (!res.ok) console.warn('[storage] 写入失败：', rel, res.error)
  return res.ok
}

/** 写 JSON。结构化数据用 JSON、配置用 YAML，与各自的文件后缀对齐 */
export async function writeJson(rel: string, data: unknown): Promise<boolean> {
  return writeText(rel, `${JSON.stringify(data, null, 2)}\n`)
}

/**
 * 写一张图。内容用 base64 data URL 传，落盘的是真实二进制
 * （见 electron/storage.ts 的 writeImage），用 33% 的传输体积换一个
 * 「数据目录里就是能双击打开的 png」。
 */
export async function writeImage(rel: string, dataUrl: string): Promise<boolean> {
  const res = await native().storage.writeImage(rel, dataUrl)
  if (!res.ok) console.warn('[storage] 图片写入失败：', rel, res.error)
  return res.ok
}

/** 读一张图的 data URL；文件不存在返回 null */
export async function readImage(rel: string): Promise<string | null> {
  const res = await native().storage.readImage(rel)
  if (!res.ok) {
    console.warn('[storage] 图片读取失败：', rel, res.error)
    return null
  }
  return res.dataUrl
}

/**
 * 写任意扩展名的二进制（资源库）。与 writeImage 分开：那条通道按扩展名白名单
 * 只收图片，这条不限类型（见 electron/storage.ts 的 writeBinary）。
 * 内容同样是 base64 data URL，落盘的仍是真实二进制。
 */
export async function writeBinary(rel: string, dataUrl: string): Promise<boolean> {
  const res = await native().storage.writeBinary(rel, dataUrl)
  if (!res.ok) console.warn('[storage] 资源写入失败：', rel, res.error)
  return res.ok
}

/** 读任意扩展名的二进制的 data URL；文件不存在返回 null，mime 由扩展名推 */
export async function readBinary(rel: string): Promise<string | null> {
  const res = await native().storage.readBinary(rel)
  if (!res.ok) {
    console.warn('[storage] 资源读取失败：', rel, res.error)
    return null
  }
  return res.dataUrl
}

export async function listDir(rel: string): Promise<StorageEntry[]> {
  const res = await native().storage.list(rel)
  if (!res.ok) {
    console.warn('[storage] 列目录失败：', rel, res.error)
    return []
  }
  return res.entries
}

/** 删除文件或整个目录（用户级清理用） */
export async function removePath(rel: string): Promise<boolean> {
  const res = await native().storage.remove(rel)
  if (!res.ok) console.warn('[storage] 删除失败：', rel, res.error)
  return res.ok
}

/**
 * 新建一个目录（父目录连带建起）。
 * 已存在同名文件 / 目录时主进程拒绝（新建要的是「多一个东西」，不静默合并），
 * 这里回 false，调用方给一句人话即可。
 */
export async function mkdir(rel: string): Promise<boolean> {
  const res = await native().storage.mkdir(rel)
  if (!res.ok) console.warn('[storage] 新建目录失败：', rel, res.error)
  return res.ok
}

/**
 * 移动文件或整个目录。
 *
 * 改名（改标题）时用它把节点目录下的资源整个挪到新位置：文档保存走的是
 * 「新路径写、旧路径删」，而旧路径的删除是递归的——不先挪走，static 里的
 * 素材会跟着旧目录一起没（见 electron/storage.ts 的 movePath）。
 * 目标已存在时主进程会拒绝（不删任何东西），这里返回 false，调用方记一条警告即可。
 */
export async function movePath(from: string, to: string): Promise<boolean> {
  const res = await native().storage.move(from, to)
  if (!res.ok) console.warn('[storage] 移动失败：', from, '→', to, res.error)
  return res.ok
}

/** 相对当前用户目录的两条路径（movePath 的用户内包装，工作区拖拽复制用） */
export async function copyUserPath(from: string, to: string): Promise<boolean> {
  const a = userPath(from)
  const b = userPath(to)
  return a && b ? copyPath(a, b) : false
}

/** 复制文件或整个目录（工作区拖拽的 Ctrl 分支）。目标已存在时主进程拒绝，这里返回 false */
export async function copyPath(from: string, to: string): Promise<boolean> {
  const res = await native().storage.copy(from, to)
  if (!res.ok) console.warn('[storage] 复制失败：', from, '→', to, res.error)
  return res.ok
}

/**
 * 在系统文件管理器里定位某个文件（知识节点右键菜单的「在资源管理器中打开」）。
 * 返回是否成功——失败只提示，不抛出：磁盘上的事不该把界面打断。
 */
/**
 * 在系统文件管理器里定位一个**绝对路径**的文件（导出之后的「打开所在文件夹」）。
 *
 * 与 revealPath 的区别只有一处：那个接的是数据根下的相对路径，这个接的是
 * 用户在原生对话框里亲自选出来的路径——它当然不在数据目录里，后缀也未必是 md。
 */
export async function revealLocalFile(abs: string): Promise<boolean> {
  if (!abs.trim()) return false
  const r = await native().local.reveal(abs)
  return r.ok
}

export async function revealPath(rel: string): Promise<boolean> {
  const res = await native().storage.reveal(rel)
  if (!res.ok) {
    console.warn('[storage] 定位失败：', rel, res.error)
    return false
  }
  return true
}

/** 递归列出某目录下的全部文件（相对根目录的路径） */
export async function listFilesRecursive(rel: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await listDir(dir)) {
      const child = `${dir}/${entry.name}`
      if (entry.dir) await walk(child)
      else out.push(child)
    }
  }
  await walk(rel)
  return out
}

/* ---------- 会话（appdata，机器本地） ---------- */

export async function readSessionFile<T>(): Promise<T | null> {
  const res = await native().storage.readSession()
  return res.ok ? ((res.data ?? null) as T | null) : null
}

export async function writeSessionFile(data: unknown): Promise<boolean> {
  const res = await native().storage.writeSession(data)
  if (!res.ok) console.warn('[storage] 会话写入失败：', res.error)
  return res.ok
}

/* ---------- 提交调度 ---------- */

/**
 * 一次「把某个文件写成它该有的样子」。给出两个版本：
 * 平时的异步版，和关窗前的同步版。
 *
 * 之所以不是简单的「写字符串」：教学文档一次保存会牵动多个文件（新增、改动、删除），
 * 写什么得等真要落盘时才知道，所以这里存的是动作而不是内容。
 */
export interface Commit {
  run(): Promise<void>
  runSync(): FlushItem[]
}

const WRITE_DELAY = 320

const pending = new Map<string, { timer: number; commit: Commit }>()

/**
 * 调度一次提交。同一个 key 连续调用只保留最后一次——
 * 调用方每次都传「当前完整状态」，覆盖式写入，丢掉中间态没有副作用。
 */
export function scheduleCommit(key: string, commit: Commit, delay = WRITE_DELAY): void {
  const prev = pending.get(key)
  if (prev) window.clearTimeout(prev.timer)
  const timer = window.setTimeout(() => {
    pending.delete(key)
    void commit.run().catch((err) => console.warn('[storage] 落盘失败：', key, err))
  }, delay)
  pending.set(key, { timer, commit })
}

/** 立刻把待写的内容落盘（切用户、手动保存时用） */
export async function flushCommits(): Promise<void> {
  const items = [...pending.values()]
  pending.clear()
  for (const { timer, commit } of items) {
    window.clearTimeout(timer)
    try {
      await commit.run()
    } catch (err) {
      console.warn('[storage] 落盘失败：', err)
    }
  }
}

/**
 * 同步落盘：页面卸载前调用。
 * 用 sendSync 走主进程的同步写——此刻再排队就来不及了。
 */
export function flushCommitsSync(): void {
  const items = [...pending.values()]
  if (!items.length) return
  pending.clear()
  const payload: FlushItem[] = []
  for (const { timer, commit } of items) {
    window.clearTimeout(timer)
    try {
      payload.push(...commit.runSync())
    } catch (err) {
      console.warn('[storage] 同步落盘失败：', err)
    }
  }
  if (!payload.length) return
  try {
    const res = native().storage.flush(payload)
    if (!res.ok) console.warn('[storage] 同步落盘未全部成功：', res.failed)
  } catch (err) {
    console.warn('[storage] 同步落盘失败：', err)
  }
}

/* ---------- 用户内的读写：入参是「相对当前用户」的路径 ---------- */

/**
 * 下面这一组的入参都相对**当前用户目录**（`docs/…`），前缀由 userPath 补。
 * learn/* 里凡是拿资源清单或图片引用里的路径来读写磁盘的，都必须走这一组——
 * 直接调上面那些函数就会写进 `{root}/docs/…`（就是资源与清单分家的原因）。
 * 未登录时统一返回中性值：读回 null/空数组，写回 false。
 */

export async function readUserText(rel: string): Promise<string | null> {
  const p = userPath(rel)
  return p ? readText(p) : null
}

export async function writeUserText(rel: string, content: string): Promise<boolean> {
  const p = userPath(rel)
  return p ? writeText(p, content) : false
}

export async function readUserImage(rel: string): Promise<string | null> {
  const p = userPath(rel)
  return p ? readImage(p) : null
}

export async function writeUserImage(rel: string, dataUrl: string): Promise<boolean> {
  const p = userPath(rel)
  return p ? writeImage(p, dataUrl) : false
}

export async function readUserBinary(rel: string): Promise<string | null> {
  const p = userPath(rel)
  return p ? readBinary(p) : null
}

export async function writeUserBinary(rel: string, dataUrl: string): Promise<boolean> {
  const p = userPath(rel)
  return p ? writeBinary(p, dataUrl) : false
}

export async function listUserDir(rel: string): Promise<StorageEntry[]> {
  const p = userPath(rel)
  return p ? listDir(p) : []
}

export async function removeUserPath(rel: string): Promise<boolean> {
  const p = userPath(rel)
  return p ? removePath(p) : false
}

export async function mkdirUserPath(rel: string): Promise<boolean> {
  const p = userPath(rel)
  return p ? mkdir(p) : false
}

export async function moveUserPath(from: string, to: string): Promise<boolean> {
  const a = userPath(from)
  const b = userPath(to)
  return a && b ? movePath(a, b) : false
}

/** 在系统文件管理器里定位用户内的文件 */
export async function revealUserPath(rel: string): Promise<boolean> {
  const p = userPath(rel)
  return p ? revealPath(p) : false
}

