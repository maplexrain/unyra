/**
 * 声明式文件实体注册表（File Entity Registry）。
 *
 * 集中声明所有业务数据文件的物理路径模式、文件分类、序列化格式与类型结构。
 * 杜绝在各业务模块打补丁式的路径匹配代码。
 */
import type { FileEntityDef, EntityMatch } from './types'

export const FILE_ENTITIES: FileEntityDef[] = [
  // 1. 个人笔记文档（纯 Markdown 文档，放在前面防止被 generic doc 拦截）
  {
    id: 'node-note',
    pattern: 'docs/:path*/:title.notes/:name.md',
    category: 'document',
    format: 'markdown',
    title: '学习者个人笔记',
    description: '针对特定知识点记录的专属笔记（如错题本、摘录、反思等）。',
    defaultValue: () => '',
    params: [
      { name: 'path*', description: '所属节点路径', example: '高等数学/极限' },
      { name: 'title', description: '知识点标题', example: '极限' },
      { name: 'name', description: '笔记名称', example: '错题本' },
    ],
  },

  // 2. 节点元数据与状态文件（结构化 JSON 数据）
  {
    id: 'node-meta',
    pattern: 'docs/:path*/:title.meta.json',
    category: 'data',
    format: 'json',
    title: '知识点元数据与学习状态',
    description: '包含知识点 ID、层级依赖、掌握度评估、错题记录以及复习计划。',
    typeDefinition: `{
  version: number,
  id: string,
  title: string,
  description: string,
  status: "learning" | "mastered",
  learning?: {
    mastery: number, // 0~100 掌握度得分
    selfRating: "mastered" | "familiar" | "unknown" | "unsure",
    mistakes: Array<{ pattern: string, count: number, cause?: string }>
  },
  dependencies: Array<{ to: string, createdAt: number }>
}`,
    defaultValue: () => ({
      version: 1,
      id: '',
      title: '',
      description: '',
      status: 'learning',
      dependencies: [],
    }),
  },

  // 3. 独立结构化大纲（结构化 JSON 数据）
  {
    id: 'node-outline',
    pattern: 'docs/:path*/outline.json',
    category: 'data',
    format: 'json',
    title: '目标或知识点结构化大纲',
    description: '包含本层知识点的导语规划以及直接子目标的清单列表。',
    typeDefinition: `{
  intro: string, // 大纲导语与目标规划
  children: Array<{
    key: string,
    title: string,
    summary: string
  }>
}`,
    itemShape: '{ key: string, title: string, summary: string }',
    defaultValue: () => ({ intro: '', children: [] }),
  },

  // 4. 教学文档正文（纯 Markdown 文档）
  {
    id: 'node-doc',
    pattern: 'docs/:path*/:title.md',
    category: 'document',
    format: 'markdown',
    title: '知识点教学文档正文',
    description: '知识点的主体教学与讲解文档，包含 Markdown 格式与公式排版。',
    defaultValue: () => '',
    params: [
      { name: 'path*', description: '所属目标或上级节点路径（可多层）', example: '高等数学/极限' },
      { name: 'title', description: '知识点标题', example: '夹逼定理' },
    ],
  },

  // 5. 跨轮会话长期记忆（结构化 JSON 数据）
  {
    id: 'mind-memory',
    pattern: 'mind/:key.json',
    category: 'data',
    format: 'json',
    title: '长期跨轮记忆条目',
    description: '保存用户的长期习惯、约定、薄弱概念等结论性知识。',
    typeDefinition: `{
  key: string,
  text: string,
  updatedAt: number,
  category?: string
}`,
    defaultValue: () => ({ key: '', text: '', updatedAt: Date.now() }),
  },

  // 6. 学习者用户画像（结构化 JSON 数据）
  {
    id: 'user-profile',
    pattern: 'user/profile.json',
    category: 'data',
    format: 'json',
    title: '学习者画像与偏好档案',
    description: '记录学习者的昵称、教育背景、专业、当前技能以及学习偏好。',
    typeDefinition: `{
  nickname: string,
  education?: string,
  major?: string,
  experience?: string,
  masteredSkills: string[],
  preferences?: Record<string, unknown>
}`,
    itemShape: 'masteredSkills 元素为 string',
    defaultValue: () => ({ nickname: '', masteredSkills: [] }),
  },

  // 7. 目标临时变量中继（结构化 JSON 数据）
  {
    id: 'goal-tmp',
    pattern: 'docs/:goal/tmp.json',
    category: 'data',
    format: 'json',
    title: '中间变量缓存存储',
    description: '执行过程中产生的超长数据或临时结果暂存，按 key 索引。',
    typeDefinition: `{
  version: number,
  entries: Record<string, {
    key: string,
    value: unknown,
    expiresAt?: number
  }>
}`,
    itemShape: 'entries 字典中每项为 { key: string, value: any, expiresAt?: number }',
    defaultValue: () => ({ version: 1, entries: {} }),
  },

  // 8. 试卷与考核记录（结构化 JSON 数据）
  {
    id: 'exam-item',
    pattern: 'exams/:examId.json',
    category: 'data',
    format: 'json',
    title: '独立试卷定义与考查题库',
    description: '包含特定考卷的题目列表、试卷属性与分值。',
    typeDefinition: `{
  id: string,
  title: string,
  kind: "quiz" | "exam" | "recall",
  level: number,
  minutes: number,
  questions: Array<{
    id: string,
    type: "single" | "multiple" | "truefalse" | "fill" | "short",
    stem: string,
    answer: string[] | boolean[] | string,
    options?: string[],
    analysis?: string
  }>
}`,
    itemShape: 'questions 列表元素为试题对象 { id, type, stem, answer, options?, analysis? }',
    defaultValue: () => ({ id: '', title: '', kind: 'quiz', level: 1, minutes: 15, questions: [] }),
  },
  // 9. 超级文档（可交互 HTML 页面）
  {
    id: 'superdoc-item',
    pattern: 'docs/:path*/superdocs/:name.html',
    category: 'document',
    format: 'html',
    title: '节点超级可交互 HTML 文档',
    description: '绑定知识点的可交互独立页面（含定制样式、按钮与脚本）。用 ui.superdoc 在界面打开。',
    defaultValue: () => '<div></div>',
  },
  // 10. 目标静态素材与多媒体资源
  {
    id: 'static-res',
    pattern: 'docs/:goal/static/:filename',
    category: 'document',
    format: 'binary',
    title: '目标静态媒体与素材库',
    description: '当前学习目标下的图片、音频、PDF 等文件，正文以标准 Markdown 语法直接引用。',
    defaultValue: () => '',
  },
  // 11. 目标级持久化函数源码
  {
    id: 'method-code',
    pattern: 'docs/:goal/methods/:name.js',
    category: 'data',
    format: 'text',
    title: '目标级持久化函数源码',
    description: '跨对话复用的 JS 函数源码，第一个参数为 api，可由 method.call 或超级文档调用。',
    defaultValue: () => '((api, ...args) => {})',
  },
  // 12. 工作流定义与规程模版
  {
    id: 'workflow-def',
    pattern: 'workflows/:name.json',
    category: 'data',
    format: 'json',
    title: '工作流规程配置与任务指令',
    description: '三级任务模板定义，触发时通过 wf.invoke(name, params) 入队启动。',
    typeDefinition: `{
  id: string,
  name: string,
  instruction: string,
  description?: string,
  prompt?: string,
  tier?: "builtin" | "global" | "goal"
}`,
    defaultValue: () => ({ id: '', name: '', instruction: '' }),
  },
  // 13. 有效阅读事实与进展账本
  {
    id: 'reading-stats',
    pattern: 'docs/:goal/stats/reading.json',
    category: 'data',
    format: 'json',
    title: '有效阅读事实与进展账本',
    description: '记录当前目标下各知识点与小节的有效阅读时长、视口到达比例（reach ≥ 0.6）与阅读会话明细。',
    defaultValue: () => ({ sessions: [], sections: {} }),
  },
  // 14. 间隔复习计划与记录
  {
    id: 'review-plan',
    pattern: 'docs/:goal/stats/review.json',
    category: 'data',
    format: 'json',
    title: '艾宾浩斯间隔复习计划与账本',
    description: '记录各知识点的到期复习阶段（+1/+3/+7/+14/+30）、薄弱点记录与完成历史。',
    defaultValue: () => ({ plans: {}, history: [] }),
  },
  // 15. 打卡资格与历史记录
  {
    id: 'checkin-records',
    pattern: 'docs/:goal/stats/checkin.json',
    category: 'data',
    format: 'json',
    title: '学习打卡资格与历次结算记录',
    description: '记录每日有效阅读门槛达成情况、已出题源与连续打卡天数。',
    defaultValue: () => ({ date: '', passed: false, streak: 0, attempts: [] }),
  },
  // 16. 正文划词注解清单
  {
    id: 'node-annotations',
    pattern: 'docs/:path*/annotations.json',
    category: 'data',
    format: 'json',
    title: '知识点正文划词注解清单',
    description: '记录在知识点文档正文上划词的术语解释（词条、出现序号、Markdown 说明）。',
    typeDefinition: `Array<{
  term: string,
  occurrence?: number,
  body: string
}>`,
    itemShape: '{ term: string, occurrence?: number, body: string }',
    defaultValue: () => [],
  },
]

