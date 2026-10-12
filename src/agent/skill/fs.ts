import { listDir, readText, revealPath, storageInfo, writeText, removePath } from '../../lib/storage'
import { isElectron } from '../../lib/native'
import { BUILTIN_SKILLS } from './builtins'
import { getLoadedSkills, setLoadedSkills, subscribeSkills } from './registry'
import type { SkillCategory, SkillDef } from './types'

export { getLoadedSkills, subscribeSkills }

/** 相对数据根的技能根目录名 */
export const SKILLS_REL_DIR = 'skills'

/**
 * 解析单个技能目录下的 SKILL.md 文件。
 * 遵循标准 YAML Frontmatter + Markdown 指令正文规范：
 * ---
 * name: 技能名称
 * description: 技能描述
 * category: learning
 * tags:
 *   - 标签1
 *   - 标签2
 * icon: Sparkles
 * enabled: true
 * ---
 * ## 技能规范与指令内容...
 */
export function parseSkillMd(content: string, dirName: string): SkillDef {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    return {
      id: dirName,
      name: dirName,
      description: '',
      instructions: content.trim(),
      enabled: true,
      category: 'general',
      tags: [],
      icon: 'Sparkles',
    }
  }

  const rawYaml = match[1]
  const instructions = match[2]?.trim() || ''

  const lines = rawYaml.split(/\r?\n/)
  const meta: Record<string, unknown> = {}
  let currentKey = ''
  let currentList: string[] | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // 缩进列表项，例如 "  - 标签"
    if (trimmed.startsWith('- ') && currentKey) {
      if (!currentList) {
        currentList = []
        meta[currentKey] = currentList
      }
      currentList.push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, ''))
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const val = line.slice(colonIdx + 1).trim()
      currentKey = key
      currentList = null

      if (!val) {
        continue
      }

      if (val === 'true') {
        meta[key] = true
      } else if (val === 'false') {
        meta[key] = false
      } else if (/^\d+$/.test(val)) {
        meta[key] = Number(val)
      } else if (val.startsWith('[') && val.endsWith(']')) {
        meta[key] = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
      } else {
        meta[key] = val.replace(/^['"]|['"]$/g, '')
      }
    }
  }

  return {
    id: dirName,
    name: typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : dirName,
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
    instructions,
    enabled: typeof meta.enabled === 'boolean' ? meta.enabled : true,
    category: (meta.category as SkillCategory) || 'general',
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    icon: typeof meta.icon === 'string' ? meta.icon : 'Sparkles',
    builtin: typeof meta.builtin === 'boolean' ? meta.builtin : false,
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : undefined,
  }
}

/**
 * 将 SkillDef 序列化为标准的 SKILL.md 格式
 */
export function serializeSkillMd(skill: SkillDef): string {
  const lines: string[] = ['---']
  lines.push(`name: ${skill.name}`)
  if (skill.description) {
    lines.push(`description: ${skill.description}`)
  }
  if (skill.category) {
    lines.push(`category: ${skill.category}`)
  }
  if (skill.tags && skill.tags.length > 0) {
    lines.push('tags:')
    for (const tag of skill.tags) {
      lines.push(`  - ${tag}`)
    }
  }
  if (skill.icon) {
    lines.push(`icon: ${skill.icon}`)
  }
  lines.push(`enabled: ${skill.enabled}`)
  if (skill.builtin) {
    lines.push('builtin: true')
  }
  if (skill.updatedAt) {
    lines.push(`updatedAt: ${skill.updatedAt}`)
  }
  lines.push('---')
  lines.push('')
  lines.push(skill.instructions.trim())
  lines.push('')
  return lines.join('\n')
}

/**
 * 校验并规范化技能目录 ID（必须是合法的目录名）
 */
export function sanitizeSkillId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

let isInitialized = false

/**
 * 初始化技能目录：
 * 若数据根目录下的 skills/ 缺少内置技能，自动将内置技能释放为独立的物理子目录与 SKILL.md。
 */
export async function ensureSkillsDirAndBuiltins(): Promise<void> {
  if (!isElectron()) return

  for (const builtin of BUILTIN_SKILLS) {
    try {
      const filePath = `${SKILLS_REL_DIR}/${builtin.id}/SKILL.md`
      const existing = await readText(filePath)
      if (existing === null) {
        // 尚未在磁盘上创建该内置技能目录与 SKILL.md，写入种子
        await writeText(filePath, serializeSkillMd(builtin))
      }
    } catch (err) {
      console.warn('[skills] 释放内置技能失败:', builtin.id, err)
    }
  }
}

