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
        p.status = e.ok ? 'done' : 'error'
        // 工具附带的图片（如 res.read 看了一张图）：只存引用，字节在磁盘上
        if (e.images?.length) p.images = e.images
      }
      break
    }
    case 'notice':
      parts.push({ type: 'notice', level: e.level, text: e.message })
      break
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
      parts.push({ type: 'notice', level: 'warn', text: `⚠️ ${e.message}` })
      break
    case 'done':
      break
  }
}
