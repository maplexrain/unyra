/**
 * 这个文件负责什么：沙箱类型契约的**see（看图）**组——顶层 api see 的入参（见 learn/see）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/**
 * see 的入参（顶层 api，见 SandboxOptions.see 与 learn/see）。
 *
 * raw 是字符串写法：http(s) 图片地址、`data:image/...;base64,…`、或裸 base64；
 * 对象写法把字段拆开，还能补 mime（裸 base64 没有前缀时靠它，或靠魔数嗅探）与 name。
 * pdf 分支看一份 PDF 的页面：pdf 收 http(s) 地址 / moji:static/<uuid> / 用户相对路径，
 * page 从 1 起（单个或数组，一次最多 4 页），只渲染成图、不提取文字层。
 */
export interface SeeRequest {
  raw?: string
  url?: string
  base64?: string
  mime?: string
  name?: string
  pdf?: string
  page?: number | number[]
  /** 图片说明或题注（如 '图 3 整体架构'），直接写入静态资源库元数据 */
  caption?: string
  /** 排序序号（如 1, 2, 3），直接写入静态资源库元数据，便于 res.list 原样呈现 */
  order?: number
}

