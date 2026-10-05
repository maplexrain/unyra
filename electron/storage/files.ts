/**
 * 这个文件负责数据目录内的文本读写与路径校验：相对路径解析（越界即拒）、读 / 写、移动（改名）、
 * 删除、列目录、在系统文件管理器里定位，以及 YAML 与机器本地的会话文件。
 */
import { shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
// 文案函数在这份里叫 tr：下面满地的 const t = target(rel) 会把它遮住
import { t as tr } from '../i18n'
import { currentRoot, errText, isMissing, sessionPath, type ReadResult, type Result } from './settings'

/* ---------- 路径校验 ---------- */

/**
 * 把相对路径解析到 root 之内；越界一律返回 null。
 *
 * 逐段检查而不是靠字符串前缀判断——`root/../x` 这类在 resolve 之后才现形。
 */
export function resolveInside(root: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || rel.includes('\0')) return null
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (/^[a-zA-Z]:/.test(clean)) return null
  const segments = clean ? clean.split('/') : []
  if (segments.some((s) => !s || s === '.' || s === '..')) return null
  const base = path.resolve(root)
  const full = segments.length ? path.resolve(base, ...segments) : base
  if (full !== base && !full.startsWith(base + path.sep)) return null
  return full
}

/** 统一的入参校验：不合法就回一个错误结果，而不是抛异常到 IPC 边界上 */
export function target(rel: unknown): { full: string } | { error: string } {
  const full = resolveInside(currentRoot(), rel)
  return full ? { full } : { error: tr('路径不合法') }
}

/* ---------- 读写 ---------- */

export async function readText(rel: unknown): Promise<ReadResult> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  try {
    return { ok: true, content: await fsp.readFile(t.full, 'utf-8') }
  } catch (err) {
    // 文件不存在是正常情况（首次运行、刚建的用户），当成「空」而不是错误
    if (isMissing(err)) return { ok: true, content: null }
    return { ok: false, error: errText(err) }
  }
}

/**
 * 原子写：先落同目录的临时文件、再 rename 到位。
 *
 * 直接 writeFile 覆盖旧文件的话，进程死在写的半路上（强杀、断电、崩溃）就留下半个
 * state.json——下次启动读不出来，整个状态被按空处理：教学文档还能从 docs/ 里解析回来，
 * **只存在 state.json 里的东西（收藏、对话、页签布局）就全灭了**，再一保存连盘上的旧数据
 * 一起覆盖掉。rename 在同一目录内是同卷的，本身就是原子操作。
 *
 * 临时名带序号（而不是固定 full + '.tmp'）：万一有写绕过下面的排队，两个写也不会
 * 共享同一个临时文件互相搬走。
 */
let tmpSeq = 0

async function atomicWrite(full: string, content: string): Promise<void> {
  const tmp = `${full}.${process.pid}.${++tmpSeq}.tmp`
  await fsp.writeFile(tmp, content, 'utf-8')
  try {
    await fsp.rename(tmp, full)
  } catch (err) {
    // 个别文件系统 / 杀软占用会让 rename 对已存在目标失败：退回「先删再改名」，
    // 中间丢的窗口只有「已经写好的临时文件还等着就位」的那一瞬间
    if (!isMissing(err)) {
      try {
        await fsp.rm(full, { force: true })
        await fsp.rename(tmp, full)
        return
      } catch (err2) {
        await fsp.rm(tmp, { force: true }).catch(() => {})
        throw err2
      }
    }
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/*
 * 同一目标文件的写**排队串行**：并发写同一份文件时，前一次 rename 会把临时文件搬走，
 * 后一次 rename 就 ENOENT——reading-tick.json / state.json 这类高频写最容易撞上，
 * 表现就是控制台里一串「写入失败 … rename … ENOENT」，后写的那份内容被丢掉。
 * 链条只关心「前面的写完成没有」：前一次失败也继续排（这一次照写，失败由自己回）。
 */
const writeChains = new Map<string, Promise<unknown>>()

export async function writeText(rel: unknown, content: unknown): Promise<Result> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  const run = async (): Promise<Result> => {
    try {
      await fsp.mkdir(path.dirname(t.full), { recursive: true })
      await atomicWrite(t.full, typeof content === 'string' ? content : '')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: errText(err) }
    }
  }
  const prev = writeChains.get(t.full) ?? Promise.resolve()
  const job = prev.then(run, run)
  writeChains.set(t.full, job)
  // 收尾清账：这条链跑完且没有新写接上时，把句柄从表里摘掉（防 Map 无界生长）
  void job.finally(() => {
    if (writeChains.get(t.full) === job) writeChains.delete(t.full)
  })
  return job
}

