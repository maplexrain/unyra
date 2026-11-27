/**
 * 外部组件文件加载器。
 *
 * 这一层只负责「目录里的 .tsx → 可用的模块对象」：扫描 `doc-design/`、按源码编译、
 * 记录错误、热更新通知。具体“文档组件 / 课堂组件 / 动效 / 音效”的语义由各自的
 * registry 解释，避免循环依赖。
 *
 * 安全边界：文件是用户自己放在本地用户目录里的代码，按本地优先应用的约定执行；
 * 编译只提供 React 与 jsx-runtime，不注入应用内部对象。组件渲染函数只拿到标签内 HTML。
 */
import { listUserDir, mkdirUserPath, onUserTextWritten, readUserText, removeUserPath, userAbsPath, userPath, writeUserText } from '../storage'
import { onLocalFileWritten } from '../localFiles'
import { compileExternalTsx } from './compile'
import {
  EXTERNAL_MODULES_DIR,
  type ExternalModuleError,
  type ExternalModuleKind,
  type ExternalModuleRecord,
} from './types'

const KINDS: ExternalModuleKind[] = [
  'doc-component',
  'classroom-component',
  'classroom-animation',
  'classroom-sound',
]

const listeners = new Set<() => void>()
let modules: ExternalModuleRecord[] = []
let errors: ExternalModuleError[] = []
let lastSources = new Map<string, string>()
let hydrated = false
let pollTimer: number | null = null
let refreshChain: Promise<boolean> = Promise.resolve(false)

function isKind(value: unknown): value is ExternalModuleKind {
  return typeof value === 'string' && (KINDS as string[]).includes(value)
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (err) {
      console.warn('[externalModules] listener failed:', err)
    }
  }
}

export function subscribeExternalModules(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isExternalModulesHydrated(): boolean {
  return hydrated
}

export function listExternalModules(kind?: ExternalModuleKind): ExternalModuleRecord[] {
  return kind ? modules.filter((m) => m.kind === kind) : modules.slice()
}

export function getExternalModule(kind: ExternalModuleKind, idOrAlias: string): ExternalModuleRecord | undefined {
  const target = idOrAlias.trim().toLowerCase()
  if (!target) return undefined
  return modules.find(
    (m) =>
      m.kind === kind &&
      (m.id.toLowerCase() === target ||
        String(m.def.id ?? '').toLowerCase() === target ||
        String(m.def.tag ?? '').toLowerCase() === target ||
        String(m.def.verb ?? '').toLowerCase() === target ||
        String(m.def.name ?? '').toLowerCase() === target),
  )
}

export function externalModuleErrors(): ExternalModuleError[] {
  return errors.slice()
}

export function findExternalModuleByFile(fileName: string): ExternalModuleRecord | undefined {
  return modules.find((m) => m.fileName === fileName)
}

function compileOne(fileName: string, source: string): { record?: ExternalModuleRecord; error?: ExternalModuleError } {
  const result = compileExternalTsx(source, fileName)
  if (result.error || !result.def) {
    return { error: { fileName, message: result.error || '模块没有导出对象' } }
  }
  const raw = result.def
  if (!isKind(raw.kind)) {
    return {
      error: {
        fileName,
        message: `kind 必须是 ${KINDS.join(' / ')} 之一（当前：${String(raw.kind ?? '缺失')}）`,
      },
    }
  }
  if (raw.component != null && typeof raw.component !== 'function') {
    return { error: { fileName, message: 'component 必须是 React 组件函数' } }
  }
  if ((raw.kind === 'doc-component' || raw.kind === 'classroom-component') && typeof raw.component !== 'function') {
    return { error: { fileName, message: `${raw.kind} 必须导出 component React 组件` } }
  }

  let id = ''
  if (raw.kind === 'doc-component') id = String(raw.id ?? raw.tag ?? '')
  else if (raw.kind === 'classroom-component') id = String(raw.tag ?? '')
  else if (raw.kind === 'classroom-animation') id = String(raw.verb ?? '')
  else id = String(raw.name ?? '')
  id = id.trim()
  if (!id) {
    return { error: { fileName, message: `${raw.kind} 缺少 id / tag / verb / name` } }
  }

  return {
    record: {
      kind: raw.kind,
      id,
      file: `${EXTERNAL_MODULES_DIR}/${fileName}`,
      fileName,
      source,
      def: raw,
      loadedAt: Date.now(),
    },
  }
}

async function readAllModules(): Promise<{
  next: ExternalModuleRecord[]
  nextErrors: ExternalModuleError[]
  nextSources: Map<string, string>
  changed: boolean
}> {
  const dir = userPath(EXTERNAL_MODULES_DIR)
  if (!dir) {
    return {
      next: [],
      nextErrors: [],
      nextSources: new Map(),
      changed: modules.length > 0 || errors.length > 0 || lastSources.size > 0,
    }
  }

  let entries: Array<{ name: string; dir: boolean }> = []
  try {
    entries = await listUserDir(EXTERNAL_MODULES_DIR)
  } catch {
    entries = []
  }
  const files = entries
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.tsx'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const next: ExternalModuleRecord[] = []
  const nextErrors: ExternalModuleError[] = []
  const seen = new Map<string, string>()
  const nextSources = new Map<string, string>()
  let changed = files.length !== lastSources.size

  for (const fileName of files) {
    const source = await readUserText(`${EXTERNAL_MODULES_DIR}/${fileName}`)
    if (source == null) {
      nextErrors.push({ fileName, message: '读不到文件内容' })
      changed = true
      continue
    }
    nextSources.set(fileName, source)
    if (lastSources.get(fileName) !== source) changed = true

    const result = compileOne(fileName, source)
    if (result.error) {
      nextErrors.push(result.error)
      continue
    }
    const record = result.record!
    const duplicateKey = `${record.kind}:${record.id.toLowerCase()}`
    if (seen.has(duplicateKey)) {
      nextErrors.push({ fileName, message: `与 ${seen.get(duplicateKey)} 的 ${record.kind} id 重复：${record.id}` })
      continue
    }
    seen.set(duplicateKey, fileName)
    next.push(record)
  }

  if (nextErrors.length || errors.length) {
    const signature = (list: ExternalModuleError[]) => list.map((e) => `${e.fileName}:${e.message}`).join('\n')
    if (signature(nextErrors) !== signature(errors)) changed = true
  }

  return { next, nextErrors, nextSources, changed }
}

/** 重新读目录。并发调用会排队，避免注册后立即刷新覆盖下一次刷新。 */
export function refreshExternalModules(force = false): Promise<boolean> {
  const run = refreshChain.then(async () => {
    if (!userPath(EXTERNAL_MODULES_DIR)) {
      if (modules.length || errors.length) {
        modules = []
        errors = []
        lastSources = new Map()
        emit()
      }
      return false
    }
    const result = await readAllModules()
    if (!force && !result.changed) return false
    modules = result.next
    errors = result.nextErrors
    lastSources = result.nextSources
    emit()
    return true
  })
  refreshChain = run.catch(() => false)
  return run
}

/** 开始轮询热更新；只有 hydrate 后调用。测试里可 stop。 */
export function startExternalModulesPolling(intervalMs = 2200): void {
  if (typeof window === 'undefined') return
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => {
    if (!document.hidden) void refreshExternalModules()
  }, Math.max(600, intervalMs))
}

