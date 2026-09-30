/** 这个文件负责什么：资源库的数据形状——一条资源（StaticResource）、它属于文本还是二进制，以及「哪份文档引用了它」（ResourceRef）。 */

/**
 * 资源类型只有两类。
 *
 * 「文本 / 二进制」这个粗分类是给**行为**用的：文本能读能改内容（改完回写文件），
 * 二进制的元数据（名称、描述）能改、内容不能。界面据此决定给不给「编辑」。
 * 更细的类型（图片 / PDF / 音频）由后缀推 mime 得到，不单独存字段——
 * 存了就要维护，而它完全可以从 ext 推出来。
 */
export type ResourceType = 'text' | 'binary'

/** 一条资源。字段与清单文件里的键一一对应（清单是给人看的，键名不改写）。 */
export interface StaticResource {
  /** 标识，同时就是磁盘上的文件名（不含后缀） */
  uuid: string
  /** 展示名：原文件名去后缀；粘贴来的图给「粘贴的图片 N」 */
  name: string
  /** 后缀，小写、不含点；文件就是 \`{uuid}.{ext}\` */
  ext: string
  type: ResourceType
  /** 一句话说明。由 Agent 写（见 res.update），可空 */
  description: string
  /** 上传日期 */
  createdAt: number
  /** 修改日期：改内容、改名、改描述都会动它 */
  updatedAt: number
  bytes: number
  /**
   * 内容指纹（SHA-256 十六进制；环境不支持时退回 fnv1a-…）。
   *
   * 用来**避免同一份内容存两遍**：转存、res.create、res.update 都会先算它，
   * 命中同目标里已有的资源就直接复用那条（uuid 不变、文件不重写）。
   * 老清单里没有这一项，读回来是空串（此时不参与去重，不影响其它字段）。
   */
  hash: string
}

/** 一处引用：哪份文档的哪个位置引用了这条资源 */
export interface ResourceRef {
  nodeId: string
  /** 节点的可读路径（如「极限/夹逼定理」） */
  path: string
  title: string
  /** 引用了它的文档 */
  doc: 'teaching' | 'note'
  docLabel: string
  /** 出现次数 */
  count: number
  /** 引用发生在别的目标里（跨目标引用是允许的，但值得提醒） */
  foreign: boolean
}
