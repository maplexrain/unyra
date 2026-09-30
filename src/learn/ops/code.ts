/**
 * 代码块伪编译（code.*）这一组的宿主实现：交付口（见 lib/codeArtifacts 的 submitCompile）。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 code.* 一组。
 */

import type { CodeOps } from '../../agent/tools'
import { submitCompile, submitSilent } from '../../lib/codeArtifacts'
import { globalModel } from '../../ai/settings'

/**
 * 代码块伪编译（code.*）的宿主实现：**交货口**（见 lib/codeArtifacts 的 submitCompile）。
 *
 * 为什么在宿主这一侧收：代码原文由渲染层记着（用户点的是哪一块，它最清楚），
 * 模型只需要交「转译结果 + 说明」。让模型回抄一遍代码是自找麻烦——几千行里错一个空格，
 * 指纹就对不上，那块代码的「运行」永远亮不起来。
 *
 * 模型名的取法带一层 try：这个 ops 也会被 Node 探针调用，那里没有 localStorage
 * （见 ai/settings 的读写），编译者的名字本来也只是记账，取不到就留空。
 */
export function createCodeOps(): CodeOps {
  let model = ''
  try {
    model = globalModel()
  } catch {
    model = ''
  }
  return {
    save: async (input) => {
      const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
      const r = await submitCompile({ key: rec.key, js: rec.js, note: rec.note, model })
      if (!r.ok) return { error: r.error }
      return {
        ok: true,
        key: r.key,
        chars: r.chars,
        note:
          '产物已交给宿主：那个代码块上的「运行」已经亮起来了（用户回到文档区就能点）。' +
          '现在在对话里用两三句说清你改了什么、假设了什么，不要重复贴代码。' +
          (r.saved ? '（落盘时有一句提示：' + r.saved + '）' : ''),
      }
    },
    silent: async (input) => {
      const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
      const r = await submitSilent({ key: rec.key, reason: rec.reason })
      if (!r.ok) return { error: r.error }
      return {
        ok: true,
        key: r.key,
        note:
          '已记下「无输出」：那个代码块从此只显示「复制」，不再有编译与运行（重启之后也是）。' +
          '现在在对话里用一句话告诉用户为什么它没有输出（比如「这段只有类型定义，没有会被执行的语句」），' +
          '不要写代码、不要再调其他 api。' +
          (r.saved ? '（落盘时有一句提示：' + r.saved + '）' : ''),
      }
    },
  }
}
