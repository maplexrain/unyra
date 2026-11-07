/**
 * 这个文件负责什么：IPC 契约的**公告（远程公告的本地状态）**通道组——NoticeSettings，
 * 公告在本机的偏好与已读清单（跟机器走，见 electron/storage/settings.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 公告（远程公告的本地状态） ---------- */

/**
 * 公告在**本机**的状态（落在 appdata 的 global.yaml，跟机器走，不属于任何用户）。
 *
 * 为什么是「跟机器走」而不是「跟用户走」：公告是应用级的一句话（新版发布、服务调整），
 * 同一台机器上换个用户登录，不该又弹一遍；同理，用户关掉自动弹出也该对这台机器上的
 * 所有用户生效。
 *
 * 谁在用：主进程 electron/storage/settings.ts（读写）与 electron/storage/ipc.ts
 * （notice:get / notice:set），preload 的 notice.*，渲染层 src/lib/notice.ts。
 */
export interface NoticeSettings {
  /** 用户偏好：启动时要不要自动弹出公告（默认 true = 每次打开都弹） */
  autoShow: boolean
  /**
   * 上一次「自动弹出决策」生效时的**软件版本号**。
   *
   * 这是「每次更新后强制弹一次」的判据，刻意**不是**一个布尔标志：装上新版本之后
   * 版本号必然与这里存的不同 → 强制弹一次；弹完把版本号追平 → 下次启动不再强制。
   * 这样既做到了「更新后必弹」，又**不会**去重置用户的 autoShow 选择
   * （重置用户选择是一种「用副作用换效果」的写法：用户会发现自己的设置被悄悄改了）。
   */
  shownVersion: string
  /**
   * **已经读过的公告 id**（只增不减，最多保留最近 200 条）。
   *
   * 唯一的用途是顶栏那颗**红点**：还有没读过的公告（含轮询期间新到的）就点亮，
   * 全读完就熄灭。它**不参与**「要不要自动弹出」的判定——那个只看 shownVersion
   * 与 autoShow（理由见 src/lib/notice 的 shouldAutoShow）。
   *
   * 什么时候算读过：公告在弹窗里被显示出来（当前页签）时，以及关掉弹窗时
   * （那时候用户已经有机会看过了）。
   */
  readIds: string[]
}

