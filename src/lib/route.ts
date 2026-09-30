/**
 * 应用内的导航位置与守卫。
 *
 * 只有一道闸门：**登录**（这台机器上现在是哪位用户）。
 *
 * 守卫写成**纯函数、在渲染期裁决**（见 App.tsx）：即便某处忘了走 navigate，
 * 也不可能落到受保护的页面。这是它存在的唯一理由——把「谁能看到什么」
 * 从「谁记得检查」里拿出来。
 */

export type Route = 'login' | 'learn'

/** 未登录 → 登录页；已登录 → 照目标走（登录页本身不可达） */
export function guardRoute(signedIn: boolean, target: Route): Route {
  if (signedIn) return target === 'login' ? 'learn' : target
  return 'login'
}
