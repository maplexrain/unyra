import { emptyProfile, makeUser, type User, type UserProfile } from './types'
import { normalizeProfile } from './profile'
import { ASSETS_DIR, assetUrl } from './assets'
import { AVATAR_FILE_PREFIX, migrateDataUrlAvatar } from './avatar'
import { listDir, readYaml, removePath, userRel, writeYaml } from '../lib/storage'

/**
 * 用户数据的持久化与「数据作用域」。
 *
 * 落盘结构（root 见 electron/storage.ts，默认为 appdata 里的应用数据目录）：
 *
 *   {root}/users/{uid}/user.yaml        用户信息（这个文件）
 *   {root}/users/{uid}/setting.yaml     用户配置（外观 + AI，见 lib/userSettings）
 *   {root}/users/{uid}/state.json       学习区界面状态
 *   {root}/users/{uid}/assets/…         静态资源（头像等，见 user/assets）
 *   {root}/users/{uid}/docs/…           教学文档（见 learn/files）
 *
 * `assets/` 里放的是**真实文件**（头像就是一张 png），user.yaml 里只记一个
 * `asset:文件名` 的短地址。从前头像是把 base64 直接写进 user.yaml 的，那份文件因此
 * 动辄几百 KB、每次启动都要整份解析——这一版改掉了（见 user/types 的 avatar 字段）。
 * 目录**按需出现**：没有静态资源的用户在磁盘上就没有这个目录。
 *
 * **用户列表就是 users/ 下的目录列表**：不再有一份单独的索引文件——目录即索引，
 * 少一份需要保持同步的数据。目录名即 uid，也是 user.yaml 里的 id 的权威来源。
 *
 * 作用域是用户级隔离的机制：存储层（learn/store、ai/settings、lib/appearance）
 * 读取时同步取当前 uid，不必层层传参。只有「当前用户」这一个模块级变量，
 * 启动顺序由 lib/boot.ts 保证：先 bootstrapUsers() 与 restoreSession()，
 * 再载入该用户的配置与教学文档。
 */

/** 用户列表的内存缓存；bootstrapUsers 填充，增删改同步维护 */
let users: User[] = []

let currentUserId: string | null = null

/* ---------- 作用域 ---------- */

export function activeUserId(): string | null {
  return currentUserId
}

/**
 * 切换当前用户作用域。
 * 只改内存：谁是「当前用户」由会话决定（见 session.ts），这里不落盘。
 */
export function setActiveUserScope(userId: string | null): void {
  currentUserId = userId
}

/* ---------- 读写 ---------- */

function normalizeUser(raw: unknown, fallbackId: string): User | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const now = Date.now()
  return {
    id: fallbackId,
    profile: normalizeProfile(r.profile),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
  }
}

/**
 * 把老数据里那段 base64 头像迁成 assets/ 下的真实文件（见 user/avatar 的
 * migrateDataUrlAvatar）。
 *
 * **必须在 normalizeProfile 之前动手**：normalizeAvatar 现在会把 `data:` 一律丢掉，
 * 先归一就等于当场把用户的头像删了——迁移就再也看不到它。所以在**原始** yaml 上改，
 * 改完再归一。
 *
 * 迁移失败（写盘失败、data URL 形状不认）时原样返回，用户至少还留着那段 base64；
 * 下一次启动会再试一遍。
 */
