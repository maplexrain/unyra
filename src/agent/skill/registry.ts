import { BUILTIN_SKILLS } from './builtins'
import type { SkillDef, SkillSettings } from './types'
import type { ConversationMessage } from '../types'

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
 * 将启用的技能格式化为轻量发现层 (Discovery Index) 系统提示词块：
 * 只保留元数据索引（ID、名称、适用时机/描述、可用脚本），极大减轻 Token 负载并保持前缀缓存稳定；
 * 模型在需要时通过沙箱 `api.skill.read(id)` 动态载入完整规范与执行指导。
 */
export function formatSkillsDiscoveryPrompt(skills: SkillDef[], skillsRoot?: string): string {
  const active = skills.filter((s) => s.enabled)
  const rootDesc = skillsRoot ? `物理根路径：\`${skillsRoot}\`` : '物理存储于数据根的 `skills/` 目录'
  const header = [
    '### 专业技能系统与可用专业技能库 (Available Skills)：',
    `- **技能路径与权限**：${rootDesc}。Agent 拥有对 skills/ 目录的**完全读写与执行权限**；可使用 \`api.files.*\` 读写任意技能文件/脚本，或通过 \`await api.skill.paths(id?)\` 查询绝对路径。`,
    '- **规范查阅与执行**：遇特定场景调用 `await api.skill.read(id)` 查阅规范（自动激活上下文）；用 `await api.skill.run(id, script, args)` 执行专属脚本。',
  ]

  if (!active.length) {
    header.push('', '当前暂无已启用的技能。如学习者有需要，可按上述规范在 `skills/` 目录下创建新技能。')
    return header.join('\n')
  }

  const lines = active.map((s) => {
    const trigger = s.whenToUse || s.description || '按需选用'
    const scriptsHint = s.scripts && s.scripts.length > 0 ? ` (专属脚本: ${s.scripts.map((sc) => sc.name).join(', ')})` : ''
    return `- [${s.id}] ${s.name}: ${trigger}${scriptsHint}`
  })

  return [
    ...header,
    '',
    '**当前已启用的技能列表**：',
    lines.join('\n'),
  ].join('\n')
}

/**
 * 兼容旧版命名：默认采用渐进式开示发现层索引格式
 */
export function formatActiveSkillsPrompt(skills: SkillDef[], skillsRoot?: string): string {
  return formatSkillsDiscoveryPrompt(skills, skillsRoot)
}

/**
 * 计算当前已激活技能的摘要指纹（用于侦测技能增删修改，以便仅在发生变化时动态注入）
 */
export function getSkillsDigest(skills: SkillDef[]): string {
  const active = skills.filter((s) => s.enabled)
  if (!active.length) return ''
  return active
    .map((s) => `${s.id}@${s.name}@${s.updatedAt || 0}@${(s.scripts ?? []).map((sc) => sc.name).sort().join(',')}`)
    .sort()
    .join(';')
}

/**
 * 这一段对话里，当前技能清单是否需要宣布或更新。
 * 判据：未失活（!m.retired）的消息中最后一条带有 skillsDigest 的消息其指纹是否与当前一致。
 * 若中途新增、删除了技能，指纹不一致，立即返回 true 触发动态更新注入；
 * 若从未注入且存在启用技能，返回 true 触发初始注入；
 * 若指纹一致，返回 false，保持上下文紧凑并最大化命中前缀缓存。
 */
export function needsSkillsAnnounce(messages: ConversationMessage[], currentDigest: string): boolean {
  if (!currentDigest) return false
  const activeMsgs = messages.filter((m) => !m.retired && m.skillsDigest !== undefined)
  if (!activeMsgs.length) return true
  const last = activeMsgs[activeMsgs.length - 1]
  return last.skillsDigest !== currentDigest
}

/**
 * 构造技能清单动态注入消息（作为中途进入历史的一条隐藏 user 消息，不破坏系统提示词前缀缓存）
 */
export function skillsAnnounceMessage(
  skills: SkillDef[],
  skillsRoot: string | undefined,
  at: number,
  uuid: string,
  digest: string,
  isUpdate = false,
): ConversationMessage {
  const text = formatSkillsDiscoveryPrompt(skills, skillsRoot)
  return {
    id: uuid,
    role: 'user',
    parts: [{ type: 'text', text }],
    ts: at,
    hidden: true,
    mark: isUpdate ? '专业技能库已更新' : '可用专业技能库',
    skillsDigest: digest,
  }
}