/**
 * 将 pattern 编译为正则表达式与参数名称列表
 */
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const clean = normalizeRelativePath(pattern)
  const escaped = clean
    .split('/')
    .map((segment) => {
      let segRegex = ''
      let lastIndex = 0
      const paramRegex = /:([a-zA-Z0-9_]+)(\*)?/g
      let m: RegExpExecArray | null
      while ((m = paramRegex.exec(segment)) !== null) {
        const literal = segment.slice(lastIndex, m.index)
        segRegex += literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const paramName = m[1]
        const isWildcard = m[2] === '*'
        paramNames.push(paramName)
        segRegex += isWildcard ? '(.+)' : '([^/]+)'
        lastIndex = paramRegex.lastIndex
      }
      const tail = segment.slice(lastIndex)
      segRegex += tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return segRegex
    })
    .join('/')

  return {
    regex: new RegExp(`^${escaped}$`),
    paramNames,
  }
}

/**
 * 缓存已编译的正则表达式
 */
const compiledCache = new Map<string, { regex: RegExp; paramNames: string[] }>()

function getCompiled(pattern: string) {
  let cached = compiledCache.get(pattern)
  if (!cached) {
    cached = compilePattern(pattern)
    compiledCache.set(pattern, cached)
  }
  return cached
}

