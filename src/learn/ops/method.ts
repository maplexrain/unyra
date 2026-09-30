/**
 * 目标级持久化函数（method.*）这一组 ops 的宿主实现（见 learn/methods）。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 method.* 一组。
 */

import type { MethodOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import { findMethod, listMethods, removeMethod, upsertMethod } from '../methods'

/**
 * 目标级持久化函数（method.*）的宿主实现（见 learn/methods）。
 *
 * find 只回源码、不执行：执行发生在 agent/tools 的 method.call 里——
 * 只有那里拿得到「当前这次编排的 api」注入给函数。超级文档的桥走
 * runMethodEntry + 常驻 api（buildStandaloneApi），语义相同。
 */
export function createMethodOps(deps: AgentOpsDeps): MethodOps {
  const store0 = () => deps.getLatest()
  const goal = () => deps.goalId()

  return {
    list: () => {
      const items = listMethods(store0(), goal())
      return {
        count: items.length,
        items,
        note: items.length
          ? 'method.call(name, ...args) 执行一个；超级文档的脚本也是这样调它们。'
          : '这个目标还一个函数都没有。method.create({ name, code }) 建一个。',
      }
    },

    create: (input) => {
      const r = upsertMethod(store0(), goal(), input, Date.now())
      if (!r.ok) return { error: r.error }
      deps.set(r.store)
      return {
        ok: true,
        name: r.name,
        ...(r.updated ? { updated: true } : { created: true }),
        note:
          (r.updated ? '已覆盖更新函数「' + r.name + '」' : '已创建函数「' + r.name + '」') +
          '。编排里 method.call("' + r.name + '", 实参) 执行；超级文档的脚本里写 api.method.call。',
      }
    },

    remove: (name) => {
      const s = store0()
      if (!findMethod(s, goal(), name)) {
        const items = listMethods(s, goal()).map((x) => x.name).join('、')
        return { error: '没有叫「' + name + '」的函数。' + (items ? '现有的：' + items : '这个目标还一个函数都没有。') }
      }
      deps.set(removeMethod(s, goal(), name))
      return { ok: true, deleted: name }
    },

    find: (name) => {
      const m = findMethod(store0(), goal(), name)
      return m ? { name: m.name, code: m.code } : null
    },
  }
}