/**
 * 从磁盘物理扫描所有技能子目录：
 * 遍历 {root}/skills/*\/SKILL.md
 */
export async function loadSkillsFromDisk(): Promise<SkillDef[]> {
  if (!isElectron()) {
    return getLoadedSkills()
  }

  try {
    // 首次进入确保内置技能落盘
    if (!isInitialized) {
      await ensureSkillsDirAndBuiltins()
      isInitialized = true
    }

    const entries = await listDir(SKILLS_REL_DIR)
    const dirs = entries.filter((e) => e.dir)

    // 如果还没有子目录，再次尝试播种
    if (!dirs.length) {
      await ensureSkillsDirAndBuiltins()
      const retryEntries = await listDir(SKILLS_REL_DIR)
      dirs.push(...retryEntries.filter((e) => e.dir))
    }

    const loaded: SkillDef[] = []
    const builtinIds = new Set(BUILTIN_SKILLS.map((b) => b.id))

    for (const d of dirs) {
      const skillId = d.name
      const mdPath = `${SKILLS_REL_DIR}/${skillId}/SKILL.md`
      const content = await readText(mdPath)
      if (content !== null) {
        const parsed = parseSkillMd(content, skillId)
        if (builtinIds.has(skillId)) {
          parsed.builtin = true
        }
        loaded.push(parsed)
      }
    }

    if (loaded.length > 0) {
      setLoadedSkills(loaded)
      return loaded
    }
  } catch (err) {
    console.warn('[skills] 扫描磁盘技能目录异常:', err)
  }

  return getLoadedSkills()
}

/**
 * 保存或新建技能到磁盘独立的子目录:
 * {root}/skills/<skill-id>/SKILL.md
 */
export async function saveSkillToDisk(skill: SkillDef): Promise<boolean> {
  const safeId = sanitizeSkillId(skill.id)
  if (!safeId) return false

  const updated: SkillDef = {
    ...skill,
    id: safeId,
    updatedAt: Date.now(),
  }

  const content = serializeSkillMd(updated)
  const ok = await writeText(`${SKILLS_REL_DIR}/${safeId}/SKILL.md`, content)

  if (ok) {
    const current = [...getLoadedSkills()]
    const idx = current.findIndex((s) => s.id === safeId)
    if (idx >= 0) {
      current[idx] = updated
    } else {
      current.push(updated)
    }
    setLoadedSkills(current)
  }

  return ok
}

/**
 * 切换技能启用开关并同步更新对应目录下的 SKILL.md
 */
export async function toggleSkillOnDisk(skillId: string, enabled: boolean): Promise<boolean> {
  const target = getLoadedSkills().find((s) => s.id === skillId)
  if (!target) return false

  const nextSkill: SkillDef = {
    ...target,
    enabled,
    updatedAt: Date.now(),
  }

  return saveSkillToDisk(nextSkill)
}

/**
 * 删除磁盘上的技能目录：
 * 递归删除 {root}/skills/<skill-id>
 */
export async function deleteSkillFromDisk(skillId: string): Promise<boolean> {
  const safeId = sanitizeSkillId(skillId)
  if (!safeId) return false

  const ok = await removePath(`${SKILLS_REL_DIR}/${safeId}`)
  if (ok) {
    const next = getLoadedSkills().filter((s) => s.id !== safeId)
    setLoadedSkills(next)
  }
  return ok
}

/**
 * 在系统文件管理器中定位技能目录
 * @param skillId 可选，若指定则定位具体技能子目录，否则定位技能根目录
 */
export async function revealSkillsDir(skillId?: string): Promise<boolean> {
  if (skillId) {
    return revealPath(`${SKILLS_REL_DIR}/${sanitizeSkillId(skillId)}`)
  }
  return revealPath(SKILLS_REL_DIR)
}

/**
 * 获取技能根目录的绝对物理路径（展示在界面上）
 */
export async function getSkillsAbsPath(): Promise<string> {
  try {
    const info = await storageInfo()
    if (info && info.root) {
      const cleanRoot = info.root.replace(/[\\/]+$/, '')
      return `${cleanRoot}/${SKILLS_REL_DIR}`.replace(/\//g, '\\')
    }
  } catch {
    // 忽略异常
  }
  return `${SKILLS_REL_DIR}\\`
}
