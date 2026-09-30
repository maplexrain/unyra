/**
 * 用户配置（`{root}/users/{uid}/setting.yaml`）。
 *
 * 一个用户一份文件，装两类配置：外观（主题、正文字号系数）与 AI（提供商、Key、默认模型）。
 * 它们都跟着用户走，所以同文件同生命周期；分开的只是模块（lib/appearance、
 * ai/settings），各自只管自己那一片。
 *
 * 读在启动：lib/boot.ts 载入当前用户时把整份文件读进内存，之后 appearance 与
 * ai/settings 都是同步读内存，界面代码不必 await。写则是「改内存 + 调度落盘」。
 */

import { readYaml, scheduleCommit, userRel, writeYaml } from './storage'

export interface UserSettingsFile {
  version: 1
  appearance: unknown
  ai: unknown
  /** 改过键的快捷键：id → 组合串（没改过的不写进来，默认值归代码） */
  shortcuts: unknown
  /** 语音输入（开关；模型路径归主进程管） */
  voice: unknown
  /** 超级导师自己的设置（上下文压缩阈值等，见 agent/settings） */
  agent: unknown
}

export type SettingsKey = 'appearance' | 'ai' | 'shortcuts' | 'voice' | 'agent'

const settingsRel = (uid: string): string => userRel(uid, 'setting.yaml')

let uid: string | null = null
let file: UserSettingsFile = { version: 1, appearance: null, ai: null, shortcuts: null, voice: null, agent: null }
/**
 * 每次载入自增。缓存（ai/settings）据此判断「内存里这份是不是被换过了」——
 * 同一个 uid 重新载入时 uid 没变，只有版本号能区分。
 */
let revision = 0

export const settingsUid = (): string | null => uid
export const settingsRevision = (): number => revision

/** 载入某个用户的配置；uid 为 null 表示未登录，回到空配置 */
export async function hydrateUserSettings(nextUid: string | null): Promise<void> {
  uid = nextUid
  revision++
  file = { version: 1, appearance: null, ai: null, shortcuts: null, voice: null, agent: null }
  if (!nextUid) return
  const raw = await readYaml<Partial<UserSettingsFile>>(settingsRel(nextUid))
  if (raw && typeof raw === 'object') {
    file = {
      version: 1,
      appearance: raw.appearance ?? null,
      ai: raw.ai ?? null,
      shortcuts: raw.shortcuts ?? null,
      voice: raw.voice ?? null,
      agent: raw.agent ?? null,
    }
  }
}

/** 同步读某一片配置的原始值；归一化由各自的模块负责 */
export function readUserSettings(key: SettingsKey): unknown {
  return file[key]
}

/**
 * 改内存并调度落盘。整份覆盖写，丢掉中间态没有副作用。
 *
 * 落盘时用的是**这一刻的快照**而不是模块变量：调度是延迟执行的，期间可能切了用户
 * 或又改了另一片配置——写快照才能保证「这次改动落在这位用户的文件里」。
 */
export function writeUserSettings(key: SettingsKey, value: unknown): void {
  file = { ...file, [key]: value }
  const owner = uid
  if (!owner) return
  const rel = settingsRel(owner)
  const snapshot = file
  scheduleCommit(`settings:${owner}`, {
    run: async () => {
      await writeYaml(rel, snapshot)
    },
    runSync: () => [{ rel, kind: 'yaml', data: snapshot }],
  })
}
