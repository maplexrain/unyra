import type { User, UserProfile } from './types'
import { createUser, getUser, listUsers, removeUser, updateUser } from './store'
import { signIn, restoreSession, signOut, type Session } from './session'

/**
 * 用户仓储接口 —— 预留给未来接入账号体系（远端 API）。
 *
 * 方法一律返回 Promise，即使当前本地实现是同步的：这样将来换成
 * `fetch(baseUrl + '/users', { headers: { Authorization: token } })` 这类
 * 实现时，调用方（UserDialog / App）的代码一行都不用改。
 *
 * 接入远端时：
 *   1. 在下面的 remoteUserRepo 位置实现一个 UserRepo；
 *   2. 在 userRepo() 里按「是否已登录 / 是否配置了服务端地址」选择实现。
 * 本地与远端的数据合并、同步策略另行设计，当前不做。
 */

export interface UserRepo {
  list(): Promise<User[]>
  get(id: string): Promise<User | null>
  /** 新建用户；实现方决定是否同时把它设为当前用户 */
  create(profile?: Partial<UserProfile>): Promise<User>
  update(id: string, patch: Partial<UserProfile>): Promise<User | null>
  /** 删除用户；不允许删到最后一个 */
  remove(id: string): Promise<boolean>
  /** 登录：建立会话并设置数据作用域 */
  signIn(id: string): Promise<Session>
  /** 登出：清除会话与作用域 */
  signOut(): Promise<void>
  /** 恢复已保存的会话；失效返回 null */
  restore(): Promise<Session | null>
}

/** 本地实现：用户落在 `{root}/users/{uid}/`，作用域切换同步生效 */
const localUserRepo: UserRepo = {
  list: async () => listUsers(),
  get: async (id) => getUser(id),
  create: async (profile) => createUser(profile),
  update: async (id, patch) => updateUser(id, patch),
  remove: async (id) => (await removeUser(id)) !== null,
  signIn: async (id) => signIn(id),
  signOut: async () => signOut(),
  restore: async () => restoreSession(),
}

/**
 * 返回当前应当使用的仓储实现。
 * 目前恒为本地；将来在此处按配置/登录态返回远端实现。
 */
export function userRepo(): UserRepo {
  // 预留：if (isSignedIn()) return remoteUserRepo(baseUrl, token)
  return localUserRepo
}
