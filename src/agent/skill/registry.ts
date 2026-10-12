import { BUILTIN_SKILLS } from './builtins'
import type { SkillDef, SkillSettings } from './types'

/** 内存中缓存的技能列表（默认是内置技能，被物理扫描或用户修改时更新） */
let memorySkills: SkillDef[] = [...BUILTIN_SKILLS]
const listeners = new Set<() => void>()

export function getLoadedSkills(): SkillDef[] {
  return memorySkills
}

export function setLoadedSkills(skills: SkillDef[]): void {
  memorySkills = skills
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (err) {
      console.warn('[skills] listener error:', err)
    }
  }
}

export function subscribeSkills(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 汇总当前生效的全部技能定义：
 * 优先读取独立技能目录缓存集合，并与设置兼容合并。
 */
export function getEffectiveSkills(settings?: SkillSettings | null): SkillDef[] {
  const baseList = memorySkills.length > 0 ? memorySkills : BUILTIN_SKILLS

  const customList = settings?.skills ?? []
  if (!customList.length) {
    return baseList.map((s) => ({ ...s }))
  }

  const customMap = new Map<string, SkillDef>()
  for (const s of customList) {
    customMap.set(s.id, s)
  }

  // 1. 以基底（内置/磁盘技能）为主，合并设置覆盖
  const result: SkillDef[] = baseList.map((base) => {
    const userOverride = customMap.get(base.id)
    if (userOverride) {
      customMap.delete(base.id)
      return {
        ...base,
        ...userOverride,
      }
    }
    return { ...base }
  })

  // 2. 其余纯自定义技能追加
  for (const s of customMap.values()) {
    result.push({
      ...s,
      builtin: false,
    })
  }

  return result
}

/**
 * 获取当前所有已启用的技能
 */
export function getActiveSkills(settings?: SkillSettings | null): SkillDef[] {
  if (settings && settings.enabled === false) return []
  return getEffectiveSkills(settings).filter((s) => s.enabled)
}

/**
 * 将启用的技能格式化为系统提示词块
 */
export function formatActiveSkillsPrompt(skills: SkillDef[]): string {
  const active = skills.filter((s) => s.enabled)
  if (!active.length) return ''

  const sections = active.map((s) => {
    return `### [技能] ${s.name}\n${s.instructions.trim()}`
  })

  return [
    '### 专业技能模块（当前已激活的能力指引）：',
    '以下专业技能已由学习者启用，请在对应任务与讲解中深度结合并践行其规范：',
    '',
    sections.join('\n\n'),
  ].join('\n')
}
