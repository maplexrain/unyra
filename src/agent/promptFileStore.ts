/**
 * 外置提示词文件库：`users/{uid}/prompts/*.md`（共用）与
 * `users/{uid}/agents/{agent-id}/prompts/*.md`（agent 专属）是唯一事实来源。
 *
 * 文件不等于「已加入当前 agent」：每个 agent 在各自的顺序表里显式选择要注入哪些文件。
 * 新建文件只落盘，不自动进入任何 agent 的提示词。
 *
 * 启动时由 lib/boot 的 enterUserScope 调 hydrate；界面用 useSyncExternalStore 订阅。
 */
import {
  listUserDir,
  mkdirUserPath,
  onUserTextWritten,
  readUserText,
  removeUserPath,
  userAbsPath,
  writeUserText,
} from '../lib/storage'
import { onLocalFileWritten } from '../lib/localFiles'
import {
  AGENTS_DIR,
  agentPromptsDirOf,
  COMMON_PROMPTS_DIR,
  isSafeAgentId,
} from './agentPaths'

export const PROMPT_FILES_DIR = COMMON_PROMPTS_DIR

export type PromptFileScope = 'common' | 'agent'

export interface StoredPromptFile {
  /** 稳定 id：共用 `ext:<fileName>`，专属 `agent:<agentId>:<fileName>` */
  id: string
  /** 相对用户根目录的路径（含 .md） */
  relPath: string
  /** 文件所在目录 */
  scope: PromptFileScope
  /** 专属文件的归属 agent；共用为空 */
  agentId?: string
  /** 所在 prompts/ 下的文件名（含 .md） */
  fileName: string
  /** 列表里显示的名字：文件名去掉 .md */
  name: string
  content: string
}

let files: StoredPromptFile[] = []
const listeners = new Set<() => void>()
let hydrateEpoch = 0

function emit() {
  for (const listener of listeners) listener()
}

