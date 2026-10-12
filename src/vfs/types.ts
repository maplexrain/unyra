/**
 * 声明式文件实体与响应式 VFS 类型系统。
 *
 * 核心设计哲学：
 * 1. 纯文件存储为唯一事实来源（Single Source of Truth）；
 * 2. 声明式实体路由表（Entity Registry）消除路径匹配的 if-else 补丁；
 * 3. 内存缓存 + 防回环队列（Write-Through + Anti-Echo）保障 0ms 乐观响应与零抖动；
 * 4. 自动反向派生系统提示词（Data Manifest），彻底消除实现与文档的对账成本。
 */

export type FileDataFormat = 'json' | 'text' | 'markdown' | 'yaml' | 'html' | 'binary'

export interface FileEntityParamDef {
  name: string
  description: string
  example?: string
}

export interface FileEntityDef<T = unknown> {
  /** 实体唯一标识，如 'node-doc', 'node-meta', 'user-profile' */
  id: string
  /** 路径模式，支持路由参数，例如 'docs/:goal/:title/:title.md' 或 'docs/:goal/meta.json' */
  pattern: string
  /** 文件分类：'document' (纯文档文本) | 'data' (结构化数据文件) */
  category: 'document' | 'data'
  /** 数据格式 */
  format: FileDataFormat
  /** 中文名称，用于展示与提示词生成 */
  title: string
  /** 详细用途说明 */
  description: string
  /** 默认值生成器（文件不存在或空值时的安全回退） */
  defaultValue: () => T
  /** 如果是数据文件且为列表，描述列表元素的形状与字段 */
  itemShape?: string
  /** TypeScript/JSON Schema 结构说明（供提示词生成消费） */
  typeDefinition?: string
  /** 参数说明 */
  params?: FileEntityParamDef[]
}

/** 实体匹配结果 */
export interface EntityMatch<T = unknown> {
  entity: FileEntityDef<T>
  params: Record<string, string>
  normalizedPath: string
}

/** 事务与变更凭证 */
export interface WriteContext {
  txId: string
  source: 'ui' | 'agent' | 'watcher' | 'vfs'
  path: string
  hash: string
  timestamp: number
}

/** 文件变更通知事件 */
export interface FileChangeEvent<T = unknown> {
  path: string
  relativePath: string
  action: 'write' | 'edit' | 'delete' | 'create'
  content?: string
  data?: T
  entity?: FileEntityDef<T>
  params?: Record<string, string>
  source: 'ui' | 'agent' | 'watcher' | 'vfs'
  txId?: string
}

/** 订阅回调 */
export type FileChangeCallback<T = unknown> = (event: FileChangeEvent<T>) => void
