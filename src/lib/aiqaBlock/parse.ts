import type { ParsedAiqaBlock } from './types'

/**
 * 32 位 FNV-1a 哈希，产出简短的确定性标识。
 */
function fnv1a(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 解析 ```aiqa 围栏内的配置：
 * - system: AI 的系统提示词
 * - question: AI 的固定开场白问题
 */
export function parseAiqaBlock(source: string): ParsedAiqaBlock {
  const lines = source.split(/\r?\n/)
  let system = ''
  let question = ''
  let currentKey: 'system' | 'question' | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    const sysMatch = trimmed.match(/^[-*]?\s*system\s*[:：]\s*(.*)$/i)
    const qMatch = trimmed.match(/^[-*]?\s*question\s*[:：]\s*(.*)$/i)

    if (sysMatch) {
      currentKey = 'system'
      system = sysMatch[1] ?? ''
    } else if (qMatch) {
      currentKey = 'question'
      question = qMatch[1] ?? ''
    } else if (currentKey === 'system') {
      system = system ? `${system}\n${trimmed}` : trimmed
    } else if (currentKey === 'question') {
      question = question ? `${question}\n${trimmed}` : trimmed
    }
  }

  const cleanSystem = system.trim()
  const cleanQuestion = question.trim()
  const id = `aiqa_${fnv1a(`${cleanQuestion}:::${cleanSystem}`)}`

  return {
    id,
    system: cleanSystem,
    question: cleanQuestion,
  }
}
