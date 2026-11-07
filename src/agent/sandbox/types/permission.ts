/**
 * 这个文件负责什么：沙箱类型契约的**permission（路径放行）**组——审批载荷与宿主实现。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- permission：路径放行 ---------- */

/** permission.request 的入参（api 层已把 path 归一化为非空字符串） */
export interface PermissionRequestPayload {
  /** 要放行的目录（绝对路径，或相对数据根的路径） */
  path: string
  /** 为什么需要它——原样显示在审批卡片上 */
  reason?: string
}

/**
 * permission 组的宿主实现：外部路径放行的查看 / 撤销 / 审批（行为在 agent/permissions）。
 *
 * 与 ask 的分工：ask 是 agent-用户-agent（答案回到模型手里，怎么用由模型决定）；
 * permission.request 是 agent-用户-系统——用户批准后**由宿主直接把目录写进放行配置**
 * （agent/settings 的 permissions.allowedDirs，saveAgentSettings 会同步到主进程），
 * 模型只拿到「批准了没有」。可访问作用域 = 数据根目录（恒可访问、不可撤销）+ 放行清单。
 */
export interface PermissionOps {
  /** 当前可访问的作用域：数据根 root + 已放行目录 allowedDirs */
  list(): unknown
  /** 撤销一个已放行的目录（归一化后精确匹配；数据根不在清单里、无可撤销） */
  revoke(path: string): unknown
  /** 请求放行：弹审批并阻塞到用户抉择，批准由宿主落配置；返回值带 approved */
  request(payload: PermissionRequestPayload): Promise<unknown>
}

