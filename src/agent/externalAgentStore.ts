/**
 * 外部 agent 库：`users/{uid}/agents/{agent-id}/` 是唯一事实来源。
 *
 * 目录名就是 agent id；`agent.json` 存独立配置（名称 / 简介 / 头像），
 * `prompts/` 存该 agent 的专属提示词，`assets/` 存头像等静态资源。
 * 本模块只负责目录与配置的建、读、改；运行时接入（名册/会话/提示词装配）另行处理。
 */
import { listUserDir, mkdirUserPath, onUserTextWritten, readUserText, userAbsPath, writeUserText } from '../lib/storage'
import { onLocalFileWritten } from '../lib/localFiles'
import {
  AGENTS_DIR,
  agentAssetsDirOf,
  agentConfigPathOf,
  agentDirOf,
  agentPromptsDirOf,
  isSafeAgentId,
  safeAgentDirName,
} from './agentPaths'

export interface ExternalAgentConfig {
  id: string
  name: string
  /** 一句话简介 */
  bio?: string
  /** 头像：assets/ 下的相对路径，如 `assets/avatar.png` */
  avatar?: string
  createdAt?: number
  updatedAt?: number
}

const RESERVED_IDS = new Set(['free', 'tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'])

let agents: ExternalAgentConfig[] = []
const listeners = new Set<() => void>()
let hydrateEpoch = 0

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeExternalAgents(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getExternalAgents(): ExternalAgentConfig[] {
  return agents
}

export function externalAgentAvatarPath(id: string, avatar: string | undefined): string | null {
  if (!avatar?.trim() || !isSafeAgentId(id)) return null
  const rel = avatar.trim().replace(/^\/+/, '')
  if (rel.includes('..')) return null
  return userAbsPath(rel.startsWith(`${AGENTS_DIR}/`) ? rel : `${agentDirOf(id)}/${rel}`)
}

async function readConfig(id: string): Promise<ExternalAgentConfig | null> {
  const raw = await readUserText(agentConfigPathOf(id))
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ExternalAgentConfig>
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim().slice(0, 80) : id
    return {
      id,
      name,
      ...(typeof parsed.bio === 'string' && parsed.bio.trim() ? { bio: parsed.bio.trim().slice(0, 200) } : {}),
      ...(typeof parsed.avatar === 'string' && parsed.avatar.trim() ? { avatar: parsed.avatar.trim() } : {}),
      ...(typeof parsed.createdAt === 'number' ? { createdAt: parsed.createdAt } : {}),
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
    }
  } catch {
    return null
  }
}

async function scanExternalAgents(): Promise<ExternalAgentConfig[]> {
  const entries = (await listUserDir(AGENTS_DIR)).filter((entry) => entry.dir && isSafeAgentId(entry.name))
  const loaded = await Promise.all(entries.map((entry) => readConfig(entry.name)))
  return loaded
    .filter((agent): agent is ExternalAgentConfig => Boolean(agent))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
}

export async function refreshExternalAgents(): Promise<void> {
  const epoch = ++hydrateEpoch
  const next = await scanExternalAgents()
  if (epoch !== hydrateEpoch) return
  agents = next
  emit()
}

export async function hydrateExternalAgents(uid: string | null): Promise<void> {
  hydrateEpoch++
  agents = []
  emit()
  if (!uid) return
  await refreshExternalAgents()
}

export async function createExternalAgent(rawName: string): Promise<ExternalAgentConfig | null> {
  await mkdirUserPath(AGENTS_DIR)
  const base = safeAgentDirName(rawName)
  const existing = new Set((await listUserDir(AGENTS_DIR)).filter((e) => e.dir).map((e) => e.name.toLowerCase()))
  let id = base
  let seq = 2
  while (existing.has(id.toLowerCase()) || RESERVED_IDS.has(id)) {
    id = `${base}-${seq}`
    seq += 1
  }
  if (!isSafeAgentId(id)) return null

  const now = Date.now()
  const config: ExternalAgentConfig = { id, name: rawName.trim().slice(0, 80) || id, createdAt: now, updatedAt: now }
  const body = { name: config.name, createdAt: now, updatedAt: now }
  // 三个目录先建好：即便用户还没放头像/提示词，目录契约也稳定
  await mkdirUserPath(agentPromptsDirOf(id))
  await mkdirUserPath(agentAssetsDirOf(id))
  if (!(await writeUserText(agentConfigPathOf(id), `${JSON.stringify(body, null, 2)}\n`))) return null
  await refreshExternalAgents()
  return agents.find((agent) => agent.id === id) ?? null
}

export async function updateExternalAgent(
  id: string,
  patch: Partial<Pick<ExternalAgentConfig, 'name' | 'bio' | 'avatar'>>,
): Promise<boolean> {
  if (!isSafeAgentId(id)) return false
  const current = (await readConfig(id)) ?? { id, name: id }
  const next: ExternalAgentConfig = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 80) || id } : {}),
    ...(patch.bio !== undefined ? (patch.bio.trim() ? { bio: patch.bio.trim().slice(0, 200) } : { bio: undefined }) : {}),
    ...(patch.avatar !== undefined ? (patch.avatar.trim() ? { avatar: patch.avatar.trim() } : { avatar: undefined }) : {}),
    updatedAt: Date.now(),
  }
  // 保留用户在 agent.json 里手写的其它字段，只覆盖设置页负责的这几项
  let extra: Record<string, unknown> = {}
  try {
    const raw = await readUserText(agentConfigPathOf(id))
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extra = parsed as Record<string, unknown>
  } catch {
    // 坏 JSON 就把已知字段整份重写，至少让配置回到可用状态
  }
  const body = {
    ...extra,
    name: next.name,
    ...(next.bio ? { bio: next.bio } : { bio: undefined }),
    ...(next.avatar ? { avatar: next.avatar } : { avatar: undefined }),
    ...(next.createdAt ? { createdAt: next.createdAt } : {}),
    updatedAt: next.updatedAt,
  }
  if (!(await writeUserText(agentConfigPathOf(id), `${JSON.stringify(body, null, 2)}\n`))) return false
  await refreshExternalAgents()
  return true
}

// 用户直接编辑 agent.json / 在 assets 放头像：写后重扫，设置页看到最新配置
onUserTextWritten((rel) => {
  if (/^agents\/[^/]+\/agent\.json$/i.test(rel)) void refreshExternalAgents()
})

onLocalFileWritten((path) => {
  const root = userAbsPath(AGENTS_DIR)
  if (!root) return
  const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase()
  const p = norm(path)
  if (p.startsWith(`${norm(root)}/`) && /\/agent\.json$/i.test(p)) void refreshExternalAgents()
})
