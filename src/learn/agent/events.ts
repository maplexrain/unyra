/**
 * 这个文件负责把 Agent 运行时吐出来的事件流累加进 parts（applyEvent）：
 * 流式片段（thinking / text）就在这里合并成气泡里的正文。
 *
 * 从 learn/useAgent 拆出（见 docs/refactor-plan.md 3.8）。
 */

import type { AgentEvent, AgentPart } from '../../agent/types'

/** 把运行时事件累加进 parts（原地修改，外层用新数组触发渲染） */
export function applyEvent(parts: AgentPart[], e: AgentEvent): void {
  switch (e.type) {
    case 'thinking': {
      const last = parts[parts.length - 1]
      if (last && last.type === 'thinking') last.text += e.delta
      else parts.push({ type: 'thinking', text: e.delta })
      break
    }
    case 'text': {
      const last = parts[parts.length - 1]
      if (last && last.type === 'text') last.text += e.delta
      else parts.push({ type: 'text', text: e.delta })
      break
    }
    case 'tool-call':
      parts.push({ type: 'tool', id: e.id, name: e.name, args: e.args, result: '', ok: true, status: 'running' })
      break
    case 'tool-result': {
      const p = parts.find((x): x is Extract<AgentPart, { type: 'tool' }> => x.type === 'tool' && x.id === e.id)
      if (p) {
        p.result = e.result
        p.ok = e.ok
        p.soft = e.soft
        /*
         * 三档，不是两档：只有「这段代码根本跑不起来」才算失败；「跑完了，但其中某几次
         * api 调用没有生效」是调用级失败——代码这一层已经交付了，状态仍是完成，
         * 只是界面上点一枚黄（见 ToolCard）。
         */
        p.status = e.ok || e.soft ? 'done' : 'error'
        // 工具附带的图片（如 res.read 看了一张图）：只存引用，字节在磁盘上
        if (e.images?.length) p.images = e.images
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
        if (last.type !== 'text' && last.type !== 'thinking' && last.type !== 'notice') break
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