export function stopExternalModulesPolling(): void {
  if (pollTimer && typeof window !== 'undefined') window.clearInterval(pollTimer)
  pollTimer = null
}

/** 进入用户作用域后调用：确保目录存在、首次扫描并开启热更新轮询。 */
export async function hydrateExternalModules(): Promise<void> {
  if (!userPath(EXTERNAL_MODULES_DIR)) {
    modules = []
    errors = []
    lastSources = new Map()
    hydrated = false
    stopExternalModulesPolling()
    emit()
    return
  }
  await mkdirUserPath(EXTERNAL_MODULES_DIR)
  hydrated = true
  await refreshExternalModules(true)
  startExternalModulesPolling()
}

/** 清空当前用户的模块缓存（退出登录 / 切换用户）。 */
export function clearExternalModules(): void {
  stopExternalModulesPolling()
  hydrated = false
  modules = []
  errors = []
  lastSources = new Map()
  emit()
}

/** 写一个外部模块文件并立即热更新；fileName 由 templates.externalModuleFileName 生成。 */
export async function writeExternalModuleFile(
  fileName: string,
  source: string,
): Promise<{ ok: boolean; file?: string; error?: string }> {
  const safe = fileName.replace(/[\\/]/g, '_').trim()
  if (!safe.toLowerCase().endsWith('.tsx')) return { ok: false, error: '外部组件必须是 .tsx 文件' }
  const ok = await writeUserText(`${EXTERNAL_MODULES_DIR}/${safe}`, source)
  if (!ok) return { ok: false, error: '写入外部组件文件失败（可能未登录或数据目录不可写）' }
  await refreshExternalModules(true)
  const error = errors.find((e) => e.fileName === safe)
  if (error) return { ok: false, error: error.message, file: `${EXTERNAL_MODULES_DIR}/${safe}` }
  return { ok: true, file: `${EXTERNAL_MODULES_DIR}/${safe}` }
}

/** 删除外部模块文件并刷新缓存。 */
export async function deleteExternalModuleFile(fileName: string): Promise<{ ok: boolean; error?: string }> {
  const safe = fileName.replace(/[\\/]/g, '_').trim()
  const ok = await removeUserPath(`${EXTERNAL_MODULES_DIR}/${safe}`)
  if (!ok) return { ok: false, error: '删除外部组件文件失败' }
  await refreshExternalModules(true)
  return { ok: true }
}

/** 当前目录在磁盘上的绝对路径（设置页给用户「打开文件夹」用） */
export function externalModulesAbsDir(): string | null {
  return userAbsPath(EXTERNAL_MODULES_DIR)
}

/**
 * 应用内保存与外部编辑器保存都触发刷新：storage 写只认相对路径，local 写只认绝对路径，
 * 两边都订阅一次，避免“在应用里改完不生效、在 VSCode 里改完也不生效”。
 */
onUserTextWritten((rel) => {
  if (rel.startsWith(`${EXTERNAL_MODULES_DIR}/`) && rel.toLowerCase().endsWith('.tsx')) {
    void refreshExternalModules()
  }
})
onLocalFileWritten((abs) => {
  const dir = externalModulesAbsDir()
  if (!dir) return
  const normalized = abs.replace(/\\/g, '/').toLowerCase()
  if (normalized.startsWith(dir.replace(/\\/g, '/').toLowerCase() + '/') && normalized.endsWith('.tsx')) {
    void refreshExternalModules()
  }
})
