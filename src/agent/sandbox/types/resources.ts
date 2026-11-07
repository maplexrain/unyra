/**
 * 这个文件负责什么：沙箱类型契约的**res（资源库）**组的宿主实现 ResourceOps
 * （见 learn/agentOps 与 learn/static）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/**
 * 资源库操作：沙箱里 res.* 的宿主实现（见 learn/agentOps 与 learn/static）。
 *
 * 除 list / info / refs 外都是异步的（要读写磁盘）。返回的普通对象会直接序列化给模型，
 * 因此**文字要写成人话**：模型只有这一句话能依据。
 */
export interface ResourceOps {
  /** 清单：本目标的全部资源（含引用数） */
  list: () => unknown
  /** 单条资源的详情 */
  info: (uuid: string) => unknown
  /** 读。文本回内容（可给区间）；图片不回数据，而是挂到下一跳；其它二进制只回元数据 */
  read: (uuid: string, range?: { start?: number; end?: number }) => Promise<unknown>
  /** 新建一份文本资源 */
  create: (input: { name: string; ext: string; content: string }) => Promise<unknown>
  /** 改名称 / 描述 / 文本内容 */
  update: (
    uuid: string,
    patch: { name?: string; description?: string; content?: string; caption?: string; order?: number },
  ) => Promise<unknown>
  /** 删。还被引用时必须 force 才动手 */
  remove: (uuid: string, force: boolean) => Promise<unknown>
  /** 被引用扫描：给了 uuid 就查这一条被谁引用，不给就列出全部资源的引用状况 */
  refs: (uuid?: string) => unknown
}