export function subscribePromptFiles(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 指定 agent 可见的文件：共用 + 该 agent 的专属；不传则返回全部。 */
export function getExternalPromptFiles(agentId?: string): StoredPromptFile[] {
  if (!agentId) return files
  return files.filter((file) => file.scope === 'common' || file.agentId === agentId)
}

export function promptFileIdOf(fileName: string, agentId?: string): string {
  return agentId ? `agent:${agentId}:${fileName}` : `ext:${fileName}`
}

/** 外置文件的绝对路径；页签打开本地文件时用它。字符串参数按共用 prompts/ 下的文件名解释。 */
export function promptFileAbsPath(file: { relPath: string } | string): string | null {
  const rel = typeof file === 'string' ? `${PROMPT_FILES_DIR}/${file}` : file.relPath
  return userAbsPath(rel)
}

function displayName(fileName: string): string {
  return fileName.replace(/\.md$/i, '')
}

/**
 * 把用户输入的名字变成安全的 md 文件名。
 *
 * 只留一个基名（不允许目录分隔符），去掉 Windows 不允许的字符，压掉连续空白；
 * 空名回退成「提示词」，重名由 createPromptFile 追加序号。
 */
export function safePromptFileName(raw: string): string {
  const base = raw
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  return `${base || '提示词'}.md`
}

async function scanPromptDir(
  dir: string,
  scope: PromptFileScope,
  agentId?: string,
): Promise<StoredPromptFile[]> {
  const entries = await listUserDir(dir)
  const mdFiles = entries
    .filter((entry) => !entry.dir && !entry.name.startsWith('.') && /\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => displayName(a).localeCompare(displayName(b), 'zh-Hans-CN'))

  return Promise.all(
    mdFiles.map(async (fileName) => {
      const relPath = `${dir}/${fileName}`
      const content = (await readUserText(relPath)) ?? ''
      return {
        id: promptFileIdOf(fileName, agentId),
        relPath,
        scope,
        ...(agentId ? { agentId } : {}),
        fileName,
        name: displayName(fileName),
        content,
      }
    }),
  )
}

async function scanPromptFiles(): Promise<StoredPromptFile[]> {
  const common = await scanPromptDir(PROMPT_FILES_DIR, 'common')
  const agentEntries = (await listUserDir(AGENTS_DIR)).filter((entry) => entry.dir)
  const agentFiles = await Promise.all(
    agentEntries
      .filter((entry) => isSafeAgentId(entry.name))
      .map((entry) => scanPromptDir(agentPromptsDirOf(entry.name), 'agent', entry.name)),
  )

  return [
    ...common,
    ...agentFiles
      .flat()
      .sort(
        (a, b) =>
          (a.agentId ?? '').localeCompare(b.agentId ?? '', 'zh-Hans-CN') ||
          a.name.localeCompare(b.name, 'zh-Hans-CN'),
      ),
  ]
}

/** 重新扫描 prompts/ 与 agents/<id>/prompts/。写文件、删文件、外部改名之后都走它。 */
export async function refreshPromptFiles(): Promise<void> {
  const epoch = ++hydrateEpoch
  const next = await scanPromptFiles()
  // 并发扫描只认最后一次：前一次回来得晚，不能把新结果盖回去
  if (epoch !== hydrateEpoch) return
  files = next
  emit()
}

/** 切换用户作用域时载入；uid 为 null 则清空。 */
export async function hydratePromptFiles(uid: string | null): Promise<void> {
  hydrateEpoch++
  files = []
  emit()
  if (!uid) return
  await refreshPromptFiles()
}

/**
 * 新建一份空提示词文件并返回它的元数据；同名时自动追加 `-2`、`-3`。
 * scope='agent' 时落到 `agents/{agentId}/prompts`，共用落到 `prompts/`。
 * 目录不存在会先建出来（已存在时 mkdir 失败可忽略）。
 */
export async function createPromptFile(
  rawName: string,
  opts?: { scope?: PromptFileScope; agentId?: string },
): Promise<StoredPromptFile | null> {
  const scope = opts?.scope ?? 'common'
  const agentId = scope === 'agent' ? opts?.agentId : undefined
  if (scope === 'agent' && (!agentId || !isSafeAgentId(agentId))) return null
  const dir = agentId ? agentPromptsDirOf(agentId) : PROMPT_FILES_DIR
  await mkdirUserPath(dir)
  const baseName = safePromptFileName(rawName)
  const existing = new Set(
    files
      .filter((file) => file.scope === scope && (file.agentId ?? '') === (agentId ?? ''))
      .map((file) => file.fileName.toLowerCase()),
  )
  let fileName = baseName
  let seq = 2
  while (existing.has(fileName.toLowerCase())) {
    fileName = `${baseName.replace(/\.md$/i, '')}-${seq}.md`
    seq += 1
  }

  const rel = `${dir}/${fileName}`
  if (!(await writeUserText(rel, ''))) return null
  await refreshPromptFiles()
  return files.find((file) => file.relPath === rel) ?? null
}

/** 删除一份外置提示词文件（不存在时也当成功，刷新后列表自然没有它）。 */
export async function deletePromptFile(file: { relPath: string } | string): Promise<boolean> {
  const target =
    typeof file === 'string' ? { relPath: `${PROMPT_FILES_DIR}/${file}` } : file
  const ok = await removeUserPath(target.relPath)
  await refreshPromptFiles()
  return ok
}

// 文件由普通本地文件页签编辑保存：写成功即重新读回，保证下一轮提示词用的是新内容
onUserTextWritten((rel) => {
  if (!/\.md$/i.test(rel)) return
  if (rel.startsWith(`${PROMPT_FILES_DIR}/`)) {
    void refreshPromptFiles()
    return
  }
  if (/^agents\/[^/]+\/prompts\/[^/]+\.md$/i.test(rel)) void refreshPromptFiles()
})

// 同一个文件也可能被普通本地文件页签保存（local 通道写绝对路径），同样要重新读回
onLocalFileWritten((path) => {
  const roots = [userAbsPath(PROMPT_FILES_DIR), userAbsPath(AGENTS_DIR)].filter(
    (value): value is string => Boolean(value),
  )
  if (!roots.length || !/\.md$/i.test(path)) return
  const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '')
  if (!roots.some((root) => norm(path).startsWith(`${norm(root)}/`))) return
  void refreshPromptFiles()
})
