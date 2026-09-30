/**
 * 这个文件负责什么：当前用户的数据目录前缀（`users/{uid}/`）——进程内唯一的那一份小状态。
 *
 * 为什么单独住一个文件：persist 要调 assets 搬资源目录，assets 拼路径时又要读 uid，
 * 两边互相 import 就成环。uid 本身只与「现在是谁在用」有关，与谁读它无关，单独立在这里
 * 就把环断开了——**变量本身仍然只有这一份**（模块单例语义不能复制到两个地方）。
 *
 * 谁写：lib/boot.ts 载入用户 → persist 的 hydrateLearnStore；谁读：persist 与 assets。
 */

let docsUid: string | null = null

/** 当前用户的数据目录前缀（`users/{uid}/`）；未登录为 null。 */
export function currentDocsUid(): string | null {
  return docsUid
}

/** 换用户（或退出登录）时改这一份；uid 为 null 表示未登录。 */
export function rememberDocsUid(uid: string | null): void {
  docsUid = uid
}