async function migrateAvatarIfNeeded(uid: string, raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  const profile = r.profile
  if (!profile || typeof profile !== 'object') return raw
  const p = profile as Record<string, unknown>
  const avatar = typeof p.avatar === 'string' ? p.avatar.trim() : ''
  if (!/^data:image\//i.test(avatar)) return raw

  const next = await migrateDataUrlAvatar(uid, avatar)
  if (next === avatar) return raw
  const migrated = { ...r, profile: { ...p, avatar: next } }
  // 迁移后的 yaml 立刻写回：下一次启动读到的就是新形态，不会反复迁
  await writeYaml(userRelOf(uid), migrated)
  return migrated
}

/** user.yaml 的内容。id 与目录名同值：图个可读，读回时以目录名为准 */
function userDoc(user: User): Record<string, unknown> {
  return {
    version: 1,
    id: user.id,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profile: user.profile,
  }
}

/**
 * 清扫某个用户 `assets/` 里不再被引用的头像文件。
 *
 * 「不再被引用」只有两种来路：换头像时留下的旧文件，以及在对话框里上传之后
 * **没保存就关掉**的那一张。两种都不该让 assets/ 一直攒下去；而它们的名字都带
 * `avatar-` 前缀，所以按「前缀 + 不等于当前在用的那一个」来清就够精确了——
 * 用户自己往 assets/ 里放的别的东西（这个目录本来就不只是给头像用的）不会被碰。
 *
 * 这里一律用**相对数据根**的路径（`listDir` / `removePath` + `userRel(uid, …)`），
 * 不走 `*User*` 那一组：bootstrap 时当前用户还没定，那一组会静默地什么都不做。
 */
async function pruneAvatarAssets(uid: string, keep: string): Promise<void> {
  const entries = await listDir(userRel(uid, ASSETS_DIR))
  for (const e of entries) {
    if (e.dir || !e.name.startsWith(AVATAR_FILE_PREFIX)) continue
    if (assetUrl(e.name) === keep) continue
    await removePath(userRel(uid, ASSETS_DIR, e.name))
  }
}

const userRelOf = (uid: string): string => userRel(uid, 'user.yaml')

async function writeUser(user: User): Promise<void> {
  await writeYaml(userRelOf(user.id), userDoc(user))
}

/**
 * 启动时调用一次：列出 users/ 下的用户；一个都没有（首次运行）就建一个默认用户。
 *
 * 返回的列表已按创建时间排序——目录列表的顺序由文件系统决定，不稳定。
 */
export async function bootstrapUsers(): Promise<User[]> {
  const entries = await listDir('users')
  const dirs = entries.filter((e) => e.dir).map((e) => e.name)

  const loaded: User[] = []
  for (const uid of dirs) {
    const raw = await readYaml<Record<string, unknown>>(userRelOf(uid))
    /*
     * 先迁头像、再归一（顺序不能反，见 migrateAvatarIfNeeded 的说明）。
     * 顺手把 assets/ 里不再被引用的旧头像清掉：换过几次头像的用户，或者上传之后
     * 没保存就关掉的那一次，都会在那里留下文件——启动是唯一「一定会经过」的时点。
     */
    const migrated = await migrateAvatarIfNeeded(uid, raw)
    // 目录在、user.yaml 读不出来（被手工删了、损坏了）：当作空画像的用户收下，
    // 至少不让人凭空消失，之后保存时会把这个文件补回来
    const user = normalizeUser(migrated, uid)
    if (user) {
      await pruneAvatarAssets(uid, user.profile.avatar)
      loaded.push(user)
    }
  }
  loaded.sort((a, b) => a.createdAt - b.createdAt)

  if (loaded.length) {
    users = loaded
    return users
  }

  const user = makeUser({ nickname: '本机用户' })
  await writeUser(user)
  users = [user]
  return users
}

/* ---------- 查询 ---------- */

export function listUsers(): User[] {
  return users
}

export function getUser(id: string): User | null {
  return users.find((u) => u.id === id) ?? null
}

export function userCount(): number {
  return users.length
}

/** 当前用户的完整记录 */
export function activeUser(): User | null {
  return currentUserId ? getUser(currentUserId) : null
}

/**
 * 当前用户的画像。AI 调用在发起时现取，保证用的是最新画像，
 * 也避免把 profile 一路透传到每个组件（与 loadAiSettings 的用法一致）。
 */
export function activeProfile(): UserProfile | null {
  return activeUser()?.profile ?? null
}

/* ---------- 增删改（供 UserRepo 本地实现调用） ---------- */

/** 新建用户：写 user.yaml，并把当前作用域切到新用户（新建即使用） */
export async function createUser(profile?: Partial<UserProfile>): Promise<User> {
  const user = makeUser(profile)
  await writeUser(user)
  users = [...users, user]
  currentUserId = user.id
  return user
}

export async function updateUser(id: string, patch: Partial<UserProfile>): Promise<User | null> {
  const existing = getUser(id)
  if (!existing) return null
  const merged: User = {
    ...existing,
    // 逐字段归一，避免把非法值（超长头像地址、越界年龄）写进存储
    profile: { ...emptyProfile(), ...normalizeProfile({ ...existing.profile, ...patch }) },
    updatedAt: Date.now(),
  }
  users = users.map((u) => (u.id === id ? merged : u))
  await writeUser(merged)
  // 头像换过之后，旧的那个文件就没人引用了（清掉；同名/外链一律不受影响）
  await pruneAvatarAssets(id, merged.profile.avatar)
  return merged
}

export interface RemoveUserResult {
  users: User[]
  activeUserId: string
}

/**
 * 删除用户：整个 `users/{uid}/` 目录一并删掉——user.yaml、setting.yaml、教学文档
 * 都在里面，一次 rm 就干净了。
 *
 * 至少要留一个：删到最后一个时返回 null（界面也应禁用）。
 * 删的是当前用户时，作用域自动切到剩下的第一个。
 */
export async function removeUser(id: string): Promise<RemoveUserResult | null> {
  if (!users.some((u) => u.id === id)) return null
  const remaining = users.filter((u) => u.id !== id)
  if (!remaining.length) return null

  await removePath(userRel(id))
  users = remaining
  const activeUserId = currentUserId === id ? remaining[0].id : (currentUserId ?? remaining[0].id)
  if (currentUserId === id) currentUserId = activeUserId
  return { users: remaining, activeUserId }
}