/* ---------- 移动（改名用） ---------- */

/**
 * 校验一次移动的两端。两边都要在数据根之内，并且：
 *
 * - 源或目标是根目录本身：把整个数据目录搬走没有意义，只会把 root 变成空壳；
 * - 两端相同：当作**无事发生**而不是报错——改名到同名（标题没变）在调用方
 *   完全可能发生，报错会让它以为自己搞错了什么；
 * - 目标在源之内：rename 本身就会失败（EINVAL），提前拦下是为了给一句人话。
 *
 * 整条移动路径上一个删除动作都没有（见 movePath），否则这些情况真会毁数据。
 */
export function moveTargets(
  fromRel: unknown,
  toRel: unknown,
): { from: string; to: string; noop: boolean } | { error: string } {
  const from = resolveInside(currentRoot(), fromRel)
  const to = resolveInside(currentRoot(), toRel)
  if (!from || !to) return { error: tr('路径不合法') }
  const root = path.resolve(currentRoot())
  if (from === root) return { error: tr('不能移动数据根目录') }
  if (to === root) return { error: tr('不能移动到数据根目录') }
  if (from === to) return { from, to, noop: true }
  if (from.startsWith(to + path.sep)) return { error: tr('目标目录不能在源目录之内') }
  return { from, to, noop: false }
}

/**
 * 移动文件或整个目录。
 *
 * 为什么需要它：**改标题 = 目录改名**，而文档保存走的是「新路径写、旧路径删」
 * 的差异比对（见 src/learn/files.ts 的 diffDocs），删除收敛到目录一级、主进程
 * 递归删。资源库里的二进制不在差异比对的视野内（那份快照只记文本文件），
 * 不先挪走就会被旧目录的删除一并带走——用户改个节点标题，素材就没了。
 *
 * 用同卷 fsp.rename：两端都在数据根之内，一定同卷，不需要跨设备的拷贝回落。
 *
 * **目标已存在就直接失败，绝不先删**。这里搬的往往是 static / images 这种整个
 * 目录，目标里可能已经有东西（上一次改名留下的，或者用户自己拷进去的）——
 * 为了完成这一次改名把它们删掉，代价远大于「这次没搬成」。返回 ok:false 之后
 * 调用方会记一条警告，资源留在原地：留着总比没了强。
 * （Windows 的 rename 本身就拒绝覆盖已存在的目标，这条规则与平台行为一致。）
 */
