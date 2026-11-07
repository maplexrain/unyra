/**
 * 这个文件负责什么：沙箱类型契约的**method（目标级持久化函数）**组的宿主实现 MethodOps
 * （见 learn/methods）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- method：目标级持久化函数 ---------- */

/**
 * method.* 的宿主实现（见 learn/methods）。
 *
 * 与 memory 的分界：memory 存的是「判断与事实」（文本，给人与模型读）；
 * method 存的是**可执行的函数源码**——它存在的意义是被调用（agent 的编排里、
 * 以及超级文档的按钮经 api.method.call）。name 就是身份，create 同名覆盖。
 */
export interface MethodOps {
  /** 清单：名字、体量、更新时间（不带代码本身） */
  list: () => unknown
  /** 新建 / 覆盖；校验（含语法编译）失败回 { error } */
  create: (input: { name?: unknown; code?: unknown }) => unknown
  /** 按 name 删一条 */
  remove: (name: string) => unknown
  /** 按 name 取一份源码；没有回 null */
  find: (name: string) => { name: string; code: string } | null
}

