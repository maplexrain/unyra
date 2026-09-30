import { getUser, setActiveUserScope } from './store'
import { readSessionFile, writeSessionFile } from '../lib/storage'

/**
 * 会话与登录态。
 *
 * 本地实现：登录即「选定本机某个用户」，登出清除会话。没有密码——
 * 数据本来就都在同一台电脑上，假密码只会制造安全错觉。
 *
 * 会话存在 **appdata**（session.json），而不是用户数据目录：它是「这台机器上
 * 现在是谁在用」的易失状态，不属于任何一位用户的数据。换个数据目录，用户列表
 * 跟着换，但没必要因此把人踢下线。
 *
 * 将来接账号体系时：
 *   - 把 signIn 的入参扩展为凭据（如 { userId, password } 或 { token }）；
 *   - 由远端校验后返回用户与 token，这里只负责保存会话与设置作用域；
 *   - 导航守卫不变——它只关心「是否已登录」，与凭据形式无关（见 lib/route）。
 */

export interface Session {
  userId: string
  signedInAt: number
}

/** 内存中的会话；signIn / signOut / restoreSession 维护 */
let current: Session | null = null

/* ---------- 持久化 ---------- */

function normalizeSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.userId !== 'string' || !r.userId) return null
  return {
    userId: r.userId,
    signedInAt: typeof r.signedInAt === 'number' ? r.signedInAt : Date.now(),
  }
}

/* ---------- 登录 / 登出 ---------- */

/**
 * 登录：设置数据作用域并持久化会话。
 * 返回会话对象（供调用方取 userId 等）。
 */
export async function signIn(userId: string): Promise<Session> {
  // 作用域先切，后续的读写（教学文档、AI 设置、外观）才会落到该用户
  setActiveUserScope(userId)
  const session: Session = { userId, signedInAt: Date.now() }
  current = session
  await writeSessionFile(session)
  return session
}

/** 登出：清除会话与作用域——之后任何读写都会退化为「无用户」状态 */
export async function signOut(): Promise<void> {
  current = null
  await writeSessionFile(null)
  setActiveUserScope(null)
}

/**
 * 启动时恢复会话。会话里的用户已被删除（或文件损坏）时视为未登录，
 * 顺带把作用域清干净，避免落到错误的数据上。
 *
 * 必须在 bootstrapUsers() 之后调用：校验会话需要用户列表。
 */
export async function restoreSession(): Promise<Session | null> {
  const session = normalizeSession(await readSessionFile<unknown>())
  if (!session) {
    // 未登录：清作用域，避免沿用上一次的 activeUserId 读到别人的数据
    setActiveUserScope(null)
    return null
  }
  if (!getUser(session.userId)) {
    await signOut()
    return null
  }
  setActiveUserScope(session.userId)
  current = session
  return session
}

/** 当前会话；未登录为 null */
export function currentSession(): Session | null {
  return current
}

/** 当前是否已登录。以内存会话为准，避免与文件读写不同步 */
export function isSignedIn(): boolean {
  return current !== null
}

/*
 * 导航守卫（guardRoute / Route）已搬到 src/lib/route.ts。
 */