/**
 * 将任意路径规范化为无前导与尾随斜杠的正斜杠相对路径
 */
export function normalizeRelativePath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .trim()
}

/**
 * 尝试匹配路径到实体定义
 */
export function matchEntity<T = unknown>(rawPath: string): EntityMatch<T> | null {
  const norm = normalizeRelativePath(rawPath)
  for (const entity of FILE_ENTITIES) {
    const { regex, paramNames } = getCompiled(entity.pattern)
    const match = norm.match(regex)
    if (match) {
      const params: Record<string, string> = {}
      for (let i = 0; i < paramNames.length; i++) {
        params[paramNames[i]] = match[i + 1] ?? ''
      }
      return {
        entity: entity as unknown as FileEntityDef<T>,
        params,
        normalizedPath: norm,
      }
    }
  }
  return null
}

/**
 * 根据实体 ID 与参数反向生成路径
 */
export function resolveEntityPath(entityId: string, params: Record<string, string>): string {
  const entity = FILE_ENTITIES.find((e) => e.id === entityId)
  if (!entity) throw new Error(`未知的实体 ID: ${entityId}`)

  let resolved = entity.pattern
  for (const [k, v] of Object.entries(params)) {
    resolved = resolved.replace(`:${k}*`, v).replace(`:${k}`, v)
  }
  return normalizeRelativePath(resolved)
}

/**
 * 自动派生生成给 Agent 的 Data Manifest（数据资产与文件契约规范）提示词
 */
export function generateDataManifestPrompt(): string {
  const lines: string[] = [
    '## 数据资产契约与文件存储规范（Data Manifest）',
    '所有业务状态、诊断数据与学习文档均以真实文件存储。Agent 可直接使用 `files.*` 读写消费：',
    '',
  ]

  for (const item of FILE_ENTITIES) {
    lines.push(`### [${item.category === 'document' ? '文档文件' : '数据文件'}] ${item.title} (${item.id})`)
    lines.push(`- **文件路径模式**: \`${item.pattern}\``)
    lines.push(`- **格式类型**: \`${item.format.toUpperCase()}\``)
    lines.push(`- **用途说明**: ${item.description}`)

    if (item.category === 'data') {
      lines.push('- **消费方式**: 文本读取后执行 `JSON.parse((await files.read(path)).content)`')
      if (item.typeDefinition) {
        lines.push('- **反序列化数据结构**:')
        lines.push('```typescript')
        lines.push(item.typeDefinition)
        lines.push('```')
      }
      if (item.itemShape) {
        lines.push(`- **列表元素形状**: \`${item.itemShape}\``)
      }
    } else {
      lines.push('- **消费方式**: 直接作为 Markdown/纯文本读写（`files.read` / `files.write` / `files.edit`）')
    }
    lines.push('')
  }

  return lines.join('\n')
}
