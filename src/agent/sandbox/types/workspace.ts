/**
 * 这个文件负责什么：沙箱类型契约的**workspace（工作区目录）**组——节点工作区文件操作
 * 的宿主实现（见 learn/workspace）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/**
 * workspace.*：节点的工作区目录（见 learn/workspace）。
 *
 * 「工作区」是磁盘上**真实存在**的系统目录（users/<uid>/docs/<目标>/<节点>/workspace/）：
 * 用户在系统资源管理器里看得见、自己也能放文件；路径写法与文档 api 同构——
 * 节点路径在前、文件在后（极限/数据/实验.csv），省略 path 就是当前节点。只收文本。
 */
export interface WorkspaceOps {
  /** 列目录（path 省略 = 当前节点的工作区）；目录还不存在时回空清单 */
  list: (path?: string) => unknown
  /** 读一个文本文件；太长的截断并带 totalChars */
  read: (path?: string) => unknown
  /** 写一个文本文件（整份覆盖；父目录自动建），输入 { path, content } */
  write: (input: Record<string, unknown>) => unknown
  /** 定向检索行号与锚点：输入 { path, anchors: ['关键词1', '关键词2'] } 直接返回行号与匹配行，免去全文塞入上下文 */
  grep?: (input: Record<string, unknown> | string) => unknown
  /** 删除工作区文件或目录 */
  delete?: (path: unknown) => unknown
  /** 移动或重命名工作区文件或目录 */
  move?: (inputOrFrom: unknown, maybeTo?: unknown) => unknown
  /** 下载远程文件（图片、PDF、数据等）并保存到工作区文件 */
  download?: (urlOrInput: unknown, maybePath?: unknown) => unknown
}