export async function movePath(fromRel: unknown, toRel: unknown): Promise<Result> {
  const m = moveTargets(fromRel, toRel)
  if ('error' in m) return { ok: false, error: m.error }
  if (m.noop) return { ok: true }
  try {
    /*
     * 目标在不在，必须自己问清楚：POSIX 的 rename 对**同名文件**是静默覆盖的，
     * 不能指望它替我们挡住；Windows 上则会失败，两边行为还不一样。
     */
    const taken = await fsp
      .access(m.to)
      .then(() => true)
      .catch(() => false)
    if (taken) return { ok: false, error: tr('目标已存在') }
    // 改名会新建一整层目录（新标题的父目录可能还不存在）
    await fsp.mkdir(path.dirname(m.to), { recursive: true })
    await fsp.rename(m.from, m.to)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * 复制文件或整个目录（工作区拖拽的 Ctrl 分支，见 LearnWorkspace 的 wsActions.transfer）。
 * 目标已存在直接拒绝（调用方会先撞名避开，真撞上了说明有并发，宁可失败也不覆盖）；
 * 目录用 fsp.cp 递归整份拷。
 */
export async function copyPath(fromRel: unknown, toRel: unknown): Promise<Result> {
  const m = moveTargets(fromRel, toRel)
  if ('error' in m) return { ok: false, error: m.error }
  if (m.noop) return { ok: false, error: tr('源与目标是同一个文件') }
  try {
    const taken = await fsp
      .access(m.to)
      .then(() => true)
      .catch(() => false)
    if (taken) return { ok: false, error: tr('目标已存在') }
    await fsp.mkdir(path.dirname(m.to), { recursive: true })
    await fsp.cp(m.from, m.to, { recursive: true, errorOnExist: true, force: false })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

export async function removePath(rel: unknown): Promise<Result> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  // 根目录本身不给删
  if (t.full === path.resolve(currentRoot())) return { ok: false, error: tr('不能删除数据根目录') }
  try {
    await fsp.rm(t.full, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * 新建一个目录。
 *
 * 已存在同名文件或目录时**拒绝**（新建要的是「多一个东西」，静默合并会让人误以为成功了）；
 * 父目录不存在则连带建起来——工作区里第一次新建时，目标根目录可能还没落过盘。
 */
export async function mkdirPath(rel: unknown): Promise<Result> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  try {
    await fsp.access(t.full)
    return { ok: false, error: tr('同名文件或目录已存在') }
  } catch {
    // 不存在才往下走
  }
  try {
    await fsp.mkdir(t.full, { recursive: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

export async function listDir(rel: unknown): Promise<
  { ok: true; entries: Array<{ name: string; dir: boolean }> } | { ok: false; error: string }
> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }
  try {
    const dirents = await fsp.readdir(t.full, { withFileTypes: true })
    return {
      ok: true,
      entries: dirents.map((d) => ({ name: d.name, dir: d.isDirectory() })),
    }
  } catch (err) {
    if (isMissing(err)) return { ok: true, entries: [] }
    return { ok: false, error: errText(err) }
  }
}

/**
 * 在系统文件管理器里定位一个文件。
 *
 * 只有主进程拿得到 shell，渲染层因此只能「请求」这件事。路径同样过 resolveInside：
 * 能打开的只限于数据根目录里的东西，不会因为一个手改过的路径就把文件管理器
 * 领到 C:\Windows 去。
 *
 * 文件还没落盘时（刚建的节点、防抖写入窗口内）退一步打开它所在的最深一层
 * 已存在目录——总比什么都不发生强。
 */
export async function revealPath(rel: unknown): Promise<Result> {
  const t = target(rel)
  if ('error' in t) return { ok: false, error: t.error }

  const exists = await fsp
    .access(t.full)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    shell.showItemInFolder(t.full)
    return { ok: true }
  }

  const base = path.resolve(currentRoot())
  let dir = path.dirname(t.full)
  while (dir.startsWith(base) && dir !== path.dirname(dir)) {
    const dirExists = await fsp
      .access(dir)
      .then(() => true)
      .catch(() => false)
    if (dirExists) {
      const err = await shell.openPath(dir)
      return err ? { ok: false, error: err } : { ok: true }
    }
    dir = path.dirname(dir)
  }
  return { ok: false, error: tr('文件尚未写入磁盘') }
}

/** 读 YAML。解析交给主进程：格式细节只在一处，渲染层拿到的就是普通对象 */
export async function readYaml(rel: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const res = await readText(rel)
  if (!res.ok) return res
  if (res.content === null) return { ok: true, data: null }
  try {
    return { ok: true, data: parseYaml(res.content) ?? null }
  } catch (err) {
    return { ok: false, error: tr('YAML 解析失败：{0}', errText(err)) }
  }
}

/**
 * 写 YAML。lineWidth: 0 关掉折行——折行会把长 Base64（头像）与 URL 切成多行，
 * 既难读也容易在手工编辑时被破坏。
 */
export async function writeYaml(rel: unknown, data: unknown): Promise<Result> {
  let text: string
  try {
    text = stringifyYaml(data ?? null, { lineWidth: 0 })
  } catch (err) {
    return { ok: false, error: tr('YAML 序列化失败：{0}', errText(err)) }
  }
  return writeText(rel, text)
}

/* ---------- 会话（机器本地） ---------- */

export async function readSession(): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const raw = await fsp.readFile(sessionPath(), 'utf-8')
    return { ok: true, data: JSON.parse(raw) }
  } catch (err) {
    if (isMissing(err)) return { ok: true, data: null }
    // 损坏的会话当作未登录，不打断启动
    return { ok: true, data: null }
  }
}

export async function writeSession(data: unknown): Promise<Result> {
  try {
    await fsp.mkdir(path.dirname(sessionPath()), { recursive: true })
    if (data === null || data === undefined) await fsp.rm(sessionPath(), { force: true })
    else await fsp.writeFile(sessionPath(), JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}
