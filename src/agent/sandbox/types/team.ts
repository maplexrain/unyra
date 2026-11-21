/**
 * 智能体团队编排（team.*）：agent team 里两位声部（仅聊天 / 导师）之间的**委托**通道。
 *
 * 与 subagent.* 的差别：subagent 是一轮对话内部的临时帮手（定义即启动、随对话消亡）；
 * team 是**声部级**的长期协作——把一项任务排队交给另一位声部，由它在自己的会话里
 * 独立跑完，交付结果再传回委托者（空闲时激活、运行中在跳边界注入）。实现见
 * learn/agentTeam/delegations（注册表）与 learn/ops/team（宿主接线）。
 *
 * **导师专用**：SUBAGENT_ALLOWED_GROUPS 不含这一组（子代理不该再往外派活），
 * 仅聊天的沙箱基座里也没有它——委托的发起与承接双方都由宿主裁决。
 */
export interface TeamOps {
  /** 列出当前可用的智能体（id + 显示名） */
  list: () => unknown
  /** 按 id 查询某位智能体的状态：是否在跑 / 是否正在处理委托 / 有几个未处理委托 */
  status: (agentId: string) => unknown
  /**
   * 把任务委托给某位智能体。**只排队、不堵塞**：目标空闲时立即启动，忙碌时等它
   * 收口后接续。preemptibleMs / preemptibleUntil 声明本委托在多久之内允许被
   * 后续委托插队（见 delegations 的插队算法）。
   */
  delegate: (input: Record<string, unknown>) => unknown
  /** 结束委托：交付结果传回委托者（空闲激活 / 运行中跳边界注入） */
  complete: (input: Record<string, unknown>) => unknown
  /** 本轮收口后延迟自启动；期间若有新启动（用户发消息、委托激活）则失效 */
  awake: (input: unknown) => unknown
}
