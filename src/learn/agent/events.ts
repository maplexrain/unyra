/**
 * 这个文件负责把 Agent 运行时吐出来的事件流累加进 parts（applyEvent）：
 * 流式片段（thinking / text）就在这里合并成气泡里的正文。
 *
 * 从 learn/useAgent 拆出（见 docs/refactor-plan.md 3.8）。
 */

import type { AgentEvent, AgentPart } from '../../agent/types'

/**
 * 把运行时事件累加进 parts。
 *
 * 只增删 / 替换传入数组里的槽位，**不原地修改已有片段对象**：调用方常把上一份 state
 * 浅拷贝后交给 React 的 state updater，而 StrictMode 会把 updater 重放一遍；原地 +=
 * 会让同一个 delta 叠两次（work 实时思考行出现「参考参考、说明说明」的根因）。
 */
export function applyEvent(parts: AgentPart[], e: AgentEvent): void {
  switch (e.type) {
    case 'thinking': {
      const last = parts[parts.length - 1]
      /*
       * 不原地改 last.text：调用方常把 parts 浅拷贝后再传进来（流式槽位 / work 实时槽位），
       * 片段对象会和上一份 state 共享。StrictMode 会重复调用 state updater，第二次仍从
       * 同一份 prev 出发，原地 += 就会把同一个 delta 叠两遍——界面上的思考/正文出现
       * 「参考参考、说明说明」式的重复。替换成新对象，updater 才是可重放的纯函数。
       */
      if (last && last.type === 'thinking') {
        parts[parts.length - 1] = { type: 'thinking', text: last.text + e.delta }
      } else parts.push({ type: 'thinking', text: e.delta })
      break
    }
    case 'text': {
      const last = parts[parts.length - 1]
      if (last && last.type === 'text') {
        parts[parts.length - 1] = { type: 'text', text: last.text + e.delta }
      } else parts.push({ type: 'text', text: e.delta })
      break
    }
    case 'tool-call':
      parts.push({ type: 'tool', id: e.id, name: e.name, args: e.args, result: '', ok: true, status: 'running' })
      break
    case 'tool-result': {
      const at = parts.findIndex((x) => x.type === 'tool' && x.id === e.id)
      if (at >= 0) {
        const p = parts[at] as Extract<AgentPart, { type: 'tool' }>
        /*
         * 三档，不是两档：只有「这段代码根本跑不起来」才算失败；「跑完了，但其中某几次
         * api 调用没有生效」是调用级失败——代码这一层已经交付了，状态仍是完成，
         * 只是界面上点一枚黄（见 ToolCard）。
         */
        parts[at] = {
          ...p,
          result: e.result,
          ok: e.ok,
          soft: e.soft,
          status: e.ok || e.soft ? 'done' : 'error',
          ...(e.images?.length ? { images: e.images } : {}),
        }
      }
      break
    }
    case 'web-tool-start': {
      const at = parts.findIndex((x) => x.type === 'web' && x.id === e.call.id)
      const next = { type: 'web' as const, id: e.call.id, step: e.step, call: e.call }
      if (at >= 0) parts[at] = next
      else parts.push(next)
      break
    }
    case 'web-tool-end': {
      const at = parts.findIndex((x) => x.type === 'web' && x.id === e.call.id)
      if (at >= 0) {
        const p = parts[at] as Extract<AgentPart, { type: 'web' }>
        parts[at] = { ...p, call: e.call }
      } else {
        parts.push({ type: 'web', id: e.call.id, step: e.step, call: e.call })
      }
      break
    }
    /**
     * 整轮结束时的完整清单：补 signature 与每步思考原文；同时兜住流式事件漏掉的
     * 呼叫（服务端只保证最终 chunk 有完整清单）。已在界面上的同 id 片段原位替换，
     * 不把整轮搜索挪到回答末尾。
     */
    case 'web-tools-final': {
      for (const step of e.steps) {
        for (const call of step.calls) {
          const at = parts.findIndex((x) => x.type === 'web' && x.id === call.id)
          if (at >= 0) {
            parts[at] = {
              type: 'web',
              id: call.id,
              step: step.index,
              ...(step.reasoningContent !== undefined ? { reasoning: step.reasoningContent } : {}),
              call,
            }
          } else {
            parts.push({
              type: 'web',
              id: call.id,
              step: step.index,
              ...(step.reasoningContent !== undefined ? { reasoning: step.reasoningContent } : {}),
              call,
            })
          }
        }
      }
      break
    }
    case 'notice':
      parts.push({ type: 'notice', level: e.level, text: e.message })
      break
    /**
     * 请求失败、要重发了：把这一趟吐出去的正文 / 思考（连同上一趟那条「正在重试」）
     * 一起撤掉——重发是从头再生成一遍，留着就会和新回答叠成两段。
     *
     * 只从**末尾**往回撤：失败的那趟只能在这条消息的尾部留下东西
     * （工具卡片与更早的正文都属于前面已经跑通的跳，不能动）。
     */
    case 'retry': {
      while (parts.length) {
        const last = parts[parts.length - 1]
        if (last.type !== 'text' && last.type !== 'thinking' && last.type !== 'notice' && last.type !== 'web') break
        parts.pop()
      }
      break
    }
    // 跳边界：只记一个标记（见 agent/types 的 hop 说明），toChatHistory 按它分段还原
    case 'hop':
      parts.push({ type: 'hop' })
      break
    // 用量与实时速度都不进 parts（那是给界面渲染的正文片段），由调用方单独累计/显示
    case 'usage':
      break
    case 'pace':
      break
    case 'error':
      // 图标由 NoticeBlock 自己画（svg 警示三角），文字里不再拼 ⚠️——两个图标叠在一起
      parts.push({ type: 'notice', level: 'warn', text: e.message })
      break
    case 'done':
      break
  }
}
