/**
 * Agent 技能 (Skill) 设施核心类型定义。
 *
 * 技能是一组经过精心调优的专业指令、思考规范与思维框架扩展包：
 * - 内置技能 (Builtin)：随应用提供，如苏格拉底式反问导学、第一性原理逆向拆解、费曼重构、代码架构重构等；
 * - 自定义技能 (Custom)：用户在超级导师设置中自由编写，可包含特定业务逻辑、领域知识或解题习惯；
 * - 激活状态：启用的技能将按需或整段汇入 Agent 系统提示词与沙箱环境。
 */

export type SkillCategory = 'learning' | 'coding' | 'research' | 'productivity' | 'general'

export interface SkillScriptDef {
  /** 脚本文件名，如 'lint.js' 或 'evaluate.py' */
  name: string
  /** 脚本功能简述 */
  description?: string
}

export interface SkillDef {
  /** 唯一标识，如 'socratic-tutor' */
  id: string
  /** 展示名称，如 '苏格拉底式启发导学' */
  name: string
  /** 简明描述 */
  description: string
  /** 适用场景与时机（用于常驻发现层索引，若未填则使用 description） */
  whenToUse?: string
  /** 技能提示词指令（核心规范与工作流程） */
  instructions: string
  /** 是否启用 */
  enabled: boolean
  /** 是否为内置技能 */
  builtin?: boolean
  /** 所属类别 */
  category?: SkillCategory
  /** 标签列表，如 ['导学', '思维模型'] */
  tags?: string[]
  /** 图标或 emoji 标识 */
  icon?: string
  /** 该技能专属的可执行脚本列表（存放于 skills/{id}/scripts/） */
  scripts?: SkillScriptDef[]
  /** 该技能专属的参考资料清单（存放于 skills/{id}/references/） */
  references?: string[]
  /** 更新时间戳 */
  updatedAt?: number
}

export interface SkillSettings {
  /** 技能系统总开关 */
  enabled: boolean
  /**
   * 技能列表：
   * 包含用户修改过状态的内置技能以及用户新建的自定义技能。
   */
  skills: SkillDef[]
}

export const DEFAULT_SKILL_SETTINGS: SkillSettings = {
  enabled: true,
  skills: [],
}
