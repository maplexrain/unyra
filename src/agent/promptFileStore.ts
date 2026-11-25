/**
 * 外置提示词文件库：`users/{uid}/prompts/*.md` 是唯一事实来源。
 *
 * 这些文件不属于某个 agent、也不分 role/work 层——它们是一份共用的小库，
 * 每个 agent 只是在各自的顺序表里决定「这一层要按什么顺序注入哪些文件」。
 * 新建文件就是往 prompts/ 里落一个 md；文件内容由普通的本地文件页签编辑，
 * 保存后经由 storage 的写入通知回到这里，下一轮请求立即读到新内容。
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

export const PROMPT_FILES_DIR = 'prompts'

export interface StoredPromptFile {
  /** 稳定 id：`ext:<fileName>`，顺序表与启停表里存的就是它 */
  id: string
  /** prompts/ 下的文件名（含 .md） */
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

export function getExternalPromptFiles(): StoredPromptFile[] {
  return files
}

export function promptFileIdOf(fileName: string): string {
  return `ext:${fileName}`
}

/** 外置文件的绝对路径；页签打开本地文件时用它 */
export function promptFileAbsPath(fileName: string): string | null {
  return userAbsPath(`${PROMPT_FILES_DIR}/${fileName}`)
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

async function scanPromptFiles(): Promise<StoredPromptFile[]> {
  const entries = await listUserDir(PROMPT_FILES_DIR)
  const mdFiles = entries
    .filter((entry) => !entry.dir && !entry.name.startsWith('.') && /\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => displayName(a).localeCompare(displayName(b), 'zh-Hans-CN'))

  const loaded = await Promise.all(
    mdFiles.map(async (fileName) => {
      const content = (await readUserText(`${PROMPT_FILES_DIR}/${fileName}`)) ?? ''
      return {
        id: promptFileIdOf(fileName),
        fileName,
        name: displayName(fileName),
        content,
      }
    }),
  )
  return loaded
}

/** 重新扫描 prompts/。写文件、删文件、外部改名之后都走它。 */
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
 * 目录不存在会先建出来（已存在时 mkdir 失败可忽略）。
 */
export async function createPromptFile(rawName: string): Promise<StoredPromptFile | null> {
  await mkdirUserPath(PROMPT_FILES_DIR)
  const baseName = safePromptFileName(rawName)
  const existing = new Set(files.map((file) => file.fileName.toLowerCase()))
  let fileName = baseName
  let seq = 2
  while (existing.has(fileName.toLowerCase())) {
    fileName = `${baseName.replace(/\.md$/i, '')}-${seq}.md`
    seq += 1
  }

  const rel = `${PROMPT_FILES_DIR}/${fileName}`
  if (!(await writeUserText(rel, ''))) return null
  await refreshPromptFiles()
  return files.find((file) => file.fileName === fileName) ?? null
}

/** 删除一份外置提示词文件（不存在时也当成功，刷新后列表自然没有它）。 */
export async function deletePromptFile(fileName: string): Promise<boolean> {
  const ok = await removeUserPath(`${PROMPT_FILES_DIR}/${fileName}`)
  await refreshPromptFiles()
  return ok
}

// 文件由普通本地文件页签编辑保存：写成功即重新读回，保证下一轮提示词用的是新内容
onUserTextWritten((rel) => {
  if (!rel.startsWith(`${PROMPT_FILES_DIR}/`)) return
  if (!/\.md$/i.test(rel)) return
  void refreshPromptFiles()
})

// 同一个文件也可能被普通本地文件页签保存（local 通道写绝对路径），同样要重新读回
onLocalFileWritten((path) => {
  const dir = userAbsPath(PROMPT_FILES_DIR)
  if (!dir) return
  const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase()
  if (!norm(path).startsWith(`${norm(dir).replace(/\/$/, '')}/`)) return
  if (!/\.md$/i.test(path)) return
  void refreshPromptFiles()
})
