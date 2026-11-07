/**
 * 这个文件负责什么：沙箱类型契约的**userInfo（学习者画像）**组的宿主实现 UserInfoOps
 * （见 user/fields 与 learn/agentOps）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- userInfo：学习者画像 ---------- */

/**
 * userInfo.* 的宿主实现（见 user/fields 与 learn/agentOps）。
 *
 * 为什么要有这两个 api：画像原先是被**塞进系统提示词**的——它一变（用户改一次资料），
 * 整段前缀缓存就作废，而绝大多数轮次根本用不到画像里的任何一项。改成主动取之后，
 * 提示词只与目标相关，「这份讲解要不要贴合这个人」由导师自己决定。
 *
 * get 回的是给模型看的那份（**不含头像**，见 user/fields 的 profileForModel）；
 * update 是**增量**语义：只写传进来的字段，其余原样保留。
 */
export interface UserInfoOps {
  /** 读画像；没有当前用户时回 { error } */
  get: () => unknown
  /** 增量更新；认不出的字段与写不进去的值要逐条说明（见 user/fields 的 coerceProfileValue） */
  update: (patch: unknown) => unknown | Promise<unknown>
}

