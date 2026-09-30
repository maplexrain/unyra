/**
 * 学习者画像（userInfo.*）这一组 ops 的宿主实现（见 user/fields）。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 userInfo.* 一组。
 */

import type { UserInfoOps } from '../../agent/tools'
import type { UserInfoIo } from './deps'
import {
  PROFILE_FIELD_LABEL,
  coerceProfileValue,
  isProfileField,
  profileFieldList,
  profileForModel,
  type ProfileField,
} from '../../user/fields'
import type { UserProfile } from '../../user/types'

/**
 * 学习者画像（userInfo.*）的宿主实现（见 user/fields）。
 *
 * 两条边界写在这里：
 * 1. **头像不出门**：profileForModel 已经把它摘掉（一段 data URL 上限 256KB，
 *    进上下文就是几十万字符的灾难），这一层不要再把整个 profile 原样递出去。
 * 2. **写不进去要说清楚**：认不出的字段、越界的年龄、认不出的性别逐条回报，
 *    **不因为一个字段不合法就整单丢掉**——导师看到 skipped 才知道该换个问法，
 *    否则它会以为「画像已经补全了」，下一轮又问一遍同样的东西。
 */
export function createUserInfoOps(io: UserInfoIo): UserInfoOps {
  return {
    get: () => {
      const view = profileForModel(io.read())
      if (!view) {
        return {
          error:
            '读不到当前用户的画像（还没登录、或用户数据尚未载入）。这一轮就按通用深度讲，' +
            '不要臆断他的语言、背景与经历。',
        }
      }
      return view
    },

    update: async (patch) => {
      const src = patch && typeof patch === 'object' ? (patch as Record<string, unknown>) : {}
      const keys = Object.keys(src)
      if (!keys.length) {
        return {
          error:
            '没有给出要改的字段。用法：api.userInfo.update({ education: "本科", role: "后端工程师" })。' +
            '可写字段：' + profileFieldList(),
        }
      }
      const clean: Record<string, unknown> = {}
      const applied: Array<{ field: ProfileField; label: string; value: string | number; note?: string }> = []
      const skipped: Array<{ field: string; reason: string }> = []
      for (const key of keys) {
        if (!isProfileField(key)) {
          skipped.push({ field: key, reason: '认不出的字段名' })
          continue
        }
        const c = coerceProfileValue(key, src[key])
        if (!c.ok) {
          skipped.push({ field: key, reason: c.reason })
          continue
        }
        clean[key] = c.value
        applied.push({ field: key, label: PROFILE_FIELD_LABEL[key], value: c.value, ...(c.note ? { note: c.note } : {}) })
      }
      if (!applied.length) {
        return {
          ok: false,
          content:
            '一个字段都没写进去：' +
            skipped.map((s) => s.field + '（' + s.reason + '）').join('；') +
            '。可写字段：' + profileFieldList(),
        }
      }
      const next = await io.update(clean as Partial<UserProfile>)
      if (!next) return { error: '画像没能存下来（没有当前用户，或写盘失败）。这一轮先按原来的信息讲。' }
      const view = profileForModel(next)
      const missing = view?.missing ?? []
      const notices = applied.filter((a) => a.note).map((a) => a.label + '：' + a.note)
      return {
        ok: true,
        updated: applied.map((a) => a.label + '=' + a.value),
        ...(notices.length ? { notices } : {}),
        ...(skipped.length ? { skipped } : {}),
        profile: view,
        note:
          '已**增量**写进画像（只动了上面这几个字段，其余原样保留）。' +
          (missing.length
            ? '还没填的：' + missing.join('、') + '——这次确实需要的话，用 api.ask 问（题目上写 userInfo: \'字段名\'，用户提交即落库）。'
            : '画像现在是完整的。'),
      }
    },
  }
}
